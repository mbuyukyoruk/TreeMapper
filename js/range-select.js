// Shift+click ranges and arrow keys through the search hits (loaded after select-tool.js).
// Shift+click on a tip label or tip node selects every tip from the last tip clicked (the
// anchor) to this one, as in a file list; Cmd/Ctrl+click still adds one. In the search box,
// Down / Up step through the hits in the order they are drawn, bringing each into view and
// underlining it; Enter selects that hit alone.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var svgEl = $('svg'), search = $('accessionSearch');
  if (!svgEl) return;
  function hiddenTips(d, out) {
    var k = (d.children && d.children.length) ? d.children : (d._children || []);
    if (!k.length) { if (d.data && d.data.name != null) out.push(String(d.data.name)); return out; }
    k.forEach(function (c) { hiddenTips(c, out); });
    return out;
  }
  // the rows on screen, top to bottom (a collapsed clade is one row with all its tips)
  function rows() {
    if (typeof root === 'undefined' || !root) return [];
    var dropped = (typeof droppedNodes !== 'undefined') ? droppedNodes : new Set();
    return root.leaves().filter(function (d) { return !d._removedAsDuplicate && !dropped.has(d) && Number.isFinite(d.x); })
      .sort(function (a, b) { return a.x - b.x; })
      .map(function (d) { return { node: d, names: (d._children && !d.children) ? hiddenTips(d, []) : [String(d.data.name)] }; });
  }
  function rowOf(list, name) { for (var i = 0; i < list.length; i++) if (list[i].names.indexOf(name) >= 0) return i; return -1; }
  // the tip (or collapsed clade) an element of the drawing stands for
  function tipOf(target) {
    var el = target;
    while (el && el !== svgEl) {
      var d = el.__data__;
      if (d && d.data && typeof d.data === 'object' && (el.classList.contains('label') || el.classList.contains('node') || el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('node'))) {
        if (!(d.children && d.children.length)) return d;
        return null;   // an internal node: its clade, not a range
      }
      el = el.parentNode;
    }
    return null;
  }
  // ------------------------------------------------------------ Shift+click
  var anchor = null;
  svgEl.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    var d = tipOf(e.target); if (!d) return;
    var names = (d._children && !d.children) ? hiddenTips(d, []) : [String(d.data.name)];
    if (!e.shiftKey) { anchor = names[0]; return; }   // a plain (or Cmd/Ctrl) click sets the anchor
    var list = rows(), c = rowOf(list, names[0]); if (c < 0) return;
    var a = rowOf(list, anchor);
    if (a < 0) {   // no anchor yet: from the first selected tip, else from this one
      var sel = (typeof highlightedAccessions !== 'undefined') ? highlightedAccessions : new Set();
      for (var i = 0; i < list.length; i++) if (list[i].names.some(function (n) { return sel.has(n); })) { a = i; break; }
      if (a < 0) a = c;
      anchor = list[a].names[0];
    }
    e.preventDefault(); e.stopImmediatePropagation();
    var out = [];
    for (var j = Math.min(a, c); j <= Math.max(a, c); j++) list[j].names.forEach(function (n) { out.push(n); });
    if (typeof applyTipSelection === 'function') applyTipSelection(out);
    if (typeof setStatus === 'function') setStatus(out.length + ' tip' + (out.length === 1 ? '' : 's') + ' selected · ' + list[Math.min(a, c)].names[0] + (a === c ? '' : ' to ' + list[Math.max(a, c)].names[0]));
  }, true);
  // --------------------------------------------------- arrow keys in the search box
  var cur = -1, curName = null;
  function hits() {
    if (typeof highlightedAccessions === 'undefined' || !highlightedAccessions.size) return [];
    return rows().filter(function (r) { return r.names.some(function (n) { return highlightedAccessions.has(n); }); });
  }
  function labelOf(name) {
    var out = null;
    d3.select(svgEl).selectAll('text.label').each(function (d) { if (!out && d && d.data && String(d.data.name) === name) out = this; });
    return out;
  }
  function mark(name) {
    svgEl.querySelectorAll('text.label.search-current').forEach(function (t) { t.classList.remove('search-current'); });
    curName = name;
    var el = name ? labelOf(name) : null;
    if (el) el.classList.add('search-current');
    return el;
  }
  // pans the drawing so the element is inside the canvas (keeps the scale)
  function reveal(el) {
    if (!el || typeof svg === 'undefined' || typeof zoom === 'undefined') return;
    var r = el.getBoundingClientRect(), c = svgEl.getBoundingClientRect();
    var pad = 24, dx = 0, dy = 0;
    if (r.top < c.top + pad) dy = c.top + pad - r.top; else if (r.bottom > c.bottom - pad) dy = c.bottom - pad - r.bottom;
    if (r.left < c.left + pad) dx = c.left + pad - r.left; else if (r.right > c.right - pad) dx = c.right - pad - r.right;
    if (!dx && !dy) return;
    try {
      var t = d3.zoomTransform(svgEl);
      svg.call(zoom.transform, d3.zoomIdentity.translate(t.x + dx, t.y + dy).scale(t.k));
    } catch (e) {}
  }
  function step(dir) {
    var H = hits(); if (!H.length) return false;
    var at = curName ? H.findIndex(function (r) { return r.names.indexOf(curName) >= 0; }) : -1;
    if (at < 0) cur = dir > 0 ? 0 : H.length - 1;
    else cur = Math.max(0, Math.min(H.length - 1, at + dir));
    var r = H[cur], el = mark(r.names[0]);
    reveal(el);
    if (typeof setStatus === 'function') setStatus('Hit ' + (cur + 1) + ' of ' + H.length + ': ' + r.names[0] + (r.names.length > 1 ? ' (collapsed, ' + r.names.length + ' tips)' : '') + ' · Enter selects it');
    return true;
  }
  if (search) {
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (step(e.key === 'ArrowDown' ? 1 : -1)) { e.preventDefault(); e.stopImmediatePropagation(); } }
      else if (e.key === 'Enter' && curName) {
        var H = hits(), r = H.filter(function (x) { return x.names.indexOf(curName) >= 0; })[0];
        if (!r) return;
        e.preventDefault(); e.stopImmediatePropagation();
        mark(null);
        if (typeof applyTipSelection === 'function') applyTipSelection(r.names);
        anchor = r.names[0];
        if (typeof setStatus === 'function') setStatus(r.names[0] + ' selected');
      }
    }, true);
    search.addEventListener('input', function () { cur = -1; mark(null); });
  }
  window.tmRangeSelect = { rows: rows, hits: hits, current: function () { return curName; } };
})();
