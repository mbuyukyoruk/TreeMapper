// Dataframe extras (loaded after app.js): gene names on the bars, and a header track on the side away from the axis row (a diagram of the region) above
// the panel (a schematic row of boxes, arrows and lines in the panel's own bp coordinates,
// e.g. "ncRNA" line, motif boxes and a gene arrow, as drawn by hand on figures).
//
// Both are settings of the dataframe card (Gene labels; Header track) and so are kept in
// sessions. The header track's lines: start end label [colour] [box|arrow|line], one item per
// line, e.g. "-300 0 ncRNA #9ca3af line". Rectangular layout only.
(function () {
  'use strict';
  var HEADER_H = 34, HEADER_GAP = 8;   // the band kept free for the track, and its distance from the tips
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function card(id) { return document.getElementById('dataframeCard' + id); }
  function q(id, sel) { var c = card(id); return c ? c.querySelector(sel) : null; }
  function labelSettings(id) {
    var on = q(id, '.gl-on');
    if (!on || !on.checked) return null;
    var place = q(id, '.gl-place:checked');
    return { place: place ? place.value : 'inside', font: +((q(id, '.gl-font') || {}).value) || 10, fit: !!(q(id, '.gl-fit') && q(id, '.gl-fit').checked) };
  }
  // a readable text colour on a fill
  function inkOn(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
    if (!m) { var r = /rgb\((\d+), (\d+), (\d+)\)/.exec(String(hex)); if (!r) return '#111'; m = [0, (+r[1]).toString(16).padStart(2, '0'), (+r[2]).toString(16).padStart(2, '0'), (+r[3]).toString(16).padStart(2, '0')]; }
    var L = 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16);
    return L > 150 ? '#111111' : '#ffffff';
  }
  var ctx2d = null;
  function textWidth(s, px) { if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d'); ctx2d.font = '600 ' + px + 'px ' + ((typeof drawingFontFamily === 'function' && drawingFontFamily(document.getElementById('svg'))) || 'sans-serif'); return ctx2d.measureText(s).width; }

  // one row's bars: [{ x, w, y, h, gname, color }]
  function drawBarLabels(id, leafG, bars) {
    var s = labelSettings(id); if (!s || !bars.length) return;
    // narrow bars first: a motif on a long gene keeps its name, the long gene's name gives way
    var placed = [];
    bars.slice().sort(function (a, b) { return a.w - b.w; }).forEach(function (b) {
      var tw = textWidth(b.gname, s.font);
      var cx = b.x + b.w / 2, box = { l: cx - tw / 2 - 2, r: cx + tw / 2 + 2 };
      if (placed.some(function (q) { return box.l < q.r && box.r > q.l; })) return;
      if (s.place === 'inside') {
        if (s.fit && tw > b.w - 4) return;
        if (b.h < s.font * 0.8) return;
        placed.push(box);
        leafG.append('text').attr('class', 'gene-bar-label').attr('x', b.x + b.w / 2).attr('y', b.y + b.h / 2).attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-size', s.font).attr('font-weight', '600').attr('fill', inkOn(b.color)).attr('pointer-events', 'none').attr('data-gene', b.gname).text(b.gname);
      } else {
        placed.push(box);
        leafG.append('text').attr('class', 'gene-bar-label gene-bar-label-above').attr('x', b.x + b.w / 2).attr('y', b.y - 1.5).attr('text-anchor', 'middle')
          .attr('font-size', s.font).attr('font-weight', '600').attr('fill', 'var(--tree)').attr('pointer-events', 'none').attr('data-gene', b.gname).text(b.gname);
      }
    });
  }

  // ---------------------------------------------------------------- header track
  function parseHeader(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (line) {
      var t = line.trim(); if (!t || t[0] === '#') return;
      var m = /^(-?[\d.]+)\s+(-?[\d.]+)\s*(.*)$/.exec(t); if (!m) return;
      var rest = m[3].trim(), shape = 'box', colour = '';
      var sm = /\b(box|arrow|rarrow|larrow|line)\s*$/i.exec(rest); if (sm) { shape = sm[1].toLowerCase(); rest = rest.slice(0, sm.index).trim(); }
      var cm = /(#[0-9a-f]{3,8}|[a-z]+)\s*$/i.exec(rest);
      if (cm && (cm[1][0] === '#' || /^(red|blue|green|grey|gray|black|orange|purple|teal|gold|pink|brown|navy|olive|maroon|silver|violet|indigo|cyan|magenta|lime|salmon|coral|tan|khaki|crimson|tomato|orchid|plum|slategray|steelblue|seagreen|goldenrod|firebrick|darkred|darkblue|darkgreen|lightblue|lightgreen|lightgray|lightgrey|darkgray|darkgrey|dimgray)$/i.test(cm[1]))) { colour = cm[1]; rest = rest.slice(0, cm.index).trim(); }
      var a = +m[1], b = +m[2];
      out.push({ start: Math.min(a, b), end: Math.max(a, b), reverse: a > b, label: rest, colour: colour || '#9ca3af', shape: shape });
    });
    return out;
  }
  function headerItems(id) { var ta = q(id, '.ht-text'); return ta ? parseHeader(ta.value) : []; }
  function anyHeader() {
    if (typeof dataframes === 'undefined' || !dataframes) return false;
    var any = false; dataframes.forEach(function (df, id) { if (headerItems(id).length) any = true; }); return any;
  }
  // names that would overlap step to further rows: the room reserved grows with them (the
  // rows are known once the track is laid out; a change of that need redraws once)
  var extraRows = {};
  function headerBand() {
    if (!anyHeader()) return 0;
    var extra = 0; Object.keys(extraRows).forEach(function (k) { if (dataframes.has(+k)) extra = Math.max(extra, extraRows[k]); });
    return HEADER_H + HEADER_GAP + extra;
  }
  // drawn into the panel's group on the side away from the axis row, so its shapes and names
  // never sit on the axis numbers and titles: below the last tip when the axes are on top,
  // above the first tip when the axes are below
  function drawHeader(id, ctx) {
    var items = headerItems(id); if (!items.length || !ctx || !ctx.panelScale) return;
    var font = +((q(id, '.ht-font') || {}).value) || 11;
    var tipsY = (typeof root !== 'undefined' && root) ? root.leaves().map(function (d) { return d.x; }).filter(Number.isFinite) : [];
    var atBottom = !ctx.axisRow.below;
    var y0 = atBottom ? (tipsY.length ? Math.max.apply(null, tipsY) : ctx.axisRow.y) + HEADER_GAP + 4 : (tipsY.length ? Math.min.apply(null, tipsY) : ctx.axisRow.y) - HEADER_GAP - HEADER_H;   // the track's top
    var H = 12, G = ctx.g.append('g').attr('class', 'header-track' + (atBottom ? ' header-track-bottom' : '')).attr('data-dataframe', id);
    var x0 = ctx.panelX, right = ctx.panelX + ctx.panelWidth - (ctx.margin ? ctx.margin.right : 0), labelBoxes = [], rows = 0;
    var ex = extraRows[id] || 0;
    if (!atBottom) y0 -= ex;   // above the tips: the band grows upward for the extra name rows (names above the shapes); below: downward (names below)
    items.forEach(function(it) {
      var xa = x0 + ctx.panelScale(it.start), xb = x0 + ctx.panelScale(it.end);
      var xl = Math.max(x0, Math.min(xa, xb)), xr = Math.min(right, Math.max(xa, xb));
      if (xr <= xl) return;
      var yc = atBottom ? y0 + 2 + H / 2 : y0 + ex + 16 + H / 2;
      if (it.shape === 'line') {
        G.append('line').attr('x1', xl).attr('x2', xr).attr('y1', yc).attr('y2', yc).attr('stroke', it.colour).attr('stroke-width', 3).attr('stroke-linecap', 'round');
      } else if (it.shape === 'arrow' || it.shape === 'rarrow' || it.shape === 'larrow') {
        var left = it.shape === 'larrow' || (it.shape === 'arrow' && it.reverse), tip = Math.min(10, (xr - xl) * 0.3);
        var d = left ? ('M' + xr + ',' + (yc - H / 2) + ' L' + (xl + tip) + ',' + (yc - H / 2) + ' L' + xl + ',' + yc + ' L' + (xl + tip) + ',' + (yc + H / 2) + ' L' + xr + ',' + (yc + H / 2) + ' Z')
                      : ('M' + xl + ',' + (yc - H / 2) + ' L' + (xr - tip) + ',' + (yc - H / 2) + ' L' + xr + ',' + yc + ' L' + (xr - tip) + ',' + (yc + H / 2) + ' L' + xl + ',' + (yc + H / 2) + ' Z');
        G.append('path').attr('d', d).attr('fill', it.colour).attr('stroke', 'none');
      } else {
        G.append('rect').attr('x', xl).attr('y', yc - H / 2).attr('width', xr - xl).attr('height', H).attr('rx', 2).attr('fill', it.colour);
      }
      if (it.label) {
        // labels that would overlap step up a line
        var tw = textWidth(it.label, font), cx = (xl + xr) / 2, box = { l: cx - tw / 2 - 3, r: cx + tw / 2 + 3, row: 0 };
        while (labelBoxes.some(function (q) { return q.row === box.row && box.l < q.r && box.r > q.l; })) box.row++;
        labelBoxes.push(box);
        rows = Math.max(rows, box.row);
        G.append('text').attr('x', cx).attr('y', atBottom ? y0 + H + 5 + font + box.row * (font + 2) : y0 + ex + 12 - box.row * (font + 2)).attr('text-anchor', 'middle').attr('dominant-baseline', 'auto').attr('font-size', font).attr('font-weight', '600').attr('fill', 'var(--tree)').text(it.label);
      }
    });
    var need = rows * (font + 2);
    if ((extraRows[id] || 0) !== need) { extraRows[id] = need; if (typeof drawTree === 'function') setTimeout(function () { drawTree(); }, 0); }
  }

  // ---------------------------------------------------------------- card
  function redraw(id) {
    if (typeof root === 'undefined' || !root) return;
    if (typeof setDrawScope === 'function') setDrawScope('dataframe:' + id);
    drawTree();
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.classList) return;
    if (!t.classList.contains('gl-on') && !t.classList.contains('gl-place') && !t.classList.contains('gl-font') && !t.classList.contains('gl-fit') && !t.classList.contains('ht-text') && !t.classList.contains('ht-font')) return;
    var c = t.closest('[id^="dataframeCard"]'); var m = c && /(\d+)$/.exec(c.id); if (!m) return;
    var sub = c.querySelector('.gl-sub'); if (sub) sub.hidden = !(c.querySelector('.gl-on') || {}).checked;
    // the header track changes the room beyond the tips: a full redraw
    if (t.classList.contains('ht-text')) { if (typeof root !== 'undefined' && root) drawTree(); return; }
    redraw(+m[1]);
  });
  window.tmGeneExtras = { drawBarLabels: drawBarLabels, drawHeader: drawHeader, headerBand: headerBand, parseHeader: parseHeader, HEADER_H: HEADER_H };
})();
