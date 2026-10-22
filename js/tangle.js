// Tree comparison: a tanglegram (loaded after app.js and msa.js). Style → Compare trees.
//
// A second Newick tree is drawn in its own panel, the last one on the right, mirrored (its
// root at the right, its tips facing the main tree), so the panel splitter sets its width
// like any other panel's. A thin line joins each shared tip to its row in the main tree, so
// the two orders can be compared; the Robinson–Foulds distance over the shared tips is shown.
// The second tree has the main tree's options: its tips ordered as loaded, to match the
// main tree (clades rotated for the fewest crossings), or ladderized increasing / decreasing;
// redundant tips (sibling tips with the same branch length) removed; guide lines from its
// tips, drawn like the main tree's label guides; the connector lines on or off.
// A scale bar (the main tree's settings) with its zero at the root. Rectangular layout; drawn
// as a data layer with the others, so exported, resized live with its splitter; kept in sessions.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var tree2 = null, text2 = '', name2 = '';
  function val(id, d) { var e = $(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : d; }
  function on() { return !!val('tangleShow', true) && !!tree2 && (typeof geometry === 'undefined' || geometry !== 'radial'); }
  function kids(x) { return (x.children && x.children.length) ? x.children : []; }
  function tipsOf(n) { var out = []; (function w(x) { var k = kids(x); if (!k.length) out.push(x); else k.forEach(w); })(n); return out; }
  function load(text, fname) {
    // parseNewick gives plain nodes ({ name, length, children }); the hierarchy adds .data and .parent
    var t; try { t = d3.hierarchy(parseNewick(text), function (d) { return d.children; }); } catch (e) { tree2 = null; throw e; }
    if (!t || !tipsOf(t).length) { tree2 = null; throw new Error('no tips in the tree'); }
    tree2 = t; text2 = text; name2 = fname || 'second tree';
    tree2.each(function (x) { if (x.children) x._loaded = x.children.slice(); });   // the order as loaded
    var st = $('tangleTree'); if (st && st.value !== text) st.value = text;
    var nm = $('tangleName'); if (nm) nm.value = name2;
  }
  // ------------------------------------------------------------------ RF distance
  function splits(rootNode, shared) {
    var first = null; shared.forEach(function (n) { if (first === null || n < first) first = n; });
    var out = new Set();
    (function w(x) {
      var k = kids(x);
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
    var only1 = names1.size - shared.size, only2 = tipsOf(tree2).length - shared.size;
    if (shared.size < 4) return { shared: shared.size, rf: 0, max: 0, norm: 0, only1: only1, only2: only2 };
    var A = splits(root, shared), B = splits(tree2, shared), d = 0;
    A.forEach(function (s) { if (!B.has(s)) d++; }); B.forEach(function (s) { if (!A.has(s)) d++; });
    var max = A.size + B.size;
    return { shared: shared.size, rf: d, max: max, norm: max ? d / max : 0, only1: only1, only2: only2 };
  }
  // ------------------------------------------------------------------ tip order
  // the clades are rotated in place (the hierarchy keeps its nodes; only each node's
  // child order changes), as the main tree's own ordering does
  function orderLoaded() { tree2.each(function (x) { if (x.children && x._loaded) x.children = x._loaded.slice(); }); }
  function orderMatch() {
    var idx = new Map(); root.leaves().forEach(function (l, i) { idx.set(String(l.data.name), i); });
    (function w(x) {
      var k = kids(x);
      if (!k.length) { var i = idx.get(String(x.data.name)); x._tm = i == null ? Infinity : i; return; }
      k.forEach(w);
      k.sort(function (a, b) { return a._tm - b._tm; });
      var vals = k.map(function (c) { return c._tm; }).filter(isFinite);
      x._tm = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : Infinity;
    })(tree2);
  }
  // ladderized by the deepest tip of each clade, as the main tree's Order tips
  function depthMax(x) { var k = kids(x); if (!k.length) return x.depth || 0; return Math.max.apply(null, k.map(depthMax)); }
  function orderLadder(dir) {
    (function w(x) {
      var k = kids(x); if (!k.length) return;
      k.forEach(w);
      k.sort(function (a, b) { return dir === 'increasing' ? depthMax(b) - depthMax(a) : depthMax(a) - depthMax(b); });
    })(tree2);
  }
  function applyOrder() {
    if (!tree2) return;
    var mode = val('tangleOrderMode', 'loaded');
    if (mode === 'match' && typeof root !== 'undefined' && root) { orderLoaded(); orderMatch(); }
    else if (mode === 'increasing' || mode === 'decreasing') { orderLoaded(); orderLadder(mode); }
    else orderLoaded();
  }
  // redundant tips, as the main tree's "Remove redundant tips": of sibling tips with the same
  // branch length only the first is kept
  function dropRedundant() {
    var gone = new Set();
    if (!val('tangleUnique', false)) return gone;
    tree2.each(function (x) {
      var seen = new Map();
      kids(x).forEach(function (c) {
        if (kids(c).length) return;
        var len = +c.data.length || 0;
        if (seen.has(len)) gone.add(c); else seen.set(len, c);
      });
    });
    return gone;
  }
  function crossings(pairs) {
    // pairs: [y1, y2] per shared tip; count inversions (O(n²), fine for a few thousand)
    var n = 0; pairs.sort(function (a, b) { return a[0] - b[0]; });
    for (var i = 0; i < pairs.length; i++) for (var j = i + 1; j < pairs.length; j++) if (pairs[j][1] < pairs[i][1]) n++;
    return n;
  }
  // ------------------------------------------------------------------ drawing
  var lastReport = null;
  function panelWanted() { return on(); }
  // drawn into the layer group the app gives (ctx.g, in layer mode): the drawing spans
  // panel.x + 8 … panel.x + width − 8, the span a live splitter drag maps for every column
  function draw(ctx) {
    lastReport = null;
    var panel = ctx.panel;
    if (!on() || !panel || !(panel.width > 0)) { report(); return; }
    var leaves = ctx.leaves.filter(function (l) { return !l._removedAsDuplicate && !(typeof droppedNodes !== 'undefined' && droppedNodes.has(l)) && Number.isFinite(l.x); });
    if (!leaves.length) return;
    applyOrder();
    var gone = dropRedundant();
    var tips2 = tipsOf(tree2).filter(function (t) { return !gone.has(t); }), n2 = tips2.length;
    if (!n2) { report(); return; }
    // the panel: connectors in its left part, the tree's tips at the tips column, its root at the right
    var x0 = panel.x + 8, W = Math.max(1, panel.width - 16);
    var xTips = x0 + Math.max(24, Math.min(140, Math.round(W * 0.3))), xRoot = x0 + W, xEnd = xTips + 10;
    var y1 = Math.min.apply(null, leaves.map(function (l) { return l.x; })), y2 = Math.max.apply(null, leaves.map(function (l) { return l.x; }));
    var step = n2 > 1 ? (y2 - y1) / (n2 - 1) : 0;
    tips2.forEach(function (t, i) { t._ty = n2 > 1 ? y1 + i * step : (y1 + y2) / 2; });
    // internal nodes: the mean of their drawn tips; a clade whose tips are all removed is not drawn
    var drawn = new Set(tips2);
    (function post(x) { var k = kids(x); if (!k.length) return; k.forEach(post); var ys = k.filter(function (c) { return drawn.has(c); }).map(function (c) { return c._ty; }); if (ys.length) { x._ty = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length; drawn.add(x); } })(tree2);
    // depth from branch lengths (or levels when the tree has none)
    var maxDepth = 0;
    (function depth(x, d) { x._td = d; var k = kids(x); k.forEach(function (c) { depth(c, d + (+c.data.length || 0)); }); if (!k.length && drawn.has(x)) maxDepth = Math.max(maxDepth, d); })(tree2, 0);
    var hasLen = maxDepth > 0, levels = 0;
    (function lv(x, d) { if (drawn.has(x)) levels = Math.max(levels, d); kids(x).forEach(function (c) { lv(c, d + 1); }); })(tree2, 0);
    var span = Math.max(1, xRoot - xEnd);
    var xOf = function (x) { return hasLen ? xRoot - (x._td / maxDepth) * span : xRoot - ((x.depth || 0) / Math.max(1, levels)) * span; };
    var G = ctx.g.append('g').attr('class', 'tanglegram');
    var col = 'var(--tree)', bw = (typeof getBranchStrokeWidth === 'function') ? getBranchStrokeWidth() : 1;
    // branches (rectangular): parent vertical, child horizontal; the same stroke as the main tree
    var L = G.append('g').attr('class', 'tangle-links');
    (function w(x) {
      kids(x).forEach(function (c) {
        if (!drawn.has(c)) return;
        L.append('path').attr('d', 'M' + xOf(x) + ',' + x._ty + ' V' + c._ty + ' H' + xOf(c)).attr('fill', 'none').attr('stroke', col).attr('stroke-width', bw).attr('stroke-linecap', 'round');
        w(c);
      });
    })(tree2);
    // guide lines from the tips to the tips column, styled like the main tree's label guides
    if (val('tangleGuides', true) && typeof guideStyle === 'function') {
      var parts = [];
      tips2.forEach(function (t) { var xa = xOf(t) - 4, xb = xTips + 2; if (xa > xb + 2) parts.push('M' + xa.toFixed(2) + ' ' + t._ty.toFixed(2) + 'L' + xb.toFixed(2) + ' ' + t._ty.toFixed(2)); });
      if (parts.length) guideStyle(G.append('path').attr('class', 'tangle-guides label-guides')).attr('d', parts.join(''));
    }
    // the connectors: from the panel's left edge at the main tip's row to the second tree's tip
    var byName = new Map(); leaves.forEach(function (l) { byName.set(String(l.data.name), l); });
    var C = G.append('g').attr('class', 'tangle-connectors'), pairs = [], shared = 0, showLinks = val('tangleLinks', true);
    tips2.forEach(function (t) {
      var m = byName.get(String(t.data.name));
      if (!m) return;
      shared++;
      pairs.push([m.x, t._ty]);
      if (!showLinks) return;
      var sel = typeof highlightedAccessions !== 'undefined' && highlightedAccessions.has(m.data.name);
      var c1 = x0 + Math.round((xTips - x0) * 0.35), c2 = x0 + Math.round((xTips - x0) * 0.65);
      C.append('path').attr('class', 'tangle-line').attr('data-name', String(t.data.name))
        .attr('d', 'M' + x0 + ',' + m.x + ' C' + c1 + ',' + m.x + ' ' + c2 + ',' + t._ty + ' ' + xTips + ',' + t._ty)
        .attr('fill', 'none').attr('stroke', sel ? '#ff6b35' : (Math.abs(m.x - t._ty) < 0.5 ? '#94a3b8' : '#2563eb')).attr('stroke-width', sel ? 1.4 : 0.7).attr('opacity', sel ? 1 : 0.6).attr('stroke-linecap', 'round');
    });
    var r = rf();
    lastReport = { shared: shared, crossings: crossings(pairs), rf: r, removed: gone.size };
    if (hasLen) scaleBar(G, xEnd, xRoot, maxDepth, ctx);
    report();
  }
  // the second tree's scale bar: at the axis row, with the main tree's scale-bar settings
  // (hidden / full axis / a bar of the chosen length), its zero at the root on the right
  function scaleBar(G, xEnd, xRoot, maxDepth, ctx) {
    var hide = $('hideScaleBar') ? $('hideScaleBar').checked : false, cover = $('coverScaleBar') ? $('coverScaleBar').checked : true;
    if (hide || !(xRoot > xEnd) || typeof axisForRow !== 'function') return;
    var sw = parseFloat(($('scaleStrokeWidth') || {}).value || '2'), widthPx = xRoot - xEnd;
    var g = G.append('g').attr('class', 'compare-scale').attr('transform', 'translate(' + xEnd + ',' + ctx.axisY + ')');
    if (cover) {
      var x = d3.scaleLinear().domain([maxDepth, 0]).range([0, widthPx]);
      g.call(axisForRow(x).ticks(typeof axisTickCount === 'function' ? axisTickCount(x) : 4).tickSizeOuter(0));
      g.selectAll(':scope > .tick text').attr('fill', 'var(--tree)').attr('font-size', '12px').attr('font-weight', 'bold');
      g.selectAll(':scope > path, :scope > .tick line').attr('stroke', 'var(--tree)').attr('stroke-width', sw + 'px').attr('opacity', '1.0');
      g.selectAll(':scope > path').attr('fill', 'none');
    } else {
      var want = parseFloat(($('scaleRange') || {}).value || '0.5'), len = Math.min(widthPx, (want / maxDepth) * widthPx), value = (len / widthPx) * maxDepth;
      if (!(len > 0)) return;
      var lx = widthPx - len;   // at the root end
      g.append('line').attr('x1', lx).attr('x2', lx + len).attr('y1', 0).attr('y2', 0).attr('stroke', 'var(--tree)').attr('stroke-width', sw + 'px');
      g.append('text').attr('x', lx + len / 2).attr('y', ctx.below ? 18 : -8).attr('text-anchor', 'middle').attr('fill', 'var(--tree)').attr('font-size', '12px').attr('font-weight', 'bold').text(value.toFixed(2));
    }
  }
  function report() {
    var el = $('tangleReport'); if (!el) return;
    if (!tree2) { el.textContent = 'No second tree loaded.'; return; }
    var r = lastReport && lastReport.rf ? lastReport.rf : rf();
    if (!r) { el.textContent = name2 + ': ' + tipsOf(tree2).length + ' tips.'; return; }
    el.textContent = name2 + ': ' + r.shared + ' shared tips' + (r.only1 ? ', ' + r.only1 + ' only in the main tree' : '') + (r.only2 ? ', ' + r.only2 + ' only in the second' : '') +
      ' · RF distance ' + r.rf + ' of ' + r.max + ' (' + (r.norm * 100).toFixed(0) + '%)' + (lastReport ? ' · ' + lastReport.crossings + ' crossings' + (lastReport.removed ? ' · ' + lastReport.removed + ' redundant tip' + (lastReport.removed === 1 ? '' : 's') + ' removed' : '') : '');
  }
  // the panel comes and goes with the comparison: the panel system is laid out again
  function relayout() {
    if (typeof root === 'undefined' || !root) return;
    if (typeof geometry !== 'undefined' && geometry !== 'radial' && typeof window.tmRelayoutPanels === 'function') { try { window.tmRelayoutPanels(); } catch (e) { console.warn(e); } }
    if (typeof setDrawScope === 'function') { try { setDrawScope('compare'); } catch (e) {} }
    drawTree();
  }
  function redraw() { if (typeof root === 'undefined' || !root) return; if (typeof setDrawScope === 'function') { try { setDrawScope('compare'); } catch (e) {} } drawTree(); }
  function loading() { return !!(window.tmSession && tmSession.isLoading && tmSession.isLoading()); }
  // ------------------------------------------------------------------ controls
  function setEnabled() {
    var has = !!tree2;
    ['tangleShow', 'tangleOrderMode', 'tangleUnique', 'tangleGuides', 'tangleLinks', 'tangleRemove'].forEach(function (id) { var e = $(id); if (e) e.disabled = !has; });
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.id) return;
    if (t.id === 'tangleFile') {
      var f = t.files && t.files[0]; if (!f) return;
      f.text().then(function (txt) {
        try { load(txt, f.name); } catch (e) { if (typeof setStatus === 'function') setStatus('Second tree: ' + e.message); setEnabled(); return; }
        var s = $('tangleShow'); if (s && !s.checked) s.checked = true;
        $('tangleTree').dispatchEvent(new Event('change', { bubbles: true }));
        t.value = '';
        setEnabled(); relayout();
      });
    }
    else if (t.id === 'tangleTree') {
      // a session puts the tree back (its panel is laid out when the session draws the tree)
      if (t.value && t.value !== text2) { try { load(t.value, ($('tangleName') || {}).value || 'second tree'); } catch (e) { tree2 = null; } }
      else if (!t.value) { tree2 = null; text2 = ''; }
      setEnabled(); report();
      if (!loading()) relayout();
    }
    else if (t.id === 'tangleShow') { if (!loading()) relayout(); }
    else if (t.id === 'tangleOrderMode' || t.id === 'tangleUnique' || t.id === 'tangleGuides' || t.id === 'tangleLinks') { if (!loading()) redraw(); }
  });
  // the main tree's scale-bar and branch settings are drawn into this layer too: before the
  // app's own handler redraws, mark this layer as changed so it is drawn again, not reused
  var SHARED = { hideScaleBar: 1, coverScaleBar: 1, scaleRange: 1, scaleStrokeWidth: 1, branchStrokeWidth: 1 };
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !SHARED[t.id] || !tree2 || typeof setDrawScope !== 'function') return;
    try { setDrawScope('compare'); } catch (e) {}
  }, true);
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('#tangleRemove') : null; if (!t) return;
    ev.preventDefault();
    tree2 = null; text2 = ''; name2 = '';
    var st = $('tangleTree'); if (st) st.value = ''; var nm = $('tangleName'); if (nm) nm.value = '';
    setEnabled(); report(); relayout();
  });
  // the connectors follow the selection without a redraw (called from the app's highlight pass)
  function refreshSelection() {
    var sel = (typeof highlightedAccessions !== 'undefined') ? highlightedAccessions : new Set();
    document.querySelectorAll('#svg .tangle-line').forEach(function (l) {
      var on = sel.has(l.getAttribute('data-name'));
      var m = /^M[-\d.]+,([-\d.]+) C.* ([-\d.]+)$/.exec(l.getAttribute('d') || '');
      var straight = m && Math.abs(+m[1] - +m[2]) < 0.5;
      l.setAttribute('stroke', on ? '#ff6b35' : (straight ? '#94a3b8' : '#2563eb'));
      l.setAttribute('stroke-width', on ? 1.4 : 0.7);
      l.setAttribute('opacity', on ? 1 : 0.6);
    });
  }
  setEnabled();
  window.tmTangle = { draw: draw, panelWanted: panelWanted, reserve: function () { return 0; }, load: load, rf: rf, refreshSelection: refreshSelection, relayout: relayout, report: function () { return lastReport; }, tips: function () { return tree2 ? tipsOf(tree2).map(function (t) { return String(t.data.name); }) : []; } };
})();
