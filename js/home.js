// The home page (loaded right after its markup in index.html, before the workspace's scripts;
// js/home-figure.js and js/home-tree.js first). A page of its own: html.tm-home is set in the
// <head>, so the workspace is never seen before the home page.
//   - The reverse transcriptase figure (the RT example as TreeMapper draws it) sits in a fixed
//     layer. In a window of 1180 x 640 px or more the page does not move as it is scrolled: the
//     headline and launcher become smaller and move up, the figure rises from the bottom of the
//     window into the space under them, opens by the example's 20 degrees (its axes and titles
//     coming into the opening), grows its rings from the inside out behind a soft mask and runs
//     pulses of light from the root to the tips, and the examples and recent sessions come in
//     from below beside it. All of it follows the scroll position, so it is still when the page
//     is. Smaller windows have the same parts in the page's flow. Behind the page a slow light
//     drifts and sparks run along faint traces all the time.
//   - Ways in: open or drop a tree or session, generate a tree, open from a URL, paste data,
//     the examples, recent sessions (js/recent.js), an empty workspace.
//   - Opening anything plays one transition (about 0.75 s) that fits what is opened: the RT
//     example's figure flies to where the drawing sits in the workspace; the mock example's
//     picture grows from its card into the canvas; anything else (a file, a recent session, an
//     address, pasted data, a generated tree) leaves the page and shows one loading ring in the
//     canvas. Meanwhile the page slides away and the workspace's panels come in from their edges.
//     Then whatever flew crossfades into the real drawing (waiting with a slow pulse if the
//     session is not ready). No other loading screen, status messages or notices.
//   - Opening a tree or a session from inside the workspace shows the same one loading state.
//   - The workspace's Home button asks first, then plays the way back: the session's drawing and
//     the panels go first, then the page comes back with the figure settling where it rests.
//     Reduced motion: plain crossfades.
//   - The viewer's theme is never changed by opening anything; switching it plays a short
//     transition (a circle of the new theme opening from the switch).
// window.tmHome: { open(exampleId), show(), state(), figure(), examples, layout() }.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var html = document.documentElement, page = $('tmHome');
  if (!page) return;
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ICON = function (d, size, sw) { return '<svg class="pro-ico" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var I = { x: '<path d="M6 6l12 12M18 6 6 18"/>' };
  var reduced = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var theme = function () { return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; };
  var EASE = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };   // ease-in-out (as the CSS curve)
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var smooth = function (a, b, v) { var u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  var DUR0 = 760;
  // --th-slow on <html> (a number) slows the transition down, for checking it frame by frame
  var slow = function () { var v = parseFloat(getComputedStyle(html).getPropertyValue('--th-slow')); return v > 0 ? v : 1; };
  var WIDE = window.matchMedia ? matchMedia('(min-width: 1180px) and (min-height: 640px)') : { matches: true };
  var view = $('thView');

  // ------------------------------------------------------------------ the page's state
  // 'home' -> 'opening' (flying / waiting) -> 'app' -> 'closing' -> 'home'
  var state = 'home';
  function isHome() { return state === 'home'; }

  // ------------------------------------------------------------------ the figure
  var figEl = $('thFigure'), cStatic = $('thFigStatic'), cPulse = $('thFigPulse'), cRings = $('thFigRings');
  var FIG = window.TM_HOME_FIGURE;
  var fig = FIG && window.tmHomeTree ? tmHomeTree.create(FIG) : null;
  // the rings on the GPU where there is WebGL (opening and growing them every frame), else with the rest
  var ringsGL = null;
  try { ringsGL = fig && cRings ? fig.ringsGL(cRings) : null; } catch (e) { ringsGL = null; }
  if (!ringsGL && cRings) cRings.hidden = true;
  var OPEN = fig ? fig.open : 0;
  // how far out the figure reads as drawn for a mask (its soft edge is mostly transparent)
  var VISIBLE = fig ? fig.feather * 0.4 : 0;
  var RP = 0, paintedDpr = 0;
  var PF = FIG ? Math.min(1, (FIG.rings[0].outer + 0.04)) : 1;   // the tree's share of the figure, and a margin for the glow
  var cur = { cx: 0, cy: 0, r: 100, rot: 0, open: OPEN, mask: 2 };   // where the figure is (window px) and how it is drawn
  function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
  function sizeFigure(R) {
    if (!fig) return;
    R = Math.ceil(R);
    if (R === RP && paintedDpr === dpr()) return;
    RP = R; paintedDpr = dpr();
    var S = 2 * R, d = dpr();
    figEl.style.width = S + 'px'; figEl.style.height = S + 'px';
    cStatic.width = cStatic.height = Math.round(S * d);
    if (ringsGL) cRings.width = cRings.height = Math.round(S * d);
    // the pulses run only along the tree's branches (within PF of the figure's radius): their
    // canvas covers that disc alone, so a scroll frame clears and paints a fraction of the pixels
    var P = Math.ceil(S * PF);
    cPulse.width = cPulse.height = Math.round(P * d);
    cPulse.style.width = cPulse.style.height = P + 'px'; cPulse.style.left = cPulse.style.top = ((S - P) / 2) + 'px';
    lastDraw = lastPulse = null;
  }
  // the figure as drawn now: its opening and how far out its rings are shown
  var lastDraw = null;
  function drawFigure(open, mask) {
    if (!fig || !RP) return;
    var k = open.toFixed(2) + ':' + mask.toFixed(4) + ':' + RP + theme() + dpr();
    if (k === lastDraw) return; lastDraw = k;
    // (the plate or glow under the figure reaches only as far as the rings shown, so the place
    // where the outer rings will grow is not outlined before they do)
    figEl.style.setProperty('--th-plate', Math.min(1, mask).toFixed(4));
    if (ringsGL && ringsGL.lost()) { ringsGL = null; cRings.hidden = true; }
    var d = dpr(), g = cStatic.getContext('2d');
    if (ringsGL) ringsGL.draw({ theme: theme(), open: open, mask: mask });
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, 2 * RP, 2 * RP);
    fig.paint(g, { cx: RP, cy: RP, radius: RP, dpr: d, theme: theme(), only: 'static', open: open, mask: mask, rings: !ringsGL });
  }
  var lastPulse = null;
  function paintPulses(phase, alpha, open) {
    if (!fig || !RP) return;
    var key = phase.toFixed(4) + ':' + alpha.toFixed(2) + ':' + open.toFixed(2) + ':' + RP + theme();
    if (key === lastPulse) return; lastPulse = key;
    var P = Math.ceil(2 * RP * PF), d = dpr(), g = cPulse.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, P, P);
    if (alpha > 0.01) fig.paint(g, { cx: P / 2, cy: P / 2, radius: RP, dpr: d, theme: theme(), only: 'pulses', pulse: phase, pulseAlpha: alpha, open: open });
  }
  function tf(s) { return 'translate(' + s.cx.toFixed(2) + 'px,' + s.cy.toFixed(2) + 'px) rotate(' + s.rot.toFixed(4) + 'rad) scale(' + (s.r / RP).toFixed(5) + ') translate(' + (-RP) + 'px,' + (-RP) + 'px)'; }
  function place(s) {
    cur = { cx: s.cx, cy: s.cy, r: s.r, rot: s.rot, open: s.open === undefined ? cur.open : s.open, mask: s.mask === undefined ? cur.mask : s.mask };
    if (!RP) return;
    figEl.style.transform = tf(cur);
  }
  // the figure's flights run as Web Animations of its transform, on the compositor: they stay
  // smooth while the main thread is busy reading and drawing the session
  var flying = null;
  function fly(to, ms, done) {
    if (flying) {   // a flight in progress: the new one starts where the figure is now
      var f = flying, p = clamp((performance.now() - f.t0) / f.ms, 0, 1), e = EASE(p);
      cur = { cx: lerp(f.from.cx, f.end.cx, e), cy: lerp(f.from.cy, f.end.cy, e), r: lerp(f.from.r, f.end.r, e), rot: lerp(f.from.rot, f.end.rot, e), open: cur.open, mask: cur.mask };
      f.onfinish = null; f.cancel(); flying = null;
    }
    var from = { cx: cur.cx, cy: cur.cy, r: cur.r, rot: cur.rot }, rot0 = from.rot, rot1 = to.rot;
    while (rot1 - rot0 > Math.PI) rot1 -= 2 * Math.PI; while (rot0 - rot1 > Math.PI) rot1 += 2 * Math.PI;
    var end = { cx: to.cx, cy: to.cy, r: to.r, rot: rot1 };
    if (!figEl.animate || ms <= 0) { place(end); if (done) done(); return; }
    var a = figEl.animate([{ transform: tf(from) }, { transform: tf(end) }], { duration: ms, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
    a.from = from; a.end = end; a.t0 = performance.now(); a.ms = ms;
    flying = a; place(end);
    a.onfinish = function () { if (flying !== a) return; flying = null; a.cancel(); if (done) done(); };
  }
  function fade(el, to, ms, delay) {
    if (!el.animate) { el.style.opacity = String(to); return; }
    var from = getComputedStyle(el).opacity;
    el.style.opacity = String(to);
    el.animate([{ opacity: from }, { opacity: to }], { duration: ms, delay: delay || 0, easing: 'ease-in-out', fill: 'backwards' });
  }
  // the figure's drawing eased to the example's own (opened, every ring): before the session is
  // read, so it lands looking as the workspace will draw it
  function settleDrawing(ms) {
    var o0 = cur.open, m0 = cur.mask, m1 = fig ? fig.maskEnd : 2, t0 = performance.now();
    if (o0 === OPEN && m0 >= m1) return;
    (function step() {
      var u = clamp((performance.now() - t0) / ms, 0, 1), e = EASE(u);
      cur.open = lerp(o0, OPEN, e); cur.mask = lerp(m0, m1, e);
      drawFigure(cur.open, cur.mask);
      if (u < 1) requestAnimationFrame(step);
    })();
  }

  // ------------------------------------------------------------------ the layout and the scroll
  // (measured from layout boxes, which transforms do not change, and the window without its
  // scroll bar: the same numbers before, during and after a transition, so the figure lands
  // exactly where it rests)
  var hero = { eyebrow: $('thEyebrow'), title: $('thTitle'), lead: $('thLead'), group: $('thLaunchGroup') };
  var colL = $('thExamples'), colR = $('thRight'), cols = colL.parentNode;
  var M = null;
  function vw() { return document.documentElement.clientWidth || window.innerWidth; }
  function vh() { return window.innerHeight; }
  function textWidth(el) { var w = 0; Array.prototype.forEach.call(el.children, function (c) { if (c.offsetWidth) w = Math.max(w, c.offsetWidth); }); return w || el.offsetWidth; }
  function waysWidth() { var k = $('thWays').children, a = 1e9, b = -1e9; Array.prototype.forEach.call(k, function (c) { if (!c.offsetWidth) return; a = Math.min(a, c.offsetLeft); b = Math.max(b, c.offsetLeft + c.offsetWidth); }); return b > a ? b - a : 0; }
  function topIn(el) { var t = 0; while (el && el !== view && el !== document.body) { t += el.offsetTop; el = el.offsetParent; } return t; }
  function measure() {
    var W = vw(), H = vh(), wide = WIDE.matches;
    // (the columns' own place and width first, as the stylesheet has them)
    [colL, colR].forEach(function (c) { c.style.left = c.style.right = c.style.width = c.style.height = ''; });
    if (wide) {
      var D = Math.round(H * 0.75);
      var lw = colL.offsetWidth, lx = colL.offsetLeft, rx = colR.offsetLeft;   // (absolute in the view)
      var colTop = colL.offsetTop;
      var avail = rx - (lx + lw) - 2 * 24;
      var tTop = topIn(hero.title), tH = hero.title.offsetHeight, tW = textWidth(hero.title);
      var gTop = topIn(hero.group), gH = hero.group.offsetHeight, gW = Math.max($('thDrop').offsetWidth, waysWidth());
      var sT = Math.min(0.6, avail / tW), sG = Math.min(0.9, avail / gW);
      var tTop1 = 70, gTop1 = tTop1 + tH * sT + 14, gBot1 = gTop1 + gH * sG;
      // the figure: under the launcher at the top of the page (rising like a dome from the bottom
      // of the window, a little larger than the room under the launcher), between the two columns
      // and under the smaller launcher at the end
      // (at the start: centred on the window's bottom edge, so its top half shows under the
      // launcher, the rings shown at first reaching up to the launcher)
      var top0 = gTop + gH + 24;
      var shown0 = fig ? clamp(fig.maskStart - VISIBLE, 0.3, 1) : 1;
      // (four fifths of the room up to the launcher: the owner, round 6)
      var r0 = clamp(0.8 * (H - top0) / shown0, 240, W * 0.4);
      var top1 = gBot1 + 16, room = H - 14 - top1;
      var r1 = Math.max(160, Math.min(room / 2, avail / 2));
      // the columns at the end beside the figure, a gutter from it, as wide as the room allows
      // (up to 460 px); the headline and launcher no wider than the space between them
      var G = 28, cssW = lw;
      var inner = 2 * r1 + 2 * G;
      sT = Math.min(sT, inner / tW); sG = Math.min(sG, inner / gW);
      gTop1 = tTop1 + tH * sT + 14; gBot1 = gTop1 + gH * sG;
      top1 = gBot1 + 16; room = H - 14 - top1;
      var c1 = top1 + Math.max(r1, room / 2);
      var pw = clamp((W - 2 * r1 - 2 * G - 2 * 28) / 2, cssW, 460);
      colL.style.width = colR.style.width = pw + 'px';
      colL.style.left = Math.max(16, W / 2 - r1 - G - pw) + 'px';
      colR.style.right = 'auto'; colR.style.left = Math.min(W - 16 - pw, W / 2 + r1 + G) + 'px';
      // the columns at the end: below the launcher where they fit, else as high as they need
      // (beside the headline), their middles near the figure's centre, within the window
      var place = function (h) { return Math.max(76, Math.min(H - 16 - h, Math.max(gBot1 + 14, c1 - h / 2))); };
      // (both columns start at one height, the higher of their own places: the RT card and the
      // mock example's card top-aligned; the recent sessions keep one height, a long list scrolls)
      var rp = $('thRecentPanel'); rp.style.height = '';
      // the recent sessions card ends where the RT card ends (its height set by the layout, not by
      // how many sessions there are: a longer list scrolls inside it); the footer line under it
      var hh = function (e) { return e.getBoundingClientRect().height; };
      var ft = colR.querySelector('.th-foot'), footH = ft ? hh(ft) + 8 : 0;
      var top2 = Math.min(place(hh(colL) + footH), place(hh(colR))), pL = top2, pR = top2;
      rp.style.height = Math.max(172, hh(rp) + hh(colL) - (hh(colR) - footH)) + 'px';
      // the areas beside the hero block (headline, launcher and the buttons under it) left free by
      // the columns: a note on each side spans the block's height (js/home.js edges())
      var hw = Math.max(tW * sT, gW * sG) / 2 + 28;
      var side = function (top, x0, x1) { return { x0: x0, x1: x1, y0: tTop1, y1: gBot1, free: top - 14 >= gBot1 }; };
      M = { wide: true, W: W, H: H, D: D, colTop: colTop, peek: -24, colL: pL, colR: pR,
        edges: [side(pL, 0, W / 2 - hw), side(pR, W, W / 2 + hw)],
        title: { dy: tTop1 - tTop, s: sT, top: tTop, h: tH }, group: { dy: gTop1 - gTop, s: sG },
        lead: { top: topIn(hero.lead), h: hero.lead.offsetHeight },
        a: { cx: W / 2, cy: H, r: r0, rot: 0.55, top: H - r0 * shown0 }, b: { cx: W / 2, cy: c1, r: r1, rot: 0, top: c1 - r1 } };
      $('thRun').style.height = (H + D) + 'px';
    } else {
      var slot = $('thSlot'), st = topIn(slot), sw = slot.offsetWidth;
      M = { wide: false, W: W, H: H, cx: slot.offsetLeft + sw / 2, docY: st + sw / 2, r: sw / 2 * 0.98, top: st };
      $('thRun').style.height = '';
    }
    return M;
  }
  // where everything is for a scroll position
  function homeState(sy) {
    if (!M) measure();
    var maskA = fig ? fig.maskStart : 2, maskB = fig ? fig.maskEnd : 2;
    if (M.wide) {
      // (the scroll is the motion's own pace: a gentle smoothstep, not a slow-starting curve)
      var p = clamp(sy / M.D, 0, 1), e = smooth(0, 1, p);
      // its top follows the launcher's bottom, so no gap opens between them
      // (by what is drawn of it: while the outer rings are still hidden, the rings shown so far
      // come up to the launcher, not the empty space where the outer rings will grow)
      var r = lerp(M.a.r, M.b.r, e), top = lerp(M.a.top, M.b.top, e);
      var mask = lerp(maskA, maskB, smooth(0.06, 0.9, p)), shown = clamp(mask - VISIBLE, 0, 1);
      return { p: p, e: e, cx: lerp(M.a.cx, M.b.cx, e), cy: top + r * shown, r: r, rot: lerp(M.a.rot, M.b.rot, e),
        open: OPEN * smooth(0.12, 0.78, p), mask: mask,
        // the pulses run while the page moves, and are out of sight at the top and the bottom
        pulse: p * 1.15, pa: clamp(Math.min(p / 0.08, (1 - p) / 0.08), 0, 1) };
    }
    // in the page's flow: by how far the figure's place has come into the window
    var q = clamp((sy - (M.top - M.H * 0.75)) / (M.H * 0.7), 0, 1);
    return { p: q, cx: M.cx, cy: M.docY - sy, r: M.r, rot: 0.4 * (1 - EASE(q)), open: OPEN * smooth(0.1, 0.8, q), mask: lerp(maskA, maskB, smooth(0.05, 0.9, q)), pulse: sy / 700, pa: clamp(sy / 60, 0, 1) * clamp((1 - q) / 0.1 + 0.3, 0, 1) };
  }
  // the hero's parts and the two columns at a scroll position (wide windows)
  function layoutAt(s) {
    if (!M || !M.wide) { [hero.eyebrow, hero.title, hero.lead, hero.group, colL, colR].forEach(function (el) { el.style.transform = ''; el.style.opacity = ''; }); return; }
    var e = s.e, p = s.p;
    var sT = lerp(1, M.title.s, e), sG = lerp(1, M.group.s, e);
    hero.title.style.transform = 'translateY(' + (M.title.dy * e).toFixed(2) + 'px) scale(' + sT.toFixed(4) + ')';
    hero.group.style.transform = 'translateY(' + (M.group.dy * e).toFixed(2) + 'px) scale(' + sG.toFixed(4) + ')';
    var u = smooth(0, 0.42, p);
    hero.eyebrow.style.transform = 'translateY(' + (-14 * u).toFixed(2) + 'px)'; hero.eyebrow.style.opacity = (1 - u).toFixed(3);
    // the lead goes as the headline shrinks over it, moving up with the headline's bottom
    var tBot = M.title.top + M.title.dy * e + M.title.h * sT, lead = smooth(0, 0.34, p);
    hero.lead.style.transform = 'translateY(' + (Math.min(0, tBot + 18 - M.lead.top)).toFixed(2) + 'px)'; hero.lead.style.opacity = (1 - lead).toFixed(3);
    hero.eyebrow.style.visibility = u > 0.98 ? 'hidden' : ''; hero.lead.style.visibility = lead > 0.98 ? 'hidden' : '';
    // the columns come in from below (out of sight below the window at the top of the page)
    var c = smooth(0.12, 1, p);
    colL.style.transform = 'translateY(' + ((M.colL - M.colTop) + (1 - c) * (M.H - M.peek - M.colL)).toFixed(2) + 'px)';
    colR.style.transform = 'translateY(' + ((M.colR - M.colTop) + (1 - c) * (M.H - M.peek - M.colR)).toFixed(2) + 'px)';
  }
  var raf = 0;
  function onScroll() { if (!raf && isHome()) raf = requestAnimationFrame(function () { raf = 0; frame(); }); }
  function figureSize() { return M.wide ? Math.max(M.a.r, M.b.r) : M.r; }
  function frame() {
    if (!isHome()) return;
    if (!M) measure();
    var s = homeState(window.scrollY || 0);
    sizeFigure(Math.max(figureSize(), 1));
    layoutAt(s);
    place(s); drawFigure(s.open, s.mask); paintPulses(s.pulse, s.pa, s.open);
    edges(s.p);
  }
  function relayout() { M = null; measure(); frame(); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { if (isHome()) relayout(); traces(); });
  if (WIDE.addEventListener) WIDE.addEventListener('change', function () { if (isHome()) relayout(); });
  new MutationObserver(function () { lastDraw = lastPulse = null; ringStrips(); traces(); if (isHome()) frame(); else if (state === 'opening' || state === 'closing') drawFigure(cur.open, cur.mask); }).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (isHome()) relayout(); });

  // beside the headline at the end of the scroll: two small notes about TreeMapper itself (it runs
  // in the browser; what it exports), each sliding in from its edge of the window as the page is
  // scrolled, on a panel of its own; shown only where the side panels leave room
  var sideEls = [$('thSideL'), $('thSideR')];
  function edges(p) {
    sideEls.forEach(function (el, i) {
      if (!el) return;
      var A = M && M.wide && M.edges ? M.edges[i] : null;
      var w = A ? Math.min(300, Math.abs(A.x1 - A.x0) - 56) : 0;
      // (only where both sides have room, so the two are always a pair)
      if (!A || w < 200 || !M.edges[0].free || !M.edges[1].free || A.y1 - A.y0 < 96) { el.hidden = true; return; }
      el.hidden = false;
      // settled: in the column of the panel under it, centred on the hero block's height; before
      // that, out past its edge of the window
      // (in the column of the panel under it: its outer edge on the panel's, as wide as the panel
      // where the headline leaves room)
      var dir = A.x1 > A.x0 ? 1 : -1, col = i ? colR : colL, cw = col.offsetWidth;
      w = Math.min(cw, Math.abs(A.x1 - A.x0) - (dir > 0 ? col.offsetLeft : (M.W - col.offsetLeft - cw)));
      var left = dir > 0 ? col.offsetLeft : col.offsetLeft + cw - w;
      el.style.width = w + 'px';
      var u = EASE(smooth(0.45, 1, p)), off = dir > 0 ? -(left + w + 24) : (M.W - left + 24);
      // (its own height, centred on the hero block: from the headline's top to the buttons' bottom)
      el.style.left = left + 'px'; el.style.top = ((A.y0 + A.y1) / 2 - el.offsetHeight / 2) + 'px';
      el.style.transform = 'translateX(' + ((1 - u) * off).toFixed(1) + 'px)';
      el.style.opacity = (0.25 + 0.75 * u).toFixed(3);
    });
  }

  // each ring of the figure in the list beside it, as a strip of its own cells (a slice of the
  // circle, unrolled), so the list and the rings can be matched by eye
  function ringStrips() {
    var F = FIG; if (!F) return;
    document.querySelectorAll('#tmHome [data-ring]').forEach(function (li) {
      var ri = F.rings.map(function (r) { return r.type; }).indexOf(li.getAttribute('data-ring')); if (ri < 0) return;
      var c = li.querySelector('canvas');
      if (!c) { c = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true'); li.insertBefore(c, li.firstChild); }
      var W = 360, H = 32; c.width = W; c.height = H;
      var g = c.getContext('2d'), pal = F.pal[theme()], A = F.arcs, ring = F.rings[ri];
      g.fillStyle = theme() === 'dark' ? '#0C1116' : '#FFFFFF'; g.fillRect(0, 0, W, H);
      if (ring.type.indexOf('dataframe') === 0) {
        // the domain layout: its regions as one bar, inside out (N-terminal region, RT domain,
        // C-terminal region), each as wide as its share of the ring
        var area = {}, rad = {}, tot = 0;
        for (var j = 0; j < A.length; j += 6) { if (A[j + 5] !== ri) continue; var w = (A[j + 1] - A[j]) * (A[j + 3] - A[j + 2]); area[A[j + 4]] = (area[A[j + 4]] || 0) + w; rad[A[j + 4]] = (rad[A[j + 4]] || 0) + w * (A[j + 2] + A[j + 3]) / 2; tot += w; }
        var x = 0;
        Object.keys(area).sort(function (u, v) { return rad[u] / area[u] - rad[v] / area[v]; }).forEach(function (ci) { var wd = area[ci] / tot * W; g.fillStyle = pal[ci]; g.fillRect(x, 0, wd, H); x += wd; });
        return;
      }
      for (var i = 0; i < A.length; i += 6) {
        if (A[i + 5] !== ri) continue;
        var s = A[i] / 1e4, e = A[i + 1] / 1e4;
        var x0 = s / (Math.PI * 2) * W, x1 = Math.max(x0 + 0.6, e / (Math.PI * 2) * W);
        var r0 = (A[i + 2] / 1e4 - ring.inner) / (ring.outer - ring.inner), r1 = (A[i + 3] / 1e4 - ring.inner) / (ring.outer - ring.inner);
        g.fillStyle = pal[A[i + 4]];
        g.fillRect(x0, H * (1 - r1), x1 - x0, H * (r1 - r0));
      }
    });
  }

  // ------------------------------------------------------------------ the background
  // A slowly drifting light (a tiny canvas, scaled up), and over it faint traces: small
  // rectangular trees growing in from the window's sides, along which sparks of light run from
  // the root to the tips, as signals in a circuit. Always moving; nothing runs while the page is
  // hidden or the workspace is open.
  var aur = $('thAurora'), aurCtx = aur ? aur.getContext('2d') : null;
  var trC = $('thTraces'), spC = $('thSparks'), spCtx = spC ? spC.getContext('2d') : null;
  var bgRun = 0, aurLast = 0, spLast = 0;
  var BLOBS = [   // [colour, x period (s), y period (s), size, phase]
    ['20,184,166', 47, 61, 0.62, 0.1], ['16,185,129', 71, 53, 0.50, 2.2], ['14,165,233', 59, 79, 0.55, 4.1],
    ['99,102,241', 83, 67, 0.48, 1.3], ['230,159,0', 97, 89, 0.32, 3.4]
  ];
  if (aur) { aur.width = 192; aur.height = 120; }
  // a small seeded random, so the traces are the same on every visit
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  var routesBG = [];
  function traces() {
    if (!trC) return;
    var W = vw(), H = vh(), d = dpr(), dark = theme() === 'dark';
    trC.width = Math.round(W * d); trC.height = Math.round(H * d);
    if (spC) { spC.width = W; spC.height = H; }
    var g = trC.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
    var R = rng(20261025), reach = Math.min(W * 0.3, 460);
    routesBG = [];
    var segs = [], nodes = [];
    // a rectangular tree from (x, y) growing in direction dir (1: right, -1: left)
    function grow(x, y, dir, len, spread, depth, path) {
      var x1 = x + dir * len;
      segs.push([x, y, x1, y]);
      var here = path.concat([[x1, y]]);
      if (depth === 0 || Math.abs(x1 - (dir > 0 ? 0 : W)) > reach) { routesBG.push(here); nodes.push([x1, y, 1]); return; }
      nodes.push([x1, y, 0]);
      var k = R() < 0.28 ? 3 : 2, h = spread * (0.75 + R() * 0.5);
      for (var i = 0; i < k; i++) {
        var yy = y + (k === 2 ? (i ? h : -h) : (i - 1) * h);
        if (yy < 84 || yy > H - 8) continue;   // (clear of the top bar)
        segs.push([x1, y, x1, yy]);
        grow(x1, yy, dir, len * (0.62 + R() * 0.3), spread * 0.52, depth - 1, here.concat([[x1, yy]]));
      }
    }
    var per = Math.max(2, Math.round(H / 330));
    for (var side = 0; side < 2; side++) {
      for (var t = 0; t < per; t++) {
        var y0 = 84 + (H - 84) * (t + 0.5 + (R() - 0.5) * 0.5) / per, dir = side ? -1 : 1;
        grow(side ? W : 0, y0, dir, 46 + R() * 50, H / per * 0.3, 5, [[side ? W : 0, y0]]);
      }
    }
    // (1.5 px lines, so the traces can be seen)
    g.lineWidth = 1.5; g.lineCap = 'square';
    // (quieter on the light page, where dark lines on a pale ground stand out more)
    g.strokeStyle = dark ? 'rgba(160, 220, 230, 0.075)' : 'rgba(13, 60, 70, 0.045)';
    g.beginPath(); segs.forEach(function (s) { g.moveTo(Math.round(s[0]) + 0.5, Math.round(s[1]) + 0.5); g.lineTo(Math.round(s[2]) + 0.5, Math.round(s[3]) + 0.5); }); g.stroke();
    g.fillStyle = dark ? 'rgba(160, 220, 230, 0.16)' : 'rgba(13, 60, 70, 0.08)';
    nodes.forEach(function (n) { g.beginPath(); g.arc(n[0], n[1], n[2] ? 1.6 : 1.2, 0, Math.PI * 2); g.fill(); });
    routesBG.forEach(function (rt) { var c = [0], L = 0; for (var i = 1; i < rt.length; i++) { L += Math.abs(rt[i][0] - rt[i - 1][0]) + Math.abs(rt[i][1] - rt[i - 1][1]); c.push(L); } rt.cum = c; rt.len = L; });
    sparks = [];
  }
  var sparks = [], SPARK_COL = { dark: ['45,212,191', '56,189,248', '129,140,248', '52,211,153'], light: ['13,148,136', '2,132,199', '79,70,229', '5,150,105'] };
  function sparkAt(rt, d) {
    var c = rt.cum, i = 1; while (i < c.length - 1 && c[i] < d) i++;
    var a = rt[i - 1], b = rt[i], f = clamp((d - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1]), 0, 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  function drawSparks(t, dt) {
    if (!spCtx || !routesBG.length) return;
    var W = spC.width, H = spC.height, dark = theme() === 'dark';
    spCtx.clearRect(0, 0, W, H);
    var want = Math.max(6, Math.round(routesBG.length / 5));
    while (sparks.length < want) sparks.push({ rt: routesBG[Math.floor(Math.random() * routesBG.length)], d: -Math.random() * 260, v: 55 + Math.random() * 60, c: Math.floor(Math.random() * 4) });
    spCtx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    spCtx.lineCap = 'round';
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i]; s.d += s.v * dt;
      if (s.d - 70 > s.rt.len) { sparks.splice(i, 1); continue; }
      if (s.d <= 0) continue;
      var col = SPARK_COL[dark ? 'dark' : 'light'][s.c], trail = 70, N = 8;
      var fade = Math.min(1, s.d / 60, (s.rt.len + 70 - s.d) / 90);
      spCtx.beginPath();
      for (var k = 0; k <= N; k++) { var pp = sparkAt(s.rt, Math.max(0, s.d - trail + trail * k / N)); if (k) spCtx.lineTo(pp[0], pp[1]); else spCtx.moveTo(pp[0], pp[1]); }
      var hp = sparkAt(s.rt, Math.min(s.d, s.rt.len)), tp = sparkAt(s.rt, Math.max(0, s.d - trail));
      var gr = spCtx.createLinearGradient(tp[0], tp[1], hp[0], hp[1]);
      gr.addColorStop(0, 'rgba(' + col + ',0)'); gr.addColorStop(1, 'rgba(' + col + ',' + ((dark ? 0.75 : 0.38) * fade).toFixed(3) + ')');
      spCtx.strokeStyle = gr; spCtx.lineWidth = 1.4; spCtx.stroke();
      if (s.d <= s.rt.len) {
        var hg = spCtx.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 6);
        hg.addColorStop(0, 'rgba(' + (dark ? '230,255,252' : col) + ',' + ((dark ? 0.9 : 0.6) * fade).toFixed(3) + ')'); hg.addColorStop(1, 'rgba(' + col + ',0)');
        spCtx.fillStyle = hg; spCtx.fillRect(hp[0] - 6, hp[1] - 6, 12, 12);
      }
    }
    spCtx.globalCompositeOperation = 'source-over';
  }
  function paintAurora(t) {
    var W = 192, H = 120, s = t / 1000, dark = theme() === 'dark';
    aurCtx.clearRect(0, 0, W, H);
    aurCtx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    BLOBS.forEach(function (b, i) {
      var x = W * (0.5 + 0.42 * Math.sin(s * 2 * Math.PI / b[1] + b[4])), y = H * (0.45 + 0.4 * Math.sin(s * 2 * Math.PI / b[2] + b[4] * 1.7));
      var r = W * b[3] * (0.9 + 0.1 * Math.sin(s / 7 + i)), g = aurCtx.createRadialGradient(x, y, 0, x, y, r);
      // (the amber light only on the light page: on the dark one it mixes into an olive smear)
      var a = (dark ? 0.26 : 0.24) * (i === 4 ? (dark ? 0.12 : 0.6) : 1);
      g.addColorStop(0, 'rgba(' + b[0] + ',' + a + ')'); g.addColorStop(1, 'rgba(' + b[0] + ',0)');
      aurCtx.fillStyle = g; aurCtx.fillRect(0, 0, W, H);
    });
    aurCtx.globalCompositeOperation = 'source-over';
  }
  function background(t) {
    bgRun = 0;
    if (!aurCtx || !(isHome() || state === 'opening' || state === 'closing') || document.hidden) return;
    if (t - aurLast > 32) { aurLast = t; paintAurora(t); }   // (~30 frames a second is plenty for the light)
    var dt = spLast ? Math.min(0.1, (t - spLast) / 1000) : 0; spLast = t;
    drawSparks(t, dt);
    bgRun = requestAnimationFrame(background);
  }
  function startBackground() {
    if (reduced()) { if (aurCtx) paintAurora(1e5); return; }
    if (!bgRun) { spLast = 0; bgRun = requestAnimationFrame(background); }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) startBackground(); });

  // ------------------------------------------------------------------ recent sessions
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) { var d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago'; }
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  // a small picture of the session's shape: a circle for the circular layout, a ladder for the rectangular
  function glyph(r) {
    return r.layout === 'radial'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2.2"/><path d="M12 12V6.5M12 12l4.5 2.6M12 12l-4.5 2.6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 12h3M7 7v10M7 7h4M7 17h4M11 5v4M11 5h3M11 9h3M11 15v4M11 15h3M11 19h3"/><path d="M17 5h3M17 9h3M17 15h3M17 19h3" stroke-opacity=".5"/></svg>';
  }
  function renderRecent() {
    if (!window.tmRecent) return Promise.resolve();
    return tmRecent.list().then(function (list) {
      var ul = $('thRecent');
      ul.innerHTML = list.map(function (r) {
        var n = r.layers.length, meta = (r.tips ? r.tips.toLocaleString() + ' tips' : 'tree') + ' · ' + n + ' layer' + (n === 1 ? '' : 's') + ' · ' + (r.layout === 'radial' ? 'circular' : 'rectangular');
        return '<li><button type="button" class="th-rec" data-recent="' + esc(r.id) + '" title="Open ' + esc(r.name) + '">' +
          '<span class="th-rec-ico">' + glyph(r) + '</span>' +
          '<span class="th-rec-main"><b>' + esc(r.name) + '</b><span>' + esc(meta) + '</span></span>' +
          '<span class="th-rec-when">' + ago(r.when) + '</span></button>' +
          '<button type="button" class="th-rec-x" data-forget="' + esc(r.id) + '" aria-label="Remove ' + esc(r.name) + ' from recent sessions" title="Remove from this list">' + ICON(I.x, 13, 2) + '</button></li>';
      }).join('');
      $('thRecentEmpty').hidden = list.length > 0;
      ul.classList.toggle('th-more', list.length > 2);
      $('thRecentClear').hidden = list.length === 0;
      var cnt = $('thRecentCount'); if (cnt) { cnt.hidden = !list.length; cnt.textContent = String(list.length); }
      if (isHome()) relayout();
    });
  }
  document.addEventListener('tm-recent-changed', function () { renderRecent(); });

  // ------------------------------------------------------------------ the top bar's two links
  // Examples and Recent sessions each bring their own panel into view and point at it: in a
  // wide window by scrolling to the end of the page's motion (where both panels are in view),
  // with a short ring of light on that panel and the focus on its first control.
  function spotlight(id) {
    var panel = id === 'thExamples' ? colL.querySelector('.th-panel') : $('thRecentPanel');
    if (!panel) return;
    var go = function () {
      document.querySelectorAll('#tmHome .th-spot').forEach(function (p) { p.classList.remove('th-spot'); });
      void panel.offsetWidth; panel.classList.add('th-spot');
      setTimeout(function () { panel.classList.remove('th-spot'); }, 1800);
      var first = id === 'thExamples' ? $('thOpenRt') : (panel.querySelector('.th-rec') || panel);
      if (first === panel) panel.setAttribute('tabindex', '-1');
      first.focus({ preventScroll: true });
    };
    var target = M && M.wide ? M.D : Math.max(0, topIn(panel) - 72);
    var far = Math.abs((window.scrollY || 0) - target) > 4;
    window.scrollTo({ top: target, behavior: reduced() ? 'auto' : 'smooth' });
    if (!far) { go(); return; }
    // (once the scroll has arrived)
    var t0 = performance.now();
    (function wait() { if (Math.abs((window.scrollY || 0) - target) <= 2 || performance.now() - t0 > 1400) go(); else requestAnimationFrame(wait); })();
  }
  document.querySelectorAll('#tmHome [data-nav]').forEach(function (b) { b.addEventListener('click', function () { spotlight(b.getAttribute('data-nav')); }); });

  // ------------------------------------------------------------------ the workspace, quietly
  // While the home page is up, a transition runs or a session loads, the workspace's notices are
  // not shown and its panels show no content (one loading state only); afterwards they work as before.
  var quiet = true, reading = 0;
  function hookWorkspace() {
    // status messages go on as usual (the status bar is not seen until the session is ready);
    // an error while an opening is under way brings the page back, with the reason
    var setS = window.setStatus;
    if (typeof setS === 'function' && !setS.__home) {
      window.setStatus = function (m) {
        var t = String(m || '');
        if (/^(Error|Could not|Failed)/i.test(t)) { if (state === 'opening') fail(t); else if (state === 'home') say(t); }
        return setS.apply(this, arguments);
      };
      window.setStatus.__home = true;
    }
    var note = window.showNotification;
    if (typeof note === 'function' && !note.__home) { window.showNotification = function () { if (quiet || reloading) return; return note.apply(this, arguments); }; window.showNotification.__home = true; }
    // a tree being read: the start of an opening (a session's tree, a generated, pasted or dropped
    // tree); in the workspace, the start of its loading state
    var htf = window.handleTreeFile;
    if (typeof htf === 'function' && !htf.__home) {
      window.handleTreeFile = async function () {
        if (state === 'home') begin('plain');
        else if (state === 'app') startReload();
        reading++;
        try { return await htf.apply(this, arguments); }
        finally {
          reading--;
          var sessionLoading = window.tmSession && tmSession.isLoading && tmSession.isLoading();
          if (state === 'opening' && !sessionLoading && pendingKind !== 'session') ready(hasTree());
          if (reloading && !sessionLoading && !reading) endReload();
        }
      };
      window.handleTreeFile.__home = true;
    }
    // a message box while an opening waits for a tree that is not being read (a refused table,
    // a failed generation): nothing will open, so the page comes back
    var al = window.alert;
    if (typeof al === 'function' && !al.__home) {
      window.alert = function () {
        var r = al.apply(this, arguments);
        if (state === 'opening' && !isReady && !reading && !(window.tmSession && tmSession.isLoading && tmSession.isLoading())) fail();
        return r;
      };
      window.alert.__home = true;
    }
    // a web address being fetched (From URL…, or the page's ?session= / ?tree= address)
    if (window.tmSession && tmSession.fetchText && !tmSession.fetchText.__home) {
      var ft = tmSession.fetchText;
      tmSession.fetchText = function (url) {
        if (state === 'home') begin('plain', 'url');
        var pr = ft.apply(this, arguments);
        if (state === 'opening' && pendingKind === 'url') pr.then(function () { watchdog(); }, function (e) { fail('Could not fetch ' + url + ': ' + (e && e.message ? e.message : e)); });
        return pr;
      };
      tmSession.fetchText.__home = true;
    }
  }
  function hasTree() { try { return !!root; } catch (e) { return false; } }
  // keys go to the home page, not to the hidden workspace (its shortcuts would act unseen)
  window.addEventListener('keydown', function (e) {
    if (state !== 'home' && state !== 'opening' && state !== 'closing') return;
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    var inDialog = t && t.closest && t.closest('.pro-modal, [role="dialog"]');
    if (inDialog) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O') && state === 'home') { e.preventDefault(); e.stopImmediatePropagation(); click('proEmptyOpen'); return; }
    if (typing || e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.indexOf('Arrow') === 0 || e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End') { if (!typing) e.stopImmediatePropagation(); return; }
    e.stopImmediatePropagation();
  }, true);

  // ------------------------------------------------------------------ the loading ring
  var loader = null;
  function loaderAt() {
    if (!loader) { loader = document.createElement('div'); loader.className = 'tm-loader'; loader.id = 'tmLoader'; loader.setAttribute('role', 'progressbar'); loader.setAttribute('aria-label', 'Opening'); loader.innerHTML = '<i></i>'; document.body.appendChild(loader); }
    var c = document.querySelector('.pro-center'), r = c ? c.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    loader.style.left = (r.left + r.width / 2) + 'px'; loader.style.top = (r.top + r.height * 0.5) + 'px';
    return loader;
  }

  // ------------------------------------------------------------------ opening: one transition
  // kind: 'rt' (the figure flies), 'mock' (the mock example's picture grows from its card),
  // 'plain' (anything else: the loading ring)
  var pendingKind = '', flightKind = '', isReady = false, readyOk = false, flight = null, watch = 0;
  function say(t) { var s = $('thError'); if (s) s.textContent = t || ''; }
  // the drawing's place in the workspace: a circular drawing by its own centre and outer ring,
  // a rectangular one by its box; before anything is drawn, the middle of the canvas
  function target() {
    var center = document.querySelector('.pro-center'), cr = center ? center.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    // (TreeMapper fits a circular drawing to about half the canvas's shorter side, a little below
    // its middle under the toolbar: measured at 1280-2560 px wide with the example opened)
    var fallback = { cx: cr.left + cr.width / 2, cy: cr.top + cr.height * 0.53, r: Math.max(120, Math.min(470, Math.min(cr.width, cr.height) * 0.46)), rot: 0, exact: false };
    if (!isReady || !readyOk) return fallback;
    try {
      var spin = document.querySelector('#svg .spin');
      if (typeof geometry !== 'undefined' && geometry === 'radial' && spin && window.radialPanelSystem) {
        var rings = radialPanelSystem.getRings() || [], last = rings[rings.length - 1], m = spin.getScreenCTM();
        var outer = last ? last.outerRadius || last.outer : 0, k = m ? Math.hypot(m.a, m.b) : 0;
        if (outer && k) return { cx: m.e, cy: m.f, r: outer * k, rot: Math.atan2(m.b, m.a), exact: true };
      }
    } catch (e) {}
    return fallback;
  }
  // the workspace comes in: its panels from outside with no transition first, then let in
  function panelsIn(k) {
    html.style.setProperty('--th-home-delay', '0s'); html.style.setProperty('--th-panel-delay', '.22s');
    html.classList.add('tm-out', 'tm-hide-drawing', 'tm-wait-content');
    var sp = document.querySelector('.sidepanel'); if (sp) void getComputedStyle(sp).transform;
    html.classList.add('tm-moving');
    requestAnimationFrame(function () {
      html.classList.add('tm-away', 'tm-bgaway');
      setTimeout(function () { if (state === 'opening') html.classList.remove('tm-out'); }, 60 * k);
    });
  }
  // an opening has begun (a click on an example, a file chosen, a session being read ...)
  function begin(kind, sub) {
    if (state !== 'home') return;
    hookWorkspace();
    state = 'opening'; flightKind = kind; pendingKind = sub || (kind === 'plain' ? '' : 'session'); isReady = false; readyOk = false; say('');
    quiet = true;
    cancelAnimationFrame(raf); raf = 0;
    var k = slow();
    flight = true;
    // reduced motion: one crossfade at once, to the workspace (the figure or the picture still,
    // where the drawing will be, breathing until the session is ready)
    if (reduced()) {
      html.classList.add('tm-reduced', 'tm-out', 'tm-hide-drawing', 'tm-wait-content');
      var sp0 = document.querySelector('.sidepanel'); if (sp0) void getComputedStyle(sp0).opacity;
      html.classList.add('tm-moving');
      if (kind === 'rt') { figEl.style.opacity = '0'; settleDrawing(0); }
      else fade(figEl, 0, 250);
      requestAnimationFrame(function () {
        html.classList.remove('tm-out'); html.classList.add('tm-away', 'tm-bgaway');
        if (kind === 'rt') { place(target()); fade(figEl, 1, 300); figEl.classList.add('th-wait'); }
        else if (kind === 'mock') { var c = cardFlight(true); if (c) { fade(c, 1, 300); c.classList.add('th-wait'); } }
        else { loaderAt(); html.classList.add('tm-loading'); }
        setTimeout(function () { flight = null; if (state === 'opening' && isReady) landed(); }, 320);
      });
      return;
    }
    html.classList.remove('tm-reduced');
    panelsIn(k);
    if (kind !== 'rt') html.style.setProperty('--th-panel-delay', '.1s');
    fade(cPulse, 0, 420 * k);
    if (kind === 'rt') {
      // (painted at the size it lands at, so it is as sharp there as the drawing it turns into)
      var tg0 = target(); if (tg0.r > RP) { sizeFigure(tg0.r); place(cur); drawFigure(cur.open, cur.mask); }
      settleDrawing(300 * k);
      fly(target(), DUR0 * k, function () { flight = null; if (state !== 'opening') return; if (isReady) landed(); else hold(); });
      return;
    }
    // the figure leaves with the page (it is not what is being opened)
    fade(figEl, 0, 380 * k);
    if (kind === 'mock') {
      var c = cardFlight(false);
      if (c) { setTimeout(function () { flight = null; if (state !== 'opening') return; if (isReady) landed(); else hold(); }, DUR0 * k); return; }
    }
    // the loading ring, once the panels are in
    setTimeout(function () {
      flight = null; if (state !== 'opening') return;
      if (isReady) landed(); else { loaderAt(); html.classList.add('tm-loading'); }
    }, DUR0 * k * 0.8);
  }
  // the flight is over before the session: what flew waits in place with a slow breath (CSS)
  function hold() { if (flightKind === 'rt') figEl.classList.add('th-wait'); else if (fly2) fly2.classList.add('th-wait'); }
  function ready(ok) {
    if (state !== 'opening' || isReady) return;
    clearTimeout(watch);
    isReady = true; readyOk = !!ok;
    if (!ok) { fail(); return; }
    if (!flight) landed();
  }
  // what flew is over the drawing (a last short move when the drawing's place is known only
  // now), then one crossfade, and the workspace is the page
  function landed() {
    var k = slow();
    var cross = function (el) {
      if (el) el.classList.remove('th-wait');
      html.classList.remove('tm-hide-drawing', 'tm-wait-content', 'tm-loading');
      // the drawing comes in first; what flew goes a moment later, so there is never a gap
      if (el) setTimeout(function () { fade(el, 0, 260 * k); }, 90 * k);
      setTimeout(finishOpen, 380 * k);
    };
    if (flightKind === 'rt') {
      var tg = target(), off = Math.abs(tg.cx - cur.cx) + Math.abs(tg.cy - cur.cy) + Math.abs(tg.r - cur.r);
      if (off > 1.5 && !reduced()) fly(tg, 320 * k, function () { cross(figEl); }); else { if (reduced()) place(tg); cross(figEl); }
      return;
    }
    if (flightKind === 'mock' && fly2) { cross(fly2); return; }
    cross(null);
  }
  function finishOpen() {
    if (state !== 'opening') return;
    state = 'app'; quiet = false;
    html.classList.remove('tm-home', 'tm-moving', 'tm-away', 'tm-bgaway', 'tm-out', 'tm-hide-drawing', 'tm-reduced', 'tm-wait-content', 'tm-loading');
    figEl.style.opacity = '0'; figEl.hidden = true; figEl.classList.remove('th-wait');
    dropCardFlight();
    var b = $('proHomeBtn'); if (b) b.focus({ preventScroll: true });
  }
  // nothing opened (a refused file, a failed fetch): back to the home page, with the reason
  function fail(msg) {
    if (state !== 'opening') return;
    clearTimeout(watch);
    var was = flightKind;
    state = 'closing'; quiet = true; flight = null;
    say(msg || '');
    html.classList.remove('tm-loading');
    dropCardFlight();
    comeBack(was === 'rt' ? 'fly' : 'rise', function () { closeWorkspace(); });
  }
  // a fetched address that opened nothing (no tree in it) gives up after a moment, unless a
  // dialog is asking the visitor something
  function watchdog() {
    clearTimeout(watch);
    watch = setTimeout(function () {
      if (state !== 'opening' || isReady) return;
      var asking = Array.prototype.some.call(document.querySelectorAll('.pro-modal'), function (m) { return !m.hidden; });
      if (asking || (window.tmSession && tmSession.isLoading && tmSession.isLoading())) { watchdog(); return; }
      if (hasTree()) ready(true); else fail('Nothing to open at that address: it holds no tree or session TreeMapper can read.');
    }, 1500);
  }
  document.addEventListener('tm-session-loading', function () {
    if (state === 'home') begin('plain');
    else if (state === 'opening') pendingKind = 'session';
    else if (state === 'app') startReload();
  });
  document.addEventListener('tm-session-ready', function (e) {
    if (state === 'opening') ready(e.detail && e.detail.ok);
    else if (reloading && !reading) endReload();
  });

  // the mock example's picture, flying from its card into the workspace's canvas: a frame that
  // grows from the card's crop to the canvas, the picture inside it scaled evenly (its frames are
  // computed here, so the picture is never stretched, and run on the compositor)
  var fly2 = null;
  function cardFlight(still) {
    var card = page.querySelector('.th-mock'), crop = card && card.querySelector('.th-win-crop');
    var img = crop && crop.querySelector(theme() === 'dark' ? '.th-dark-img' : '.th-light-img');
    var center = document.querySelector('.pro-center');
    if (!crop || !img || !center || !img.naturalWidth) return null;
    var a = crop.getBoundingClientRect(), c = center.getBoundingClientRect();
    var iw = img.naturalWidth, ih = img.naturalHeight;
    // the picture in the card: covering its frame from the top left (object-fit: cover)
    var k0 = Math.max(a.width / iw, a.height / ih);
    // at the end: where its contents are drawn in the canvas (data-crop: x, y, w as fractions of
    // the canvas area, written with the picture by examples-build/home_shots.js)
    var cut = String(crop.getAttribute('data-crop') || '0,0,1,1').split(',').map(Number);
    var k1 = cut[2] * c.width / iw;
    var b = { left: c.left + cut[0] * c.width, top: c.top + cut[1] * c.height, width: iw * k1, height: Math.min(ih * k1, c.bottom - c.top - cut[1] * c.height) };
    fly2 = document.createElement('div'); fly2.className = 'th-fly'; fly2.setAttribute('aria-hidden', 'true');
    var im = new Image(); im.src = img.currentSrc || img.src; im.alt = ''; im.width = iw; im.height = ih;
    fly2.appendChild(im);
    fly2.style.width = b.width + 'px'; fly2.style.height = b.height + 'px';
    document.body.appendChild(fly2);
    card.classList.add('th-flying');
    var R0 = { x: a.left, y: a.top, w: a.width, h: a.height, ix: 0, iy: 0, k: k0 };
    var R1 = { x: b.left, y: b.top, w: b.width, h: b.height, ix: 0, iy: 0, k: k1 };
    var at = function (e) {
      var R = { x: lerp(R0.x, R1.x, e), y: lerp(R0.y, R1.y, e), w: lerp(R0.w, R1.w, e), h: lerp(R0.h, R1.h, e), ix: lerp(R0.ix, R1.ix, e), iy: lerp(R0.iy, R1.iy, e), k: lerp(R0.k, R1.k, e) };
      var sx = R.w / b.width, sy = R.h / b.height;
      return { outer: 'translate(' + R.x.toFixed(2) + 'px,' + R.y.toFixed(2) + 'px) scale(' + sx.toFixed(5) + ',' + sy.toFixed(5) + ')',
        inner: 'scale(' + (1 / sx).toFixed(5) + ',' + (1 / sy).toFixed(5) + ') translate(' + R.ix.toFixed(2) + 'px,' + R.iy.toFixed(2) + 'px) scale(' + R.k.toFixed(5) + ')',
        radius: (lerp(10, 12, e) / Math.max(sx, 0.01)).toFixed(2) + 'px / ' + (lerp(10, 12, e) / Math.max(sy, 0.01)).toFixed(2) + 'px' };
    };
    if (still || !fly2.animate) { var z = at(1); fly2.style.transform = z.outer; im.style.transform = z.inner; fly2.style.opacity = still ? '0' : '1'; return fly2; }
    var N = 24, ko = [], ki = [], ms = DUR0 * slow();
    for (var i = 0; i <= N; i++) { var e = EASE(i / N), z2 = at(e); ko.push({ transform: z2.outer, borderRadius: z2.radius }); ki.push({ transform: z2.inner }); }
    var z1 = at(1); fly2.style.transform = z1.outer; im.style.transform = z1.inner;
    fly2.animate(ko, { duration: ms, easing: 'linear' }); im.animate(ki, { duration: ms, easing: 'linear' });
    return fly2;
  }
  function dropCardFlight() {
    if (fly2) { fly2.remove(); fly2 = null; }
    var card = page.querySelector('.th-mock'); if (card) card.classList.remove('th-flying');
  }

  // ------------------------------------------------------------------ loading inside the workspace
  // A tree or a session opened from inside the workspace (Open, a dropped file, From URL…, pasted
  // data, Generate tree): the drawing and the panels' content go, the loading ring shows, and
  // the new session comes in all at once when it is ready.
  var reloading = false, reloadOff = 0;
  function startReload() {
    if (reloading || state !== 'app') return;
    reloading = true; clearTimeout(reloadOff); lastExample = '';
    // (at once, with no fade: the session's first steps, a bare tree, are drawn within a few frames)
    html.classList.remove('tm-reload');
    html.classList.add('tm-hide-drawing', 'tm-wait-content');
    void document.body.offsetWidth;
    html.classList.add('tm-reload');
    loaderAt(); html.classList.add('tm-loading');
  }
  function endReload() {
    if (!reloading) return;
    reloading = false;
    html.classList.remove('tm-hide-drawing', 'tm-wait-content', 'tm-loading');
    reloadOff = setTimeout(function () { if (!reloading) html.classList.remove('tm-reload'); }, 400 * slow());
  }

  // ------------------------------------------------------------------ the ways in
  function click(id) { var b = $(id); if (b) b.click(); }
  $('thOpen').addEventListener('click', function () { say(''); click('proEmptyOpen'); });
  $('thGenerate').addEventListener('click', function () { say(''); click('proEmptyGenerate'); });
  $('thUrl').addEventListener('click', function () { say(''); click('proEmptyUrl'); });
  $('thPaste').addEventListener('click', function () { say(''); if (window.tmIntake && tmIntake.paste) tmIntake.paste(''); });
  $('twSkip').addEventListener('click', function () { if (state !== 'home') return; begin('plain', 'empty'); ready(true); });
  $('thTheme').addEventListener('click', function (e) { switchTheme(e.currentTarget, !!e.isTrusted); });
  // a file chosen in the workspace's file picker while on the home page: its opening begins
  // with the visitor's choice (the reading starts a moment later)
  document.addEventListener('change', function (e) {
    var t = e.target; if (state !== 'home' || !t || t.type !== 'file' || !t.files || !t.files.length) return;
    if (t.id === 'treeFile') begin('plain', window.tmSession && tmSession.isSessionFile(t.files[0]) ? 'session' : '');
  }, true);

  // Generate tree (its dialog shows over the home page): the opening begins with the click, as
  // building the tree can take a while before it is read
  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('#generateTreeBtn'), f = $('geneDataFile');
    if (g && state === 'home' && f && f.files && f.files.length) begin('plain');
  }, true);
  var loadScript = function (src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('it could not be loaded')); }; document.head.appendChild(s); }); };
  function stamp() { var sc = document.querySelector('script[src*="home.js"]'), m = sc && /[?&]v=(\d+)/.exec(sc.getAttribute('src') || ''); return m ? '?v=' + m[1] : ''; }
  var EXAMPLES = { 'rt-references': 'rt-references.treemapper', mock: 'crispr-cas-loci.treemapper' };
  // two frames: the transition is handed to the compositor before the reading blocks the page
  var frames = function () { return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function openExample(id) {
    if (state !== 'home' || !EXAMPLES[id]) return;
    begin(id === 'rt-references' && fig ? 'rt' : id === 'mock' ? 'mock' : 'plain', 'session');
    await frames();
    // (the RT figure first eases into the example's own drawing, then the reading begins; slowed
    // down for checking, the reading waits for the flight, so its frames show the motion alone)
    if (id === 'rt-references') await wait(300 * slow());
    if (slow() > 1) await wait(DUR0 * slow());
    try {
      if (!(window.TM_EXAMPLES && TM_EXAMPLES[id])) await loadScript('examples/' + id + '.js' + stamp());
      var s = window.TM_EXAMPLES && TM_EXAMPLES[id];
      if (!s) throw new Error('the example is missing');
      await tmSession.load(JSON.stringify(s), { example: id, name: EXAMPLES[id] });
    } catch (e) { fail('Could not open the example: ' + (e && e.message ? e.message : e)); }
  }
  page.addEventListener('click', function (e) {
    var f = e.target.closest('[data-forget]'); if (f) { if (window.tmRecent) tmRecent.remove(f.getAttribute('data-forget')); return; }
    var r = e.target.closest('[data-recent]');
    if (r) { if (state !== 'home') return; begin('plain', 'session'); frames().then(function () { return tmRecent.open(r.getAttribute('data-recent')); }).catch(function (err) { fail('Could not open it: ' + (err && err.message ? err.message : err)); }); return; }
    var x = e.target.closest('[data-example]'); if (x) { e.preventDefault(); openExample(x.getAttribute('data-example')); return; }
    // the figure itself opens its example (where the page shows it, not under a panel or a control)
    if (overFigure(e)) { openExample('rt-references'); return; }
  });
  function overFigure(e) {
    if (state !== 'home' || !e.target.closest || e.target.closest('button, a, input, label, .th-panel, .th-launchgroup, .th-top, .th-eyebrow, h1, p')) return false;
    var dx = e.clientX - cur.cx, dy = e.clientY - cur.cy;
    return dx * dx + dy * dy <= cur.r * cur.r;
  }
  page.addEventListener('mousemove', function (e) { var on = overFigure(e); if (on !== page.classList.contains('th-over-figure')) { page.classList.toggle('th-over-figure', on); page.title = on ? 'Open this example: reverse transcriptases' : ''; } });
  $('thRecentClear').addEventListener('click', function () { if (window.tmRecent) tmRecent.clear(); });

  // files dropped anywhere on the home page: a session opens as a session, the rest goes to the intake
  var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
  window.addEventListener('dragover', function (e) { if (state === 'home' && hasFiles(e)) { e.preventDefault(); page.classList.add('th-dragging'); } });
  window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) page.classList.remove('th-dragging'); });
  window.addEventListener('drop', function (e) {
    if (state !== 'home') return;
    page.classList.remove('th-dragging');
    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    if (!files.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var session = window.tmSession && files.filter(function (f) { return tmSession.isSessionFile(f); })[0];
    if (session) tmSession.load(session);
    else if (window.tmIntake && tmIntake.files) tmIntake.files(files);
  }, true);

  // ------------------------------------------------------------------ closing the workspace
  // the session goes: its layers, the comparison tree, the tree and everything drawn
  async function closeWorkspace() {
    var origConfirm = window.confirm, origAlert = window.alert;
    window.confirm = function () { return true; }; window.alert = function () {};
    try {
      // the layer cards, last first (as a session does before it opens); some go a moment later
      for (var round = 0; round < 8; round++) {
        var del = Array.prototype.slice.call(document.querySelectorAll('.card-container > details .df-delete'));
        if (!del.length) break;
        del.reverse().forEach(function (b) { try { b.click(); } catch (e) {} });
        await wait(60);
      }
      var tr = $('tangleRemove'); if (tr && !tr.disabled) try { tr.click(); } catch (e) {}
      if (typeof window.resetAllFeaturesForNewTree === 'function') resetAllFeaturesForNewTree();
      try { currentLoadedTreeFile = null; selectedTreeFile = null; } catch (e) {}
      if (typeof window.drawTree === 'function') drawTree();
      if (window.tmUndo && tmUndo.clear) tmUndo.clear();
      var dn = $('proDocName'); if (dn) dn.textContent = 'No tree loaded';
    } finally { window.confirm = origConfirm; window.alert = origAlert; }
  }
  // the workspace's Home button: ask (unsaved work would be lost), then the transition back
  var ask = null, askAfterSave = false;
  function buildAsk() {
    if (ask) return ask;
    ask = document.createElement('div'); ask.className = 'pro-modal'; ask.id = 'tmHomeAsk'; ask.hidden = true;
    ask.innerHTML = '<div class="pro-modal-card tm-ask-card" role="alertdialog" aria-modal="true" aria-labelledby="tmAskTitle" aria-describedby="tmAskText">' +
      '<div class="pro-panel-head"><span class="pro-panel-title" id="tmAskTitle">Close this session and go home?</span></div>' +
      '<div class="tm-ask-body"><p id="tmAskText">The tree and its data layers will be closed. <b>Anything not saved as a session will be lost.</b></p>' +
      '<div class="tm-ask-actions"><button type="button" class="pro-btn tm-ask-save" id="tmAskSave">Save session…</button>' +
      '<button type="button" class="pro-btn" id="tmAskCancel">Cancel</button>' +
      '<button type="button" class="pro-btn pro-btn-danger" id="tmAskGo">Close and go home</button></div></div></div>';
    document.body.appendChild(ask);
    var hide = function () { ask.hidden = true; askAfterSave = false; };
    ask.addEventListener('mousedown', function (e) { if (e.target === ask) hide(); });
    ask.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); var b = $('proHomeBtn'); if (b) b.focus(); } });
    $('tmAskCancel').addEventListener('click', function () { hide(); var b = $('proHomeBtn'); if (b) b.focus(); });
    $('tmAskGo').addEventListener('click', function () { hide(); goHome(); });
    // save first: once the session file is written, go home
    $('tmAskSave').addEventListener('click', function () {
      ask.hidden = true; askAfterSave = true;
      try { if (window.tmSession) tmSession.save(); } finally { askAfterSave = false; }   // (saved: tm-session-saved came during save(); cancelled: stay)
    });
    return ask;
  }
  document.addEventListener('tm-session-saved', function () { if (askAfterSave) { askAfterSave = false; setTimeout(goHome, 200); } });
  function homeClicked() {
    if (state !== 'app') return;
    if (!hasTree()) { goHome(); return; }
    buildAsk().hidden = false;
    setTimeout(function () { $('tmAskCancel').focus(); }, 0);
  }
  // the way back. how: 'fly' (the reverse of the RT example's flight: the figure appears where
  // the drawing was, once the drawing has gone, and flies home) or 'rise' (the figure comes up in
  // its place on the page). The session is gone from the screen before the figure is seen.
  function comeBack(how, after) {
    var k = slow();
    html.classList.add('tm-home', 'tm-moving', 'tm-away', 'tm-bgaway');
    window.scrollTo(0, 0);
    M = null; measure();
    var to = homeState(0), from = target();
    sizeFigure(Math.max(figureSize(), from.r));
    layoutAt(to);
    figEl.hidden = false; figEl.classList.remove('th-wait'); figEl.getAnimations && figEl.getAnimations().forEach(function (a) { a.cancel(); });
    figEl.style.opacity = '0'; cPulse.style.opacity = '0';
    paintPulses(to.pulse, to.pa, to.open);
    var done = async function () {
      html.classList.remove('tm-moving', 'tm-away', 'tm-bgaway', 'tm-out', 'tm-hide-drawing', 'tm-reduced', 'tm-wait-content', 'tm-loading');
      figEl.style.opacity = ''; cPulse.style.opacity = '';
      state = 'home';
      frame();   // (exactly where the flight ended: the same measurements)
      if (after) await after();
      lastExample = '';
      renderRecent(); startBackground();
      var o = $('thOpen'); if (o) o.focus({ preventScroll: true });
    };
    startBackground();
    if (reduced()) {
      html.classList.add('tm-reduced', 'tm-hide-drawing');
      place(to); drawFigure(to.open, to.mask);
      requestAnimationFrame(function () { fade(figEl, 1, 300); html.classList.remove('tm-away', 'tm-bgaway'); html.classList.add('tm-out'); setTimeout(done, 320); });
      return;
    }
    html.classList.remove('tm-reduced');
    html.style.setProperty('--th-home-delay', '.24s'); html.style.setProperty('--th-panel-delay', '0s');
    requestAnimationFrame(function () {
      // 1. the session's drawing fades and the panels go back to their edges, as the page's
      // light comes back behind them
      html.classList.add('tm-hide-drawing', 'tm-out'); html.classList.remove('tm-bgaway');
      // 2. then the page comes back, and the figure: from where the drawing was, or in its place
      setTimeout(function () {
        // (flying back, the page comes in later, once the figure has passed the launcher)
        if (how === 'fly') html.style.setProperty('--th-home-delay', '.42s');
        html.classList.remove('tm-away');
        fade(cPulse, 1, 400 * k, 300 * k);
        if (how === 'fly') {
          place({ cx: from.cx, cy: from.cy, r: from.r, rot: from.rot, open: OPEN, mask: fig ? fig.maskEnd : 2 });
          drawFigure(OPEN, fig ? fig.maskEnd : 2);
          fade(figEl, 1, 220 * k);
          // (its drawing eases back to the page's state for the top of the page as it flies)
          var o0 = OPEN, m0 = fig ? fig.maskEnd : 2, t0 = performance.now(), ms = DUR0 * k;
          (function step() { var u = clamp((performance.now() - t0) / ms, 0, 1), e = EASE(u); cur.open = lerp(o0, to.open, e); cur.mask = lerp(m0, to.mask, e); drawFigure(cur.open, cur.mask); if (u < 1 && state === 'closing') requestAnimationFrame(step); })();
          fly(to, ms, done);
        } else {
          place({ cx: to.cx, cy: to.cy + 40, r: to.r * 0.94, rot: to.rot + 0.08, open: to.open, mask: to.mask });
          drawFigure(to.open, to.mask);
          fade(figEl, 1, 380 * k, 120 * k);
          setTimeout(function () { fly(to, 620 * k, done); }, 60 * k);
        }
      }, 260 * k);
    });
  }
  function goHome() {
    if (state !== 'app') return;
    // (the figure flies back only from its own example; from anything else it rises in its place)
    var rt = hasTree() && lastExample === 'rt-references';
    state = 'closing'; quiet = true;
    isReady = true; readyOk = hasTree();
    comeBack(rt ? 'fly' : 'rise', closeWorkspace);
  }
  var lastExample = '';
  document.addEventListener('tm-session-opened', function (e) { lastExample = (e.detail && e.detail.example) || ''; });

  // ------------------------------------------------------------------ light and dark
  // The switch (on this page or in the workspace's top bar) plays a short crossfade. On this page
  // the colours ease and the pictures (the light, the traces, the figure) fade from copies of the
  // old ones, while the sparks and everything else keep moving: a view transition would show a
  // still picture of the old page meanwhile, and the background would stop. In the workspace,
  // whose drawing is rebuilt in the new colours, a view transition crossfades it. Only for the
  // visitor's own clicks and keys: a script that clicks the switch gets the change at once.
  function switchTheme(origin, trusted) {
    var tg = $('themeToggle');
    var apply = function () {
      if (tg && document.readyState !== 'loading') { tg.checked = !tg.checked; tg.dispatchEvent(new Event('change', { bubbles: true })); }
      else { var t = theme() === 'dark' ? 'light' : 'dark'; html.setAttribute('data-theme', t); try { localStorage.setItem('ptree-theme', t); } catch (e) {} if (tg) tg.checked = t === 'dark'; }
      // (the page's own pictures at once, so the new theme is complete when it is shown)
      lastDraw = lastPulse = null; ringStrips(); traces(); if (isHome()) frame(); else if (state !== 'app') drawFigure(cur.open, cur.mask);
      if (aurCtx) paintAurora(performance.now());
    };
    if (!trusted || reduced()) { apply(); return; }
    var k = slow();
    if (state === 'app' && document.startViewTransition) {
      html.classList.add('tm-theme-fade');
      var vt = document.startViewTransition(apply), off = function () { html.classList.remove('tm-theme-fade'); };
      vt.finished.then(off, off);
      return;
    }
    html.classList.add('tm-theme-soft'); void document.body.offsetWidth;
    // copies of the background's pictures as they are, fading out over the new ones (the figure's
    // colours are the same in both themes; its plate crossfades in CSS)
    [aur, trC].forEach(function (c) {
      if (!c || c.hidden || !c.width || !c.animate) return;
      var copy = document.createElement('canvas');
      copy.className = c.className; copy.setAttribute('aria-hidden', 'true'); copy.style.cssText = c.style.cssText; copy.width = c.width; copy.height = c.height;
      try { copy.getContext('2d').drawImage(c, 0, 0); } catch (e) { return; }
      c.parentNode.insertBefore(copy, c.nextSibling);
      var an = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520 * k, easing: 'ease-in-out', fill: 'forwards' });
      an.onfinish = function () { copy.remove(); };
    });
    apply();
    setTimeout(function () { html.classList.remove('tm-theme-soft'); }, 560 * k);
  }
  // the workspace's switch (a checkbox in a label): a visitor's click or key plays the transition
  function hookThemeSwitch() {
    var tg = $('themeToggle'); if (!tg || tg.__home) return; tg.__home = true;
    var lab = tg.closest('label');
    var on = function (e) { if (!e.isTrusted) return; e.preventDefault(); e.stopPropagation(); switchTheme(lab || tg, true); };
    if (lab) lab.addEventListener('click', function (e) { if (e.target === tg) return; on(e); }, true);
    tg.addEventListener('click', on, true);
  }

  // ------------------------------------------------------------------ start
  function version() { var v = $('proVersion'); return v && v.textContent ? v.textContent : ''; }
  document.addEventListener('DOMContentLoaded', function () {
    hookWorkspace(); hookThemeSwitch();
    $('thVersion').textContent = version();
    var b = $('proHomeBtn'); if (b) b.addEventListener('click', homeClicked);
    var brand = document.querySelector('.pro-topbar .pro-brand');
    if (brand) { brand.style.cursor = 'pointer'; brand.title = 'Home'; brand.addEventListener('click', homeClicked); }
    if (!(window.tmReport && $('proReportBtn'))) { var rp = $('thReport'); if (rp) rp.remove(); }
    else $('thReport').addEventListener('click', function () { tmReport.show(); });
    if (!(window.tmIntake && tmIntake.paste)) $('thPaste').remove();
    renderRecent(); ringStrips();
    relayout();
  });
  window.addEventListener('load', function () { hookWorkspace(); if (isHome()) relayout(); });
  // (a reload starts at the top: the page asks the browser not to restore the scroll, see the <head>)
  if (window.scrollY) window.scrollTo(0, 0);
  window.addEventListener('pageshow', function (e) { if (e.persisted && isHome()) { window.scrollTo(0, 0); relayout(); } });
  traces(); measure(); frame(); startBackground();
  window.tmHome = {
    open: openExample, show: function () { homeClicked(); }, state: function () { return state; },
    figure: function () { return { cx: cur.cx, cy: cur.cy, r: cur.r, rot: cur.rot, open: cur.open, mask: cur.mask }; },   // where the figure is (window px) and how it is drawn
    layout: function () { if (!M) measure(); return JSON.parse(JSON.stringify(M)); },
    reloading: function () { return reloading; },
    examples: Object.keys(EXAMPLES)
  };
})();
