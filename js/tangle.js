// Tree comparison: a tanglegram (loaded after app.js). Style → Compare trees.
//
// A second Newick tree is drawn to the right of the panels, mirrored (its root at the right,
// its tips facing the main tree), and a line joins each tip to the same tip in the main
// tree, so the two orders can be compared. "Match order" rotates the second tree's clades
// so its tips follow the main tree's order as far as the topology allows (fewer crossings).
// The Robinson–Foulds distance between the two trees over their shared tips is shown.
// Rectangular layout; drawn with the tree, so exported; the second tree is kept in sessions.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var tree2 = null, text2 = '', name2 = '';
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function on() { var e = $('tangleShow'); return !!(e && e.checked) && !!tree2 && (typeof geometry === 'undefined' || geometry !== 'radial'); }
  function width() { return Math.max(80, +(($('tangleWidth') || {}).value) || 260); }
  function tipsOf(n) { var out = []; (function w(x) { var k = (x.children && x.children.length) ? x.children : []; if (!k.length) out.push(x); else k.forEach(w); })(n); return out; }
  function load(text, fname) {
    // parseNewick gives plain nodes ({ name, length, children }); the hierarchy adds .data and .parent
    try { tree2 = d3.hierarchy(parseNewick(text), function (d) { return d.children; }); } catch (e) { tree2 = null; throw e; }
    text2 = text; name2 = fname || 'second tree';
    var st = $('tangleTree'); if (st && st.value !== text) { st.value = text; }
    var nm = $('tangleName'); if (nm) nm.value = name2;
  }
  // ------------------------------------------------------------------ RF distance
  function splits(rootNode, shared) {
    var first = null; shared.forEach(function (n) { if (first === null || n < first) first = n; });
    var out = new Set();
    (function w(x) {
      var k = (x.children && x.children.length) ? x.children : [];
      if (!k.length) return [String(x.data.name)];
      var names = []; k.forEach(function (c) { names = names.concat(w(c)); });
      if (x !== rootNode) {
        var side = names.filter(function (n) { return shared.has(n); }).sort();
        if (side.indexOf(first) >= 0) { var S = new Set(side); side = []; shared.forEach(function (n) { if (!S.has(n)) side.push(n); }); side.sort(); }
        if (side.length >= 2 && side.length <= shared.size - 2) out.add(side.join('\u0001'));
      }
      return names;
    })(rootNode);
    return out;
  }
  function rf() {
    if (!tree2 || typeof root === 'undefined' || !root) return null;
    var names1 = new Set(root.leaves().map(function (l) { return String(l.data.name); })), shared = new Set();
    tipsOf(tree2).forEach(function (l) { if (names1.has(String(l.data.name))) shared.add(String(l.data.name)); });
    if (shared.size < 4) return { shared: shared.size, rf: 0, max: 0, norm: 0 };
    var A = splits(root, shared), B = splits(tree2, shared), d = 0;
    A.forEach(function (s) { if (!B.has(s)) d++; }); B.forEach(function (s) { if (!A.has(s)) d++; });
    var max = A.size + B.size;
    return { shared: shared.size, rf: d, max: max, norm: max ? d / max : 0, only1: names1.size - shared.size, only2: tipsOf(tree2).length - shared.size };
  }
  // ------------------------------------------------------------------ order matching
  function matchOrder() {
    if (!tree2 || typeof root === 'undefined' || !root) return;
    var idx = new Map(); root.leaves().forEach(function (l, i) { idx.set(String(l.data.name), i); });
    (function w(x) {
      var k = (x.children && x.children.length) ? x.children : [];
      if (!k.length) { var i = idx.get(String(x.data.name)); x._tm = i == null ? Infinity : i; return; }
      k.forEach(w);
      k.sort(function (a, b) { return a._tm - b._tm; });
      var vals = k.map(function (c) { return c._tm; }).filter(isFinite);
      x._tm = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : Infinity;
    })(tree2);
    text2 = (typeof TreeCore !== 'undefined' && TreeCore.write && TreeCore.parse) ? text2 : text2;   // the order lives in the hierarchy; sessions keep the drawn order through _order
    var st = $('tangleOrder'); if (st) st.value = JSON.stringify(tipsOf(tree2).map(function (l) { return String(l.data.name); }));
  }
  // put back a tip order saved in a session (rotate clades to match it)
  function applyOrder(names) {
    if (!tree2 || !names || !names.length) return;
    var idx = new Map(); names.forEach(function (n, i) { idx.set(n, i); });
    (function w(x) {
      var k = (x.children && x.children.length) ? x.children : [];
      if (!k.length) { var i = idx.get(String(x.data.name)); x._tm = i == null ? Infinity : i; return; }
      k.forEach(w); k.sort(function (a, b) { return a._tm - b._tm; });
      var vals = k.map(function (c) { return c._tm; }).filter(isFinite); x._tm = vals.length ? Math.min.apply(null, vals) : Infinity;
    })(tree2);
  }
  function crossings(pairs) {
    // pairs: [y1, y2] per shared tip; count inversions (O(n²), fine for a few thousand)
    var n = 0; pairs.sort(function (a, b) { return a[0] - b[0]; });
    for (var i = 0; i < pairs.length; i++) for (var j = i + 1; j < pairs.length; j++) if (pairs[j][1] < pairs[i][1]) n++;
    return n;
  }
  // ------------------------------------------------------------------ drawing
  var lastReport = null;
  function reserve() { return on() ? width() + 40 : 0; }
  function draw(ctx) {
    d3.select('#zoomable').selectAll('g.tanglegram').remove();
    lastReport = null;
    if (!on() || ctx.isRadial) { report(); return; }
    var leaves = ctx.leaves.filter(function (l) { return !l._removedAsDuplicate && !(typeof droppedNodes !== 'undefined' && droppedNodes.has(l)) && Number.isFinite(l.x); });
    if (!leaves.length) return;
    var z = document.getElementById('zoomable'), right = -Infinity;
    ['.layers-container', 'g.nodes', 'g.links', 'g.group-marks'].forEach(function (sel) { var el = z.querySelector(sel); if (!el) return; try { var b = el.getBBox(); if (b.width) right = Math.max(right, b.x + b.width); } catch (e) {} });
    Array.prototype.forEach.call(z.querySelectorAll('text.label, .group-marks text'), function (t) { try { var b = t.getBBox(); if (b.width) right = Math.max(right, b.x + b.width); } catch (e) {} });
    // and the panels themselves (an empty placeholder panel draws nothing but takes the room)
    try { (getPanelPositions() || []).forEach(function (pp) { if (pp && Number.isFinite(pp.x) && Number.isFinite(pp.width)) right = Math.max(right, pp.x + pp.width); }); } catch (e) {}
    if (!isFinite(right)) return;
    var W = width(), x0 = right + 24, xTips = x0 + 10, xRoot = x0 + W;
    var y1 = Math.min.apply(null, leaves.map(function (l) { return l.x; })), y2 = Math.max.apply(null, leaves.map(function (l) { return l.x; }));
    // the second tree's layout: tips evenly over the same height, depth from branch lengths
    var tips2 = tipsOf(tree2), n2 = tips2.length;
    var step = n2 > 1 ? (y2 - y1) / (n2 - 1) : 0;
    tips2.forEach(function (t, i) { t._ty = n2 > 1 ? y1 + i * step : (y1 + y2) / 2; });
    var maxDepth = 0;
    (function depth(x, d) { x._td = d; var k = (x.children && x.children.length) ? x.children : []; k.forEach(function (c) { depth(c, d + (+c.data.length || 0)); }); if (!k.length) maxDepth = Math.max(maxDepth, d); })(tree2, 0);
    var hasLen = maxDepth > 0;
    (function post(x) { var k = (x.children && x.children.length) ? x.children : []; if (!k.length) return; k.forEach(post); x._ty = k.reduce(function (a, c) { return a + c._ty; }, 0) / k.length; })(tree2);
    var levels = 0; (function lv(x, d) { levels = Math.max(levels, d); var k = (x.children && x.children.length) ? x.children : []; k.forEach(function (c) { lv(c, d + 1); }); })(tree2, 0);
    var xOf = function (x) { return hasLen ? xRoot - (x._td / maxDepth) * (W - 10) : xRoot - (depthOf(x) / Math.max(1, levels)) * (W - 10); };
    function depthOf(x) { var d = 0; for (var p = x; p.parent; p = p.parent) d++; return d; }
    var G = d3.select('#zoomable').append('g').attr('class', 'tanglegram').attr('data-tree-part', '');
    var col = 'var(--tree)';
    // branches (rectangular): parent vertical, child horizontal
    var L = G.append('g').attr('class', 'tangle-links');
    (function w(x) {
      var k = (x.children && x.children.length) ? x.children : [];
      k.forEach(function (c) {
        L.append('path').attr('d', 'M' + xOf(x) + ',' + x._ty + ' V' + c._ty + ' H' + xOf(c)).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.2);
        w(c);
      });
    })(tree2);
    // tip ends: a short lead to the tips' column, then the connectors to the main tree
    var byName = new Map(); leaves.forEach(function (l) { byName.set(String(l.data.name), l); });
    var C = G.append('g').attr('class', 'tangle-connectors'), pairs = [], shared = 0;
    tips2.forEach(function (t) {
      L.append('path').attr('d', 'M' + xOf(t) + ',' + t._ty + ' H' + xTips).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.2).attr('stroke-dasharray', '2,2').attr('opacity', 0.6);
      var m = byName.get(String(t.data.name));
      if (!m) return;
      shared++;
      pairs.push([m.x, t._ty]);
      var sel = typeof highlightedAccessions !== 'undefined' && highlightedAccessions.has(m.data.name);
      C.append('path').attr('class', 'tangle-line').attr('data-name', String(t.data.name))
        .attr('d', 'M' + (right + 4) + ',' + m.x + ' C' + (right + 14) + ',' + m.x + ' ' + (xTips - 10) + ',' + t._ty + ' ' + xTips + ',' + t._ty)
        .attr('fill', 'none').attr('stroke', sel ? '#ff6b35' : (Math.abs(m.x - t._ty) < 0.5 ? '#94a3b8' : '#2563eb')).attr('stroke-width', sel ? 1.8 : 0.9).attr('opacity', sel ? 1 : 0.75);
    });
    var r = rf();
    lastReport = { shared: shared, crossings: crossings(pairs), rf: r };
    G.append('text').attr('class', 'tangle-title').attr('x', xRoot).attr('y', y1 - 14).attr('text-anchor', 'end').attr('font-size', 12).attr('font-weight', 600).attr('fill', col).text(name2);
    report();
  }
  function report() {
    var el = $('tangleReport'); if (!el) return;
    if (!tree2) { el.textContent = 'No second tree loaded.'; return; }
    var r = lastReport && lastReport.rf ? lastReport.rf : rf();
    if (!r) { el.textContent = ''; return; }
    el.textContent = r.shared + ' shared tips' + (r.only1 ? ', ' + r.only1 + ' only in the main tree' : '') + (r.only2 ? ', ' + r.only2 + ' only in the second' : '') +
      ' · RF distance ' + r.rf + ' of ' + r.max + ' (' + (r.norm * 100).toFixed(0) + '%)' + (lastReport ? ' · ' + lastReport.crossings + ' crossings' : '');
  }
  function redraw() {
    if (typeof root === 'undefined' || !root) return;
    if (typeof normalizeWidths === 'function' && typeof geometry !== 'undefined' && geometry !== 'radial') { try { normalizeWidths(); } catch (e) {} }
    drawTree();
  }
  // ------------------------------------------------------------------ controls
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.id) return;
    if (t.id === 'tangleFile') {
      var f = t.files && t.files[0]; if (!f) return;
      f.text().then(function (txt) {
        try { load(txt, f.name); } catch (e) { if (typeof setStatus === 'function') setStatus('Second tree: ' + e.message); return; }
        var s = $('tangleShow'); if (s && !s.checked) { s.checked = true; }
        $('tangleTree').dispatchEvent(new Event('change', { bubbles: true }));
        t.value = '';
        redraw();
      });
    }
    else if (t.id === 'tangleTree') {
      // a session puts the tree back
      if (t.value && t.value !== text2) { try { load(t.value, ($('tangleName') || {}).value || 'second tree'); } catch (e) { tree2 = null; } var o = $('tangleOrder'); if (o && o.value) { try { applyOrder(JSON.parse(o.value)); } catch (e) {} } }
      else if (!t.value) { tree2 = null; text2 = ''; }
      report();
    }
    else if (t.id === 'tangleOrder') { if (t.value && tree2) { try { applyOrder(JSON.parse(t.value)); } catch (e) {} redraw(); } }
    else if (t.id === 'tangleShow' || t.id === 'tangleWidth') redraw();
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('#tangleMatch, #tangleRemove') : null; if (!t) return;
    ev.preventDefault();
    if (t.id === 'tangleMatch') { matchOrder(); redraw(); }
    else { tree2 = null; text2 = ''; var st = $('tangleTree'); if (st) { st.value = ''; } var o = $('tangleOrder'); if (o) o.value = ''; report(); redraw(); }
  });
  // the connectors follow the selection without a redraw (called from the app's highlight pass)
  function refreshSelection() {
    var sel = (typeof highlightedAccessions !== 'undefined') ? highlightedAccessions : new Set();
    document.querySelectorAll('#svg .tangle-line').forEach(function (l) {
      var on = sel.has(l.getAttribute('data-name'));
      var m = /^M[-\d.]+,([-\d.]+) C.* ([-\d.]+)$/.exec(l.getAttribute('d') || '');
      var straight = m && Math.abs(+m[1] - +m[2]) < 0.5;
      l.setAttribute('stroke', on ? '#ff6b35' : (straight ? '#94a3b8' : '#2563eb'));
      l.setAttribute('stroke-width', on ? 1.8 : 0.9);
      l.setAttribute('opacity', on ? 1 : 0.75);
    });
  }
  window.tmTangle = { draw: draw, reserve: reserve, load: load, rf: rf, matchOrder: matchOrder, refreshSelection: refreshSelection, report: function () { return lastReport; } };
})();
