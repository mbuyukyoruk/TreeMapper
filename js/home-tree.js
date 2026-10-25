// The home page figure (loaded before js/home.js): the reverse transcriptase example as
// TreeMapper draws it (js/home-figure.js), painted on a canvas.
//   var f = tmHomeTree.create(data)
//   f.paint(ctx, { cx, cy, radius, dpr, theme, open, mask, only, pulse, pulseAlpha, rings })
//   var gl = f.ringsGL(canvas); gl.draw({ theme, open, mask })   (the rings on the GPU; null without WebGL)
// open: the circle's opening in degrees (0 closed, data.open as in the example), applied the way
//   TreeMapper does it: a tip at angle a (no opening) goes to open + a * (1 - open / 360 deg); the
//   axes and titles TreeMapper draws in the opening come in as it opens.
// mask: how far out the rings are shown (in units of the outer radius): the rings appear from the
//   inside out behind a soft edge (feather wide), so the edge where a ring grows is never seen.
// The rings and the branches are painted into bitmaps once per size, theme and opening; a frame
// places those, masks the rings and adds the pulses of light: short bright trails running from
// the root to the tips along the real branches, in each family's colour. Where the pulses are is
// given by `pulse` (the page's scroll position), so the drawing is still when the page is.
(function () {
  'use strict';
  var TAU = Math.PI * 2;

  function create(F) {
    var L = F.links, A = F.arcs, nL = L.length / 6, nA = A.length / 6;
    var OPEN = (F.open || 0) * Math.PI / 180, FEATHER = 0.06, GAP_TEXT = 0.78;
    var ang = function (v) { return v / 1e4; }, rad = function (v) { return v / 1e4; };
    // the angle of a point with the circle opened by `op` (radians)
    var opened = function (a, op) { return op + a * (1 - op / TAU); };
    // ---- topology from coordinates: a link's parent is the link ending where it starts
    var key = function (a, r) { return a + ':' + r; };
    var endAt = new Map();
    for (var i = 0; i < nL; i++) endAt.set(key(L[i * 6 + 2], L[i * 6 + 3]), i);
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
    // ---- the pulse routes: root -> tip as polylines of (angle with no opening, radius) samples
    var tips = []; for (i = 0; i < nL; i++) if (isTip[i] && famOf(L[i * 6 + 4]) >= 0) tips.push(i);
    // tips spread round the circle (every k-th by angle), so pulses cover every family
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
      var cum = [0];
      for (var q = 1; q < pts.length; q++) {
        var x0 = pts[q - 1][1] * Math.sin(pts[q - 1][0]), y0 = -pts[q - 1][1] * Math.cos(pts[q - 1][0]);
        var x1 = pts[q][1] * Math.sin(pts[q][0]), y1 = -pts[q][1] * Math.cos(pts[q][0]);
        len += Math.hypot(x1 - x0, y1 - y0); cum.push(len);
      }
      routes.push({ pts: pts, cum: cum, len: len, fam: famOf(L[t * 6 + 4]), phase: (k * 0.618034) % 1 });
    }

    // ---- bitmaps: the rings (with the opening's axes and titles) and the branches
    function bitmap(px) { var c = document.createElement('canvas'); c.width = c.height = px; return c; }
    function paintRings(h, R, pal, op) {
      var byA = new Map();
      for (var i = 0; i < nA; i++) { var cj = A[i * 6 + 4]; if (!byA.has(cj)) byA.set(cj, []); byA.get(cj).push(i); }
      byA.forEach(function (list, cj) {
        h.beginPath();
        list.forEach(function (i) {
          var a0 = opened(ang(A[i * 6]), op) - Math.PI / 2, a1 = opened(ang(A[i * 6 + 1]), op) - Math.PI / 2, r0 = rad(A[i * 6 + 2]) * R, r1 = rad(A[i * 6 + 3]) * R;
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
    }
    // what TreeMapper draws in the opening (its axes, their numbers and titles, the heatmaps' titles)
    function paintGap(h, R, theme, alpha) {
      var G = (F.gap && (F.gap[theme] || F.gap.light)) || [];
      if (!G.length || alpha <= 0.01) return;
      var fam = getComputedStyle(document.documentElement).getPropertyValue('--pro-font').trim() || 'system-ui, sans-serif';
      h.save(); h.globalAlpha = alpha; h.lineCap = 'butt';
      G.forEach(function (g) {
        if (g[0] === 'l') {
          h.beginPath(); h.moveTo(g[1] * R, g[2] * R); h.lineTo(g[3] * R, g[4] * R);
          h.strokeStyle = g[5]; h.lineWidth = Math.max(0.5, g[6] * R); h.globalAlpha = alpha * (g[7] === undefined ? 1 : g[7]); h.stroke();
          return;
        }
        // ['t', text, x, y, size, weight, colour, anchor, baseline, a, b, c, d, e, f, opacity]
        h.save();
        h.transform(g[9], g[10], g[11], g[12], g[13] * R, g[14] * R);
        h.globalAlpha = alpha * (g[15] === undefined ? 1 : g[15]);
        // (smaller and lighter than in the workspace: on the page they stood out from the figure)
        h.font = (+g[5] >= 700 ? 600 : g[5]) + ' ' + (g[4] * R * GAP_TEXT).toFixed(2) + 'px ' + fam;
        h.fillStyle = g[6];
        h.textAlign = g[7] === 'middle' ? 'center' : g[7] === 'end' ? 'right' : 'left';
        h.textBaseline = /middle|central/.test(g[8]) ? 'middle' : /hanging/.test(g[8]) ? 'hanging' : 'alphabetic';
        h.fillText(g[1], g[2] * R, g[3] * R);
        h.restore();
      });
      h.restore();
    }
    // the tree's scale bar, in the figure's bottom-right corner (outside the rings), as the
    // workspace draws its short bar: the value over a bar with end ticks, the title under it.
    // Drawn on its own at every frame, at full strength: not with the opening's axes (which fade
    // with the opening) and not behind the rings' mask, so it is always there.
    function paintScale(h, R, theme) {
      var S = F.scale; if (!S || !(S.len > 0)) return;
      var G = (F.gap && (F.gap[theme] || F.gap.light)) || [];
      var fam = getComputedStyle(document.documentElement).getPropertyValue('--pro-font').trim() || 'system-ui, sans-serif';
      h.save();
      // the tree's scale bar, in the figure's bottom-right corner (outside the rings), as the
      // workspace draws its short bar: the value over a bar with end ticks, the title under it
      {
        var col = (G.filter(function (g) { return g[0] === 'l'; })[0] || [])[5] || (theme === 'dark' ? '#b9c4cc' : '#3a4650');
        var fs = 12 / ((F.R && F.R.outer) || 392) * R * GAP_TEXT, y = 0.84 * R, tk = fs * 0.35;
        h.font = '500 ' + fs.toFixed(2) + 'px ' + fam;
        var half = Math.max(S.len * R, S.title ? h.measureText(S.title).width : 0) / 2, mid = 0.92 * R - half;
        var x0 = mid - S.len * R / 2, x1 = mid + S.len * R / 2;
        h.globalAlpha = 1; h.strokeStyle = col; h.fillStyle = col; h.lineWidth = Math.max(1, fs * 0.14);
        h.beginPath(); h.moveTo(x0, y); h.lineTo(x1, y); h.moveTo(x0, y - tk); h.lineTo(x0, y + tk); h.moveTo(x1, y - tk); h.lineTo(x1, y + tk); h.stroke();
        h.textAlign = 'center'; h.textBaseline = 'alphabetic'; h.font = '600 ' + fs.toFixed(2) + 'px ' + fam;
        h.fillText(S.value.toFixed(2), (x0 + x1) / 2, y - tk - fs * 0.35);
        if (S.title) { h.textBaseline = 'hanging'; h.font = '500 ' + fs.toFixed(2) + 'px ' + fam; h.fillText(S.title, (x0 + x1) / 2, y + tk + fs * 0.35); }
      }
      h.restore();
    }
    function paintTree(g, R, px, pal, op) {
      var by = new Map();
      for (var i = 0; i < nL; i++) { var ci = L[i * 6 + 4]; if (!by.has(ci)) by.set(ci, []); by.get(ci).push(i); }
      g.lineCap = 'round'; g.lineWidth = Math.max(1, px / 900);
      by.forEach(function (list, ci) {
        g.beginPath();
        list.forEach(function (i) {
          var pa = opened(ang(L[i * 6]), op) - Math.PI / 2, pr = rad(L[i * 6 + 1]) * R, ca = opened(ang(L[i * 6 + 2]), op) - Math.PI / 2, cr = rad(L[i * 6 + 3]) * R;
          g.moveTo(pr * Math.cos(pa), pr * Math.sin(pa));
          if (pr > 0 && Math.abs(ca - pa) > 1e-6) g.arc(0, 0, pr, pa, ca, ca < pa);
          g.lineTo(cr * Math.cos(ca), cr * Math.sin(ca));
        });
        g.strokeStyle = pal[ci]; g.stroke();
      });
    }
    // the opening's axes and titles show as the circle opens (from about two thirds of the way)
    var gapAlpha = function (op) { if (!OPEN) return 0; var u = (op / OPEN - 0.62) / 0.38; u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
    // the bitmaps: the rings and the branches for an opening (to a twentieth of a degree: finer
    // steps are not seen), the opening's axes and titles once per size and theme
    var cache = { size: 0, theme: '', ringsKey: '', treeKey: '', rings: null, tree: null, gap: null };
    // (the branches' bitmap covers the tree's disc only: a fraction of the pixels to clear and place)
    var TPF = 0.02; for (var li = 0; li < nL; li++) TPF = Math.max(TPF, rad(L[li * 6 + 3]) + 0.02); TPF = Math.min(1, TPF);
    function ensure(px, theme, op, withRings) {
      px = Math.max(64, Math.min(4096, Math.round(px)));
      var opk = Math.round(op * 180 / Math.PI * 20) / 20, o = opk * Math.PI / 180;
      if (!(cache.tree && cache.theme === theme && Math.abs(cache.size - px) / px < 0.04)) {
        cache = { size: px, theme: theme, ringsKey: '', treeKey: '', rings: null, tree: bitmap(Math.ceil(px * TPF)), gap: bitmap(px) };
        var gg = cache.gap.getContext('2d'); gg.translate(px / 2, px / 2); paintGap(gg, px / 2, theme, 1);
      }
      var size = cache.size, R = size / 2, pal = F.pal[theme] || F.pal.light;
      if (cache.treeKey !== String(opk)) {
        var tw = cache.tree.width, g = cache.tree.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, tw, tw); g.translate(tw / 2, tw / 2);
        paintTree(g, R, size, pal, o); cache.treeKey = String(opk);
      }
      if (withRings && cache.ringsKey !== String(opk)) {
        if (!cache.rings) cache.rings = bitmap(size);
        var h = cache.rings.getContext('2d'); h.setTransform(1, 0, 0, 1, 0, 0); h.clearRect(0, 0, size, size); h.translate(R, R);
        paintRings(h, R, pal, o); cache.ringsKey = String(opk);
      }
      return o;
    }

    // ---- the rings on the GPU (WebGL), when it is there: painted once, unrolled (angle across,
    // radius down), and wrapped round the circle by a small shader at every frame with the
    // opening and the mask applied per pixel. Drawing the 5,400 ring cells again for each step of
    // the opening took most of a frame; this takes a fraction of a millisecond.
    var RMIN = 1, PAD = 0.02;
    for (i = 0; i < nA; i++) RMIN = Math.min(RMIN, rad(A[i * 6 + 2]));
    RMIN = Math.max(0, RMIN - 0.004);
    function ringsGL(canvas) {
      var gl = null;
      try { gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false }); } catch (e) {}
      if (!gl) return null;
      var vs = 'attribute vec2 p; varying vec2 uv; void main() { uv = p; gl_Position = vec4(p.x, -p.y, 0.0, 1.0); }';
      var fs = 'precision highp float; varying vec2 uv; uniform sampler2D tex; uniform float op, rmin, pad, mask, feather, px;\n' +
        'const float TAU = 6.28318530718;\n' +
        'void main() {\n' +
        '  float r = length(uv); if (r > 1.0 + 1.0 / px || r < rmin) discard;\n' +
        '  float a = atan(uv.x, -uv.y); if (a < 0.0) a += TAU;\n' +
        '  float a0 = (a - op) / (1.0 - op / TAU);\n' +
        '  float u = (a0 + pad) / (TAU + 2.0 * pad); if (u < 0.0 || u > 1.0) discard;\n' +
        '  vec4 c = texture2D(tex, vec2(u, (r - rmin) / (1.0 - rmin)));\n' +
        // (the same soft edge as the 2D mask: opaque to mask - feather, then an ease-out falloff)
        '  float t = clamp((r - (mask - feather)) / feather, 0.0, 1.0);\n' +
        '  float m = t <= 0.35 ? mix(1.0, 0.55, t / 0.35) : t <= 0.7 ? mix(0.55, 0.16, (t - 0.35) / 0.35) : mix(0.16, 0.0, (t - 0.7) / 0.3);\n' +
        '  gl_FragColor = c * m;\n' +
        '}';
      var sh = function (type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      var prog;
      try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null; } catch (e) { return null; }
      gl.useProgram(prog);
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      var U = {}; ['op', 'rmin', 'pad', 'mask', 'feather', 'px', 'tex'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      var tex = gl.createTexture(), texKey = '';
      var maxT = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
      // the rings unrolled: one rectangle per cell (an angle range across, a radius range down)
      function texture(theme, devR) {
        var W = maxT, H = Math.max(64, Math.min(maxT, Math.ceil((1 - RMIN) * devR * 1.5)));
        var key = theme + ':' + H; if (key === texKey) return; texKey = key;
        var c = bitmap(1); c.width = W; c.height = H;
        var g = c.getContext('2d'), pal = F.pal[theme] || F.pal.light, span = TAU + 2 * PAD;
        var byA = new Map();
        for (var i = 0; i < nA; i++) { var cj = A[i * 6 + 4]; if (!byA.has(cj)) byA.set(cj, []); byA.get(cj).push(i); }
        byA.forEach(function (list, cj) {
          g.beginPath();
          list.forEach(function (i) {
            var a0 = ang(A[i * 6]), a1 = ang(A[i * 6 + 1]); if (a1 < a0 - Math.PI) a1 += TAU;
            var x0 = (a0 + PAD) / span * W, x1 = (a1 + PAD) / span * W;
            var y0 = (rad(A[i * 6 + 2]) - RMIN) / (1 - RMIN) * H, y1 = (rad(A[i * 6 + 3]) - RMIN) / (1 - RMIN) * H;
            // (a hair wider than the cell, so neighbouring cells meet without seams)
            g.rect(x0 - 0.25, y0, Math.max(0.5, x1 - x0 + 0.5), y1 - y0);
          });
          g.fillStyle = pal[cj]; g.fill();
        });
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      return {
        // o: { theme, open (degrees), mask } at the canvas's own size
        draw: function (o) {
          var w = canvas.width; if (!w) return;
          texture(o.theme === 'dark' ? 'dark' : 'light', w / 2);
          gl.viewport(0, 0, w, canvas.height);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          var op = Math.max(0, Math.min(OPEN, (o.open === undefined ? F.open : o.open) * Math.PI / 180));
          gl.uniform1f(U.op, op); gl.uniform1f(U.rmin, RMIN); gl.uniform1f(U.pad, PAD);
          gl.uniform1f(U.mask, o.mask === undefined ? 2 : o.mask); gl.uniform1f(U.feather, FEATHER); gl.uniform1f(U.px, w / 2);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.tex, 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        },
        lost: function () { return gl.isContextLost(); }
      };
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
    // o: { cx, cy, radius (css px), dpr, theme, open (degrees), mask (outer-radius units),
    //      pulse (any number; 1 = once along), pulseAlpha (0..1),
    //      only: 'static' (the figure without pulses) or 'pulses' (the pulses alone) }
    function paint(ctx, o) {
      var dpr = o.dpr || 1, R = o.radius, theme = o.theme === 'dark' ? 'dark' : 'light';
      var op = Math.max(0, Math.min(OPEN, (o.open === undefined ? F.open : o.open) * Math.PI / 180));
      ctx.save();
      ctx.translate(o.cx, o.cy);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      if (o.only !== 'pulses') {
        // the rings (unless they are drawn on the GPU underneath) and the opening's axes and
        // titles behind their soft-edged mask, then the branches over them
        var withRings = o.rings !== false;
        ensure(2 * R * dpr, theme, op, withRings);
        var m = o.mask === undefined ? 2 : o.mask, ga = gapAlpha(op);
        if (withRings) ctx.drawImage(cache.rings, -R, -R, 2 * R, 2 * R);
        if (ga > 0.01) { ctx.globalAlpha = ga; ctx.drawImage(cache.gap, -R, -R, 2 * R, 2 * R); ctx.globalAlpha = 1; }
        if (m < 1 + FEATHER && (withRings || ga > 0.01)) {
          // (the whole figure when the rings are drawn here; else only the opening's corner, where
          // the axes and titles are)
          var box = withRings ? [-R - 2, -R - 2, 2 * R + 4, 2 * R + 4] : [-2, -R - 2, R * 0.6, R + 4];
          var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, m * R));
          var a = Math.max(0, (m - FEATHER) / Math.max(m, 1e-6));
          gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(a, 'rgba(0,0,0,1)');
          // (an ease-out falloff: no hard line where the rings end)
          gr.addColorStop(a + (1 - a) * 0.35, 'rgba(0,0,0,.55)'); gr.addColorStop(a + (1 - a) * 0.7, 'rgba(0,0,0,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalCompositeOperation = 'destination-in';
          ctx.fillStyle = gr; ctx.fillRect(box[0], box[1], box[2], box[3]);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.drawImage(cache.tree, -R * TPF, -R * TPF, 2 * R * TPF, 2 * R * TPF);
        paintScale(ctx, R, theme);
      }
      var pa = o.only === 'static' ? 0 : (o.pulseAlpha === undefined ? 1 : o.pulseAlpha);
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
          ctx.globalAlpha = pa * fade;
          ctx.beginPath();
          var N = 10;
          for (var s = 0; s <= N; s++) {
            var pp = at(rt, d - trail + trail * s / N), aa = opened(pp[0], op), x = pp[1] * R * Math.sin(aa), y = -pp[1] * R * Math.cos(aa);
            if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          // on a light page the trail is a deeper shade of the family colour, so it reads over the branches
          ctx.strokeStyle = dark ? col : shade(col, 0.62); ctx.lineWidth = Math.max(dark ? 1.5 : 2, R / (dark ? 260 : 220)); ctx.stroke();
          var hp = at(rt, d), ha = opened(hp[0], op), hx = hp[1] * R * Math.sin(ha), hy = -hp[1] * R * Math.cos(ha);
          ctx.drawImage(glow(col, dark), hx - head, hy - head, head * 2, head * 2);
        });
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
    // the rings shown at the start: the innermost one, and the next growing behind the soft edge
    var data = F.rings.filter(function (r) { return r.type !== 'tree' && r.type !== 'labels'; });
    var firstRings = data[0] ? data[0].outer : 1;
    return { paint: paint, ringsGL: ringsGL, rings: F.rings, gapText: GAP_TEXT, routes: routes.length, open: F.open || 0, feather: FEATHER,
      maskStart: firstRings + FEATHER, maskEnd: 1 + FEATHER };
  }
  window.tmHomeTree = { create: create };
})();
