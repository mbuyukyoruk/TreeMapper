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
    F.active = leaves.length >= window.TM_FAST_FROM && window.tmFastDraw !== false;
    F.radial = !!isRadial;
    F.cols = new Map();
    F.drawCount = (F.drawCount || 0) + 1;
    // a drag's pictures belong to the drawing they were painted from; a column the redraw keeps gets its paths back
    if (F.dragEnd) { F.dragEnd(); dropPictures(); }
    document.querySelectorAll('[data-fast-hidden]').forEach(p => { p.style.visibility = p.getAttribute('data-fast-hidden') || ''; p.removeAttribute('data-fast-hidden'); });
    // the hovered row is forgotten with the drawing it was found in (the next pointer move finds it again)
    try { if (typeof hoveredBand !== 'undefined') hoveredBand = null; } catch (e) {}
    if (!F.active) { F.rows = null; return false; }
    const rows = leaves.filter(l => Number.isFinite(l.x)).map(l => ({ y: l.x, leaf: l }));
    rows.sort((a, b) => a.y - b.y);
    F.rows = rows;
    F.leaves = leaves; F.rowsA = null;   // (the circular layout: rows by angle, made when first needed)
    F.culled = false;
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
    const pos = opts.pos || (d => [d.y, d.x]);
    F.nodes.pos = pos;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const d of nodes) { const [px, py] = pos(d); if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    const pad = Math.max(opts.tipNodeSize || 2, opts.internalNodeSize || 2) + 6;
    const hit = G.append('rect').attr('class', 'fast-hit fast-hit-tree').attr('x', x0 - pad).attr('y', y0 - pad).attr('width', Math.max(0, x1 - x0) + 2 * pad).attr('height', Math.max(0, y1 - y0) + 2 * pad).attr('fill', 'transparent').attr('stroke', 'none');
    const visible = nodes.filter(d => !look(d).hidden);
    F.nodes.quad = d3.quadtree().x(d => pos(d)[0]).y(d => pos(d)[1]).addAll(visible);
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
      const [px, py] = N.pos ? N.pos(d) : [d.y, d.x];
      g.d.push(markerPath(shape, px, py, size));
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
  // rows left out of a column (synteny's collapsed rows): its paths are made without them
  F.dropRows = function (spanG, leaves) {
    const col = F.cols.get(spanG.node()); if (!col) return;
    col.groups.forEach(g => { g.items = g.items.filter(it => !leaves.has(it.leaf)); g.d = g.items.map(it => it.path || ('M' + n2(it.x) + ',' + n2(it.y) + 'h' + n2(it.w) + 'v' + n2(it.h) + 'h' + n2(-it.w) + 'z')); });
    leaves.forEach(l => col.byRow.delete(l));
  };
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
      G.append('image').attr('class', 'fast-items fast-picture').attr('data-cells', ordered.reduce((a, g) => a + g.items.length, 0)).attr('x', o.x).attr('y', col.y0).attr('width', o.w).attr('height', col.y1 - col.y0).attr('preserveAspectRatio', 'none').attr('href', cv.toDataURL('image/png')).attr('pointer-events', 'none');
      col.pictured = ordered;
    } else
    ordered.forEach(g => {
      const p = G.append('path').attr('class', 'fast-items').attr('d', g.d.join('')).attr('pointer-events', 'none');
      if (g.stroke) p.attr('fill', 'none').attr('stroke', g.stroke).attr('stroke-width', g.sw); else p.attr('fill', g.color).attr('stroke', 'none');
      if (g.op != null) p.attr('opacity', g.op);
    });
    if (!Number.isFinite(col.y0)) return;
    const o = col.opts;
    el.__fastCol = col;
    const hit = G.append('rect').attr('class', 'fast-hit fast-hit-column').attr('x', o.x).attr('y', col.y0).attr('width', Math.max(0, o.w)).attr('height', Math.max(0, col.y1 - col.y0)).attr('fill', 'transparent').attr('stroke', 'none');
    const find = (ev) => {
      const [px, py] = pointerIn(ev, col.el);
      // rows thinner than a pixel: the pointer (whole pixels in Firefox) is given to the nearest row
      const leaf = F.rowAt(py, Math.max(o.rowTol || 0, 0.5));
      if (!leaf) return null;
      const items = col.byRow.get(leaf); if (!items) return null;
      for (let i = 0; i < items.length; i++) { const it = items[i]; const sl = it.h < 1 ? 0.5 : 0; if (py >= it.y - sl && py <= it.y + it.h + sl && px >= it.x && px <= it.x + it.w) return { item: it, leaf }; }
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

  // ---- a data ring of the circular layout: arcs batched by colour, hover and click by angle and radius
  // polar(group, opts, item): opts { r0, r1 (the ring), aTol, tooltip(item, leaf), click(item, leaf, ev), vmin, vmax }
  //   item { a (the row's angle), r0, r1, path (the arc), color | stroke+sw, op?, back?, leaf, ...data }
  // finishPolar(group): the paths and the hit ring
  F.polar = function (spanG, opts, item) {
    const el = spanG.node();
    let col = F.cols.get(el);
    if (!col) { col = { spanG, el, opts, groups: new Map(), byRow: new Map(), polar: true }; F.cols.set(el, col); }
    const key = (item.back ? 'B' : 'A') + (item.stroke ? 'S' + item.stroke + '|' + item.sw : 'F' + item.color) + (item.op != null ? '|' + item.op : '');
    let g = col.groups.get(key);
    if (!g) { g = { color: item.color, stroke: item.stroke, sw: item.sw, op: item.op, back: !!item.back, d: [] }; col.groups.set(key, g); }
    g.d.push(item.path);
    if (item.leaf) { let r = col.byRow.get(item.leaf); if (!r) { r = []; col.byRow.set(item.leaf, r); } r.push(item); }
  };
  // the row at an angle (the circular layout's leaves sorted by their angle)
  F.rowAtAngle = function (a, tol) {
    if (!F.rowsA) { F.rowsA = (F.leaves || []).filter(l => Number.isFinite(l.a)).map(l => ({ a: l.a, leaf: l })); F.rowsA.sort((p, q) => p.a - q.a); }
    const rows = F.rowsA; if (!rows.length) return null;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].a < a) lo = mid + 1; else hi = mid; }
    let best = rows[lo];
    if (lo > 0 && Math.abs(rows[lo - 1].a - a) < Math.abs(best.a - a)) best = rows[lo - 1];
    // (the first and last rows meet across the seam at 12 o'clock)
    const seam = rows[0], last = rows[rows.length - 1];
    if (Math.abs(seam.a + 2 * Math.PI - a) < Math.abs(best.a - a)) best = seam;
    if (Math.abs(last.a - 2 * Math.PI - a) < Math.abs(best.a - a)) best = last;
    const da = Math.min(Math.abs(best.a - a), Math.abs(best.a + 2 * Math.PI - a), Math.abs(best.a - 2 * Math.PI - a));
    return da <= tol ? best.leaf : null;
  };
  F.finishPolar = function (spanG) {
    const el = spanG.node(), col = F.cols.get(el);
    if (!col) return;
    F.cols.delete(el);
    const G = col.spanG, o = col.opts;
    const ordered = [...col.groups.values()].sort((a, b) => (b.back ? 1 : 0) - (a.back ? 1 : 0));
    // (a ring drag draws the ring from these, js/fast-draw.js radialDragFrame)
    { const flat = []; col.byRow.forEach(items => items.forEach(it => flat.push(it))); el.__fastRing = { opts: o, items: flat }; }
    // a ring of many colours (a column where every value differs): its arcs painted into one picture
    if (ordered.length > F.MANY_COLOURS && o.r1 > o.r0 && ordered.every(g => !g.stroke && col.byRow.size)) {
      const S = 2, R = o.r1, W = Math.max(1, Math.round(2 * R * S)), cv = document.createElement('canvas'); cv.width = W; cv.height = W;
      const ctx = cv.getContext('2d'); ctx.translate(W / 2, W / 2); ctx.scale(S, S);
      let n = 0;
      col.byRow.forEach(items => items.forEach(it => {
        const a0 = (it.a0 !== undefined ? it.a0 : it.a - (o.aTol || 0)) - Math.PI / 2, a1 = (it.a1 !== undefined ? it.a1 : it.a + (o.aTol || 0)) - Math.PI / 2;
        ctx.beginPath(); ctx.arc(0, 0, it.r1, a0, a1); ctx.arc(0, 0, it.r0, a1, a0, true); ctx.closePath();
        ctx.fillStyle = it.color; if (it.op != null) ctx.globalAlpha = it.op; ctx.fill(); ctx.globalAlpha = 1; n++;
      }));
      G.append('image').attr('class', 'fast-items fast-picture').attr('data-cells', n).attr('x', -R).attr('y', -R).attr('width', 2 * R).attr('height', 2 * R).attr('href', cv.toDataURL('image/png')).attr('pointer-events', 'none');
    } else
    ordered.forEach(g => {
      const p = G.append('path').attr('class', 'fast-items').attr('d', g.d.join('')).attr('pointer-events', 'none');
      if (g.stroke) p.attr('fill', 'none').attr('stroke', g.stroke).attr('stroke-width', g.sw); else p.attr('fill', g.color).attr('stroke', 'none');
      if (g.op != null) p.attr('opacity', g.op);
    });
    if (!(o.r1 > o.r0)) return;
    const ring = d3.arc()({ innerRadius: o.r0, outerRadius: o.r1, startAngle: 0, endAngle: 2 * Math.PI });
    const hit = G.append('path').attr('class', 'fast-hit fast-hit-ring').attr('d', ring).attr('fill', 'transparent').attr('stroke', 'none');
    const find = (ev) => {
      const [px, py] = pointerIn(ev, col.el);
      const r = Math.hypot(px, py); let a = Math.atan2(px, -py); if (a < 0) a += 2 * Math.PI;   // (d3's arcs: 0 at 12 o'clock, clockwise)
      const sl = 0.5 / Math.max(r, 1);   // half a pixel of angle: the pointer comes in whole pixels in Firefox
      const leaf = F.rowAtAngle(a, Math.max(o.aTol || 0, sl));
      if (!leaf) return null;
      const items = col.byRow.get(leaf); if (!items) return null;
      for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.a0 !== undefined && (a < it.a0 - sl || a > it.a1 + sl)) continue; if (r >= it.r0 && r <= it.r1) return { item: it, leaf }; }
      return null;
    };
    hit.on('mousemove', function (ev) {
      if (typeof isDragging !== 'undefined' && isDragging) return; if (window.__draggingSplitter) return;
      const h = find(ev);
      this.style.cursor = h && o.click && !h.item.back ? 'pointer' : '';
      if (h && o.tooltip) { ev.stopPropagation(); showTip(ev, h.leaf, true, { v: o.tooltip(h.item, h.leaf), vmin: o.vmin, vmax: o.vmax }); } else hideTip();
    }).on('mouseleave', function () { hideTip(); this.style.cursor = ''; })
      .on('click', function (ev) { if (!o.click) return; if (typeof isDragging !== 'undefined' && isDragging) return; if (window.__draggingSplitter) return; const h = find(ev); if (!h || h.item.back) return; ev.stopPropagation(); o.click(h.item, h.leaf, ev); });
  };
  // an arc with an arrow head (the circular layout's gene bars), as the per-element drawing makes it
  F.arcArrowPath = function (a, span, r0, r1, og) {
    const ext = r1 - r0, tip = Math.min(ext * 0.3, 10);
    const bodyIn = og > 0 ? r0 : r0 + tip, bodyOut = og > 0 ? r1 - tip : r1;
    const body = d3.arc()({ innerRadius: bodyIn, outerRadius: bodyOut, startAngle: a - span / 2, endAngle: a + span / 2 });
    const s = a - span / 2, e = a + span / 2, c = (ang, r) => [r * Math.cos(ang - Math.PI / 2), r * Math.sin(ang - Math.PI / 2)];
    const p1 = c(s, og > 0 ? bodyOut : bodyIn), p2 = c(a, og > 0 ? r1 : r0), p3 = c(e, og > 0 ? bodyOut : bodyIn);
    return body + 'M' + n2(p1[0]) + ',' + n2(p1[1]) + 'L' + n2(p2[0]) + ',' + n2(p2[1]) + 'L' + n2(p3[0]) + ',' + n2(p3[1]) + 'Z';
  };
  F.radialLine = function (a, r0, r1) { const c = (r) => [r * Math.cos(a - Math.PI / 2), r * Math.sin(a - Math.PI / 2)]; const p = c(r0), q = c(r1); return 'M' + n2(p[0]) + ',' + n2(p[1]) + 'L' + n2(q[0]) + ',' + n2(q[1]); };
  // a selection of the leaves without elements: the circular layout's ring code reads the
  // leaves through one (each, size, data) and draws into groups of its own
  F.leafSelection = function (leaves) { return d3.selectAll(leaves.map(l => ({ __data__: l }))); };

  // ---- labels on a large tree: the rows in view, once a label is legible at this zoom
  // (a label of 16,000 tips is a fraction of a pixel tall: nothing is drawn until the view is
  // zoomed in; then the labels of the rows in view, and half a view above and below)
  F.LABEL_PX = 3.5; F.CULL_FROM = 2000;   // (a label 3.5 px tall on screen is the smallest worth drawing) F.allLabels = false; F.culled = false;
  F.labelTips = function (tips, fontPx, svgH) {
    F.culled = false;
    if (F.allLabels || F.radial || tips.length < F.CULL_FROM) return tips;
    let t; try { t = d3.zoomTransform(document.getElementById('svg')); } catch (e) { return tips; }
    const k = t.k || 1;
    F.culled = true; F.drawnAt = [t.x, t.y, t.k];
    if (fontPx * k < F.LABEL_PX) return [];
    const y0 = (0 - t.y) / k, y1 = (svgH - t.y) / k, pad = (y1 - y0) * 0.5;
    return tips.filter(d => d.x >= y0 - pad && d.x <= y1 + pad);
  };
  // the circular layout: the tips whose markers lie in the view (half a view around it)
  F.labelTipsRadial = function (tips, fontPx, spinEl) {
    F.culled = false;
    if (F.allLabels || tips.length < F.CULL_FROM || !spinEl) return tips;
    const svgEl = document.getElementById('svg');
    let t; try { t = d3.zoomTransform(svgEl); } catch (e) { return tips; }
    F.culled = true; F.drawnAt = [t.x, t.y, t.k];
    if (fontPx * (t.k || 1) < F.LABEL_PX) return [];
    let m; try { m = spinEl.getScreenCTM().inverse().multiply(svgEl.getScreenCTM()); } catch (e) { return tips; }
    const W = svgEl.clientWidth, H = svgEl.clientHeight;
    const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    const px = (x1 - x0) * 0.5, py = (y1 - y0) * 0.5; x0 -= px; x1 += px; y0 -= py; y1 += py;
    return tips.filter(d => (d.rx || 0) >= x0 && (d.rx || 0) <= x1 && (d.ry || 0) >= y0 && (d.ry || 0) <= y1);
  };
  let relabelT = 0;
  F.afterZoom = function () {
    if (!F.active || !F.culled) return;
    // (a draw's own fit sets the zoom too: nothing to do when the view is the one drawn for)
    let t; try { t = d3.zoomTransform(document.getElementById('svg')); } catch (e) { return; }
    if (F.drawnAt && F.drawnAt[0] === t.x && F.drawnAt[1] === t.y && F.drawnAt[2] === t.k) return;
    clearTimeout(relabelT);
    relabelT = setTimeout(() => { relabelT = 0; if (F.active && F.culled) drawTree(); }, 150);
  };

  // ---- a splitter drag of the rectangular layout: live frames from the few elements
  // The tree's parts are stretched to the tree column; every data column is moved, and
  // stretched when its width changed (its cells and bars are drawn in proportion to the
  // column's width, so a stretch is what a redraw would give). The big paths (branches,
  // markers, cells, bars, bands) are painted once into a picture per group, while the
  // splitter is hovered, so a frame moves bitmaps instead of rasterising tens of thousands
  // of subpaths again (WebKit managed 12 frames a second that way on 24,000 tips). Text is
  // moved to its new place, never scaled. The release draws everything for real.
  let dragBase = null, dragPics = null, dragPicsKey = '';
  // what a group's content spans at the drag's start, and the fixed room on either side of it
  // in its panel: a redraw keeps that room and stretches the content to what is left, so the
  // frame does the same (a column's padding, the axis' margins, the tree's own gaps)
  function spanOf(el, panel, holder) {
    let bb = null; try { bb = el.getBBox(); } catch (e) {}
    if (!bb || !(bb.width > 0)) return null;
    let a = bb.x, s = bb.width;
    // (a column the last redraw kept and moved or stretched carries that transform: the span as displayed)
    try { const t = (holder || el).transform.baseVal; if (t && t.numberOfItems) { const M = t.consolidate().matrix; a = M.a * bb.x + M.e; s = M.a * bb.width; } } catch (e) {}
    return { a, s, mL: a - panel.x, mR: panel.x + panel.width - (a + s) };
  }
  // the stretch of a span to its panel's new size, as a matrix
  function stretchOf(span, panel) {
    if (!span) return null;
    const s1 = Math.max(1, panel.width - span.mL - span.mR), a1 = panel.x + span.mL, k = s1 / span.s;
    return { k, tx: a1 - span.a * k };
  }
  const HEAVY_D = 1500;   // a path with more data than this (characters) goes into the picture
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function dragGroups() {
    const groups = [...document.querySelectorAll('#zoomable [data-tree-part]')];
    if (typeof layerReuse !== 'undefined' && layerReuse.byKey) layerReuse.byKey.forEach(e => { if (e.el && e.el.isConnected && e.panelFn && Number.isFinite(e.x) && e.w > 0) groups.push(e.el); });
    return groups;
  }
  function viewKey() {
    let t; try { t = d3.zoomTransform(document.getElementById('svg')); } catch (e) { return ''; }
    return F.drawCount + '|' + t.x + '|' + t.y + '|' + t.k + '|' + (window.devicePixelRatio || 1);
  }
  // the group's heavy paths painted into one picture of the part of the group in view, on the
  // screen's own pixel grid (so the swap from paths to picture shows nothing). The PNG is
  // written here: the browser's encoder took 0.7 s per picture in WebKit, this takes a few ms
  // per megabyte (stored blocks, no compression).
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function pngBlob(cv) {
    const W = cv.width, H = cv.height, rgba = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const rowLen = W * 4 + 1, raw = H * rowLen, nBlocks = Math.ceil(raw / 65535), zlen = 2 + raw + nBlocks * 5 + 4;
    const out = new Uint8Array(8 + 25 + 13 + 16 + 12 + zlen + 12);   // (sRGB and gAMA chunks: the colours decoded as on the page)
    const u32 = (v, at) => { out[at] = v >>> 24; out[at + 1] = (v >>> 16) & 255; out[at + 2] = (v >>> 8) & 255; out[at + 3] = v & 255; };
    const crcOf = (from, to) => { let c = 0xFFFFFFFF; for (let i = from; i < to; i++) c = CRC_T[(c ^ out[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    let p = 8;
    u32(13, p); out.set([73, 72, 68, 82], p + 4); u32(W, p + 8); u32(H, p + 12); out[p + 16] = 8; out[p + 17] = 6; u32(crcOf(p + 4, p + 21), p + 21); p += 25;
    u32(1, p); out.set([115, 82, 71, 66], p + 4); out[p + 8] = 0; u32(crcOf(p + 4, p + 9), p + 9); p += 13;
    u32(4, p); out.set([103, 65, 77, 65], p + 4); u32(45455, p + 8); u32(crcOf(p + 4, p + 12), p + 12); p += 16;
    u32(zlen, p); out.set([73, 68, 65, 84], p + 4); const chunk = p + 4; p += 8;
    out[p++] = 0x78; out[p++] = 0x01;
    let a = 1, b = 0, left = 0, remaining = raw, i = 0, mod = 0;
    for (let y = 0; y < H; y++) {
      for (let k = -1; k < W * 4; k++) {
        if (!left) { left = Math.min(65535, remaining); out[p++] = remaining <= 65535 ? 1 : 0; out[p++] = left & 255; out[p++] = left >>> 8; out[p++] = (~left) & 255; out[p++] = ((~left) >>> 8) & 255; }
        const v = k < 0 ? 0 : rgba[i++];
        out[p++] = v; a += v; b += a; left--; remaining--;
        if (++mod === 5000) { a %= 65521; b %= 65521; mod = 0; }
      }
    }
    a %= 65521; b %= 65521;
    u32(((b << 16) | a) >>> 0, p); p += 4;
    u32(crcOf(chunk, p), p); p += 4;
    u32(0, p); out.set([73, 69, 78, 68], p + 4); u32(0xAE426082, p + 8);
    return new Blob([out], { type: 'image/png' });
  }
  const styleAttrs = (st) => {
    const a = [];
    const put = (n, v, skip) => { if (v !== undefined && v !== null && v !== '' && v !== skip) a.push(n + '="' + String(v).replace(/"/g, "'") + '"'); };
    put('fill', st.fill); put('fill-opacity', st.fillOpacity, '1'); put('fill-rule', st.fillRule, 'nonzero');
    put('stroke', st.stroke, 'none'); if (st.stroke && st.stroke !== 'none') { put('stroke-width', st.strokeWidth); put('stroke-opacity', st.strokeOpacity, '1'); put('stroke-linecap', st.strokeLinecap, 'butt'); put('stroke-linejoin', st.strokeLinejoin, 'miter'); put('stroke-dasharray', st.strokeDasharray, 'none'); put('stroke-miterlimit', st.strokeMiterlimit, '4'); }
    put('opacity', st.opacity, '1'); put('shape-rendering', st.shapeRendering, 'auto');
    return a.join(' ');
  };
  function paintPicture(el) {
    const T = {}; let tq = performance.now(); const lap = (n) => { T[n] = Math.round(performance.now() - tq); tq = performance.now(); };
    const heavy = [...el.querySelectorAll('path')].filter(p => (p.getAttribute('d') || '').length > HEAVY_D);
    if (!heavy.length) return null;
    const svgEl = document.getElementById('svg');
    let ctm, bb; try { ctm = el.getScreenCTM(); bb = el.getBBox(); } catch (e) { return null; }
    lap('bbox');
    const visibleOf = (p, st) => p.hasAttribute('data-fast-hidden') ? (p.getAttribute('data-fast-hidden') || 'visible') : st.visibility;
    if (!ctm || !bb || !(ctm.a > 0) || !(ctm.d > 0)) return null;
    const sr = svgEl.getBoundingClientRect(), inv = ctm.inverse();
    const dpr = window.devicePixelRatio || 1;
    // the part in view, in the group's frame, its corners on the screen's device pixels (the
    // picture then sits on the same pixel grid as the paths it stands in for)
    const toG = (X, Y) => [(X - ctm.e) / ctm.a, (Y - ctm.f) / ctm.d];
    const toS = (x, y) => [ctm.a * x + ctm.e, ctm.d * y + ctm.f];
    const [bx0, by0] = toS(bb.x - 4, bb.y - 4), [bx1, by1] = toS(bb.x + bb.width + 4, bb.y + bb.height + 4);
    const X0 = Math.floor(Math.max(sr.left, bx0) * dpr) / dpr, X1 = Math.ceil(Math.min(sr.right, bx1) * dpr) / dpr;
    const Y0 = Math.floor(Math.max(sr.top, by0) * dpr) / dpr, Y1 = Math.ceil(Math.min(sr.bottom, by1) * dpr) / dpr;
    if (!(X1 > X0 && Y1 > Y0)) return null;
    let W = Math.round((X1 - X0) * dpr), H = Math.round((Y1 - Y0) * dpr);
    const area = W * H, MAX_AREA = 12e6; if (area > MAX_AREA) { const q = Math.sqrt(MAX_AREA / area); W = Math.round(W * q); H = Math.round(H * q); }
    W = Math.max(1, W); H = Math.max(1, H);
    const [x0, y0] = toG(X0, Y0), [x1, y1] = toG(X1, Y1);
    const im = document.createElementNS(SVG_NS, 'image');
    im.setAttribute('class', 'fast-drag-picture'); im.setAttribute('x', x0); im.setAttribute('y', y0); im.setAttribute('width', x1 - x0); im.setAttribute('height', y1 - y0);
    im.setAttribute('preserveAspectRatio', 'none'); im.setAttribute('pointer-events', 'none'); im.style.display = 'none';
    const pic = { el, im, heavy, url: null, ready: false, shown: false, T };
    const done = (href) => { if (pic.dead) return; im.setAttribute('href', href); pic.ready = true; if (pic.wanted) showPicture(el); };
    heavy[0].parentNode.insertBefore(im, heavy[0]);   // (what is drawn above the first heavy path stays above the picture)
    // painted on a canvas: the same paths, on the same pixel grid, no document to parse
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); if (!ctx) return null;
    const kx = W / (x1 - x0), ky = H / (y1 - y0);
    // the paths written to an SVG image and painted by the browser's own SVG renderer: a canvas
    // painting them itself blends sub-pixel rows differently in WebKit, and the swap would show
    const parts = [];
    heavy.forEach(p => {
      const st = getComputedStyle(p);
      if (st.display === 'none' || visibleOf(p, st) === 'hidden' || !(parseFloat(st.opacity) > 0)) return;
      let rel; try { rel = inv.multiply(p.getScreenCTM()); } catch (e) { return; }
      const tr = (Math.abs(rel.a - 1) < 1e-9 && Math.abs(rel.d - 1) < 1e-9 && !rel.b && !rel.c && !rel.e && !rel.f) ? '' : ' transform="matrix(' + [rel.a, rel.b, rel.c, rel.d, rel.e, rel.f].join(',') + ')"';
      parts.push('<path d="' + p.getAttribute('d') + '"' + tr + ' ' + styleAttrs(st) + '/>');
    });
    if (!parts.length) { im.remove(); return null; }
    lap('svg');
    const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + x0 + ' ' + y0 + ' ' + (x1 - x0) + ' ' + (y1 - y0) + '" preserveAspectRatio="none">' + parts.join('') + '</svg>';
    const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(svgUrl); lap('load');
      if (pic.dead) return;
      try {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        cv.getContext('2d').drawImage(img, 0, 0, W, H); lap('paint');
        const blob = pngBlob(cv); lap('png');
        pic.url = URL.createObjectURL(blob); done(pic.url);
      } catch (e) { /* (no picture: the paths stay) */ }
    };
    img.onerror = () => { URL.revokeObjectURL(svgUrl); };
    img.src = svgUrl;
    return pic;
  }
  function dropPictures() {
    if (dragPics) dragPics.forEach(pic => { pic.dead = true; if (pic.url) { try { URL.revokeObjectURL(pic.url); } catch (e) {} } if (pic.im.parentNode) pic.im.parentNode.removeChild(pic.im); });
    dragPics = null; dragPicsKey = '';
    document.querySelectorAll('image.fast-drag-picture').forEach(im => im.remove());
  }
  // the pictures made in advance (the splitter hovered), for this drawing and view
  F.dragPrepare = function () {
    if (!F.active || F.radial || dragBase) return;
    const key = viewKey();
    if (dragPics && dragPicsKey === key) return;
    dropPictures();
    const pics = [];
    // the tree's parts only: WebKit painted 5 frames a second with the branches and markers of 24,000
    // tips as paths under a transform, while the columns' paths cost it nothing measurable (and a
    // column's paths stretched are exactly what a redraw gives, a picture of them is not quite)
    dragGroups().forEach(el => { if (!el.hasAttribute('data-tree-part')) return; const pic = paintPicture(el); if (pic) pics.push(pic); });
    dragPics = pics; dragPicsKey = key;
  };
  F.dragCapture = function () {
    dragBase = null;
    if (!F.active || F.radial || typeof getPanelPositions !== 'function') return;
    const ps = getPanelPositions(), tree = ps.find(p => p.type === 'tree'); if (!tree) return;
    F.dragPrepare();
    const parts = [...document.querySelectorAll('#zoomable [data-tree-part]')];
    const links = document.querySelector('#zoomable g.links[data-tree-part]');
    const treeSpan = (links && spanOf(links, tree)) || { a: tree.x + 48, s: Math.max(1, tree.width - 56), mL: 48, mR: 8 };
    const layers = [];
    if (typeof layerReuse !== 'undefined' && layerReuse.byKey) layerReuse.byKey.forEach((e, key) => {
      if (!(e.el && e.el.isConnected && e.panelFn && Number.isFinite(e.x) && e.w > 0)) return;
      const content = e.el.firstElementChild;   // (the column's cells, bars or arcs; the axis and title follow it)
      const p0 = e.panelFn(e.index) || { x: e.x, width: e.w };   // (the panel as it is now: a kept column was moved to it by the last redraw)
      layers.push({ e, type: String(key).split(':')[0], span: (content && spanOf(content, p0, e.el)) || { a: p0.x, s: p0.width, mL: 0, mR: 0 }, drawnAt: null });
    });
    const baseOf = new Map(); parts.forEach(el => baseOf.set(el, el.getAttribute('transform') || '')); layers.forEach(L => baseOf.set(L.e.el, L.e.el.getAttribute('transform') || ''));
    // a tree without data: the dashed "add data" box and its button sit in the empty panel
    let placeholder = null;
    const phPanel = ps.find(p => String(p.type).startsWith('placeholder'));
    const phBox = document.querySelector('#zoomable > rect.placeholder-box'), phBtn = document.querySelector('#zoomable > g.meta-add');
    if (phPanel && phBox) placeholder = { box: phBox, btn: phBtn, x: +phBox.getAttribute('x'), w: +phBox.getAttribute('width'), px: phPanel.x, pw: phPanel.width, btnBase: phBtn ? (phBtn.getAttribute('transform') || '') : '' };
    dragBase = { tree: treeSpan, parts, layers, texts: new Map(), baseOf, placeholder, treeK: 1, stretched: false, pauseT: 0 };
  };
  F.dragReady = function () { return !!dragBase; };
  // a group moved or stretched: its picture shown instead of its heavy paths
  function showPicture(el) {
    const pic = dragPics && dragPics.find(p => p.el === el); if (!pic || pic.shown) return;
    if (!dragBase && !pic.preview) return;
    pic.wanted = true;
    if (!pic.ready) return;   // (shown as soon as it is: the paths stay until then)
    pic.heavy.forEach(p => { p.setAttribute('data-fast-hidden', p.style.visibility || ''); p.style.visibility = 'hidden'; });
    pic.im.style.display = ''; pic.shown = true;
  }
  function hidePicture(pic) {
    pic.wanted = false; pic.preview = false;
    if (!pic.shown) return;
    pic.shown = false; pic.im.style.display = 'none';
    pic.heavy.forEach(p => { p.style.visibility = p.getAttribute('data-fast-hidden') || ''; p.removeAttribute('data-fast-hidden'); });
  }
  // (for checks: every picture shown in place of its paths, or the paths back)
  F.dragPreview = function (on) {
    if (on) { F.dragPrepare(); if (dragPics) dragPics.forEach(pic => { pic.preview = true; showPicture(pic.el); }); }
    else if (dragPics) dragPics.forEach(hidePicture);
  };
  // the group's "units" (text, axis ticks, the + and - buttons, axis titles, vertical lines)
  // keep their size: each is moved to where the stretch puts its anchor. Everything else in the
  // group (cells, bars, bands, the axis line) is drawn in proportion to the column and stretches.
  const UNIT_GROUP = '.tick, .axis-title, .axis-title-add, .axis-ui';
  function placeTexts(el, k) {
    const b = dragBase; if (!b) return;
    let units = b.texts.get(el);
    if (!units) {
      units = [];
      let inv; try { inv = el.getCTM().inverse(); } catch (e) { inv = null; }
      const seen = new Set();
      const add = (t, x, y, tick) => {
        if (seen.has(t) || t.closest('.svg-splitters')) return;
        seen.add(t);
        const base = t.getAttribute('transform') || '';
        let ax = x, gx = x;
        try { const own = t.parentNode.getCTM().inverse().multiply(t.getCTM()); ax = own.a * x + own.c * y + own.e; const m = inv.multiply(t.getCTM()); gx = m.a * x + m.c * y + m.e; } catch (e) {}
        let w = 0; if (tick) { try { const tx = t.querySelector('text'); w = tx ? tx.getBBox().width : 0; } catch (e) {} }
        units.push({ t, base, ax, gx, axis: tick ? t.parentNode : null, w, vis: t.style.visibility || '' });
      };
      el.querySelectorAll(UNIT_GROUP).forEach(g => { if (g.parentNode.closest && g.parentNode.closest(UNIT_GROUP) && el.contains(g.parentNode.closest(UNIT_GROUP))) return; add(g, 0, 0, g.classList.contains('tick')); });
      el.querySelectorAll('text').forEach(t => { const u = t.parentNode.closest ? t.parentNode.closest(UNIT_GROUP) : null; if (u && el.contains(u)) return; add(t, +t.getAttribute('x') || 0, +t.getAttribute('y') || 0, false); });
      el.querySelectorAll('line').forEach(l => { const u = l.parentNode.closest ? l.parentNode.closest(UNIT_GROUP) : null; if (u && el.contains(u)) return; const x1 = +l.getAttribute('x1') || 0, x2 = +l.getAttribute('x2') || 0; if (Math.abs(x1 - x2) < 0.01) add(l, x1, +l.getAttribute('y1') || 0, false); });
      b.texts.set(el, units);
    }
    units.forEach(({ t, base, ax, vis }) => {
      if (k === 1) { if (base) t.setAttribute('transform', base); else t.removeAttribute('transform'); t.style.visibility = vis; }
      else t.setAttribute('transform', 'translate(' + ax + ',0) scale(' + (1 / k) + ',1) translate(' + (-ax) + ',0)' + (base ? ' ' + base : ''));
    });
    if (k === 1) return;
    // tick numbers that would overlap on the stretched axis are left out (a redraw chooses fewer ticks)
    const axes = new Map();
    units.forEach(it => { if (!it.axis) return; let a = axes.get(it.axis); if (!a) { a = []; axes.set(it.axis, a); } a.push(it); });
    axes.forEach(a => {
      a.sort((p, q) => p.gx - q.gx);
      let lastX = -Infinity, lastW = 0;
      a.forEach(it => {
        const X = it.gx * k;
        if (X - lastX < (lastW + it.w) / 2 + 6) it.t.style.visibility = 'hidden';
        else { it.t.style.visibility = it.vis; lastX = X; lastW = it.w; }
      });
    });
  }
  F.dragFrame = function () {
    const b = dragBase; if (!b) return false;
    const ps = getPanelPositions(), tree = ps.find(p => p.type === 'tree'); if (!tree) return false;
    const st = stretchOf(b.tree, tree), k = st.k;
    const m = (Math.abs(k - 1) < 1e-9 && Math.abs(st.tx) < 1e-9) ? null : 'matrix(' + k + ',0,0,1,' + st.tx + ',0)';
    let changed = !!m;
    // (a group's own transform, e.g. the scale bar's translate, stays underneath the frame's)
    const setT = (el, t) => { const base = b.baseOf.get(el) || ''; const v = (t ? t + (base ? ' ' + base : '') : base); if (v) el.setAttribute('transform', v); else el.removeAttribute('transform'); };
    b.parts.forEach(el => {
      if (m) showPicture(el);
      setT(el, m);
      if (k !== 1 || b.texts.has(el)) placeTexts(el, k);
    });
    b.layers.forEach((L) => {
      const { e, span } = L;
      const p = e.panelFn(e.index); if (!p) return;
      // an alignment column is drawn again at its place and width on every frame (its residues
      // are a picture that stretched would blur; the alignment code draws it in a few ms)
      if (L.type === 'msa' && window.tmMsa && tmMsa.liveResize) {
        if (L.drawnAt && L.drawnAt.x === p.x && L.drawnAt.width === p.width) return;
        if (p.x === e.x && p.width === e.w && !L.drawnAt) return;
        if (tmMsa.liveResize(e.index, p)) { L.drawnAt = { x: p.x, width: p.width }; changed = true; return; }
      }
      const s2 = stretchOf(span, p), kk = s2.k, same = Math.abs(kk - 1) < 1e-9;
      if (!same) b.stretched = true;
      if (same && Math.abs(s2.tx) < 1e-9) setT(e.el, '');
      else { showPicture(e.el); setT(e.el, same ? 'translate(' + s2.tx + ',0)' : 'matrix(' + kk + ',0,0,1,' + s2.tx + ',0)'); changed = true; }
      if (!same || b.texts.has(e.el)) placeTexts(e.el, same ? 1 : kk);
    });
    // the empty panel's dashed box keeps its margins; its button stays centred
    if (b.placeholder) {
      const ph = b.placeholder, p = ps.find(q => String(q.type).startsWith('placeholder'));
      if (p) {
        const x = ph.x + (p.x - ph.px), w = Math.max(0, ph.w + (p.width - ph.pw));
        ph.box.setAttribute('x', x); ph.box.setAttribute('width', w);
        if (ph.btn) { const dx = (x + w / 2) - (ph.x + ph.w / 2); ph.btn.setAttribute('transform', (dx ? 'translate(' + dx + ',0)' : '') + (ph.btnBase ? ' ' + ph.btnBase : '')); }
        if (p.x !== ph.px || p.width !== ph.pw) changed = true;
      }
    }
    // (nothing moved yet, e.g. the press itself: the splitters stay as drawn)
    if (changed) { try { drawSplittersInSVG(g, lastSplitterContentHeight, dragGeom ? dragGeom.canvasRect : null); updateSplitterLineHeights(); } catch (e) {} }
    // while the pointer moves the stretched groups are approximate (the tree's picture
    // stretched, dots and arrow heads too); when it pauses, the drawing is drawn for real at
    // these widths and the drag goes on from there
    b.treeK = k; if (!same_all(b)) b.stretched = true;
    if (changed) { clearTimeout(b.pauseT); b.pauseT = setTimeout(() => { if (dragBase === b) pauseRedraw(b); }, 160); }
    return true;
  };
  function same_all(b) { return Math.abs(b.treeK - 1) < 1e-9 && !b.stretched; }
  function pauseRedraw(b) {
    if (dragBase !== b || same_all(b)) return;
    if (typeof drawTree !== 'function' || typeof panelDragPreview === 'undefined') return;
    F.dragEnd();
    const was = panelDragPreview;
    try { panelDragPreview = false; if (typeof lastTreeKeepKey !== 'undefined') lastTreeKeepKey = null; drawTree(); }
    catch (e) { console.warn(e); }
    finally { panelDragPreview = was; }
    try { if (typeof lastPreviewWidths !== 'undefined') lastPreviewWidths = panelWidths.slice(); } catch (e) {}
    F.dragCapture();   // (the pictures for the drag's continuation are painted now, during the pause)
  }
  // the release: the groups, their text and their heavy paths as they were (the redraw that
  // follows replaces most of them; a column kept by the redraw must be whole)
  F.dragEnd = function () {
    const b = dragBase; dragBase = null;
    if (!b) return;
    clearTimeout(b.pauseT);
    const restore = (el) => { const base = b.baseOf.get(el) || ''; if (base) el.setAttribute('transform', base); else el.removeAttribute('transform'); };
    b.parts.forEach(restore);
    b.layers.forEach(L => restore(L.e.el));
    if (b.placeholder) { const ph = b.placeholder; ph.box.setAttribute('x', ph.x); ph.box.setAttribute('width', ph.w); if (ph.btn) { if (ph.btnBase) ph.btn.setAttribute('transform', ph.btnBase); else ph.btn.removeAttribute('transform'); } }
    b.texts.forEach(texts => texts.forEach(({ t, base, vis }) => { if (base) t.setAttribute('transform', base); else t.removeAttribute('transform'); t.style.visibility = vis; }));
    if (dragPics) dragPics.forEach(hidePicture);
  };
  F.dragPictures = function () { return dragPics ? dragPics.map(p => ({ ready: p.ready, shown: p.shown, heavy: p.heavy.length, w: +p.im.getAttribute('width'), h: +p.im.getAttribute('height'), T: p.T })) : null; };

  // ---- a ring drag of the circular layout: live frames from the few elements
  // The tree's paths scale with its ring; each data ring is painted into a picture with its
  // arcs moved to the ring's new radii (a ring drag changes radii, which no transform of the
  // paths can follow). The release draws everything for real.
  let ringBase = null;
  F.radialDragCapture = function () {
    ringBase = null;
    if (!F.active || !F.radial || typeof radialRings === 'undefined') return;
    const rings0 = radialRings.map(r => ({ type: r.type, inner: r.innerRadius, outer: r.outerRadius }));
    const parts = [...document.querySelectorAll('#zoomable [data-tree-part]')];
    const rings = [...document.querySelectorAll('#svg g')].filter(g => g.__fastRing && g.isConnected).map(g => {   // (the rings sit in the labels group beside the zoomed group)
      const o = g.__fastRing.opts, r0 = rings0.find(r => r.type === o.ringType) || rings0.find(r => Math.abs(r.inner - o.r0) < 1e-6 && Math.abs(r.outer - o.r1) < 1e-6);
      return { el: g, items: g.__fastRing.items, ring0: r0, hidden: false };
    });
    ringBase = { rings0, parts, rings };
  };
  F.radialDragFrame = function () {
    const b = ringBase; if (!b || typeof radialRings === 'undefined') return false;
    const t0 = b.rings0.find(r => r.type === 'tree'), t1 = radialRings.find(r => r.type === 'tree');
    if (t0 && t1 && t0.outer > 0) { const sc = t1.outerRadius / t0.outer; b.parts.forEach(el => { if (Math.abs(sc - 1) < 1e-9) el.removeAttribute('transform'); else el.setAttribute('transform', 'scale(' + sc + ')'); }); }
    const S = 2, Rmax = Math.max(...radialRings.map(r => r.outerRadius), 1);
    b.rings.forEach(R => {
      if (!R.ring0) return;
      const r1 = radialRings.find(r => r.type === R.ring0.type); if (!r1) return;
      const i0 = R.ring0.inner, o0 = R.ring0.outer, i1 = r1.innerRadius, o1 = r1.outerRadius, k = (o0 > i0) ? (o1 - i1) / (o0 - i0) : 1;
      const f = (r) => i1 + (r - i0) * k;
      if (!R.hidden) { [...R.el.children].forEach(c => { if (c.classList && (c.classList.contains('fast-items') || c.classList.contains('fast-hit'))) c.style.display = 'none'; }); R.hidden = true; }
      const W = Math.max(1, Math.round(2 * o1 * S)), cv = document.createElement('canvas'); cv.width = W; cv.height = W;
      const ctx = cv.getContext('2d'); ctx.translate(W / 2, W / 2); ctx.scale(S, S);
      const aTol = R.el.__fastRing.opts.aTol || 0;
      R.items.forEach(it => {
        const a0 = (it.a0 !== undefined ? it.a0 : it.a - aTol) - Math.PI / 2, a1 = (it.a1 !== undefined ? it.a1 : it.a + aTol) - Math.PI / 2;
        const ra = f(it.r0), rb = f(it.r1);
        if (it.op != null) ctx.globalAlpha = it.op;
        if (it.stroke) { ctx.beginPath(); ctx.moveTo(ra * Math.cos(it.a - Math.PI / 2), ra * Math.sin(it.a - Math.PI / 2)); ctx.lineTo(rb * Math.cos(it.a - Math.PI / 2), rb * Math.sin(it.a - Math.PI / 2)); ctx.strokeStyle = it.stroke === 'var(--text)' ? '#888' : it.stroke; ctx.lineWidth = it.sw || 1; ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(0, 0, rb, a0, a1); ctx.arc(0, 0, ra, a1, a0, true); ctx.closePath(); ctx.fillStyle = it.color; ctx.fill(); }
        ctx.globalAlpha = 1;
      });
      let im = R.el.querySelector(':scope > image.fast-drag-picture');
      if (!im) { im = document.createElementNS('http://www.w3.org/2000/svg', 'image'); im.setAttribute('class', 'fast-drag-picture'); im.setAttribute('pointer-events', 'none'); R.el.appendChild(im); }
      im.setAttribute('x', -o1); im.setAttribute('y', -o1); im.setAttribute('width', 2 * o1); im.setAttribute('height', 2 * o1); im.setAttribute('href', cv.toDataURL('image/png'));
    });
    return true;
  };

  window.tmFast = F;
})();
