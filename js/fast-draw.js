// Large trees drawn as few elements (prototype, branch fast-prototype).
//
// A drawing of 20,000 tips with data columns is 300,000 SVG elements when every branch,
// marker, cell and bar is its own element; the browser then styles and lays out all of
// them on every redraw, and Safari takes seconds. From TM_FAST_FROM tips (3,000; rectangular
// layout) the tree is drawn here instead: all branches of one colour and width as one
// path, all markers of one look as one path, all cells of one colour as one path, all
// bars of one gene as one path. Hover, click and tooltips are found from coordinates
// (the row from y, the bar from x), so the features behave as before. Everything stays
// SVG: zoom, export, sessions, undo, selection, the comparison tree work unchanged.
//
// What is different in fast mode: synteny links are not drawn (they need one element
// per bar); line and box charts are drawn as before (per element).
(function () {
  'use strict';
  const F = { active: false, rows: null, links: null, nodes: null, markers: null, cols: new Map(), MANY_COLOURS: 400 };
  window.TM_FAST_FROM = window.TM_FAST_FROM || 3000;
  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  // ---- a redraw begins: is this a large rectangular tree?
  F.begin = function (leaves, isRadial) {
    F.active = !isRadial && leaves.length >= window.TM_FAST_FROM && window.tmFastDraw !== false;
    F.cols = new Map();
    // the hovered row is forgotten with the drawing it was found in (the next pointer move finds it again)
    try { if (typeof hoveredBand !== 'undefined') hoveredBand = null; } catch (e) {}
    if (!F.active) { F.rows = null; return false; }
    const rows = leaves.filter(l => Number.isFinite(l.x)).map(l => ({ y: l.x, leaf: l }));
    rows.sort((a, b) => a.y - b.y);
    F.rows = rows;
    return true;
  };
  // the tip drawn at y (within tol), or null
  F.rowAt = function (y, tol) {
    const rows = F.rows; if (!rows || !rows.length) return null;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].y < y) lo = mid + 1; else hi = mid; }
    let best = rows[lo];
    if (lo > 0 && Math.abs(rows[lo - 1].y - y) < Math.abs(best.y - y)) best = rows[lo - 1];
    return Math.abs(best.y - y) <= tol ? best.leaf : null;
  };
  // pointer position in a group's own coordinates
  function pointerIn(ev, el) { return d3.pointer(ev, el); }
  function zoomK() { try { return d3.zoomTransform(document.getElementById('svg')).k || 1; } catch (e) { return 1; } }

  // ---- branches: one path per (stroke, width)
  // links: [{source, target}]; shape(d) -> path d; stroke(d), width(d) -> the branch's look
  F.drawLinks = function (parent, links, shape, stroke, width) {
    F.links = { links, shape, stroke, width };
    const G = parent.append('g').attr('class', 'links').attr('data-tree-part', '').attr('data-fast', '');
    F.linksG = G.node();
    F.restyleLinks();
    return G;
  };
  // the branches drawn again with their current colours (the selection overlay, path
  // colours, clade colours): a few paths replaced, no per-branch elements
  F.restyleLinks = function (overlayStroke, overlayWidth) {
    const L = F.links, G = F.linksG; if (!L || !G || !G.isConnected) return;
    if (overlayStroke) F.overlay = { stroke: overlayStroke, width: overlayWidth }; else if (F.overlay === undefined) F.overlay = null;
    const ov = F.overlay;
    const groups = new Map();
    for (const d of L.links) {
      let s = ov && ov.stroke ? ov.stroke(d) : null, w = ov && ov.width ? ov.width(d) : null;
      if (s == null) s = L.stroke(d);
      if (w == null) w = L.width(d);
      const key = s + '|' + w;
      let g = groups.get(key);
      if (!g) { g = { s, w, d: [] }; groups.set(key, g); }
      g.d.push(L.shape(d));
    }
    while (G.firstChild) G.removeChild(G.firstChild);
    groups.forEach(g => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'tree-branch tree-branches'); p.setAttribute('fill', 'none');
      p.setAttribute('stroke', g.s); p.setAttribute('stroke-width', g.w); p.setAttribute('d', g.d.join(''));
      G.appendChild(p);
    });
  };

  // ---- markers: one path per look, a hit area for clicks
  // nodes: the nodes to draw; look(d) -> { fill, stroke, strokeWidth, isInternal, hidden }
  F.drawNodes = function (parent, nodes, look, opts) {
    F.nodes = { nodes, look, opts };
    const G = parent.append('g').attr('class', 'nodes').attr('data-tree-part', '').attr('data-fast', '');
    F.nodesG = G.node();
    // the hit area over the tree: clicks select the nearest marker
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const d of nodes) { if (d.y < x0) x0 = d.y; if (d.y > x1) x1 = d.y; if (d.x < y0) y0 = d.x; if (d.x > y1) y1 = d.x; }
    const pad = Math.max(opts.tipNodeSize || 2, opts.internalNodeSize || 2) + 6;
    const hit = G.append('rect').attr('class', 'fast-hit fast-hit-tree').attr('x', x0 - pad).attr('y', y0 - pad).attr('width', Math.max(0, x1 - x0) + 2 * pad).attr('height', Math.max(0, y1 - y0) + 2 * pad).attr('fill', 'transparent').attr('stroke', 'none');
    const visible = nodes.filter(d => !look(d).hidden);
    F.nodes.quad = d3.quadtree().x(d => d.y).y(d => d.x).addAll(visible);
    hit.on('click', function (ev) {
      const [px, py] = pointerIn(ev, G.node());
      const tol = (pad + 2) / zoomK();
      const d = F.nodes.quad.find(px, py, tol);
      if (!d) return;
      ev.stopPropagation();
      highlightClade(d, ev.ctrlKey || ev.metaKey);
    });
    F.markersG = G.append('g').attr('class', 'fast-markers').node();
    F.updateMarkers();
    return G;
  };
  function markerPath(shape, cx, cy, s) {
    if (shape === 'square') return 'M' + n2(cx - s) + ',' + n2(cy - s) + 'h' + n2(2 * s) + 'v' + n2(2 * s) + 'h' + n2(-2 * s) + 'z';
    if (shape === 'diamond') return 'M' + n2(cx + s) + ',' + n2(cy) + 'L' + n2(cx) + ',' + n2(cy + s) + 'L' + n2(cx - s) + ',' + n2(cy) + 'L' + n2(cx) + ',' + n2(cy - s) + 'z';
    if (shape === 'triangle') return 'M' + n2(cx + s) + ',' + n2(cy + s) + 'L' + n2(cx - s) + ',' + n2(cy + s) + 'L' + n2(cx) + ',' + n2(cy - s) + 'z';
    return 'M' + n2(cx - s) + ',' + n2(cy) + 'a' + n2(s) + ',' + n2(s) + ' 0 1,0 ' + n2(2 * s) + ',0a' + n2(s) + ',' + n2(s) + ' 0 1,0 ' + n2(-2 * s) + ',0';
  }
  // the markers drawn again with their current look (a selection changed): a few paths
  F.updateMarkers = function () {
    const N = F.nodes, G = F.markersG; if (!N || !G || !G.isConnected) return;
    const groups = new Map();
    for (const d of N.nodes) {
      const k = N.look(d); if (k.hidden) continue;
      const shape = k.isInternal ? (N.opts.internalNodeShape || 'circle') : (N.opts.tipNodeShape || 'circle');
      const size = k.isInternal ? N.opts.internalNodeSize : N.opts.tipNodeSize;
      const key = k.fill + '|' + k.stroke + '|' + k.strokeWidth + '|' + shape + '|' + size;
      let g = groups.get(key);
      if (!g) { g = { fill: k.fill, stroke: k.stroke, sw: k.strokeWidth, d: [] }; groups.set(key, g); }
      g.d.push(markerPath(shape, d.y, d.x, size));
    }
    while (G.firstChild) G.removeChild(G.firstChild);
    groups.forEach(g => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'fast-marker'); p.setAttribute('fill', g.fill); p.setAttribute('stroke', g.stroke); p.setAttribute('stroke-width', g.sw);
      p.setAttribute('d', g.d.join('')); p.setAttribute('pointer-events', 'none');
      G.appendChild(p);
    });
  };

  // ---- a data column: cells, bars and dots batched by colour, hover and click by position
  // item(spanG, opts, item): the column registers itself on its first item;
  //   opts: { x, w, rowTol, tooltip(item, leaf) -> html, click(item, leaf, ev), vmin, vmax }
  //   item: { x, w, y, h, leaf, color | stroke+sw, path? (own path d), back? (drawn first), ...data }
  // finish(spanG): the paths and the hit area are made
  F.item = function (spanG, opts, item) {
    const el = spanG.node();
    let col = F.cols.get(el);
    if (!col) { col = { spanG, el, opts, groups: new Map(), byRow: new Map(), y0: Infinity, y1: -Infinity }; F.cols.set(el, col); }
    const key = (item.back ? 'B' : 'A') + (item.stroke ? 'S' + item.stroke + '|' + item.sw : 'F' + item.color) + (item.op != null ? '|' + item.op : '');
    let g = col.groups.get(key);
    if (!g) { g = { color: item.color, stroke: item.stroke, sw: item.sw, op: item.op, back: !!item.back, d: [], items: [], plain: true }; col.groups.set(key, g); }
    g.d.push(item.path || ('M' + n2(item.x) + ',' + n2(item.y) + 'h' + n2(item.w) + 'v' + n2(item.h) + 'h' + n2(-item.w) + 'z'));
    g.items.push(item); if (item.path || item.stroke) g.plain = false;
    if (item.leaf) { let r = col.byRow.get(item.leaf); if (!r) { r = []; col.byRow.set(item.leaf, r); } r.push(item); }
    if (item.y < col.y0) col.y0 = item.y; if (item.y + item.h > col.y1) col.y1 = item.y + item.h;
  };
  // a gene bar: a box, a box with an arrow head (og > 0 right, else left), or a line (DNA mode)
  F.barPath = function (x, w, y, h, mode, og) {
    if (mode === 'line') return 'M' + n2(x) + ',' + n2(y + h / 2) + 'H' + n2(x + w);
    if (mode !== 'arrow') return null;
    const tipW = Math.min(h * 0.7, w * 0.3), bw = w - tipW;
    if (og > 0) return 'M' + n2(x) + ',' + n2(y) + 'h' + n2(bw) + 'v' + n2(h) + 'h' + n2(-bw) + 'z' + 'M' + n2(x + bw) + ',' + n2(y) + 'L' + n2(x + bw + tipW) + ',' + n2(y + h / 2) + 'L' + n2(x + bw) + ',' + n2(y + h) + 'z';
    return 'M' + n2(x + tipW) + ',' + n2(y) + 'h' + n2(bw) + 'v' + n2(h) + 'h' + n2(-bw) + 'z' + 'M' + n2(x) + ',' + n2(y + h / 2) + 'L' + n2(x + tipW) + ',' + n2(y) + 'L' + n2(x + tipW) + ',' + n2(y + h) + 'z';
  };
  F.circlePath = function (cx, cy, r) { return markerPath('circle', cx, cy, r); };
  F.finish = function (spanG) {
    const el = spanG.node(), col = F.cols.get(el);
    if (!col) return;
    F.cols.delete(el);
    const G = col.spanG;
    const ordered = [...col.groups.values()].sort((a, b) => (b.back ? 1 : 0) - (a.back ? 1 : 0));
    // a column of many colours (a heatmap where every value differs: thousands of colours, so
    // thousands of paths): its plain boxes are painted into one picture instead
    if (ordered.length > F.MANY_COLOURS && ordered.every(g => g.plain) && Number.isFinite(col.y0)) {
      const o = col.opts, S = 2, W = Math.max(1, Math.round(o.w * S)), H = Math.max(1, Math.round((col.y1 - col.y0) * S));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.min(H, 16000); const ctx = cv.getContext('2d');
      const ky = cv.height / H;
      ordered.forEach(g => { ctx.fillStyle = g.color; if (g.op != null) ctx.globalAlpha = g.op; g.items.forEach(it => ctx.fillRect((it.x - o.x) * S, (it.y - col.y0) * S * ky, Math.max(0.5, it.w * S), Math.max(0.5, it.h * S * ky))); ctx.globalAlpha = 1; });
      G.append('image').attr('class', 'fast-items fast-picture').attr('x', o.x).attr('y', col.y0).attr('width', o.w).attr('height', col.y1 - col.y0).attr('preserveAspectRatio', 'none').attr('href', cv.toDataURL('image/png')).attr('pointer-events', 'none');
      col.pictured = ordered;
    } else
    ordered.forEach(g => {
      const p = G.append('path').attr('class', 'fast-items').attr('d', g.d.join('')).attr('pointer-events', 'none');
      if (g.stroke) p.attr('fill', 'none').attr('stroke', g.stroke).attr('stroke-width', g.sw); else p.attr('fill', g.color).attr('stroke', 'none');
      if (g.op != null) p.attr('opacity', g.op);
    });
    if (!Number.isFinite(col.y0)) return;
    const o = col.opts;
    const hit = G.append('rect').attr('class', 'fast-hit fast-hit-column').attr('x', o.x).attr('y', col.y0).attr('width', Math.max(0, o.w)).attr('height', Math.max(0, col.y1 - col.y0)).attr('fill', 'transparent').attr('stroke', 'none');
    const find = (ev) => {
      const [px, py] = pointerIn(ev, col.el);
      const leaf = F.rowAt(py, (o.rowTol || 0));
      if (!leaf) return null;
      const items = col.byRow.get(leaf); if (!items) return null;
      for (let i = 0; i < items.length; i++) { const it = items[i]; if (py >= it.y && py <= it.y + it.h && px >= it.x && px <= it.x + it.w) return { item: it, leaf }; }
      return null;
    };
    let over = null;
    hit.on('mousemove', function (ev) {
      if (typeof isDragging !== 'undefined' && isDragging) return; if (window.__draggingSplitter) return;
      const h = find(ev);
      const name = h ? String(h.leaf.data.name) : null;
      if (over !== name) { if (over) bandHover(over, false); if (name) bandHover(name, true); over = name; }
      this.style.cursor = h && o.click && !h.item.back ? 'pointer' : '';
      if (h && o.tooltip) { ev.stopPropagation(); showTip(ev, h.leaf, true, { v: o.tooltip(h.item, h.leaf), vmin: o.vmin, vmax: o.vmax }); } else hideTip();
    }).on('mouseleave', function () { if (over) { bandHover(over, false); over = null; } hideTip(); this.style.cursor = ''; })
      .on('click', function (ev) { if (!o.click) return; if (typeof isDragging !== 'undefined' && isDragging) return; if (window.__draggingSplitter) return; const h = find(ev); if (!h || h.item.back) return; ev.stopPropagation(); o.click(h.item, h.leaf, ev); });
  };

  // ---- the label backgrounds (highlight layers): one path per colour, only where there is one
  // rows: [{ x, y, w, h, fill, op }] for the tips with highlight data
  F.labelBgs = function (rows) {
    const G = F.nodesG; if (!G) return;
    const groups = new Map();
    rows.forEach(r => { const key = r.fill + '|' + r.op; let g = groups.get(key); if (!g) { g = { fill: r.fill, op: r.op, d: [] }; groups.set(key, g); } g.d.push('M' + n2(r.x) + ',' + n2(r.y) + 'h' + n2(r.w) + 'v' + n2(r.h) + 'h' + n2(-r.w) + 'z'); });
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'g'); holder.setAttribute('class', 'fast-label-bgs');
    groups.forEach(g => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', 'label-highlight-bg'); p.setAttribute('fill', g.fill); p.setAttribute('opacity', g.op); p.setAttribute('d', g.d.join('')); p.setAttribute('pointer-events', 'none'); holder.appendChild(p); });
    G.insertBefore(holder, G.firstChild);
  };

  window.tmFast = F;
})();
