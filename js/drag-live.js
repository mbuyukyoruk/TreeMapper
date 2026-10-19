// Live column resizing for large drawings.
// While a column splitter is dragged, a full redraw per frame is too slow on large
// trees (tens of thousands of elements). Every position in the drawing is a linear
// function of the column it is in (x = column start + value x column width), so each
// frame the existing drawing is put at the new geometry instead of being built again:
// - a data column (dataframe / heatmap / chart) is mapped from the place and width it
//   was drawn with to its new place and width; text, dots and support symbols keep
//   their size and shape, and lines keep their thickness;
// - the tree's nodes, labels and label guides get their new coordinates; branches,
//   clade highlights, cartoons, support symbols and the scale bar are mapped like a column;
// - the splitter lines are drawn at their new places.
// When the splitter is released, the drawing is drawn for real (exactly as before).
// Drawings that redraw quickly are redrawn on every frame as before (see app.js
// refreshAllRAF).
//
// How it is shown (see "layers" and "flat parts" below): during the drag each part of
// the drawing is shown in its own layer over the canvas, so that the browser only
// paints again what changes; parts made of many plain shapes (cells, branches, dots)
// are painted into a <canvas> from the same shapes, which takes a fraction of the time
// the browser needs for the same number of SVG elements.
(function () {
  'use strict';
  var SCALE_TAGS = 'path, line, rect, polyline, polygon';
  var KEEP_SHAPE = 'text, circle, ellipse, .axis-title, .axis-title-add';   // an axis title (with its box and -) keeps its shape as a whole
  var SVGNS = 'http://www.w3.org/2000/svg';
  var base = null, lift = null;
  var ownNodes = new WeakSet();   // placeholders and parts moved out (see pro-ui: not a redraw)

  // content geometry of a data column: where its values start and how wide they are
  function columnSpan(type, x, w) {
    var right = type === 'dataframe' ? 36 : 16;   // dataframes keep margin.right (20) free as well
    return { a: x + 8, s: Math.max(1, w - right) };
  }
  function treeSpan(p) { return { a: p.x + 48, s: Math.max(1, p.width - 56) }; }
  function panelOf(ps, type, index) {
    var n = 0;
    for (var i = 0; i < ps.length; i++) if (ps[i].type.indexOf(type) === 0 && /^[a-z]+\d+$/.test(ps[i].type)) { if (n === index) return ps[i]; n++; }
    return null;
  }
  function matrix(k, a0, a1) { return 'matrix(' + k + ',0,0,1,' + (a1 - a0 * k) + ',0)'; }
  // A column that only moves is moved by the graphics card (a CSS transform on its own
  // compositing layer: nothing is painted again); the CSS transform takes the place of
  // the transform attribute, so that one is written into it.
  function cssOf(el) {
    if (!el.hasAttribute('transform')) return '';
    var m = ownMatrix(el);
    return ' matrix(' + m[0] + ',' + m[1] + ',' + m[2] + ',' + m[3] + ',' + m[4] + ',' + m[5] + ')';
  }
  var lifted = [];
  function moveOnCard(el, dx, ownCss) {
    if (!el.__liveLifted) { el.__liveLifted = true; el.style.willChange = 'transform'; lifted.push(el); }
    el.style.transform = 'translate(' + dx + 'px,0px)' + ownCss;
  }
  function dropFromCard(el) {
    if (!el.__liveLifted) return;
    el.__liveLifted = false; el.style.transform = ''; el.style.willChange = '';
  }
  // the element's own transform, before anything was added during the drag (for an
  // axis row pinned in an expanded view: without the shift it carries while pinned)
  var touched = [];
  function own(el) {
    if (!el.hasAttribute('data-live-own')) {
      var o = el.hasAttribute('data-own-transform') ? el.getAttribute('data-own-transform') : (el.getAttribute('transform') || '');
      el.setAttribute('data-live-own', o);
      el.__liveWas = el.getAttribute('transform');
      touched.push(el);
    }
    return el.getAttribute('data-live-own');
  }
  // text and dots: undo the horizontal stretch around their own anchor point
  function keepShape(el, k) {
    var x, y;
    if (el.tagName === 'text') { x = +el.getAttribute('x') || 0; y = +el.getAttribute('y') || 0; }
    else if (el.tagName === 'circle' || el.tagName === 'ellipse') { x = +el.getAttribute('cx') || 0; y = +el.getAttribute('cy') || 0; }
    else if (el.classList.contains('axis-title')) { var tx = el.querySelector('.axis-title-text'); x = tx ? +tx.getAttribute('x') || 0 : 0; y = tx ? +tx.getAttribute('y') || 0 : 0; }
    else { x = 0; y = 0; }   // a + button is drawn around its own origin
    var o = own(el);
    var c = k === 1 ? '' : 'translate(' + x + ',' + y + ') scale(' + (1 / k) + ',1) translate(' + (-x) + ',' + (-y) + ')';
    // a + / - group is placed by its own translate: the stretch is undone after it
    var t = (el.classList && el.classList.contains('axis-title-add')) ? (o + ' ' + c) : (c + ' ' + o);
    t = t.trim();
    if (t) el.setAttribute('transform', t); else el.removeAttribute('transform');
  }
  var stroked = [];
  var base0Zoom = 1;
  function prepareScaled(group) {
    // thickness of lines and outlines must not follow the stretch ("non-scaling" is
    // measured on screen, so only at 100% zoom, where it equals the drawn thickness);
    // only shapes that have an outline (WebKit paints others differently with it)
    if (base0Zoom === 1) {
      var all = group.__liveOutlined || outlined(group);
      group.__liveOutlined = null;
      for (var i = 0; i < all.length; i++) if (!all[i].hasAttribute('vector-effect')) { all[i].setAttribute('vector-effect', 'non-scaling-stroke'); stroked.push(all[i]); }
    }
    // only the outermost: a dot inside a + button keeps its shape with the button
    var list = Array.prototype.slice.call(group.querySelectorAll(KEEP_SHAPE)), set = new Set(list);
    return list.filter(function (el) { for (var a = el.parentNode; a && a !== group; a = a.parentNode) if (set.has(a)) return false; return true; });
  }
  var SCALE_SET = { path: 1, line: 1, rect: 1, polyline: 1, polygon: 1 };
  // the shapes in a group that are drawn with an outline (by their computed style)
  function outlined(group) {
    var cache = new StyleCache(), out = [];
    (function walk(el, pid) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        var st = cache.get(c, pid);
        if (st.s.display === 'none') continue;
        if (SCALE_SET[c.tagName] && paintOf(st.s.stroke) !== null && lengthOf(st.s['stroke-width']) > 0) out.push(c);
        if (c.firstElementChild) walk(c, st.id);
      }
    })(group, rootStyleId(cache, group).id);
    return out;
  }
  function hiddenEl(el) { return el.style.display === 'none' || el.getAttribute('display') === 'none'; }
  function shownNode(n) {
    if (hiddenEl(n)) return false;
    for (var c = n.firstElementChild; c; c = c.nextElementSibling) if (!hiddenEl(c)) return true;
    return false;
  }

  // ------------------------------------------------------------- matrices
  // [a, b, c, d, e, f] as in SVG: x' = a x + c y + e, y' = b x + d y + f
  var I = [1, 0, 0, 1, 0, 0];
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  // an element's transform attribute as a matrix, read from the text (in full precision;
  // the browser's own transform objects are single precision, and asking them for one
  // matrix would rewrite the attribute)
  var transformCache = new Map();
  function parseTransform(str) {
    var hit = transformCache.get(str);
    if (hit !== undefined) return hit;
    var m = I, re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/g, at = 0, f;
    while ((f = re.exec(str))) {
      if (f.index !== at) { m = null; break; }
      at = re.lastIndex;
      var a = f[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (a.some(function (v) { return !Number.isFinite(v); })) { m = null; break; }
      var t;
      switch (f[1]) {
        case 'matrix': if (a.length !== 6) { m = null; break; } t = a; break;
        case 'translate': if (a.length < 1 || a.length > 2) { m = null; break; } t = [1, 0, 0, 1, a[0], a[1] || 0]; break;
        case 'scale': if (a.length < 1 || a.length > 2) { m = null; break; } t = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
        case 'rotate': {
          if (a.length !== 1 && a.length !== 3) { m = null; break; }
          var r = a[0] * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
          t = [c, sn, -sn, c, 0, 0];
          if (a.length === 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
          break;
        }
        case 'skewX': if (a.length !== 1) { m = null; break; } t = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': if (a.length !== 1) { m = null; break; } t = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      if (!m) break;
      m = mul(m, t);
    }
    if (m && str.slice(at).trim()) m = null;
    if (transformCache.size > 20000) transformCache.clear();
    transformCache.set(str, m);
    return m;
  }
  function ownMatrix(el) {
    var str = el.getAttribute('transform');
    if (!str) return I;
    var m = parseTransform(str);
    if (m) return m;
    // something unusual: the browser's reading of it, item by item (nothing is changed)
    var list = el.transform && el.transform.baseVal, out = I;
    if (list) for (var i = 0; i < list.numberOfItems; i++) { var q = list.getItem(i).matrix; out = mul(out, [q.a, q.b, q.c, q.d, q.e, q.f]); }
    return out;
  }
  function uniformScale(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }

  // ---------------------------------------------------------- flat parts
  // A part made only of plain shapes (rect, circle, ellipse, line, polyline, polygon,
  // path) with plain colours is painted into a canvas. Everything about how a shape
  // looks comes from the browser's own computed style; anything the canvas cannot
  // paint the same way (text, gradients, clipping, filters, markers, see-through groups,
  // crisp edges, ...) keeps the part in SVG.
  var STYLE_PROPS = ['display', 'visibility', 'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'clip-path', 'mask', 'filter',
    'marker-start', 'marker-mid', 'marker-end', 'paint-order', 'shape-rendering', 'mix-blend-mode'];
  var KEY_ATTRS = new Set(['class', 'style'].concat(STYLE_PROPS));
  var SHAPES = { rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, path: 1 };
  var MIN_FLAT = 400;   // fewer shapes than this: not worth a canvas
  var MAX_RUNS = 6;     // a part split into more pieces than this stays in SVG

  // Computed styles, shared by elements that cannot differ: same parent style, same
  // tag, same class, inline style and style attributes (the page's style sheets only
  // use classes and tags for the drawing). A sample is checked against the browser.
  function StyleCache() { this.map = new Map(); this.ids = new Map(); this.n = 0; this.checked = 0; this.bad = false; }
  StyleCache.prototype.read = function (el) {
    var cs = getComputedStyle(el), o = {};
    for (var i = 0; i < STYLE_PROPS.length; i++) o[STYLE_PROPS[i]] = cs.getPropertyValue(STYLE_PROPS[i]);
    o.transformCss = el.style.transform || '';
    return o;
  };
  StyleCache.prototype.keyOf = function (el, parentId) {
    var k = parentId + '\u0001' + el.tagName, nm = el.getAttributeNames();
    for (var i = 0; i < nm.length; i++) if (KEY_ATTRS.has(nm[i])) k += '\u0001' + nm[i] + '=' + el.getAttribute(nm[i]);
    return k;
  };
  StyleCache.prototype.get = function (el, parentId) {
    var k = this.keyOf(el, parentId), hit = this.map.get(k);
    if (!hit) { hit = { s: this.read(el), id: ++this.n }; this.map.set(k, hit); }
    else if (++this.checked % 97 === 0) {
      var real = this.read(el);
      for (var i = 0; i < STYLE_PROPS.length; i++) if (real[STYLE_PROPS[i]] !== hit.s[STYLE_PROPS[i]]) { this.bad = true; break; }
    }
    return hit;
  };
  function rootStyleId(cache, el) {
    // the part's own computed style stands for everything it inherits
    var s = cache.read(el), k = 'root';
    for (var i = 0; i < STYLE_PROPS.length; i++) k += '\u0001' + s[STYLE_PROPS[i]];
    var hit = cache.map.get(k);
    if (!hit) { hit = { s: s, id: ++cache.n }; cache.map.set(k, hit); }
    return hit;
  }
  function paintOf(v) {
    if (!v || v === 'none') return null;
    if (/url\(/i.test(v)) return false;   // gradient / pattern: not plain
    if (/^(rgba?\(|#|[a-z]+$)/i.test(v.trim())) return v.trim();
    return false;
  }
  function plainEffects(s) {
    return (s['clip-path'] === 'none' || !s['clip-path']) && (s.mask === 'none' || !s.mask) && (s.filter === 'none' || !s.filter) &&
      (!s['mix-blend-mode'] || s['mix-blend-mode'] === 'normal') && !s.transformCss;
  }
  function num(v, d) { var x = parseFloat(v); return Number.isFinite(x) ? x : d; }
  function lengthOf(v) { return num(v, 0); }

  // SVG path data -> absolute M / L / C / Q / Z with the points mapped by m
  // (arcs become cubic curves, so any affine map keeps them exact)
  var CM = 0, CL = 1, CC = 2, CQ = 3, CZ = 4;
  function parsePath(d, m, out) {
    var toks = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
    if (!toks) return true;
    var i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, prev = '';
    function n() { return parseFloat(toks[i++]); }
    function isNum() { return i < toks.length && !/[A-Za-z]/.test(toks[i]); }
    function P(px, py) { out.pts.push(m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]); }
    while (i < toks.length) {
      if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
      else if (!cmd) return false;
      var rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      if (C === 'Z') { out.cmd.push(CZ); x = sx; y = sy; prev = 'Z'; continue; }
      if (!isNum()) return false;
      if (C === 'M') {
        var mx = n(), my = n(); if (rel) { mx += x; my += y; }
        x = sx = mx; y = sy = my; out.cmd.push(CM); P(x, y); prev = 'M';
        cmd = rel ? 'l' : 'L';   // further pairs are lines
        continue;
      }
      if (C === 'L') { var lx = n(), ly = n(); if (rel) { lx += x; ly += y; } x = lx; y = ly; out.cmd.push(CL); P(x, y); }
      else if (C === 'H') { var hx = n(); x = rel ? x + hx : hx; out.cmd.push(CL); P(x, y); }
      else if (C === 'V') { var vy = n(); y = rel ? y + vy : vy; out.cmd.push(CL); P(x, y); }
      else if (C === 'C' || C === 'S') {
        var x1, y1;
        if (C === 'C') { x1 = n(); y1 = n(); if (rel) { x1 += x; y1 += y; } }
        else { if (prev === 'C') { x1 = 2 * x - cx; y1 = 2 * y - cy; } else { x1 = x; y1 = y; } }
        var x2 = n(), y2 = n(), ex = n(), ey = n();
        if (rel) { x2 += x; y2 += y; ex += x; ey += y; }
        out.cmd.push(CC); P(x1, y1); P(x2, y2); P(ex, ey);
        cx = x2; cy = y2; x = ex; y = ey; prev = 'C'; continue;
      } else if (C === 'Q' || C === 'T') {
        var qx1, qy1;
        if (C === 'Q') { qx1 = n(); qy1 = n(); if (rel) { qx1 += x; qy1 += y; } }
        else { if (prev === 'Q') { qx1 = 2 * x - qx; qy1 = 2 * y - qy; } else { qx1 = x; qy1 = y; } }
        var qex = n(), qey = n(); if (rel) { qex += x; qey += y; }
        out.cmd.push(CQ); P(qx1, qy1); P(qex, qey);
        qx = qx1; qy = qy1; x = qex; y = qey; prev = 'Q'; continue;
      } else if (C === 'A') {
        var rx = Math.abs(n()), ry = Math.abs(n()), phi = n(), fa = n(), fs = n(), ax = n(), ay = n();
        if (rel) { ax += x; ay += y; }
        if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
        arcToCurves(x, y, rx, ry, phi, fa, fs, ax, ay, function (c1x, c1y, c2x, c2y, e2x, e2y) { out.cmd.push(CC); P(c1x, c1y); P(c2x, c2y); P(e2x, e2y); });
        x = ax; y = ay;
      } else return false;
      prev = C;
    }
    return out.pts.every(Number.isFinite);
  }
  // endpoint arc -> cubic Bezier pieces (SVG implementation notes, F.6)
  function arcToCurves(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, emit) {
    if (x1 === x2 && y1 === y2) return;
    if (!rx || !ry) { emit(x1, y1, x2, y2, x2, y2); return; }
    var phi = phiDeg * Math.PI / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    var x1p = cs * dx + sn * dy, y1p = -sn * dx + cs * dy;
    var lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { var sl = Math.sqrt(lam); rx *= sl; ry *= sl; }
    var num0 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    var co = Math.sqrt(Math.max(0, num0 / den)) * (fa == fs ? -1 : 1);
    var cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    var ccx = cs * cxp - sn * cyp + (x1 + x2) / 2, ccy = sn * cxp + cs * cyp + (y1 + y2) / 2;
    function ang(ux, uy, vx, vy) { var a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; }
    var t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    var segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), d = dt / segs;
    var kk = 4 / 3 * Math.tan(d / 4);
    function pt(t) { var ex = rx * Math.cos(t), ey = ry * Math.sin(t); return [cs * ex - sn * ey + ccx, sn * ex + cs * ey + ccy]; }
    function dv(t) { var ex = -rx * Math.sin(t), ey = ry * Math.cos(t); return [cs * ex - sn * ey, sn * ex + cs * ey]; }
    for (var s = 0; s < segs; s++) {
      var a0 = t1 + s * d, a1 = a0 + d, p0 = pt(a0), p1 = pt(a1), d0 = dv(a0), d1 = dv(a1);
      emit(p0[0] + kk * d0[0], p0[1] + kk * d0[1], p1[0] - kk * d1[0], p1[1] - kk * d1[1], s === segs - 1 ? x2 : p1[0], s === segs - 1 ? y2 : p1[1]);
    }
  }

  // how a style paints (the same for every shape with that style): null when it
  // paints nothing, false when the canvas cannot paint it the same way
  function paintStyle(s, tag) {
    if (s.visibility !== 'visible') return null;
    var op = num(s.opacity, 1);
    if (op <= 0) return null;
    var fill = paintOf(s.fill), stroke = paintOf(s.stroke);
    if (fill === false || stroke === false) return false;
    if (tag === 'line') fill = null;   // a line has no inside
    var sw = lengthOf(s['stroke-width']);
    if (stroke && !(sw > 0)) stroke = null;
    var fa = op * num(s['fill-opacity'], 1), sa = op * num(s['stroke-opacity'], 1);
    if (fill && fa <= 0) fill = null;
    if (stroke && sa <= 0) stroke = null;
    if (!fill && !stroke) return null;
    if (op < 1 && fill && stroke) return false;   // the browser makes the shape see-through as a whole
    var po = s['paint-order'];
    if (po && po !== 'normal' && !/^fill(\s+stroke)?(\s+markers)?$/.test(po)) return false;
    if (s['shape-rendering'] && s['shape-rendering'] !== 'auto' && s['shape-rendering'] !== 'geometricprecision' && s['shape-rendering'] !== 'geometricPrecision') return false;
    if ((s['marker-start'] && s['marker-start'] !== 'none') || (s['marker-mid'] && s['marker-mid'] !== 'none') || (s['marker-end'] && s['marker-end'] !== 'none')) return false;
    var ps = { f: fill, fa: fa, s: stroke, sa: sa, sw: sw, rule: s['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', dash: null, dof: 0 };
    if (stroke) {
      ps.cap = s['stroke-linecap'] || 'butt'; ps.join = s['stroke-linejoin'] || 'miter'; ps.ml = num(s['stroke-miterlimit'], 4);
      if (ps.join === 'miter-clip' || ps.join === 'arcs') return false;
      var da = s['stroke-dasharray'];
      if (da && da !== 'none') {
        var parts = da.split(/[\s,]+/).filter(Boolean).map(lengthOf);
        if (parts.some(function (v) { return !(v >= 0); }) || /%/.test(da)) return false;
        if (parts.length % 2) parts = parts.concat(parts);
        if (parts.some(function (v) { return v > 0; })) { ps.dash = parts; ps.dof = lengthOf(s['stroke-dashoffset']); }
      }
    }
    return ps;
  }
  // one shape -> what the canvas paints (null: nothing to paint; false: not plain)
  function shapeOf(el, tag, st, m) {
    var ps = st.paint;
    if (ps === undefined) ps = st.paint = paintStyle(st.s, tag);
    if (!ps) return ps;
    var us = (m[0] === 1 && m[3] === 1 && m[1] === 0 && m[2] === 0) ? 1 : uniformScale(m);
    var p = { f: ps.f, fa: ps.fa, s: ps.s, sa: ps.sa, sw: ps.sw * us, rule: ps.rule };
    if (ps.s) { p.cap = ps.cap; p.join = ps.join; p.ml = ps.ml; if (ps.dash) { p.dash = us === 1 ? ps.dash : ps.dash.map(function (v) { return v * us; }); p.dof = ps.dof * us; } }
    if (tag === 'circle' || tag === 'ellipse') {
      // dots keep their shape: the centre moves with the column, the size does not
      if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9) return false;
      var rx = tag === 'circle' ? num(el.getAttribute('r'), 0) : num(el.getAttribute('rx'), 0), ry = tag === 'circle' ? rx : num(el.getAttribute('ry'), 0);
      if (!(rx > 0) || !(ry > 0)) return null;
      var ccx = num(el.getAttribute('cx'), 0), ccy = num(el.getAttribute('cy'), 0);
      p.t = 'dot'; p.cx = m[0] * ccx + m[4]; p.cy = m[3] * ccy + m[5]; p.rx = rx * Math.abs(m[0]); p.ry = ry * Math.abs(m[3]);
      return p;
    }
    if (tag === 'rect') {
      var x = num(el.getAttribute('x'), 0), y = num(el.getAttribute('y'), 0), w = num(el.getAttribute('width'), 0), h = num(el.getAttribute('height'), 0);
      if (!(w > 0) || !(h > 0)) return null;
      if (num(el.getAttribute('rx'), 0) || num(el.getAttribute('ry'), 0)) return false;
      if (!p.s && Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12) {
        p.t = 'box'; p.x = m[0] * x + m[4]; p.y = m[3] * y + m[5]; p.w = m[0] * w; p.h = m[3] * h;
        return p;
      }
      p.t = 'path'; p.cmd = [CM, CL, CL, CL, CZ]; p.pts = [];
      [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(function (q) { p.pts.push(m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]); });
      return p;
    }
    var out = { cmd: [], pts: [] };
    if (tag === 'line') {
      var lp = [num(el.getAttribute('x1'), 0), num(el.getAttribute('y1'), 0), num(el.getAttribute('x2'), 0), num(el.getAttribute('y2'), 0)];
      out.cmd.push(CM, CL);
      out.pts.push(m[0] * lp[0] + m[2] * lp[1] + m[4], m[1] * lp[0] + m[3] * lp[1] + m[5], m[0] * lp[2] + m[2] * lp[3] + m[4], m[1] * lp[2] + m[3] * lp[3] + m[5]);
    } else if (tag === 'polyline' || tag === 'polygon') {
      var v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
      if (v.length < 4 || v.some(function (q) { return !Number.isFinite(q); })) return null;
      for (var i = 0; i + 1 < v.length; i += 2) { out.cmd.push(i ? CL : CM); out.pts.push(m[0] * v[i] + m[2] * v[i + 1] + m[4], m[1] * v[i] + m[3] * v[i + 1] + m[5]); }
      if (tag === 'polygon') out.cmd.push(CZ);
    } else if (tag === 'path') {
      var d = el.getAttribute('d');
      if (!d) return null;
      if (!parsePath(d, m, out)) return false;
      if (!out.cmd.length) return null;
    }
    p.t = 'path'; p.cmd = out.cmd; p.pts = out.pts;
    return p;
  }

  // collect the shapes of one element (and what is inside it); false: not plain
  function collect(el, m, parentId, cache, out, node) {
    var tag = el.tagName;
    if (tag === 'title' || tag === 'desc' || tag === 'metadata') return true;
    var st = cache.get(el, parentId), s = st.s;
    if (s.display === 'none') return true;   // nothing shown
    if (!plainEffects(s)) return false;
    var mm = mul(m, ownMatrix(el));
    if (tag === 'g') {
      if (num(s.opacity, 1) !== 1) return false;   // a see-through group is painted as a whole
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!collect(c, mm, st.id, cache, out, node)) return false;
      return true;
    }
    if (!SHAPES[tag]) return false;
    var p = shapeOf(el, tag, st, mm);
    if (p === false) return false;
    if (p) { if (node) p.node = node; out.push(p); }
    return true;
  }

  // A part split in pieces, in drawing order: runs of plain children (painted into a
  // canvas) and runs of other children (kept in SVG).
  // nodes: the tree's nodes, each placed at its node (which moves during the drag)
  function planPart(el, cache, nodes) {
    var rootSt = rootStyleId(cache, el);
    if (rootSt.s.display === 'none' || !plainEffects(rootSt.s) || num(rootSt.s.opacity, 1) !== 1) return null;
    var runs = [], rootId = rootSt.id;
    var u = ownMatrix(el);
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      var prims = [], ok;
      if (nodes) {
        // a node is drawn at (d.y, d.x); its shapes are kept relative to it (the
        // browser keeps transforms in single precision: compared to a hundredth of a pixel)
        var d = c.__data__, t = ownMatrix(c);
        ok = !!d && t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1 && Math.abs(t[4] - d.y) < 0.01 && Math.abs(t[5] - d.x) < 0.01;
        if (ok) {
          var st = cache.get(c, rootId);
          if (st.s.display === 'none') ok = true;
          else if (!plainEffects(st.s) || num(st.s.opacity, 1) !== 1) ok = false;
          else for (var cc = c.firstElementChild; cc && ok; cc = cc.nextElementSibling) ok = collect(cc, I, st.id, cache, prims, d);
        }
      } else ok = collect(c, I, rootId, cache, prims, null);
      if (cache.bad) return null;
      var kind = ok ? 'flat' : 'svg', last = runs[runs.length - 1];
      if (last && last.kind === kind) { last.els.push(c); if (ok) Array.prototype.push.apply(last.prims, prims); }
      else runs.push({ kind: kind, els: [c], prims: ok ? prims : null });
    }
    var flat = 0;
    runs.forEach(function (r) { if (r.kind === 'flat') flat += r.prims.length; });
    if (flat < MIN_FLAT || runs.length > MAX_RUNS) return null;
    // a few plain shapes between SVG pieces are not worth a canvas of their own
    runs.forEach(function (r) { if (r.kind === 'flat' && r.prims.length < 50 && runs.length > 1) r.kind = 'svg'; });
    var merged = [];
    runs.forEach(function (r) { var last = merged[merged.length - 1]; if (last && last.kind === r.kind) { Array.prototype.push.apply(last.els, r.els); if (r.prims) Array.prototype.push.apply(last.prims, r.prims); } else merged.push(r); });
    merged.forEach(function (r) { r.unitMatrix = u; });
    return merged;
  }

  // ------------------------------------------------------- painting a canvas
  function Painter(ctx) { this.ctx = ctx; this.f = null; this.s = null; this.a = -1; this.lw = -1; this.cap = null; this.join = null; this.ml = -1; this.dash = null; this.T = null; }
  Painter.prototype.setT = function (m) {
    if (this.T === m) return;
    this.T = m; this.ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  };
  Painter.prototype.alpha = function (a) { if (a !== this.a) { this.a = a; this.ctx.globalAlpha = a; } };
  Painter.prototype.fill = function (p) { if (p.f !== this.f) { this.f = p.f; this.ctx.fillStyle = p.f; } this.alpha(p.fa); };
  Painter.prototype.stroke = function (p, rs) {
    var ctx = this.ctx;
    if (p.s !== this.s) { this.s = p.s; ctx.strokeStyle = p.s; }
    this.alpha(p.sa);
    var lw = p.sw * rs; if (lw !== this.lw) { this.lw = lw; ctx.lineWidth = lw; }
    if (p.cap !== this.cap) { this.cap = p.cap; ctx.lineCap = p.cap; }
    if (p.join !== this.join) { this.join = p.join; ctx.lineJoin = p.join; }
    if (p.ml !== this.ml) { this.ml = p.ml; ctx.miterLimit = p.ml; }
    var dk = p.dash ? p.dash.join(',') + '@' + p.dof + '@' + rs : '';
    if (dk !== this.dash) { this.dash = dk; ctx.setLineDash(p.dash ? p.dash.map(function (v) { return v * rs; }) : []); ctx.lineDashOffset = p.dash ? p.dof * rs : 0; }
  };
  // a path in canvas pixels (the points mapped here: line widths stay in pixels)
  function replay(ctx, p, T) {
    var c = p.cmd, q = p.pts, j = 0, a = T[0], b = T[1], cc = T[2], d = T[3], e = T[4], f = T[5];
    for (var i = 0; i < c.length; i++) {
      switch (c[i]) {
        case CM: ctx.moveTo(a * q[j] + cc * q[j + 1] + e, b * q[j] + d * q[j + 1] + f); j += 2; break;
        case CL: ctx.lineTo(a * q[j] + cc * q[j + 1] + e, b * q[j] + d * q[j + 1] + f); j += 2; break;
        case CC: ctx.bezierCurveTo(a * q[j] + cc * q[j + 1] + e, b * q[j] + d * q[j + 1] + f, a * q[j + 2] + cc * q[j + 3] + e, b * q[j + 2] + d * q[j + 3] + f, a * q[j + 4] + cc * q[j + 5] + e, b * q[j + 4] + d * q[j + 5] + f); j += 6; break;
        case CQ: ctx.quadraticCurveTo(a * q[j] + cc * q[j + 1] + e, b * q[j] + d * q[j + 1] + f, a * q[j + 2] + cc * q[j + 3] + e, b * q[j + 2] + d * q[j + 3] + f); j += 4; break;
        case CZ: ctx.closePath(); break;
      }
    }
  }
  function yRange(p) {
    if (p.minY !== undefined) return;
    var lo = Infinity, hi = -Infinity;
    for (var j = 1; j < p.pts.length; j += 2) { if (p.pts[j] < lo) lo = p.pts[j]; if (p.pts[j] > hi) hi = p.pts[j]; }
    p.minY = lo; p.maxY = hi;
  }
  var DEVICE = [1, 0, 0, 1, 0, 0];
  // S: canvas pixels from the part's coordinates (with the column's stretch);
  // rs: canvas pixels per unit for sizes that do not stretch (dots, line widths).
  // Shapes outside the canvas (above or below it) are left out.
  function paintRun(r, S, rs) {
    var cv = r.cv, ctx = r.ctx, P = new Painter(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cv.width, cv.height);
    var prims = r.prims, nodeT = null, lastNode = null;
    var cull = Math.abs(S[1]) < 1e-12 && Math.abs(S[2]) < 1e-12, top = -2, bottom = cv.height + 2;
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i], T = S;
      if (p.node) {
        if (p.node !== lastNode) { lastNode = p.node; nodeT = [S[0], S[1], S[2], S[3], S[0] * p.node.y + S[2] * p.node.x + S[4], S[1] * p.node.y + S[3] * p.node.x + S[5]]; }
        T = nodeT;
      }
      if (p.t === 'box') {
        if (cull) { var ya = T[3] * p.y + T[5], yb = ya + T[3] * p.h; if ((ya < top && yb < top) || (ya > bottom && yb > bottom)) continue; }
        P.setT(T); P.fill(p); ctx.fillRect(p.x, p.y, p.w, p.h);
      } else if (p.t === 'dot') {
        var X = T[0] * p.cx + T[2] * p.cy + T[4], Y = T[1] * p.cx + T[3] * p.cy + T[5], ext = p.ry * rs + p.sw * rs;
        if (cull && (Y + ext < top || Y - ext > bottom)) continue;
        P.setT(DEVICE); ctx.beginPath();
        if (p.rx === p.ry) ctx.arc(X, Y, p.rx * rs, 0, 2 * Math.PI); else ctx.ellipse(X, Y, p.rx * rs, p.ry * rs, 0, 0, 2 * Math.PI);
        if (p.f) { P.fill(p); ctx.fill(); }
        if (p.s) { P.stroke(p, rs); ctx.stroke(); }
      } else {
        if (cull) {
          yRange(p);
          var w2 = (p.s ? p.sw * rs : 0) + 2, y1 = T[3] * p.minY + T[5], y2 = T[3] * p.maxY + T[5];
          if (Math.max(y1, y2) + w2 < top || Math.min(y1, y2) - w2 > bottom) continue;
        }
        P.setT(DEVICE); ctx.beginPath(); replay(ctx, p, T);
        if (p.f) { P.fill(p); ctx.fill(p.rule); }
        if (p.s) { P.stroke(p, rs); ctx.stroke(); }
      }
    }
  }

  // ------------------------------------------------------ the canvas check
  // The canvas is only used where it paints plain shapes exactly as this browser paints
  // them in SVG (hairline rows, thin lines, dots, curves): checked once, by painting a
  // test picture both ways and comparing the pixels.
  var canvasSame = null;
  function probeShapes() {
    var out = [], cols = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f'];
    for (var i = 0; i < 60; i++) out.push({ t: 'rect', x: 2 + (i % 5) * 9.3, y: 1.3 + i * 0.27, w: 8.6, h: 0.27, f: cols[i % 5] });
    for (var j = 0; j < 6; j++) out.push({ t: 'line', x1: 50.5 + j * 1.7, y1: 2, x2: 50.5 + j * 1.7, y2: 30.3, s: '#1b2a66', sw: 1 });
    for (var k = 0; k < 8; k++) out.push({ t: 'circle', cx: 6 + k * 7.4, cy: 40.6 + (k % 2) * 0.5, r: 2.2, f: '#9fb1e1', s: '#1b2a66', sw: 1 });
    out.push({ t: 'path', d: 'M2,60 C20,44 40,64 62,48', s: '#333', sw: 1.2 });
    out.push({ t: 'path', d: 'M4,52.5 H30.25 V63', s: '#555', sw: 0.8 });
    return out;
  }
  // WebKit (Safari, and every browser on iPhone / iPad) paints hairline shapes in SVG
  // with a different smoothing than in a canvas, which the test picture cannot see
  // (an SVG drawn as a picture is painted like the canvas): the canvas is not used there.
  function webkitEngine() {
    var ua = navigator.userAgent || '';
    return /AppleWebKit/.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//.test(ua) || /(CriOS|FxiOS|EdgiOS)\//.test(ua);
  }
  function probe() {
    if (webkitEngine()) { canvasSame = false; return; }
    try {
      var N = 64, shapes = probeShapes(), svgS = '<svg xmlns="http://www.w3.org/2000/svg" width="' + N + '" height="' + N + '">';
      shapes.forEach(function (q) {
        if (q.t === 'rect') svgS += '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" fill="' + q.f + '"/>';
        else if (q.t === 'line') svgS += '<line x1="' + q.x1 + '" y1="' + q.y1 + '" x2="' + q.x2 + '" y2="' + q.y2 + '" stroke="' + q.s + '" stroke-width="' + q.sw + '"/>';
        else if (q.t === 'circle') svgS += '<circle cx="' + q.cx + '" cy="' + q.cy + '" r="' + q.r + '" fill="' + q.f + '" stroke="' + q.s + '" stroke-width="' + q.sw + '"/>';
        else svgS += '<path d="' + q.d + '" fill="none" stroke="' + q.s + '" stroke-width="' + q.sw + '"/>';
      });
      svgS += '</svg>';
      var img = new Image();
      img.onload = function () {
        try {
          var a = document.createElement('canvas'); a.width = a.height = N;
          var ca = a.getContext('2d'); ca.drawImage(img, 0, 0);
          var b = document.createElement('canvas'); b.width = b.height = N;
          var cb = b.getContext('2d');
          shapes.forEach(function (q) {
            if (q.t === 'rect') { cb.fillStyle = q.f; cb.fillRect(q.x, q.y, q.w, q.h); return; }
            cb.beginPath();
            if (q.t === 'line') { cb.moveTo(q.x1, q.y1); cb.lineTo(q.x2, q.y2); }
            else if (q.t === 'circle') cb.arc(q.cx, q.cy, q.r, 0, 2 * Math.PI);
            else { var pp = { cmd: [], pts: [] }; parsePath(q.d, I, pp); replay(cb, pp, I); }
            if (q.f) { cb.fillStyle = q.f; cb.fill(); }
            cb.lineWidth = q.sw; cb.strokeStyle = q.s; cb.stroke();
          });
          var da = ca.getImageData(0, 0, N, N).data, db = cb.getImageData(0, 0, N, N).data, off = 0, sum = 0;
          for (var i = 0; i < da.length; i++) { var d = Math.abs(da[i] - db[i]); sum += d; if (d > 24) off++; }
          canvasSame = off <= da.length * 0.004 && sum / da.length < 1.5;
        } catch (e) { canvasSame = false; }
      };
      img.onerror = function () { canvasSame = false; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgS);
    } catch (e) { canvasSame = false; }
  }
  setTimeout(probe, 0);

  // ----------------------------------------------------- prepared in advance
  // Reading the shapes of a large drawing takes a moment (about a tenth of a second for
  // 30 000 shapes). It is done while the pointer is over a splitter, before the drag,
  // and kept as long as nothing in the drawing or its styles changes.
  var pre = null;
  function heavyUnits() {
    var z = document.getElementById('zoomable'), out = [];
    if (!z) return out;
    layerReuse.byKey.forEach(function (c) { if (c.el && c.el.isConnected && Number.isFinite(c.x) && Number.isFinite(c.w)) out.push({ el: c.el, nodes: false }); });
    ['.links', '.clade-background-highlights', '.cartoon-triangles', '.bootstrap-elements', '#tree-scale'].forEach(function (sel) {
      var el = z.querySelector(':scope > ' + sel); if (el) out.push({ el: el, nodes: false });
    });
    var ng = z.querySelector(':scope > g.nodes'); if (ng) out.push({ el: ng, nodes: true });
    return out;
  }
  function worthIt() {
    return typeof root !== 'undefined' && root && geometry !== 'radial' && typeof lastDrawMs !== 'undefined' && lastDrawMs > LIVE_DRAG_MIN_MS;
  }
  function dropPre() { if (pre) { pre.obs.disconnect(); pre = null; } }
  function relevant(recs) {
    for (var i = 0; i < recs.length; i++) {
      var t = recs[i].target;
      if (t.nodeType !== 1) t = t.parentNode;
      if (t && t.closest && t.closest('.svg-splitters')) continue;   // the splitter's own highlight
      return true;
    }
    return false;
  }
  function prepare() {
    if (lift || !worthIt() || canvasSame === null) return;
    if (pre && !pre.stale && !relevant(pre.obs.takeRecords())) return;   // still good
    dropPre();
    var svg = document.getElementById('svg'); if (!svg) return;
    var cache = new StyleCache(), plans = new Map(), t0 = performance.now();
    // with the canvas: the shapes of each part; without: the outlined shapes of each
    // part (the parts stay SVG as a whole)
    heavyUnits().forEach(function (u) { plans.set(u.el, canvasSame ? planPart(u.el, cache, u.nodes) : { outlined: outlined(u.el) }); });
    if (cache.bad) return;
    // any change to the drawing or its styles: the prepared shapes are dropped (the
    // observer is let go then, so that nothing is kept for long)
    var obs = new MutationObserver(function (recs) { if (pre && pre.obs === obs && relevant(recs)) dropPre(); });
    obs.observe(svg, { subtree: true, attributes: true, childList: true, characterData: true });
    obs.observe(document.documentElement, { attributes: true });   // the theme
    pre = { plans: plans, obs: obs, ms: performance.now() - t0 };
  }
  // the prepared shapes, when nothing changed since (they are used once)
  function takePrepared() {
    if (!pre) return null;
    var ok = !relevant(pre.obs.takeRecords()) && !pre.stale, plans = pre.plans;
    dropPre();
    return ok ? plans : null;
  }
  // while the drag starts, the app changes things that the shapes do not depend on
  function notePrepared() { if (pre && relevant(pre.obs.takeRecords())) pre.stale = true; }
  function ignoreOwnChanges() { if (pre) pre.obs.takeRecords(); }
  var hoverTimer = 0, SPLITTERS = '.svg-splitter-hit-area, #panelsContainer .splitter';   // (the page's own splitter is over the drawing's in some browsers)
  document.addEventListener('pointerover', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest(SPLITTERS) || lift || base) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(prepare, 60);
  }, true);
  document.addEventListener('pointerout', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(SPLITTERS)) clearTimeout(hoverTimer);
  }, true);

  // ---------------------------------------------------------------- layers
  // The whole drawing is one picture: changing any part of it makes the browser go
  // over all of it again (tens of thousands of shapes), which alone takes longer than
  // a frame. During the drag each part of the drawing (each data column, the branches,
  // the nodes, ...) is shown in its own layer on top of the canvas, at exactly the same
  // place, in the same order: the browser then only paints again the parts that change,
  // and a part that only moves is moved as a whole by the graphics card. Parts of many
  // plain shapes are painted into a <canvas> (see "flat parts").
  // Everything goes back to its place (the same element, at the same spot) before the
  // drawing is drawn for real.
  function liftParts(b, prepared) {
    var svg = document.getElementById('svg'), z = document.getElementById('zoomable');
    if (!svg || !z || !svg.parentNode) return;
    var host = svg.parentNode, W = svg.clientWidth, H = svg.clientHeight;
    if (!W || !H) return;
    var hr = host.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    var left = sr.left - hr.left - host.clientLeft + host.scrollLeft, top = sr.top - hr.top - host.clientTop + host.scrollTop;
    var dpr = window.devicePixelRatio || 1;
    var kindOf = new Map();
    b.layers.forEach(function (L) { kindOf.set(L.el, { kind: 'layer', ref: L }); });
    b.treeGroups.forEach(function (g) { kindOf.set(g.el, { kind: 'tree', ref: g }); });
    var ng = z.querySelector(':scope > g.nodes'); if (ng) kindOf.set(ng, { kind: 'nodes', ref: null });
    // the parts, in drawing order: the children of the drawing, and the columns
    // one by one inside the container of the columns
    var units = [];
    for (var c = z.firstElementChild; c; c = c.nextElementSibling) {
      if (c.classList.contains('layers-container')) {
        for (var cc = c.firstElementChild; cc; cc = cc.nextElementSibling) units.push({ el: cc, wrap: c });
      } else units.push({ el: c, wrap: null });
    }
    if (!units.length) return;
    var Lf = { svg: svg, z: z, zt: z.getAttribute('transform') || '', Z: ownMatrix(z), dpr: dpr, W: W, H: H, layers: [], moved: [], clones: [], twins: new Map(), runs: [],
      cursor: svg.style.cursor, opacity: svg.style.opacity, hidMain: false };
    var next = svg.nextSibling;
    function place(elm) {
      elm.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + W + 'px;height:' + H + 'px;pointer-events:none;will-change:transform;';
      host.insertBefore(elm, next);
      Lf.layers.push(elm);
    }
    function newOverlay() {
      var o = document.createElementNS(SVGNS, 'svg');
      o.setAttribute('class', 'tm-live-layer');
      o.setAttribute('width', W); o.setAttribute('height', H);
      o.setAttribute('aria-hidden', 'true');
      var g = document.createElementNS(SVGNS, 'g');
      for (var i = 0; i < z.attributes.length; i++) if (z.attributes[i].name !== 'id') g.setAttribute(z.attributes[i].name, z.attributes[i].value);
      o.appendChild(g); Lf.clones.push(g);
      place(o);
      return { o: o, g: g, wrapFor: null, wrapEl: null };
    }
    function newCanvas() {
      var cv = document.createElement('canvas');
      cv.className = 'tm-live-layer';
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      cv.setAttribute('aria-hidden', 'true');
      place(cv);
      return cv;
    }
    function moveInto(elm, parent) {
      var ph = document.createComment('tm-live');
      ownNodes.add(ph); ownNodes.add(elm);
      elm.parentNode.insertBefore(ph, elm);
      parent.appendChild(elm);
      Lf.moved.push({ el: elm, ph: ph });
    }
    function parentIn(ov, u) {
      if (!u.wrap) { ov.wrapFor = null; return ov.g; }
      if (ov.wrapFor !== u.wrap) { ov.wrapEl = u.wrap.cloneNode(false); ov.wrapEl.removeAttribute('id'); ov.g.appendChild(ov.wrapEl); ov.wrapFor = u.wrap; }
      return ov.wrapEl;
    }
    // the matrix from a part's parent to the drawing (the container of the columns)
    function ancestors(u) { return u.wrap ? ownMatrix(u.wrap) : I; }
    var cache = new StyleCache(), shared = null;
    var t0 = performance.now();
    Lf.prepared = !!prepared;
    units.forEach(function (u) {
      var k = kindOf.get(u.el);
      if (!k) {
        // small parts share a layer
        var ovs = shared || (shared = newOverlay());
        moveInto(u.el, parentIn(ovs, u));
        return;
      }
      shared = null;
      var pp = prepared && prepared.has(u.el) ? prepared.get(u.el) : undefined;
      if (pp && pp.outlined) { u.el.__liveOutlined = pp.outlined; pp = undefined; }
      var plan = canvasSame !== true ? null : pp !== undefined ? pp : planPart(u.el, cache, k.kind === 'nodes');
      if (cache.bad) plan = null;
      if (!plan || !plan.some(function (r) { return r.kind === 'flat'; })) {
        var ov = newOverlay();
        moveInto(u.el, parentIn(ov, u));
        u.svgWhole = true;
        u.k = k;
        Lf.runs.push({ kind: 'svg', unit: u });
        return;
      }
      // split: canvas pieces, and SVG pieces inside a copy of the part
      u.k = k; u.split = true; u.A = ancestors(u);
      var twins = [];
      plan.forEach(function (r) {
        if (r.kind === 'flat') {
          var cv = newCanvas();
          Lf.runs.push({ kind: 'flat', unit: u, cv: cv, ctx: cv.getContext('2d'), prims: r.prims, U: r.unitMatrix, drawn: null });
        } else {
          var ov2 = newOverlay(), parent = parentIn(ov2, u);
          var twin = u.el.cloneNode(false); twin.removeAttribute('id');
          parent.appendChild(twin); twins.push(twin);
          r.els.forEach(function (e) { moveInto(e, twin); });
          Lf.runs.push({ kind: 'svg', unit: u, twin: twin });
        }
      });
      Lf.twins.set(u.el, twins);
      Lf.hidMain = true;
    });
    Lf.units = units;
    Lf.prepMs = performance.now() - t0;
    // the drawing itself only holds what the canvases show now
    if (Lf.hidMain) svg.style.opacity = '0';
    svg.style.cursor = 'col-resize';
    lift = Lf;
  }
  function dropParts() {
    if (!lift) return;
    var L = lift; lift = null;
    // back to the same spots, last first
    for (var i = L.moved.length - 1; i >= 0; i--) {
      var mv = L.moved[i];
      if (mv.ph.parentNode) mv.ph.parentNode.replaceChild(mv.el, mv.ph);
      else mv.el.remove();   // its old place is gone: the drawing was replaced
    }
    L.layers.forEach(function (o) { o.remove(); });
    L.svg.style.cursor = L.cursor;
    L.svg.style.opacity = L.opacity;
  }
  // the drawing was zoomed or panned during the drag
  function followZoom() {
    if (!lift) return;
    var t = lift.z.getAttribute('transform') || '';
    if (t === lift.zt) return;
    lift.zt = t; lift.Z = ownMatrix(lift.z);
    lift.clones.forEach(function (g) { if (t) g.setAttribute('transform', t); else g.removeAttribute('transform'); });
    lift.runs.forEach(function (r) { r.drawn = null; });
  }
  // During the drag a clear sheet over the drawing takes the pointer: the drawing
  // underneath (partly hidden, partly in layers) is not hovered, and the browser does
  // not have to find what is under the pointer among thousands of shapes at every move.
  var shield = null;
  function shieldUp() {
    var svg = document.getElementById('svg');
    if (shield || !svg || !svg.parentNode) return;
    var host = svg.parentNode, hr = host.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    shield = document.createElement('div');
    shield.className = 'tm-live-shield';
    shield.setAttribute('aria-hidden', 'true');
    shield.style.cssText = 'position:absolute;left:' + (sr.left - hr.left - host.clientLeft + host.scrollLeft) + 'px;top:' + (sr.top - hr.top - host.clientTop + host.scrollTop) +
      'px;width:' + svg.clientWidth + 'px;height:' + svg.clientHeight + 'px;cursor:col-resize;background:transparent;';
    var after = lift && lift.layers.length ? lift.layers[lift.layers.length - 1].nextSibling : svg.nextSibling;
    host.insertBefore(shield, after);
  }
  function shieldDown() { if (shield) { shield.remove(); shield = null; } }
  // where a part's own transform goes: the part, or its SVG pieces when it was split
  function targets(el) { return (lift && lift.twins.get(el)) || [el]; }
  function setTransform(el, t) { targets(el).forEach(function (x) { if (t) x.setAttribute('transform', t); else x.removeAttribute('transform'); }); }
  function setMove(el, dx, css) { targets(el).forEach(function (x) { moveOnCard(x, dx, css); }); }
  function clearMove(el) { targets(el).forEach(dropFromCard); }
  function inMain(el) { return lift && lift.hidMain && lift.svg.contains(el); }

  // after the parts were lifted: what is still drawn as SVG gets its dots kept round and
  // its lines kept thin (the canvas does that itself)
  function prepareSvgParts(b) {
    function keepOf(el) { return prepareScaled(el).filter(function (x) { return !inMain(x); }); }
    b.layers.forEach(function (L) {
      var t = targets(L.el);
      L.keep = [];
      t.forEach(function (x) { Array.prototype.push.apply(L.keep, keepOf(x)); });
    });
    b.treeGroups.forEach(function (g) {
      g.keep = [];
      targets(g.el).forEach(function (x) { Array.prototype.push.apply(g.keep, keepOf(x)); });
    });
    b.pinned.forEach(function (P) { P.keep = prepareScaled(P.el); });
    // nodes painted into a canvas are not moved one by one
    if (lift) lift.units.forEach(function (u) {
      if (u.k && u.k.kind === 'nodes' && u.split) {
        var inSvg = new Set();
        targets(u.el).forEach(function (t) { if (t !== u.el) for (var c = t.firstElementChild; c; c = c.nextElementSibling) inSvg.add(c); });
        b.nodes.forEach(function (nd) { if (!inSvg.has(nd.el)) nd.shown = false; });
      }
    });
  }

  // the drawing as it was last drawn: what each part is mapped from
  function capture() {
    if (base || touched.length || lifted.length || lift) reset();
    notePrepared();
    var zt = (typeof d3 !== 'undefined' && document.getElementById('svg')) ? d3.zoomTransform(document.getElementById('svg')) : null;
    base0Zoom = zt ? zt.k : 1;
    if (typeof root === 'undefined' || !root || geometry === 'radial') return;
    var z = document.getElementById('zoomable'); if (!z) return;
    var ps = getPanelPositions();
    var tree = ps.filter(function (p) { return p.type === 'tree'; })[0];
    if (!tree) return;
    var hl = document.getElementById('hideLabels'), hidden = !!(hl && hl.checked);
    var lp = getLabelsPanelDimensions();
    var b = { tree: treeSpan(tree), labelRight: hidden ? (tree.x + 48 + Math.max(1, tree.width - 56)) : lp.rightEdge - 8, labelsW: lp.width, hidden: hidden, layers: [], treeGroups: [], nodes: [], labels: [], bands: [] };
    // data columns (layerReuse cache: the place and width each was drawn with)
    layerReuse.byKey.forEach(function (c, key) {
      if (!c.el || !c.el.isConnected || !Number.isFinite(c.x) || !Number.isFinite(c.w)) return;
      var type = key.split(':')[0];
      b.layers.push({ el: c.el, type: type, index: c.index, from: columnSpan(type, c.x, c.w), keep: [], wasT: c.el.getAttribute('transform'), css: cssOf(c.el), mode: '' });
    });
    // tree parts that are mapped like a column
    ['.links', '.clade-background-highlights', '.cartoon-triangles', '.bootstrap-elements', '#tree-scale'].forEach(function (sel) {
      var el = z.querySelector(':scope > ' + sel) || z.querySelector('.pro-sticky-header > ' + sel);
      if (el) b.treeGroups.push({ el: el, keep: [] });
    });
    // nodes and labels get new coordinates
    var ng = z.querySelector(':scope > g.nodes');
    if (ng) for (var n = ng.firstElementChild; n; n = n.nextElementSibling) {
      var d = n.__data__; if (!d) continue;
      // a node with nothing shown (no marker, no label) is placed at the real redraw
      b.nodes.push({ el: n, d: d, y0: d.y, shown: shownNode(n) });
      var t = n.querySelector(':scope > text.label'); if (t) b.labels.push({ el: t, d: d, x0: t.getAttribute('x') });
      var r = n.querySelector(':scope > rect.label-highlight-bg'); if (r) b.bands.push({ el: r, d: d, x0: r.getAttribute('x'), w0: r.getAttribute('width') });
    }
    // nodes that show nothing (markers off, labels hidden) still cost the browser time on
    // every frame: while none of them shows anything, their group is left out until the
    // real redraw (nothing on screen changes)
    if (ng && b.nodes.length && !b.nodes.some(function (nd) { return nd.shown; }) && ng.style.display !== 'none') {
      b.nodesOff = { el: ng, was: ng.style.display };
      ng.style.display = 'none';
    }
    b.splitters = z.querySelector(':scope > .svg-splitters');
    // axis rows pinned to the top / bottom of an expanded view: mapped with their column
    b.pinned = [];
    z.querySelectorAll(':scope > .pro-sticky-header > *').forEach(function (el) {
      var home = el.__liveHome || null;
      if (!home) return;
      var L = b.layers.filter(function (l) { return l.el === home; })[0];
      if (L) b.pinned.push({ el: el, layer: L, keep: [], css: null });
    });
    ignoreOwnChanges();
    if (typeof labelGuideCtx !== 'undefined' && labelGuideCtx && labelGuideCtx.items)
      b.guide = { ctx: labelGuideCtx, x1: labelGuideCtx.items.map(function (it) { return it[1]; }), end: labelGuideCtx.end, labelRight: labelGuideCtx.labelRight, d: labelGuideCtx.path ? labelGuideCtx.path.getAttribute('d') : null };
    base = b;
    // the shapes are read now if that was not done while the pointer was over the splitter
    if (worthIt()) setTimeout(function () { if (base === b && !lift) prepare(); }, 0);
  }

  // the canvases: painted again when their part moved or changed size
  function paintFlat(k, t1) {
    var Z = lift.Z, dpr = lift.dpr;
    lift.runs.forEach(function (r) {
      if (r.kind !== 'flat') return;
      var u = r.unit, kx = 1, tx = 0;
      if (u.k.kind === 'layer') { var L = u.k.ref; if (!L.to) return; kx = L.k; tx = L.to.a - L.from.a * L.k; }
      else if (u.k.kind === 'tree') { kx = k; tx = t1.a - base.tree.a * k; }
      else if (u.k.kind === 'nodes') { kx = 1; tx = 0; }
      var key = kx + ',' + tx + (u.k.kind === 'nodes' ? ',' + t1.a + ',' + t1.s : '');
      if (r.drawn === key) return;
      // the part's parent -> canvas pixels; the stretch; the part's own transform
      var PZ = mul([dpr, 0, 0, dpr, 0, 0], mul(Z, u.A));
      // layers: the column's mapping takes the place of their transform (as in SVG);
      // tree parts: the mapping comes before their own transform
      var U = u.k.kind === 'layer' ? I : r.U;
      var C = [kx, 0, 0, 1, tx, 0];
      var S = mul(PZ, mul(C, U));
      var rs = uniformScale(mul(PZ, U));
      // only moved, and all of it was painted: the graphics card moves it
      if (r.drawn && r.kx === kx && r.fits) {
        var dxPx = (tx - r.tx) * PZ[0] / dpr;
        r.cv.style.transform = dxPx ? 'translate(' + dxPx + 'px,0px)' : '';
        r.drawn = key;
        return;
      }
      r.cv.style.transform = '';
      paintRun(r, S, rs);
      r.drawn = key; r.kx = kx; r.tx = tx;
      r.fits = fitsIn(r, S, rs);
    });
  }
  // everything of the canvas is inside it (then moving the canvas shows all of it)
  function fitsIn(r, S, rs) {
    if (r.bounds === undefined) {
      var minX = Infinity, maxX = -Infinity, pad = 0;
      r.prims.forEach(function (p) {
        if (p.node) { minX = -Infinity; return; }
        if (p.s) pad = Math.max(pad, p.sw);
        if (p.t === 'box') { minX = Math.min(minX, p.x, p.x + p.w); maxX = Math.max(maxX, p.x, p.x + p.w); }
        else if (p.t === 'dot') { pad = Math.max(pad, p.rx + p.sw); minX = Math.min(minX, p.cx); maxX = Math.max(maxX, p.cx); }
        else for (var j = 0; j < p.pts.length; j += 2) { minX = Math.min(minX, p.pts[j]); maxX = Math.max(maxX, p.pts[j]); }
      });
      r.bounds = Number.isFinite(minX) && Number.isFinite(maxX) ? { minX: minX, maxX: maxX, pad: pad } : null;
    }
    if (!r.bounds || Math.abs(S[1]) > 1e-9 || Math.abs(S[2]) > 1e-9) return false;
    var a = S[0] * r.bounds.minX + S[4], b2 = S[0] * r.bounds.maxX + S[4], pad2 = r.bounds.pad * rs + 2;
    return Math.min(a, b2) - pad2 >= 0 && Math.max(a, b2) + pad2 <= r.cv.width;
  }

  function frame() {
    if (!base) return false;
    if (!lift && !base.noLift) {
      // the shapes read in advance (when nothing changed since)
      var prepared = takePrepared();
      // WebKit takes long to show parts moved to layers of their own (a third of a second
      // for 3000 tips, a visible jump): there the drawing is changed where it is
      if (!window.__tmNoLift && !webkitEngine()) liftParts(base, prepared);
      else if (prepared) prepared.forEach(function (pp, el) { if (pp && pp.outlined) el.__liveOutlined = pp.outlined; });
      base.noLift = !lift;
      shieldUp();
      var tps = performance.now();
      prepareSvgParts(base);
      base.svgPrepMs = performance.now() - tps;
    }
    followZoom();
    var ps = getPanelPositions();
    var tree = ps.filter(function (p) { return p.type === 'tree'; })[0]; if (!tree) return false;
    var lp = getLabelsPanelDimensions();
    var t1 = treeSpan(tree), k = t1.s / base.tree.s;
    var labelRight = base.hidden ? (t1.a + t1.s) : lp.rightEdge - 8;
    var treeSame = base.lastTree && base.lastTree.a === t1.a && base.lastTree.s === t1.s;
    base.lastTree = t1;
    if (!treeSame) {
      // tree: branches, highlights, cartoons, support symbols, scale bar
      base.treeGroups.forEach(function (gp) {
        var m = matrix(k, base.tree.a, t1.a), o = own(gp.el);
        if (!lift || !lift.twins.has(gp.el) || lift.twins.get(gp.el).length) setTransform(gp.el, (m + ' ' + o).trim());
        gp.keep.forEach(function (el) { keepShape(el, k); });
      });
      // nodes and labels
      for (var i = 0; i < base.nodes.length; i++) {
        var nd = base.nodes[i], y = t1.a + (nd.y0 - base.tree.a) * k;
        nd.d.y = y;
        if (nd.shown) nd.el.setAttribute('transform', 'translate(' + y + ',' + nd.d.x + ')');
      }
    }
    var guideEnd = labelRight - 4;
    if (base.hidden) {
      var first = ps.filter(function (x) { return x.type !== 'tree' && x.type !== 'labels' && x.width > 0; }).sort(function (a, b2) { return a.x - b2.x; })[0];
      guideEnd = first ? first.x - 4 : labelRight;
    }
    var labelsSame = treeSame && base.lastLabelRight === labelRight && base.lastLabelsW === lp.width && base.lastGuideEnd === guideEnd;
    base.lastLabelRight = labelRight; base.lastLabelsW = lp.width; base.lastGuideEnd = guideEnd;
    if (!labelsSame) {
      for (var j = 0; j < base.labels.length; j++) base.labels[j].el.setAttribute('x', labelRight - base.labels[j].d.y);
      for (var q = 0; q < base.bands.length; q++) {
        var bd = base.bands[q];
        bd.el.setAttribute('x', labelRight - bd.d.y + 7.5 - lp.width);
        bd.el.setAttribute('width', lp.width);
      }
      // label guides: from each tip to its label
      if (typeof labelGuideCtx !== 'undefined' && labelGuideCtx && labelGuideCtx.items) {
        labelGuideCtx.items.forEach(function (it) { it[1] = it[0].y + 8; });
        labelGuideCtx.end = guideEnd;
        labelGuideCtx.labelRight = labelRight;
        updateLabelGuideEnds();
      }
    }
    // data columns
    base.layers.forEach(function (L) {
      var p = panelOf(ps, L.type, L.index); if (!p) return;
      var to = columnSpan(L.type, p.x, p.width), kk = to.s / L.from.s;
      L.changed = !(L.to && L.to.a === to.a && L.to.s === to.s);
      L.k = kk; L.to = to;
      if (!L.changed) return;
      var split = lift && lift.twins.has(L.el);
      if (split && !lift.twins.get(L.el).length) return;   // all of it is in canvases
      if (Math.abs(kk - 1) < 1e-9) {
        // only moved: by the graphics card
        if (L.mode !== 'move') {
          setTransform(L.el, L.wasT);
          L.keep.forEach(function (el) { keepShape(el, 1); });
          L.mode = 'move';
        }
        setMove(L.el, to.a - L.from.a, L.css);
        return;
      }
      if (L.mode === 'move') clearMove(L.el);
      L.mode = 'size';
      setTransform(L.el, matrix(kk, L.from.a, to.a));
      L.keep.forEach(function (el) { keepShape(el, kk); });
    });
    base.pinned.forEach(function (P) {
      var L = P.layer; if (!L.to || !L.changed) return;
      if (Math.abs(L.k - 1) < 1e-9) {
        if (P.mode !== 'move') {
          var o = own(P.el); if (o) P.el.setAttribute('transform', o); else P.el.removeAttribute('transform');
          P.keep.forEach(function (el) { keepShape(el, 1); });
          P.css = cssOf(P.el); P.mode = 'move';
        }
        moveOnCard(P.el, L.to.a - L.from.a, P.css);
        return;
      }
      if (P.mode === 'move') dropFromCard(P.el);
      P.mode = 'size';
      P.el.setAttribute('transform', (matrix(L.k, L.from.a, L.to.a) + ' ' + own(P.el)).trim());
      P.keep.forEach(function (el) { keepShape(el, L.k); });
    });
    if (lift) paintFlat(k, t1);
    // splitter lines at their new places (moved: adding or removing elements here
    // would make the pinned header of an expanded view rebuild itself)
    var sg = base.splitters;
    if (sg) {
      var x = 0;
      for (var si = 0; si < panelCount - 1; si++) {
        x += panelWidths[si] + SPLITTER_WIDTH;
        var sx = x - SPLITTER_WIDTH;
        var hit = sg.querySelector('.svg-splitter-hit-area[data-index="' + si + '"]'), ln = sg.querySelector('.svg-splitter[data-index="' + si + '"]'), sym = sg.querySelector('.svg-splitter-symbol[data-index="' + si + '"]');
        if (hit) hit.setAttribute('x', sx - SPLITTER_HIT_WIDTH / 2);
        if (ln) { ln.setAttribute('x1', sx); ln.setAttribute('x2', sx); }
        if (sym) sym.setAttribute('x', sx);
      }
    }
    return true;
  }
  // everything back as it was drawn (before a real redraw, which then draws the rest)
  function reset() {
    dropParts();
    shieldDown();
    for (var li = 0; li < lifted.length; li++) dropFromCard(lifted[li]);
    lifted = [];
    for (var i = 0; i < touched.length; i++) {
      var el = touched[i], was = el.__liveWas;
      if (was === null || was === undefined) el.removeAttribute('transform'); else el.setAttribute('transform', was);
      el.removeAttribute('data-live-own'); el.__liveWas = undefined;
    }
    touched = [];
    for (var s2 = 0; s2 < stroked.length; s2++) stroked[s2].removeAttribute('vector-effect');
    stroked = [];
    if (base) {
      if (base.nodesOff) base.nodesOff.el.style.display = base.nodesOff.was;
      base.layers.forEach(function (L) { if (L.wasT === null) L.el.removeAttribute('transform'); else L.el.setAttribute('transform', L.wasT); });
      base.nodes.forEach(function (nd) { nd.d.y = nd.y0; if (nd.shown) nd.el.setAttribute('transform', 'translate(' + nd.y0 + ',' + nd.d.x + ')'); });
      base.labels.forEach(function (lb) { lb.el.setAttribute('x', lb.x0); });
      base.bands.forEach(function (bd) { bd.el.setAttribute('x', bd.x0); bd.el.setAttribute('width', bd.w0); });
      if (base.guide && typeof labelGuideCtx !== 'undefined' && labelGuideCtx === base.guide.ctx) {
        labelGuideCtx.items.forEach(function (it, i) { it[1] = base.guide.x1[i]; });
        labelGuideCtx.end = base.guide.end; labelGuideCtx.labelRight = base.guide.labelRight;
        if (base.guide.d !== null && labelGuideCtx.path) labelGuideCtx.path.setAttribute('d', base.guide.d);
      }
    }
    base = null;
  }

  window.tmDragLive = { capture: capture, frame: frame, reset: reset, ready: function () { return !!base; },
    active: function () { return !!base || !!lift || !!shield || touched.length > 0 || lifted.length > 0; },
    // a change made by moving the parts out and back (not a redraw)
    ownMutation: function (m) {
      var i;
      for (i = 0; i < m.addedNodes.length; i++) if (!ownNodes.has(m.addedNodes[i])) return false;
      for (i = 0; i < m.removedNodes.length; i++) if (!ownNodes.has(m.removedNodes[i])) return false;
      return m.addedNodes.length + m.removedNodes.length > 0;
    },
    canvasSame: function () { return canvasSame; },
    // for tests: what the drag is shown with
    info: function () {
      if (!lift) return null;
      return { layers: lift.layers.length, canvases: lift.runs.filter(function (r) { return r.kind === 'flat'; }).length,
        flatShapes: lift.runs.reduce(function (s, r) { return s + (r.kind === 'flat' ? r.prims.length : 0); }, 0), prepMs: lift.prepMs, svgPrepMs: base && base.svgPrepMs, prepared: lift.prepared, canvasSame: canvasSame };
    } };
})();
