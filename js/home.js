// The home page (loaded right after its markup in index.html, before the workspace's scripts;
// js/home-figure.js and js/home-tree.js first). A page of its own: html.tm-home is set in the
// <head>, so the workspace is never seen before the home page.
//   - The reverse transcriptase figure (the RT example as TreeMapper draws it) sits in a fixed
//     layer. Scrolling brings it up from the bottom of the window, turns it and runs pulses of
//     light from the root to the tips; it is still when the page is still. A slow drifting
//     light behind the page moves all the time.
//   - Ways in: open or drop a tree or session, generate a tree, open from a URL, paste data,
//     the examples, recent sessions (js/recent.js), an empty workspace.
//   - Opening anything plays one transition (about 0.75 s): the page slides away, the figure
//     flies to where the drawing sits in the workspace while the workspace's panels come in
//     from their edges, then the figure crossfades into the real drawing. If the session is
//     not ready yet, the figure waits there with a slow pulse. No other loading screen or
//     status messages. The workspace's Home button asks first, then plays it in reverse and
//     closes the session. Reduced motion: a plain crossfade.
//   - The viewer's theme is never changed by opening anything.
// window.tmHome: { open(exampleId), show(), state(), figure() }.
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
  var EASE = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };   // ease-in-out
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var DUR0 = 760;
  // --th-slow on <html> (a number) slows the transition down, for checking it frame by frame
  var slow = function () { var v = parseFloat(getComputedStyle(html).getPropertyValue('--th-slow')); return v > 0 ? v : 1; };

  // ------------------------------------------------------------------ the page's state
  // 'home' -> 'opening' (flying / waiting) -> 'app' -> 'closing' -> 'home'
  var state = 'home';
  function isHome() { return state === 'home'; }
  function app() { return document.querySelector('.pro-app'); }

  // ------------------------------------------------------------------ the figure
  var figEl = $('thFigure'), cStatic = $('thFigStatic'), cPulse = $('thFigPulse');
  var fig = window.TM_HOME_FIGURE && window.tmHomeTree ? tmHomeTree.create(TM_HOME_FIGURE) : null;
  var RP = 0, paintedTheme = '', paintedDpr = 0;
  var PF = window.TM_HOME_FIGURE ? Math.min(1, (TM_HOME_FIGURE.rings[0].outer + 0.04)) : 1;   // the tree's share of the figure, and a margin for the glow   // the radius the canvases are painted at (css px)
  var cur = { cx: 0, cy: 0, r: 100, rot: 0, pulse: 0 };   // where the figure is (viewport px)
  function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
  function paintStatic(R) {
    if (!fig) return;
    R = Math.ceil(R);
    if (R === RP && paintedTheme === theme() && paintedDpr === dpr()) return;
    RP = R; paintedTheme = theme(); paintedDpr = dpr();
    var S = 2 * R, d = dpr();
    figEl.style.width = S + 'px'; figEl.style.height = S + 'px';
    cStatic.width = cStatic.height = Math.round(S * d);
    // the pulses run only along the tree's branches (within PF of the figure's radius): their
    // canvas covers that disc alone, so a scroll frame clears and paints a fifth of the pixels
    var P = Math.ceil(S * PF);
    cPulse.width = cPulse.height = Math.round(P * d);
    cPulse.style.width = cPulse.style.height = P + 'px'; cPulse.style.left = cPulse.style.top = ((S - P) / 2) + 'px';
    var g = cStatic.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, S, S);
    fig.paint(g, { cx: R, cy: R, radius: R, dpr: d, theme: theme(), only: 'static' });
    lastPulse = null;
  }
  var lastPulse = null;
  function paintPulses(phase, alpha) {
    if (!fig || !RP) return;
    var key = phase.toFixed(4) + ':' + alpha.toFixed(2) + ':' + RP + theme();
    if (key === lastPulse) return; lastPulse = key;
    var P = Math.ceil(2 * RP * PF), d = dpr(), g = cPulse.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, P, P);
    if (alpha > 0.01) fig.paint(g, { cx: P / 2, cy: P / 2, radius: RP, dpr: d, theme: theme(), only: 'pulses', pulse: phase, pulseAlpha: alpha });
  }
  function tf(s) { return 'translate(' + s.cx.toFixed(2) + 'px,' + s.cy.toFixed(2) + 'px) rotate(' + s.rot.toFixed(4) + 'rad) scale(' + (s.r / RP).toFixed(5) + ') translate(' + (-RP) + 'px,' + (-RP) + 'px)'; }
  function place(s) {
    cur = s;
    if (!RP) return;
    figEl.style.transform = tf(s);
  }
  // the figure's flights run as Web Animations of its transform, on the compositor: they stay
  // smooth while the main thread is busy reading and drawing the session
  var flying = null;
  function fly(to, ms, done) {
    if (flying) {   // a flight in progress: the new one starts where the figure is now
      var f = flying, p = clamp((performance.now() - f.t0) / f.ms, 0, 1), e = EASE(p);
      cur = { cx: lerp(f.from.cx, f.end.cx, e), cy: lerp(f.from.cy, f.end.cy, e), r: lerp(f.from.r, f.end.r, e), rot: lerp(f.from.rot, f.end.rot, e) };
      f.onfinish = null; f.cancel(); flying = null;
    }
    var from = cur, rot0 = from.rot, rot1 = to.rot;
    while (rot1 - rot0 > Math.PI) rot1 -= 2 * Math.PI; while (rot0 - rot1 > Math.PI) rot1 += 2 * Math.PI;
    var end = { cx: to.cx, cy: to.cy, r: to.r, rot: rot1 };
    if (!figEl.animate || ms <= 0) { place(end); if (done) done(); return; }
    var a = figEl.animate([{ transform: tf(from) }, { transform: tf(end) }], { duration: ms, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
    a.from = from; a.end = end; a.t0 = performance.now(); a.ms = ms;
    flying = a; place(end);
    a.onfinish = function () { if (flying !== a) return; flying = null; a.cancel(); if (done) done(); };
  }
  function fade(el, to, ms) {
    if (!el.animate) { el.style.opacity = String(to); return; }
    var from = getComputedStyle(el).opacity;
    el.style.opacity = String(to);
    el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: 'ease-in-out' });
  }

  // where the figure sits for a scroll position: from the dome under the launcher (at the top)
  // to the space between the two panels (at the bottom of the page); on a narrow window it
  // follows its place in the page
  var anchors = null;
  function measure() {
    var vw = window.innerWidth, vh = window.innerHeight, slot = $('thSlot'), ways = $('thWays');
    var max = Math.max(1, document.documentElement.scrollHeight - vh), sy = window.scrollY || 0;
    var slotR = slot.getBoundingClientRect(), waysR = ways.getBoundingClientRect();
    var wide = vw > 1040;
    if (wide) {
      // the stage starts low enough to leave the dome room, and peeks in at the bottom corners
      // (the taller panel's top about 170 px above the bottom of the window, at the top of the page)
      var heroBot = waysR.bottom + sy, stage = slot.parentNode;
      var panelTop = function () { return Math.min($('thExamples').getBoundingClientRect().top, document.querySelector('.th-right').getBoundingClientRect().top) + sy; };
      var gap = stage.__gap || 96;   // (96: the stylesheet's own until set here)
      for (var it = 0; it < 2; it++) {
        var want = Math.round(Math.max(40, gap + (vh - 170) - panelTop()));
        if (want === gap) break;
        gap = want; stage.__gap = gap; stage.style.setProperty('--th-stage-gap', gap + 'px');
      }
      slotR = slot.getBoundingClientRect(); max = Math.max(1, document.documentElement.scrollHeight - vh);
      var top0 = heroBot + 30;                                  // the dome's top, under the ways in
      var r0 = clamp(vh - 6 - top0, 260, vw * 0.3);             // its centre near the bottom of the window
      var a = { cx: vw / 2, cy: top0 + r0, r: r0, rot: 0 };
      // at the bottom of the page: the slot's visible part
      var sTop = slotR.top + sy - max, sBot = Math.min(vh - 20, slotR.bottom + sy - max);
      var hTop = Math.max(sTop, 72);
      var r1 = Math.max(160, Math.min(slotR.width, sBot - hTop) / 2 - 8);
      var b = { cx: slotR.left + slotR.width / 2, cy: (hTop + sBot) / 2, r: r1, rot: -0.62 };
      anchors = { wide: true, a: a, b: b, max: max };
    } else {
      var rr = slotR.width / 2;
      anchors = { wide: false, cx: slotR.left + rr, docY: slotR.top + sy + slotR.height / 2, r: rr * 0.98, max: max };
    }
  }
  function homeState(sy) {
    if (!anchors) measure();
    var A = anchors;
    if (A.wide) {
      // it shrinks and turns over the whole scroll; its top moves up with the page (so no gap
      // opens under the launcher) until the figure reaches its place between the panels
      var p = clamp(sy / A.max, 0, 1), e = p * p * (3 - 2 * p), r = lerp(A.a.r, A.b.r, e);
      var top = Math.max(A.a.cy - A.a.r - sy, A.b.cy - A.b.r), cy = Math.max(top + r, A.b.cy);
      // the pulses run while the page moves, and are out of sight at the top and the bottom
      var pa = clamp(Math.min(p / 0.08, (1 - p) / 0.08), 0, 1);
      return { cx: lerp(A.a.cx, A.b.cx, e), cy: cy, r: r, rot: lerp(A.a.rot, A.b.rot, e), pulse: p * 1.15, pa: pa };
    }
    return { cx: A.cx, cy: A.docY - sy, r: A.r, rot: -sy / 900, pulse: sy / 700, pa: clamp(sy / 60, 0, 1) };
  }
  var raf = 0;
  function onScroll() { if (!raf && isHome()) raf = requestAnimationFrame(function () { raf = 0; frame(); }); }
  function frame() {
    if (!isHome()) return;
    var s = homeState(window.scrollY || 0);
    paintStatic(Math.max(anchors.wide ? Math.max(anchors.a.r, anchors.b.r) : anchors.r, 1));
    place(s); paintPulses(s.pulse, s.pa);
  }
  function relayout() { anchors = null; measure(); frame(); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { if (isHome()) relayout(); });
  new MutationObserver(function () { paintedTheme = ''; ringStrips(); if (isHome()) frame(); else if (state === 'opening') paintStatic(RP); }).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (isHome()) relayout(); });

  // each ring of the figure in the list beside it, as a strip of its own cells (a slice of the
  // circle, unrolled), so the list and the rings can be matched by eye
  function ringStrips() {
    var F = window.TM_HOME_FIGURE; if (!F) return;
    document.querySelectorAll('#tmHome [data-ring]').forEach(function (li) {
      var ri = F.rings.map(function (r) { return r.type; }).indexOf(li.getAttribute('data-ring')); if (ri < 0) return;
      var c = li.querySelector('canvas');
      if (!c) { c = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true'); li.insertBefore(c, li.firstChild); }
      var W = 88, H = 28; c.width = W; c.height = H;
      var g = c.getContext('2d'), pal = F.pal[theme()], A = F.arcs, ring = F.rings[ri];
      g.fillStyle = theme() === 'dark' ? '#0C1116' : '#FFFFFF'; g.fillRect(0, 0, W, H);
      // the whole circle from the top, clockwise
      var a0 = 0, a1 = Math.PI * 2, span = a1 - a0;
      if (F.rings[ri].type.indexOf('dataframe') === 0) {
        // a gene ring: its regions as one bar, each as wide as its share of the ring
        var area = {}, rad = {}, tot = 0;
        for (var j = 0; j < A.length; j += 6) { if (A[j + 5] !== ri) continue; var w = ((A[j + 1] - A[j] + 62832) % 62832) * (A[j + 3] - A[j + 2]); area[A[j + 4]] = (area[A[j + 4]] || 0) + w; rad[A[j + 4]] = (rad[A[j + 4]] || 0) + w * (A[j + 2] + A[j + 3]) / 2; tot += w; }
        var x = 0;
        // (inside out: N-terminal region, RT domain, C-terminal region)
        Object.keys(area).sort(function (u, v) { return rad[u] / area[u] - rad[v] / area[v]; }).forEach(function (ci) { var wd = area[ci] / tot * W; g.fillStyle = pal[ci]; g.fillRect(x, 0, wd, H); x += wd; });
        return;
      }
      for (var i = 0; i < A.length; i += 6) {
        if (A[i + 5] !== ri) continue;
        var s = A[i] / 1e4, e = A[i + 1] / 1e4; if (e < s) e += Math.PI * 2;
        var x0 = (s - a0) / span * W, x1 = Math.max(x0 + 0.6, (e - a0) / span * W);
        var r0 = (A[i + 2] / 1e4 - ring.inner) / (ring.outer - ring.inner), r1 = (A[i + 3] / 1e4 - ring.inner) / (ring.outer - ring.inner);
        g.fillStyle = pal[A[i + 4]];
        g.fillRect(x0, H * (1 - r1), x1 - x0, H * (r1 - r0));
      }
    });
  }

  // ------------------------------------------------------------------ the drifting light
  var aur = $('thAurora'), aurCtx = aur ? aur.getContext('2d') : null, aurRun = 0, aurLast = 0;
  var BLOBS = [   // [colour, x period (s), y period (s), size, phase]
    ['20,184,166', 47, 61, 0.62, 0.1], ['16,185,129', 71, 53, 0.50, 2.2], ['14,165,233', 59, 79, 0.55, 4.1],
    ['99,102,241', 83, 67, 0.48, 1.3], ['230,159,0', 97, 89, 0.32, 3.4]
  ];
  if (aur) { aur.width = 192; aur.height = 120; }
  function aurora(t) {
    aurRun = 0;
    if (!aurCtx || !(isHome() || state === 'opening' || state === 'closing') || document.hidden) return;
    if (t - aurLast > 32) {   // ~30 frames a second is plenty for something this slow
      aurLast = t;
      var W = 192, H = 120, s = t / 1000, dark = theme() === 'dark';
      aurCtx.clearRect(0, 0, W, H);
      aurCtx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      BLOBS.forEach(function (b, i) {
        var x = W * (0.5 + 0.42 * Math.sin(s * 2 * Math.PI / b[1] + b[4])), y = H * (0.45 + 0.4 * Math.sin(s * 2 * Math.PI / b[2] + b[4] * 1.7));
        var r = W * b[3] * (0.9 + 0.1 * Math.sin(s / 7 + i)), g = aurCtx.createRadialGradient(x, y, 0, x, y, r);
        var a = (dark ? 0.26 : 0.24) * (i === 4 ? 0.6 : 1);
        g.addColorStop(0, 'rgba(' + b[0] + ',' + a + ')'); g.addColorStop(1, 'rgba(' + b[0] + ',0)');
        aurCtx.fillStyle = g; aurCtx.fillRect(0, 0, W, H);
      });
      aurCtx.globalCompositeOperation = 'source-over';
    }
    aurRun = requestAnimationFrame(aurora);
  }
  function startAurora() { if (!aurRun && !reduced()) aurRun = requestAnimationFrame(aurora); else if (reduced()) aurora(1e5); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) startAurora(); });

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
    if (!window.tmRecent) return;
    tmRecent.list().then(function (list) {
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
      $('thRecentClear').hidden = list.length === 0;
      if (isHome()) relayout();
    });
  }
  document.addEventListener('tm-recent-changed', function () { renderRecent(); });

  // ------------------------------------------------------------------ the workspace, quietly
  // While the home page is up or the transition runs, the workspace's notices are not shown and
  // its panels come in empty (one loading state only); afterwards they work as before.
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
    if (typeof note === 'function' && !note.__home) { window.showNotification = function () { if (quiet) return; return note.apply(this, arguments); }; window.showNotification.__home = true; }
    // a tree being read: the start of an opening (a session's tree, a generated, pasted or dropped tree)
    var htf = window.handleTreeFile;
    if (typeof htf === 'function' && !htf.__home) {
      window.handleTreeFile = async function () {
        var own = state === 'home';
        if (own) begin('tree');
        reading++;
        try { return await htf.apply(this, arguments); }
        finally {
          reading--;
          var sessionLoading = window.tmSession && tmSession.isLoading && tmSession.isLoading();
          if (state === 'opening' && !sessionLoading && pendingKind !== 'session') ready(hasTree());
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
        if (state === 'home') begin('url');
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

  // ------------------------------------------------------------------ opening: one transition
  var pendingKind = '', isReady = false, readyOk = false, flight = null, watch = 0;
  function say(t) { var s = $('thError'); if (s) s.textContent = t || ''; }
  // the drawing's place in the workspace: a circular drawing by its own centre and outer ring,
  // a rectangular one by its box; before anything is drawn, the middle of the canvas
  function target() {
    var center = document.querySelector('.pro-center'), cr = center ? center.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    // (TreeMapper fits a circular drawing to about half the canvas's shorter side, a little below
    // its middle under the toolbar, up to a radius of about 460 px: measured at 1280-2560 px wide)
    var fallback = { cx: cr.left + cr.width / 2, cy: cr.top + cr.height * 0.53, r: Math.max(120, Math.min(458, Math.min(cr.width, cr.height) * 0.495)), rot: 0, exact: false };
    if (!isReady || !readyOk) return fallback;
    try {
      var spin = document.querySelector('#svg .spin');
      if (typeof geometry !== 'undefined' && geometry === 'radial' && spin && window.radialPanelSystem) {
        var rings = radialPanelSystem.getRings() || [], last = rings[rings.length - 1], m = spin.getScreenCTM();
        var outer = last ? last.outerRadius || last.outer : 0, k = m ? Math.hypot(m.a, m.b) : 0;
        if (outer && k) return { cx: m.e, cy: m.f, r: outer * k, rot: Math.atan2(m.b, m.a), exact: true };
      }
      var z = document.querySelector('#zoomable'), b = z ? z.getBoundingClientRect() : null;
      if (b && b.width > 4 && b.height > 4) return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2, rot: 0, exact: false };
    } catch (e) {}
    return fallback;
  }
  // an opening has begun (a click on an example, a file chosen, a session being read ...)
  function begin(kind) {
    if (state !== 'home') return;
    hookWorkspace();
    state = 'opening'; pendingKind = kind || ''; isReady = false; readyOk = false; say('');
    quiet = true;
    cancelAnimationFrame(raf); raf = 0;
    place(homeState(window.scrollY || 0));
    // reduced motion: one crossfade at once, to the workspace with the figure (still) where the
    // drawing will be, breathing until the session is ready; then a crossfade to the drawing
    if (reduced()) {
      html.classList.add('tm-reduced', 'tm-out', 'tm-hide-drawing', 'tm-wait-content');
      var sp0 = document.querySelector('.sidepanel'); if (sp0) void getComputedStyle(sp0).opacity;
      html.classList.add('tm-moving');
      figEl.style.opacity = '0';
      requestAnimationFrame(function () {
        html.classList.remove('tm-out'); html.classList.add('tm-away');
        place(target()); fade(figEl, 1, 300); figEl.classList.add('th-wait');
        flight = true; setTimeout(function () { flight = null; if (state === 'opening' && isReady) landed(); }, 320);
      });
      return;
    }
    html.classList.remove('tm-reduced');
    html.style.setProperty('--th-home-delay', '0s'); html.style.setProperty('--th-panel-delay', '.22s');
    // the panels are put outside first, with no transition, then shown and let in
    html.classList.add('tm-out', 'tm-hide-drawing', 'tm-wait-content');
    var sp = document.querySelector('.sidepanel'); if (sp) void getComputedStyle(sp).transform;
    html.classList.add('tm-moving');
    var k = slow();
    flight = true;
    requestAnimationFrame(function () {
      html.classList.add('tm-away');
      setTimeout(function () { if (state === 'opening') html.classList.remove('tm-out'); }, 60 * k);
    });
    fade(cPulse, 0, 420 * k);
    fly(target(), DUR0 * k, function () { flight = null; if (state !== 'opening') return; if (isReady) landed(); else hold(); });
  }
  // the flight is over before the session: the figure waits in place with a slow breath (CSS)
  function hold() { figEl.classList.add('th-wait'); }
  function ready(ok) {
    if (state !== 'opening' || isReady) return;
    clearTimeout(watch);
    isReady = true; readyOk = !!ok;
    if (!ok) { fail(); return; }
    if (!flight) landed();
  }
  // the figure is over the drawing (a last short move when the drawing's place is known only
  // now), then one crossfade, and the workspace is the page
  function landed() {
    var tg = target(), k = slow();
    var off = Math.abs(tg.cx - cur.cx) + Math.abs(tg.cy - cur.cy) + Math.abs(tg.r - cur.r);
    var cross = function () {
      figEl.classList.remove('th-wait');
      html.classList.remove('tm-hide-drawing', 'tm-wait-content');
      // the drawing comes in first; the figure goes a moment later, so there is never a gap
      setTimeout(function () { fade(figEl, 0, 260 * k); }, 90 * k);
      setTimeout(finishOpen, 380 * k);
    };
    if (off > 1.5 && !reduced()) fly(tg, 320 * k, cross); else { if (reduced()) place(tg); cross(); }
  }
  function finishOpen() {
    if (state !== 'opening') return;
    state = 'app'; quiet = false;
    html.classList.remove('tm-home', 'tm-moving', 'tm-away', 'tm-out', 'tm-hide-drawing', 'tm-reduced', 'tm-wait-content');
    figEl.style.opacity = '0'; figEl.hidden = true; figEl.classList.remove('th-wait');
    var b = $('proHomeBtn'); if (b) b.focus({ preventScroll: true });
  }
  // nothing opened (a refused file, a failed fetch): back to the home page, with the reason
  function fail(msg) {
    if (state !== 'opening') return;
    clearTimeout(watch);
    state = 'closing'; quiet = true; flight = null;
    var k = slow();
    say(msg || '');
    html.style.setProperty('--th-home-delay', '.24s'); html.style.setProperty('--th-panel-delay', '0s');
    // the way back: the panels go, the page returns, the figure flies back to its place
    html.classList.add('tm-out'); html.classList.remove('tm-away', 'tm-hide-drawing', 'tm-wait-content');
    figEl.classList.remove('th-wait'); figEl.style.opacity = '1'; fade(cPulse, 1, 400 * k);
    var back = async function () {
      html.classList.remove('tm-moving', 'tm-out', 'tm-reduced');
      figEl.style.opacity = ''; cPulse.style.opacity = '';
      await closeWorkspace();
      state = 'home'; relayout();
    };
    if (reduced()) { back(); return; }
    anchors = null; measure();
    fly(homeState(window.scrollY || 0), DUR0 * k, back);
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
  document.addEventListener('tm-session-loading', function () { if (state === 'home') begin('session'); else if (state === 'opening') pendingKind = 'session'; });
  document.addEventListener('tm-session-ready', function (e) { if (state === 'opening') ready(e.detail && e.detail.ok); });

  // ------------------------------------------------------------------ the ways in
  function click(id) { var b = $(id); if (b) b.click(); }
  $('thOpen').addEventListener('click', function () { say(''); click('proEmptyOpen'); });
  $('thGenerate').addEventListener('click', function () { say(''); click('proEmptyGenerate'); });
  $('thUrl').addEventListener('click', function () { say(''); click('proEmptyUrl'); });
  $('thPaste').addEventListener('click', function () { say(''); if (window.tmIntake && tmIntake.paste) tmIntake.paste(''); });
  $('twSkip').addEventListener('click', function () { if (state !== 'home') return; begin('empty'); ready(true); });
  $('thTheme').addEventListener('click', function () {
    var tg = $('themeToggle');
    if (tg && tg.__bound !== false && document.readyState !== 'loading') tg.click();
    else { var t = theme() === 'dark' ? 'light' : 'dark'; html.setAttribute('data-theme', t); try { localStorage.setItem('ptree-theme', t); } catch (e) {} }
  });
  // a file chosen in the workspace's file picker while on the home page: its opening begins
  // with the visitor's choice (the reading starts a moment later)
  document.addEventListener('change', function (e) {
    var t = e.target; if (state !== 'home' || !t || t.type !== 'file' || !t.files || !t.files.length) return;
    if (t.id === 'treeFile') begin(window.tmSession && tmSession.isSessionFile(t.files[0]) ? 'session' : 'tree');
  }, true);

  // Generate tree (its dialog shows over the home page): the opening begins with the click, as
  // building the tree can take a while before it is read
  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('#generateTreeBtn'), f = $('geneDataFile');
    if (g && state === 'home' && f && f.files && f.files.length) begin('tree');
  }, true);
  var loadScript = function (src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('it could not be loaded')); }; document.head.appendChild(s); }); };
  function stamp() { var sc = document.querySelector('script[src*="home.js"]'), m = sc && /[?&]v=(\d+)/.exec(sc.getAttribute('src') || ''); return m ? '?v=' + m[1] : ''; }
  var EXAMPLES = { 'rt-references': 'rt-references.treemapper', mock: 'crispr-cas-loci.treemapper' };
  // two frames: the transition is handed to the compositor before the reading blocks the page
  var frames = function () { return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); }); };
  async function openExample(id) {
    if (state !== 'home' || !EXAMPLES[id]) return;
    begin('session');
    await frames();
    // (slowed down for checking: the reading waits for the flight, so its frames show the motion alone)
    if (slow() > 1) await new Promise(function (r) { setTimeout(r, DUR0 * slow()); });
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
    if (r) { if (state !== 'home') return; begin('session'); frames().then(function () { return tmRecent.open(r.getAttribute('data-recent')); }).catch(function (err) { fail('Could not open it: ' + (err && err.message ? err.message : err)); }); return; }
    var x = e.target.closest('[data-example]'); if (x) { e.preventDefault(); openExample(x.getAttribute('data-example')); return; }
    // the figure itself opens its example (where the page shows it, not under a panel or a control)
    if (overFigure(e)) { openExample('rt-references'); return; }
    var j = e.target.closest('[data-jump]'); if (j) { var el = $(j.getAttribute('data-jump')); if (el) { e.preventDefault(); window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); } }
  });
  function overFigure(e) {
    if (state !== 'home' || !e.target.closest || e.target.closest('button, a, input, label, .th-panel, .th-launch, .th-ways, .th-top, .th-eyebrow, h1, p')) return false;
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
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
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
  function goHome() {
    if (state !== 'app') return;
    state = 'closing'; quiet = true;
    isReady = true; readyOk = hasTree();
    var from = target(), k = slow();
    window.scrollTo(0, 0);
    html.style.setProperty('--th-home-delay', '.24s'); html.style.setProperty('--th-panel-delay', '0s');
    // the page is back underneath, still away; the figure over the drawing, unseen yet
    html.classList.add('tm-home', 'tm-moving', 'tm-away');
    anchors = null; measure();
    var to = homeState(0);
    paintStatic(Math.max(anchors.wide ? Math.max(anchors.a.r, anchors.b.r) : anchors.r, from.r));
    paintPulses(to.pulse, to.pa); cPulse.style.opacity = '0';
    figEl.hidden = false; figEl.classList.remove('th-wait'); figEl.style.opacity = '0';
    place(from);
    var done = async function () {
      html.classList.remove('tm-moving', 'tm-away', 'tm-out', 'tm-hide-drawing', 'tm-reduced');
      figEl.style.opacity = ''; cPulse.style.opacity = '';
      await closeWorkspace();
      state = 'home';
      renderRecent(); relayout(); startAurora();
      var o = $('thOpen'); if (o) o.focus({ preventScroll: true });
    };
    if (reduced()) {
      html.classList.add('tm-reduced');
      place(to); cPulse.style.opacity = '1';
      requestAnimationFrame(function () { fade(figEl, 1, 300); html.classList.remove('tm-away'); html.classList.add('tm-out'); setTimeout(done, 320); });
      return;
    }
    html.classList.remove('tm-reduced');
    startAurora();
    requestAnimationFrame(function () {
      // 1. crossfade from the drawing to the figure in the same place
      fade(figEl, 1, 280 * k); html.classList.add('tm-hide-drawing');
      setTimeout(function () {
        // 2. the panels go back to their edges, the page comes back, the figure flies home
        html.classList.add('tm-out'); html.classList.remove('tm-away');
        fade(cPulse, 1, 500 * k);
        fly(to, DUR0 * k, done);
      }, 300 * k);
    });
  }

  // ------------------------------------------------------------------ start
  function version() { var v = $('proVersion'); return v && v.textContent ? v.textContent : ''; }
  document.addEventListener('DOMContentLoaded', function () {
    hookWorkspace();
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
  measure(); frame(); startAurora();
  window.tmHome = {
    open: openExample, show: function () { homeClicked(); }, state: function () { return state; },
    figure: function () { return { cx: cur.cx, cy: cur.cy, r: cur.r, rot: cur.rot }; },   // where the figure is (window px)
    examples: Object.keys(EXAMPLES)
  };
})();
