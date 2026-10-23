// Dataframe synteny (loaded after app.js). Dataframe card → Synteny:
//   - Links between rows: a ribbon in the gene's colour joining the same gene in two
//     neighbouring rows (as clinker draws gene clusters), so conserved neighbourhoods read
//     as bands down the panel; an opacity;
//   - Collapse identical neighbourhoods: rows whose genes, in order and orientation, repeat
//     the row above are drawn as a thin line, and the first row of the run says "× N".
// Rectangular layout only; drawn with the panel, so exported and kept in sessions (the
// card's switches).
(function () {
  'use strict';
  function card(id) { return document.getElementById('dataframeCard' + id); }
  function q(id, sel) { var c = card(id); return c ? c.querySelector(sel) : null; }
  function settings(id) {
    return {
      links: !!(q(id, '.sy-links') && q(id, '.sy-links').checked),
      opacity: Math.max(0.05, Math.min(1, (+((q(id, '.sy-opacity') || {}).value) || 35) / 100)),
      collapse: !!(q(id, '.sy-collapse') && q(id, '.sy-collapse').checked)
    };
  }
  // a row's neighbourhood: its genes left to right with their orientation
  function signature(bars) {
    return bars.slice().sort(function (a, b) { return a.x - b.x; }).map(function (b) { return b.gname + (b.og > 0 ? '>' : b.og < 0 ? '<' : ''); }).join('|');
  }
  // rows: Map(leaf -> { g: the row's <g>, bars: [{ x, w, y, h, gname, color, og }] })
  function draw(id, ctx) {
    var s = settings(id);
    if ((!s.links && !s.collapse) || !ctx || !ctx.rows || !ctx.rows.size) return;
    var rows = [];
    ctx.rows.forEach(function (r, leaf) { if (Number.isFinite(leaf.x)) rows.push({ leaf: leaf, y: leaf.x, g: r.g, bars: r.bars }); });
    rows.sort(function (a, b) { return a.y - b.y; });
    var G = ctx.g.append('g').attr('class', 'synteny').attr('data-dataframe', id);
    if (s.collapse) {
      var i = 0;
      while (i < rows.length) {
        var sig = signature(rows[i].bars), j = i + 1;
        while (j < rows.length && rows[j].bars.length && signature(rows[j].bars) === sig) j++;
        var n = j - i;
        if (n > 1 && rows[i].bars.length) {
          for (var k = i + 1; k < j; k++) {
            var r = rows[k];
            // the row's own bars go; a thin line stands for "the same as above"
            // (a large tree drawn as few elements: the column leaves the row out of its paths)
            if (r.g) Array.prototype.forEach.call(r.g.node().querySelectorAll('rect:not(.df-leaf-highlight), path, line, text.gene-bar-label'), function (el) { el.remove(); });
            else if (ctx.drop) ctx.drop(r.leaf);
            r.collapsed = true;
            var x0 = Math.min.apply(null, rows[i].bars.map(function (b) { return b.x; })), x1 = Math.max.apply(null, rows[i].bars.map(function (b) { return b.x + b.w; }));
            G.append('line').attr('class', 'synteny-same').attr('x1', x0).attr('x2', x1).attr('y1', r.y).attr('y2', r.y).attr('stroke', 'var(--muted)').attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', 0.7);
          }
          var last = rows[i].bars.reduce(function (m, b) { return b.x + b.w > m.x + m.w ? b : m; }, rows[i].bars[0]);
          G.append('text').attr('class', 'synteny-count').attr('x', last.x + last.w + 6).attr('y', rows[i].y).attr('dominant-baseline', 'middle').attr('font-size', Math.max(8, Math.min(12, last.h))).attr('fill', 'var(--muted)').attr('data-count', n).text('× ' + n);
        }
        i = j;
      }
    }
    if (s.links) {
      var L = G.append('g').attr('class', 'synteny-links');
      var batched = ctx.fast ? new Map() : null;   // (a large tree: all links of one colour as one path)
      for (var a = 0; a + 1 < rows.length; a++) {
        var up = rows[a], dn = rows[a + 1];
        if (up.collapsed || dn.collapsed) continue;
        var byGene = new Map();
        dn.bars.forEach(function (b) { if (!byGene.has(b.gname)) byGene.set(b.gname, b); });
        up.bars.forEach(function (b) {
          var t = byGene.get(b.gname); if (!t) return;
          var y1 = b.y + b.h, y2 = t.y, mid = (y1 + y2) / 2;
          if (y2 <= y1) return;
          var d = 'M' + b.x + ',' + y1 + ' C' + b.x + ',' + mid + ' ' + t.x + ',' + mid + ' ' + t.x + ',' + y2 + ' L' + (t.x + t.w) + ',' + y2 + ' C' + (t.x + t.w) + ',' + mid + ' ' + (b.x + b.w) + ',' + mid + ' ' + (b.x + b.w) + ',' + y1 + ' Z';
          if (batched) { var acc = batched.get(b.color); if (!acc) { acc = []; batched.set(b.color, acc); } acc.push(d); return; }
          L.append('path').attr('class', 'synteny-link').attr('d', d).attr('fill', b.color).attr('fill-opacity', s.opacity).attr('stroke', 'none').attr('data-gene', b.gname).attr('pointer-events', 'none');
        });
      }
      if (batched) batched.forEach(function (ds, color) { L.append('path').attr('class', 'synteny-link synteny-links-batched').attr('d', ds.join('')).attr('fill', color).attr('fill-opacity', s.opacity).attr('stroke', 'none').attr('pointer-events', 'none'); });
    }
  }
  function redraw(id) {
    if (typeof root === 'undefined' || !root) return;
    if (typeof setDrawScope === 'function') setDrawScope('dataframe:' + id);
    drawTree();
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.classList) return;
    if (!t.classList.contains('sy-links') && !t.classList.contains('sy-opacity') && !t.classList.contains('sy-collapse')) return;
    var c = t.closest('[id^="dataframeCard"]'); var m = c && /(\d+)$/.exec(c.id); if (!m) return;
    var sub = c.querySelector('.sy-sub'); if (sub) sub.hidden = !(c.querySelector('.sy-links') || {}).checked;
    redraw(+m[1]);
  });
  window.tmSynteny = { draw: draw, signature: signature };
})();
