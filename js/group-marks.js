// Group marks: separator lines between groups of tips and a label per group, drawn on the
// canvas (loaded after app.js). Style tab → Group marks.
//
// The groups come from a layer's categories (a heatmap, highlight or clade-group column:
// each tip's value) or from clades picked on the tree ("Selected clades": Add the selected
// clade, name it). Tips are taken in drawn order; each run of tips with the same group gets a
// label (a group split into several runs gets one label per run) and a line is drawn where
// one run ends and the next begins. Rectangular layout: dashed lines across the tree and
// every data panel, labels to the right of the last panel. Circular layout: radial lines
// from the tree's edge to the outermost ring, labels outside it. Drawn inside the zoomable
// drawing, so they pan, zoom and export with it. Settings are Style controls (sessions).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(v) { return typeof normalizeAccession === 'function' ? normalizeAccession(v == null ? '' : v) : String(v); }

  // ------------------------------------------------------------------ settings
  function ctl() {
    return {
      source: $('groupMarksSource'), wanted: $('groupMarksSourceWanted'), lines: $('groupMarksLines'), labels: $('groupMarksLabels'),
      dashed: $('groupMarksDashed'), color: $('groupMarksColor'), width: $('groupMarksWidth'), font: $('groupMarksFont'), manual: $('groupMarksManual')
    };
  }
  function manualGroups() {
    var c = ctl(); if (!c.manual || !c.manual.value) return [];
    try { var v = JSON.parse(c.manual.value); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function setManual(list) {
    var c = ctl(); if (!c.manual) return;
    c.manual.value = list.length ? JSON.stringify(list) : '';
    renderManual();
  }
  // the layers whose categories can mark groups: [value, label, map]
  function layerSources() {
    var out = [];
    [['heatmap', typeof heatmaps !== 'undefined' ? heatmaps : null, 'Heatmap'], ['highlight', typeof highlights !== 'undefined' ? highlights : null, 'Highlight'], ['clade', typeof clades !== 'undefined' ? clades : null, 'Clade groups']].forEach(function (t) {
      if (!t[1]) return;
      t[1].forEach(function (d, id) {
        if (!d || !d.accessionToValue || !d.accessionToValue.size) return;
        if (t[0] === 'heatmap' && window.tmHeatScale && tmHeatScale.isGradient(d)) return;   // numbers on a gradient are not groups
        var title = $(t[0] + 'Title' + id);
        out.push({ value: t[0] + ':' + id, label: (title ? title.textContent : t[2] + ' ' + id), map: d.accessionToValue });
      });
    });
    return out;
  }
  function refreshOptions() {
    var c = ctl(); if (!c.source) return;
    var want = (c.wanted && c.wanted.value) || c.source.value || '';
    var html = '<option value="">(none)</option>' + layerSources().map(function (s) { return '<option value="' + esc(s.value) + '">' + esc(s.label) + '</option>'; }).join('') + '<option value="manual">Selected clades</option>';
    if (c.source.innerHTML !== html) c.source.innerHTML = html;
    c.source.value = want;
    if (c.source.value !== want) c.source.value = '';
    var box = $('groupMarksManualBox'); if (box) box.hidden = c.source.value !== 'manual';
  }
  // the group of each tip name, by the source chosen
  function groupOf() {
    var c = ctl(); if (!c.source) return null;
    var v = (c.wanted && c.wanted.value) || c.source.value;
    if (!v) return null;
    if (v === 'manual') {
      var byTip = new Map();
      manualGroups().forEach(function (g) { (g.tips || []).forEach(function (t) { byTip.set(norm(t), g.name || ''); }); });
      return byTip.size ? function (name) { return byTip.has(norm(name)) ? byTip.get(norm(name)) : null; } : null;
    }
    var src = layerSources().filter(function (s) { return s.value === v; })[0];
    if (!src) return null;
    return function (name) { var x = src.map.get(norm(name)); return x == null || x === '' ? null : String(x); };
  }

  // ------------------------------------------------------------------ drawing
  function runsOf(leaves, keyFn, order) {
    var ls = leaves.filter(function (l) { return Number.isFinite(order(l)); }).sort(function (a, b) { return order(a) - order(b); });
    var runs = [];
    ls.forEach(function (l, i) {
      var gname = keyFn(String(l.data.name));
      var last = runs[runs.length - 1];
      if (last && last.group === gname) { last.end = i; last.leaves.push(l); }
      else runs.push({ group: gname, start: i, end: i, leaves: [l] });
    });
    return { runs: runs, leaves: ls };
  }
  function draw(ctx) {
    var c = ctl();
    d3.select('#zoomable').selectAll('g.group-marks').remove();
    if (!c.source) return;
    var keyFn = groupOf();
    if (!keyFn || (!c.lines.checked && !c.labels.checked)) return;
    var colour = c.color.value || '#6b7280', width = +c.width.value || 1, font = +c.font.value || 12, dashed = c.dashed.checked;
    if (ctx.isRadial) return;   // drawn with the rings (drawRadial)
    var leaves = ctx.leaves.filter(function (l) { return !l._removedAsDuplicate && !(typeof droppedNodes !== 'undefined' && droppedNodes.has(l)); });
    {
      var R = runsOf(leaves, keyFn, function (l) { return l.x; });
      if (R.runs.length < 1) return;
      // from the tree's left edge to the right edge of the last data panel (or the labels)
      var z = document.getElementById('zoomable'), right = -Infinity, left = Infinity;
      var tree = typeof getTreePanelDimensions === 'function' ? getTreePanelDimensions() : null;
      if (tree) left = tree.x;
      ['.layers-container', 'g.nodes', 'g.links', '.tip-labels', 'g.labels'].forEach(function (sel) {
        var el = z.querySelector(sel); if (!el) return;
        try { var b = el.getBBox(); if (b.width) { right = Math.max(right, b.x + b.width); left = Math.min(left, b.x); } } catch (e) {}
      });
      Array.prototype.forEach.call(z.querySelectorAll('text.label'), function (t) { try { var b = t.getBBox(); if (b.width) right = Math.max(right, b.x + b.width); } catch (e) {} });
      // with data panels, the right edge of the last panel: it stays where it is when panels are
      // resized (a layer's drawn extent does not: content clipped to its panel still counts in a
      // bounding box, and pushed the labels out of the canvas when a column was made narrow)
      try {
        var ps = typeof getPanelPositions === 'function' ? getPanelPositions() : [], edge = -Infinity;
        ps.forEach(function (q) { if (q && q.width > 0 && q.type !== 'tree' && q.type !== 'labels' && !/^placeholder/.test(q.type)) edge = Math.max(edge, q.x + q.width); });
        if (isFinite(edge)) right = edge;
      } catch (e) {}
      if (!isFinite(right) || !isFinite(left)) return;
      var G = d3.select('#zoomable').append('g').attr('class', 'group-marks').attr('data-tree-part', '');
      var gap = R.leaves.length > 1 ? (R.leaves[R.leaves.length - 1].x - R.leaves[0].x) / (R.leaves.length - 1) : 10;
      if (c.lines.checked) {
        for (var i = 1; i < R.runs.length; i++) {
          var a = R.runs[i - 1], b2 = R.runs[i];
          if (a.group == null && b2.group == null) continue;
          var y = (a.leaves[a.leaves.length - 1].x + b2.leaves[0].x) / 2;
          G.append('line').attr('class', 'group-sep').attr('x1', left).attr('x2', right + 6).attr('y1', y).attr('y2', y)
            .attr('stroke', colour).attr('stroke-width', width).attr('stroke-dasharray', dashed ? '6,4' : null).attr('data-after', a.group == null ? '' : a.group).attr('data-before', b2.group == null ? '' : b2.group);
        }
      }
      if (c.labels.checked) {
        R.runs.forEach(function (r) {
          if (r.group == null || r.group === '') return;
          var y = (r.leaves[0].x + r.leaves[r.leaves.length - 1].x) / 2;
          G.append('text').attr('class', 'group-label').attr('x', right + 14).attr('y', y).attr('dominant-baseline', 'middle').attr('text-anchor', 'start')
            .attr('font-size', font).attr('font-weight', '600').attr('fill', 'var(--tree)').attr('data-group', r.group).text(r.group);
        });
      }
    }
  }
  // circular layout, drawn with the rings (same group and coordinates as the arcs): boundaries
  // between runs along the angle and, if the first and last groups differ, where the circle closes
  function drawRadial(ctx) {
    var c = ctl();
    if (!c.source || !ctx.group) return;
    var keyFn = groupOf();
    if (!keyFn || (!c.lines.checked && !c.labels.checked)) return;
    var colour = c.color.value || '#6b7280', width = +c.width.value || 1, font = +c.font.value || 12, dashed = c.dashed.checked;
    var leaves = (ctx.leaves || []).filter(function (l) { return !l._removedAsDuplicate && !(typeof droppedNodes !== 'undefined' && droppedNodes.has(l)); });
    var Rr = runsOf(leaves, keyFn, function (l) { return l.a; });
    if (Rr.runs.length < 1) return;
    var rings = (ctx.rings || []), inner = Infinity, outer = -Infinity;
    rings.forEach(function (r) { if (r.type !== 'tree' && r.type !== 'labels') { inner = Math.min(inner, r.innerRadius); outer = Math.max(outer, r.outerRadius); } });
    if (!isFinite(inner)) { rings.forEach(function (r) { if (r.type === 'labels') inner = Math.min(inner, r.innerRadius); }); }
    if (!isFinite(inner)) inner = Math.max.apply(null, leaves.map(function (l) { return l.r || 0; })) + 4;
    if (!isFinite(outer)) outer = inner + 40;
    var Gr = ctx.group.append('g').attr('class', 'group-marks');
    var pt = function (ang, r) { var t = ang - Math.PI / 2; return [Math.cos(t) * r, Math.sin(t) * r]; };
    var bounds = [];
    for (var j = 1; j < Rr.runs.length; j++) { var p = Rr.runs[j - 1], q = Rr.runs[j]; if (p.group == null && q.group == null) continue; bounds.push((p.leaves[p.leaves.length - 1].a + q.leaves[0].a) / 2); }
    var first = Rr.runs[0], lastR = Rr.runs[Rr.runs.length - 1];
    if (Rr.runs.length > 1 && first.group !== lastR.group && !(first.group == null && lastR.group == null)) {
      var span = (Rr.leaves.length > 1) ? (Rr.leaves[Rr.leaves.length - 1].a - Rr.leaves[0].a) / (Rr.leaves.length - 1) : 0.1;
      bounds.push(lastR.leaves[lastR.leaves.length - 1].a + span / 2);
    }
    if (c.lines.checked) bounds.forEach(function (ang) {
      var p1 = pt(ang, inner - 2), p2 = pt(ang, outer + 4);
      Gr.append('line').attr('class', 'group-sep').attr('x1', p1[0]).attr('y1', p1[1]).attr('x2', p2[0]).attr('y2', p2[1]).attr('stroke', colour).attr('stroke-width', width).attr('stroke-dasharray', dashed ? '6,4' : null);
    });
    if (c.labels.checked) Rr.runs.forEach(function (r) {
      if (r.group == null || r.group === '') return;
      var ang = (r.leaves[0].a + r.leaves[r.leaves.length - 1].a) / 2, p0 = pt(ang, outer + 12);
      var deg = ((ang * 180 / Math.PI) % 360 + 360) % 360, flip = deg > 180;
      Gr.append('text').attr('class', 'group-label').attr('transform', 'translate(' + p0[0] + ',' + p0[1] + ') rotate(' + (deg - 90 + (flip ? 180 : 0)) + ')')
        .attr('text-anchor', flip ? 'end' : 'start').attr('dominant-baseline', 'middle').attr('font-size', font).attr('font-weight', '600').attr('fill', 'var(--tree)').attr('data-group', r.group).text(r.group);
    });
  }
  // room kept free at the right of the panels for the labels (rectangular layout)
  function reserve() {
    var c = ctl();
    if (!c.source || !c.labels || !c.labels.checked || (typeof geometry !== 'undefined' && geometry === 'radial')) return 0;
    var keyFn = groupOf(); if (!keyFn || typeof root === 'undefined' || !root) return 0;
    var longest = 0;
    root.leaves().forEach(function (l) { var gname = keyFn(String(l.data.name)); if (gname) longest = Math.max(longest, String(gname).length); });
    if (!longest) return 0;
    return Math.ceil(longest * (+c.font.value || 12) * 0.62) + 28;
  }

  // ------------------------------------------------------------------ manual groups UI
  function renderManual() {
    var box = $('groupMarksManualList'); if (!box) return;
    var list = manualGroups();
    box.innerHTML = list.length ? list.map(function (g, i) {
      return '<div class="gm-row" data-i="' + i + '"><input type="text" class="gm-name" value="' + esc(g.name || '') + '" placeholder="Group ' + (i + 1) + '" aria-label="Group name" data-session-skip>' +
        '<span class="gm-n">' + (g.tips || []).length + ' tips</span><button type="button" class="gm-del" title="Remove">×</button></div>';
    }).join('') : '<p class="gm-hint">Select a clade on the tree, then “Add selected clade”.</p>';
  }
  function tipsOfSelection() {
    var out = [];
    if (typeof highlightedAccessions !== 'undefined' && highlightedAccessions.size) highlightedAccessions.forEach(function (n) { out.push(String(n)); });
    else if (typeof highlightedClade !== 'undefined' && highlightedClade) {
      (function walk(n) { var k = (n.children && n.children.length) ? n.children : (n._children || []); if (!k.length) out.push(String(n.data.name)); else k.forEach(walk); })(highlightedClade);
    }
    return out;
  }
  function redraw() {
    if (typeof root === 'undefined' || !root || typeof drawTree !== 'function') return;
    if (typeof normalizeWidths === 'function' && typeof geometry !== 'undefined' && geometry !== 'radial') { try { normalizeWidths(); } catch (e) {} }
    drawTree();
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.classList) return;
    if (t.id === 'groupMarksSource') { var w = $('groupMarksSourceWanted'); if (w) { w.value = t.value; w.dispatchEvent(new Event('change', { bubbles: true })); } var box = $('groupMarksManualBox'); if (box) box.hidden = t.value !== 'manual'; redraw(); }
    else if (t.id === 'groupMarksSourceWanted') { refreshOptions(); }
    else if (/^groupMarks(Lines|Labels|Dashed|Color|Width|Font|Manual)$/.test(t.id)) { if (t.id === 'groupMarksManual') renderManual(); redraw(); }
    else if (t.classList.contains('gm-name')) { var i = +t.closest('.gm-row').getAttribute('data-i'), l = manualGroups(); if (l[i]) { l[i].name = t.value; setManual(l); $('groupMarksManual').dispatchEvent(new Event('change', { bubbles: true })); } }
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('#groupMarksAdd, .gm-del') : null; if (!t) return;
    ev.preventDefault();
    var l = manualGroups();
    if (t.id === 'groupMarksAdd') {
      var tips = tipsOfSelection();
      if (tips.length < 1) { if (typeof setStatus === 'function') setStatus('Select a clade on the tree first'); return; }
      l.push({ name: 'Group ' + (l.length + 1), tips: tips });
    } else l.splice(+t.closest('.gm-row').getAttribute('data-i'), 1);
    setManual(l);
    $('groupMarksManual').dispatchEvent(new Event('change', { bubbles: true }));
  });
  // layers come and go: keep the source list current
  ['heatmapContainer', 'highlightContainer', 'cladeContainer'].forEach(function (id) {
    var el = $(id); if (el) new MutationObserver(function () { setTimeout(refreshOptions, 0); }).observe(el, { childList: true, subtree: true, characterData: true });
  });
  refreshOptions(); renderManual();
  window.tmGroupMarks = { draw: draw, drawRadial: drawRadial, reserve: reserve, refreshOptions: refreshOptions };
})();
