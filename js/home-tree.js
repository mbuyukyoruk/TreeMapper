// The home page figure (loaded before js/home.js): the reverse transcriptase example as
// TreeMapper draws it (js/home-figure.js), painted on a canvas.
//   var f = tmHomeTree.create(data)
//   f.paint(ctx, { cx, cy, radius, rotation, theme, pulse, pulseAlpha, alpha, rings })
// The branches and the rings are painted once per size and theme into bitmaps; a frame turns
// and places those bitmaps and adds the pulses of light: short bright trails running from the
// root to the tips along the real branches, in each family's colour. Where the pulses are is
// given by `pulse` (the page's scroll position), so the drawing is still when the page is.
(function () {
  'use strict';
  var TAU = Math.PI * 2;

  function create(F) {
    var L = F.links, A = F.arcs, nL = L.length / 6, nA = A.length / 6;
    var ang = function (v) { return v / 1e4; }, rad = function (v) { return v / 1e4; };
    // ---- topology from coordinates: a link's parent is the link ending where it starts
    var key = function (a, r) { return a + ':' + r; };
    var endAt = new Map();
    for (var i = 0; i < nL; i++) endAt.set(key(L[i * 6 + 2], L[i * 6 + 3]), i);
    // a link's parent: the link that ends at (parent angle, parent radius)
    var parentOf = new Int32Array(nL).fill(-1), isTip = new Uint8Array(nL);
    var hasChild = new Uint8Array(nL);
    for (i = 0; i < nL; i++) {
      var p = endAt.get(key(L[i * 6], L[i * 6 + 1]));
      if (p !== undefined && p !== i) { parentOf[i] = p; hasChild[p] = 1; }
    }
    for (i = 0; i < nL; i++) isTip[i] = hasChild[i] ? 0 : 1;
    // the five family colours (pulses run only along coloured branches)
    var famCol = F.families.map(function (f) { return f[1].toLowerCase(); });
    var famOf = function (ci) { return famCol.indexOf(String(F.pal.light[ci]).toLowerCase()); };
    // ---- the pulse routes: root -> tip as polylines (angle, radius) samples
    var tips = []; for (i = 0; i < nL; i++) if (isTip[i] && famOf(L[i * 6 + 4]) >= 0) tips.push(i);
    // pick tips spread round the circle (every k-th by angle), so pulses cover every family
    tips.sort(function (a, b) { return L[a * 6 + 2] - L[b * 6 + 2]; });
    var ROUTES = 64, step = tips.length / ROUTES, routes = [];
    for (var k = 0; k < ROUTES; k++) {
      var t = tips[Math.floor(k * step + (k * 7 % 5) * step / 5) % tips.length];
      var chain = []; for (var c = t; c >= 0; c = parentOf[c]) chain.push(c);
      chain.reverse();
      var pts = [], len = 0;
      chain.forEach(function (li) {
        var pa = ang(L[li * 6]), pr = rad(L[li * 6 + 1]), ca = ang(L[li * 6 + 2]), cr = rad(L[li * 6 + 3]);
        // the arc at the parent's radius, then the radial line out to the child
        var span = ca - pa, n = Math.max(1, Math.ceil(Math.abs(span) * pr * 60));
        for (var s = 0; s <= n; s++) pts.push([pa + span * s / n, pr]);
        pts.push([ca, cr]);
      });
      // cumulative length (in units of the outer radius)
      var cum = [0];
      for (var q = 1; q < pts.length; q++) {
        var x0 = pts[q - 1][1] * Math.sin(pts[q - 1][0]), y0 = -pts[q - 1][1] * Math.cos(pts[q - 1][0]);
        var x1 = pts[q][1] * Math.sin(pts[q][0]), y1 = -pts[q][1] * Math.cos(pts[q][0]);
        len += Math.hypot(x1 - x0, y1 - y0); cum.push(len);
      }
      routes.push({ pts: pts, cum: cum, len: len, fam: famOf(L[t * 6 + 4]), phase: (k * 0.618034) % 1 });
    }

    // ---- bitmaps
    var cache = { size: 0, theme: '', tree: null, rings: null };
    function bitmap(px) { var c = document.createElement('canvas'); c.width = c.height = px; return c; }
    function paintStatic(px, theme) {
      var pal = F.pal[theme] || F.pal.light, R = px / 2, tree = bitmap(px), rings = bitmap(px);
      var g = tree.getContext('2d'); g.translate(R, R);
      // branches, one path per colour
      var by = new Map();
      for (var i = 0; i < nL; i++) { var ci = L[i * 6 + 4]; if (!by.has(ci)) by.set(ci, []); by.get(ci).push(i); }
      g.lineCap = 'round'; g.lineWidth = Math.max(1, px / 900);
      by.forEach(function (list, ci) {
        g.beginPath();
        list.forEach(function (i) {
          var pa = ang(L[i * 6]) - Math.PI / 2, pr = rad(L[i * 6 + 1]) * R, ca = ang(L[i * 6 + 2]) - Math.PI / 2, cr = rad(L[i * 6 + 3]) * R;
          g.moveTo(pr * Math.cos(pa), pr * Math.sin(pa));
          if (pr > 0 && Math.abs(ca - pa) > 1e-6) g.arc(0, 0, pr, pa, ca, ca < pa);
          g.lineTo(cr * Math.cos(ca), cr * Math.sin(ca));
        });
        g.strokeStyle = pal[ci]; g.stroke();
      });
      // ring cells, one path per colour
      var h = rings.getContext('2d'); h.translate(R, R);
      var byA = new Map();
      for (i = 0; i < nA; i++) { var cj = A[i * 6 + 4]; if (!byA.has(cj)) byA.set(cj, []); byA.get(cj).push(i); }
      byA.forEach(function (list, cj) {
        h.beginPath();
        list.forEach(function (i) {
          var a0 = ang(A[i * 6]) - Math.PI / 2, a1 = ang(A[i * 6 + 1]) - Math.PI / 2, r0 = rad(A[i * 6 + 2]) * R, r1 = rad(A[i * 6 + 3]) * R;
          if (a1 < a0 - Math.PI) a1 += TAU;
          // a hair wider than the cell, so neighbouring cells meet without seams
          var e = 0.35 / Math.max(r1, 1);
          h.moveTo(r1 * Math.cos(a0 - e), r1 * Math.sin(a0 - e));
          h.arc(0, 0, r1, a0 - e, a1 + e, false);
          h.arc(0, 0, r0, a1 + e, a0 - e, true);
          h.closePath();
        });
        h.fillStyle = pal[cj]; h.fill();
      });
      cache = { size: px, theme: theme, tree: tree, rings: rings };
    }
    function ensure(px, theme) {
      px = Math.max(64, Math.min(4096, Math.round(px)));
      if (cache.tree && cache.theme === theme && Math.abs(cache.size - px) / px < 0.04) return;
      paintStatic(px, theme);
    }

    // a point on a route at distance d (in outer-radius units)
    function at(rt, d) {
      var cum = rt.cum, lo = 0, hi = cum.length - 1;
      if (d <= 0) return rt.pts[0]; if (d >= rt.len) return rt.pts[hi];
      while (lo < hi - 1) { var m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
      var f = (d - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]), a = rt.pts[lo], b = rt.pts[hi];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    var sprites = {};
    function shade(col, k) { var h = col.replace('#', ''); return '#' + [0, 2, 4].map(function (i) { return Math.round(parseInt(h.substr(i, 2), 16) * k).toString(16).padStart(2, '0'); }).join(''); }
    function glow(col, dark) {
      var k = col + dark; if (sprites[k]) return sprites[k];
      var h = col.replace('#', ''), rgb = [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }).join(',');
      var s = bitmap(64), g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      // a hot white core on a dark page; on a light page a solid core in the colour itself
      gr.addColorStop(0, dark ? 'rgba(255,255,255,.95)' : 'rgba(' + rgb + ',1)');
      gr.addColorStop(dark ? 0.22 : 0.16, 'rgba(' + rgb + ',' + (dark ? 0.9 : 0.85) + ')');
      gr.addColorStop(dark ? 0.5 : 0.4, 'rgba(' + rgb + ',' + (dark ? 0.35 : 0.22) + ')');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return (sprites[k] = s);
    }
    // o: { cx, cy, radius (css px), dpr, rotation (rad), theme, pulse (any number; 1 = once along),
    //      pulseAlpha (0..1), alpha (0..1), ringsAlpha (0..1), treeAlpha (0..1),
    //      only: 'static' (the figure without pulses) or 'pulses' (the pulses alone) }
    function paint(ctx, o) {
      var dpr = o.dpr || 1, R = o.radius, theme = o.theme === 'dark' ? 'dark' : 'light';
      if (o.only !== 'pulses') ensure(2 * R * dpr, theme);
      ctx.save();
      ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
      ctx.translate(o.cx, o.cy); ctx.rotate(o.rotation || 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      var ra = o.ringsAlpha === undefined ? 1 : o.ringsAlpha, ta = o.treeAlpha === undefined ? 1 : o.treeAlpha, base = ctx.globalAlpha;
      if (o.only === 'pulses') ra = 0;
      if (ra > 0) { ctx.globalAlpha = base * ra; ctx.drawImage(cache.rings, -R, -R, 2 * R, 2 * R); }
      if (ta > 0 && o.only !== 'pulses') { ctx.globalAlpha = base * ta; ctx.drawImage(cache.tree, -R, -R, 2 * R, 2 * R); }
      var pa = o.only === 'static' ? 0 : (o.pulseAlpha === undefined ? 1 : o.pulseAlpha) * ta;
      if (pa > 0.01) {
        var dark = theme === 'dark', trail = 0.16, head = Math.max(5, R * 0.03);
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
        ctx.lineCap = 'round';
        routes.forEach(function (rt) {
          var col = F.families[rt.fam][1];
          var u = ((o.pulse || 0) + rt.phase) % 1; if (u < 0) u += 1;
          // each pulse runs out over the first 80% of its cycle, then rests unseen at the tip
          var run = u / 0.8; if (run > 1) return;
          var d = run * (rt.len + trail), fade = Math.min(1, (1 - run) * 6);
          // near the root every route shares the same few branches: the pulses light up only
          // once they have spread out (from a tenth of the way to the tree's edge)
          var hr = at(rt, d)[1]; fade *= Math.max(0, Math.min(1, (hr - 0.05) / 0.09));
          if (fade <= 0.01) return;
          ctx.globalAlpha = base * pa * fade;
          // the trail
          ctx.beginPath();
          var N = 10;
          for (var s = 0; s <= N; s++) {
            var p = at(rt, d - trail + trail * s / N), x = p[1] * R * Math.sin(p[0]), y = -p[1] * R * Math.cos(p[0]);
            if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          // on a light page the trail is a deeper shade of the family colour, so it reads over the branches
          ctx.strokeStyle = dark ? col : shade(col, 0.62); ctx.lineWidth = Math.max(dark ? 1.5 : 2, R / (dark ? 260 : 220)); ctx.stroke();
          var hp = at(rt, d), hx = hp[1] * R * Math.sin(hp[0]), hy = -hp[1] * R * Math.cos(hp[0]);
          ctx.drawImage(glow(col, dark), hx - head, hy - head, head * 2, head * 2);
        });
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
    return { paint: paint, ensure: ensure, rings: F.rings, routes: routes.length };
  }
  window.tmHomeTree = { create: create };
})();
