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
    ' .radial-splitter-hit-area, .radial-splitter-handle, .splitter, .pro-sticky-header-bg, .axis-title, .axis-title-add, [data-no-marquee]';
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
      var collapsed = d._children && !d.children, cartoon = cart.has(d);
      if (!el || !el.isConnected) {
        // a large tree drawn as few elements (js/fast-draw.js): the position from the node's coordinates
        if (!(window.tmFast && tmFast.active)) return;
        var radialF = (typeof geometry !== 'undefined' && geometry === 'radial');
        var z = radialF ? document.querySelector('#zoomable g.spin') : document.getElementById('zoomable'), zm = z && z.getScreenCTM(); if (!zm) return;
        var ux = radialF ? (d.rx || 0) : d.y, uy = radialF ? (d.ry || 0) : d.x;
        var sx = zm.a * ux + zm.c * uy + zm.e, sy = zm.b * ux + zm.d * uy + zm.f;
        if (collapsed || cartoon) { rects.push({ r: { left: sx - 6, right: sx + 6, top: sy - 6, bottom: sy + 6 }, names: hiddenTips(d, []) }); return; }
        if (d.children && d.children.length) return;
        pts.push({ x: sx, y: sy, name: String(d.data.name) });
        return;
      }
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
    badge.textContent = (drag.mode === 'add' ? '+ ' : drag.mode === 'remove' ? '− ' : '') + n + (drag.feat != null ? ' row' : ' tip') + (n === 1 ? '' : 's');
    badge.style.left = (sel.right + 8) + 'px'; badge.style.top = (sel.bottom + 8) + 'px';
  }
  function hide() { if (box) { box.remove(); badge.remove(); box = badge = null; } }
  function cancel() { if (!drag) return; drag = null; hide(); }

  svgEl.addEventListener('pointerdown', function (e) {
    if (window.tmCanvasTool !== 'select' || window.tmSpacePan || e.button !== 0 || e.pointerType === 'touch') return;
    if (typeof root === 'undefined' || !root) return;
    if (e.target.closest && e.target.closest(NO_START)) return;
    // a press within a column splitter's grip that landed on a bar drawn over it: the splitter's
    // drag, as if the grip had been hit (the columns are painted above the grips)
    var hits = svgEl.querySelectorAll('.svg-splitter-hit-area');
    for (var hi = 0; hi < hits.length; hi++) {
      var hr = hits[hi].getBoundingClientRect();
      if (e.clientX >= hr.left && e.clientX <= hr.right && e.clientY >= hr.top && e.clientY <= hr.bottom) {
        hits[hi].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 0 }));
        return;
      }
    }
    // a drag that starts over a dataframe column selects that layer's bars (feature-select.js)
    var feat = (window.tmFeatSel && typeof tmFeatSel.layerAtScreenX === 'function') ? tmFeatSel.layerAtScreenX(e.clientX, e.clientY) : null;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, targets: null, frame: 0, last: null, feat: feat,
      mode: e.shiftKey ? 'add' : (e.altKey ? 'remove' : 'replace') };
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 4) return;   // small moves stay clicks
      drag.moved = true;
      drag.targets = drag.feat != null ? tmFeatSel.targets(drag.feat) : collectTargets();
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
    if (d.feat != null) {
      // bars of a dataframe: the layer's feature selection (rows); a click elsewhere is left alone
      var swallow0 = function (ev) { ev.stopPropagation(); ev.preventDefault(); svgEl.removeEventListener('click', swallow0, true); };
      svgEl.addEventListener('click', swallow0, true);
      setTimeout(function () { svgEl.removeEventListener('click', swallow0, true); }, 0);
      tmFeatSel.apply(d.feat, inside, d.mode);
      return;
    }
    if (window.tmFeatSel) tmFeatSel.clear();   // tips selected: no feature selection alongside
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

// Keyboard ranges, as in Excel: with tips selected, Shift+Down / Shift+Up grow or shrink the
// selection one tip at a time from the tip it started at (the anchor); Cmd/Ctrl+Shift goes to
// the last / first tip. Down / Up alone move a single selected tip to the next one.
// Tips are taken in the order they are drawn; a collapsed clade is one row (all its tips).
(function () {
  'use strict';
  var anchor = null, cursor = null, made = '';   // made: the selection these keys last set
  function typing(t) { var tag = t && t.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable); }
  function overlayOpen() { return !!document.querySelector('.pro-modal:not([hidden]), .pro-menu:not([hidden]), .pro-pop:not([hidden]), .ar-menu'); }
  function hiddenTips(d, out) {
    var k = (d.children && d.children.length) ? d.children : (d._children || []);
    if (!k.length) { if (d.data && d.data.name != null) out.push(String(d.data.name)); return out; }
    k.forEach(function (c) { hiddenTips(c, out); });
    return out;
  }
  // the rows on screen, top to bottom: { node, names }
  function rows() {
    if (typeof root === 'undefined' || !root) return [];
    var dropped = (typeof droppedNodes !== 'undefined') ? droppedNodes : new Set();
    return root.leaves().filter(function (d) { return !d._removedAsDuplicate && !dropped.has(d) && Number.isFinite(d.x); })
      .sort(function (a, b) { return a.x - b.x; })
      .map(function (d) { return { node: d, names: (d._children && !d.children) ? hiddenTips(d, []) : [String(d.data.name)] }; });
  }
  function sig(set) { return Array.from(set).sort().join('\n'); }
  // a press on the drawing takes the keyboard from the side panel (clicking SVG does not move
  // focus by itself, so the last card control used would keep the arrow keys)
  var svgEl = document.getElementById('svg');
  if (svgEl) svgEl.addEventListener('pointerdown', function () {
    var a = document.activeElement;
    if (a && a !== document.body && !svgEl.contains(a) && a.closest && a.closest('.sidepanel') && typeof a.blur === 'function') a.blur();
  }, true);
  function rowOf(list, name) { for (var i = 0; i < list.length; i++) if (list[i].names.indexOf(name) >= 0) return i; return -1; }

  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || typing(e.target) || overlayOpen()) return;
    if (typeof highlightedAccessions === 'undefined' || !highlightedAccessions.size) return;
    if (e.target && e.target.closest && e.target.closest('[role="menu"], [role="listbox"], [role="radiogroup"], .sidepanel')) return;
    var list = rows();
    if (!list.length) return;
    var sel = highlightedAccessions, down = e.key === 'ArrowDown', jump = e.metaKey || e.ctrlKey;
    if (jump && !e.shiftKey) return;
    // where the selection starts: kept while these keys made it, else worked out again
    var a = rowOf(list, anchor), c = rowOf(list, cursor);
    if (made !== sig(sel) || a < 0 || c < 0) {
      var on = [];
      list.forEach(function (r, i) { if (r.names.some(function (n) { return sel.has(n); })) on.push(i); });
      if (!on.length) return;
      if (on.length === 1) { a = c = on[0]; }
      else if (down) { a = on[0]; c = on[on.length - 1]; }
      else { a = on[on.length - 1]; c = on[0]; }
    }
    e.preventDefault();
    if (e.shiftKey) {
      c = jump ? (down ? list.length - 1 : 0) : Math.max(0, Math.min(list.length - 1, c + (down ? 1 : -1)));
    } else {
      // move: one tip, the next one past the current end
      var next = Math.max(0, Math.min(list.length - 1, c + (down ? 1 : -1)));
      if (next === c && a === c) return;   // already at the first / last tip
      a = c = next;
    }
    var names = [];
    for (var i = Math.min(a, c); i <= Math.max(a, c); i++) list[i].names.forEach(function (n) { names.push(n); });
    anchor = list[a].names[0]; cursor = list[c].names[0];
    if (!e.shiftKey && list[a].names.length === 1 && typeof highlightClade === 'function') highlightClade(list[a].node, false);   // like a click
    else if (typeof applyTipSelection === 'function') applyTipSelection(names);
    made = sig(highlightedAccessions);
    var n = highlightedAccessions.size;
    if (typeof setStatus === 'function' && e.shiftKey) setStatus(n + ' tip' + (n === 1 ? '' : 's') + ' selected · ' + list[a].names[0] + (a === c ? '' : ' to ' + list[c].names[0]));
  });
})();
