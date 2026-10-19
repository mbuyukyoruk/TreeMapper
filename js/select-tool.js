// Canvas tools, as in Illustrator: Select (V) and Pan (H).
// Select: drag on an empty part of the canvas to draw a rectangle; the tips inside
// it (their node, or their label) are selected when the mouse is released.
// Shift adds to the selection, Alt/Option takes away. A collapsed or cartooned
// clade inside the rectangle counts as all of its tips. Hold Space to pan instead.
// Pan: dragging moves an expanded tree (the earlier behaviour).
// The selection is applied by applyTipSelection() in app.js (like search results).
(function () {
  'use strict';
  var KEY = 'treemapper.canvasTool';
  var svgEl = document.getElementById('svg');
  var canvas = document.getElementById('canvas');
  var btnSelect = document.getElementById('proToolSelect'), btnPan = document.getElementById('proToolPan');
  if (!svgEl || !canvas) return;

  function setTool(t, quiet) {
    t = t === 'pan' ? 'pan' : 'select';
    window.tmCanvasTool = t;
    if (btnSelect) { btnSelect.classList.toggle('active', t === 'select'); btnSelect.setAttribute('aria-pressed', String(t === 'select')); }
    if (btnPan) { btnPan.classList.toggle('active', t === 'pan'); btnPan.setAttribute('aria-pressed', String(t === 'pan')); }
    if (!quiet) { try { localStorage.setItem(KEY, t); } catch (e) {} }
  }
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  setTool(saved || 'select', true);
  if (btnSelect) btnSelect.addEventListener('click', function () { setTool('select'); });
  if (btnPan) btnPan.addEventListener('click', function () { setTool('pan'); });
  window.tmCanvasTools = { set: setTool, get: function () { return window.tmCanvasTool; } };

  function typing(t) { var tag = t && t.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable); }
  function overlayOpen() { return !!document.querySelector('.pro-modal:not([hidden]), .pro-menu:not([hidden]), .pro-pop:not([hidden])'); }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || overlayOpen()) return;
    if (e.key === 'v' || e.key === 'V') { setTool('select'); e.preventDefault(); }
    else if (e.key === 'h' || e.key === 'H') { setTool('pan'); e.preventDefault(); }
    else if (e.key === ' ' || e.code === 'Space') {
      // Space still presses a focused button / opens a focused header
      if (e.target.closest && e.target.closest('button, summary, a, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], label')) return;
      if (!window.tmSpacePan) window.tmSpacePan = true;
      e.preventDefault();   // no page scroll
    }
    else if (e.key === 'Escape' && drag) { cancel(); e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('keyup', function (e) { if (e.key === ' ' || e.code === 'Space') window.tmSpacePan = false; });
  window.addEventListener('blur', function () { window.tmSpacePan = false; });

  // ---------------------------------------------------------------- marquee
  // things that already react to a press: nodes, labels, buttons, splitters, handles
  var NO_START = '.node, text.label, .label, .meta-add, .meta-click, .handles, .svg-splitters, .svg-splitter-hit-area,' +
    ' .radial-splitter-hit-area, .radial-splitter-handle, .splitter, .pro-sticky-header-bg, [data-no-marquee]';
  var drag = null, box = null, badge = null;
  function displayed(d) { return !d._removedAsDuplicate && !(typeof droppedNodes !== 'undefined' && droppedNodes.has(d)); }
  function hiddenTips(d, out) {
    var k = (d.children && d.children.length) ? d.children : (d._children || []);
    if (!k.length) { if (d.data && d.data.name != null) out.push(String(d.data.name)); return out; }
    k.forEach(function (c) { hiddenTips(c, out); });
    return out;
  }
  // screen positions of everything that can be selected, measured once when the drag starts
  function collectTargets() {
    var pts = [], rects = [];
    if (typeof root === 'undefined' || !root) return { pts: pts, rects: rects };
    var cart = (typeof cartoonedNodes !== 'undefined') ? cartoonedNodes : new Set();
    root.each(function (d) {
      if (!displayed(d)) return;
      var el = (typeof nodeToElement !== 'undefined') ? nodeToElement.get(d) : null;
      if (!el || !el.isConnected) return;
      var collapsed = d._children && !d.children, cartoon = cart.has(d);
      if (collapsed || cartoon) {
        // the whole clade: its marker / triangle
        var r = el.getBoundingClientRect(); var ctm0 = el.getScreenCTM();
        var cr = { left: Math.min(r.left, ctm0 ? ctm0.e : r.left), right: Math.max(r.right, ctm0 ? ctm0.e : r.right), top: Math.min(r.top, ctm0 ? ctm0.f : r.top), bottom: Math.max(r.bottom, ctm0 ? ctm0.f : r.bottom) };
        rects.push({ r: cr, names: hiddenTips(d, []) });
        return;
      }
      if (d.children && d.children.length) return;   // internal node: selected through its tips
      var m = el.getScreenCTM(); if (!m) return;
      pts.push({ x: m.e, y: m.f, name: String(d.data.name) });
    });
    // tip labels: a tip is also selected when the rectangle touches its label
    Array.prototype.forEach.call(svgEl.querySelectorAll('text.label'), function (t) {
      var d = t.__data__; if (!d || !d.data || !t.getClientRects().length) return;
      var r = t.getBoundingClientRect(); if (!r.width) return;
      rects.push({ r: r, names: (d._children && !d.children) ? hiddenTips(d, []) : [String(d.data.name)] });
    });
    return { pts: pts, rects: rects };
  }
  function namesIn(sel, dr) {
    var out = new Set(), t = (dr || drag).targets;
    for (var i = 0; i < t.pts.length; i++) { var p = t.pts[i]; if (p.x >= sel.left && p.x <= sel.right && p.y >= sel.top && p.y <= sel.bottom) out.add(p.name); }
    for (var j = 0; j < t.rects.length; j++) {
      var r = t.rects[j].r;
      if (r.right >= sel.left && r.left <= sel.right && r.bottom >= sel.top && r.top <= sel.bottom) t.rects[j].names.forEach(function (n) { out.add(n); });
    }
    return out;
  }
  function selRect(e, dr) {
    dr = dr || drag;
    var c = canvas.getBoundingClientRect();
    var x = Math.max(c.left, Math.min(c.right, e.clientX)), y = Math.max(c.top, Math.min(c.bottom, e.clientY));
    return { left: Math.min(dr.x0, x), right: Math.max(dr.x0, x), top: Math.min(dr.y0, y), bottom: Math.max(dr.y0, y) };
  }
  function show(sel, n) {
    if (!box) {
      box = document.createElement('div'); box.className = 'pro-marquee'; document.body.appendChild(box);
      badge = document.createElement('div'); badge.className = 'pro-marquee-count'; document.body.appendChild(badge);
    }
    box.style.cssText = 'left:' + sel.left + 'px;top:' + sel.top + 'px;width:' + (sel.right - sel.left) + 'px;height:' + (sel.bottom - sel.top) + 'px';
    box.setAttribute('data-mode', drag.mode);
    badge.textContent = (drag.mode === 'add' ? '+ ' : drag.mode === 'remove' ? '− ' : '') + n + ' tip' + (n === 1 ? '' : 's');
    badge.style.left = (sel.right + 8) + 'px'; badge.style.top = (sel.bottom + 8) + 'px';
  }
  function hide() { if (box) { box.remove(); badge.remove(); box = badge = null; } }
  function cancel() { if (!drag) return; drag = null; hide(); }

  svgEl.addEventListener('pointerdown', function (e) {
    if (window.tmCanvasTool !== 'select' || window.tmSpacePan || e.button !== 0 || e.pointerType === 'touch') return;
    if (typeof root === 'undefined' || !root) return;
    if (e.target.closest && e.target.closest(NO_START)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, targets: null, frame: 0, last: null,
      mode: e.shiftKey ? 'add' : (e.altKey ? 'remove' : 'replace') };
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 4) return;   // small moves stay clicks
      drag.moved = true;
      drag.targets = collectTargets();
    }
    drag.mode = e.shiftKey ? 'add' : (e.altKey ? 'remove' : drag.mode === 'replace' ? 'replace' : drag.mode);
    drag.last = e;
    if (!drag.frame) drag.frame = requestAnimationFrame(function () {
      if (!drag) return;
      drag.frame = 0;
      var sel = selRect(drag.last);
      show(sel, namesIn(sel).size);
    });
  });
  function finish(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    if (d.frame) cancelAnimationFrame(d.frame);
    hide();
    if (!d.moved) return;   // a click: the app's own click handling
    var sel = selRect.call(null, e, d), inside = namesIn(sel, d);
    var current = (typeof highlightedAccessions !== 'undefined') ? highlightedAccessions : new Set();
    var next;
    if (d.mode === 'add') { next = new Set(current); inside.forEach(function (n) { next.add(n); }); }
    else if (d.mode === 'remove') { next = new Set(current); inside.forEach(function (n) { next.delete(n); }); }
    else next = inside;
    // a drag must not also count as a click on whatever it ends over
    var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); svgEl.removeEventListener('click', swallow, true); };
    svgEl.addEventListener('click', swallow, true);
    setTimeout(function () { svgEl.removeEventListener('click', swallow, true); }, 0);
    if (typeof applyTipSelection === 'function') applyTipSelection(next);
  }
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', function () { cancel(); });
})();
