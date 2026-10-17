// Clade Tools accent bar animation.
// Moves the 200%-wide gradient strip (.clade-toolbar::before) left by one toolbar
// width and back every 3 s with ease-in-out, like the original CSS animation.
// It is driven from requestAnimationFrame on purpose: frames only run when the
// page is idle, so the bar stands still while the app is busy (as it originally
// did), and changing only `transform` on its own GPU layer causes no repaint.
(function () {
  'use strict';
  var PERIOD_MS = 3000;

  // CSS 'ease-in-out' = cubic-bezier(0.42, 0, 0.58, 1)
  function easeInOut(t) {
    var x1 = 0.42, x2 = 0.58;
    // solve bezier x(s) = t for s (Newton's method, then bisection fallback)
    function bx(s) { return 3 * x1 * s * (1 - s) * (1 - s) + 3 * x2 * s * s * (1 - s) + s * s * s; }
    function dbx(s) { return 3 * x1 * (1 - s) * (1 - s) + 6 * (x2 - x1) * s * (1 - s) + 3 * (1 - x2) * s * s; }
    var s = t;
    for (var i = 0; i < 8; i++) {
      var d = dbx(s); if (Math.abs(d) < 1e-6) break;
      s -= (bx(s) - t) / d;
    }
    if (!(s >= 0 && s <= 1) || Math.abs(bx(s) - t) > 1e-5) {
      var lo = 0, hi = 1; s = t;
      for (var j = 0; j < 30; j++) { s = (lo + hi) / 2; if (bx(s) < t) lo = s; else hi = s; }
    }
    // y1 = 0, y2 = 1
    return 3 * s * s * (1 - s) + s * s * s;
  }

  // Offset in % of the strip width at time `now` (0 → -50 → 0 over one period)
  function offsetAt(now) {
    var t = (now % PERIOD_MS) / PERIOD_MS;
    return t < 0.5 ? -50 * easeInOut(t * 2) : -50 + 50 * easeInOut((t - 0.5) * 2);
  }

  // Set the offset as a non-inherited custom property on the toolbar element;
  // .clade-toolbar::before uses it in its transform (see styles.css).
  var toolbar = null;
  var last = null;
  function frame(now) {
    if (!toolbar || !toolbar.isConnected) toolbar = document.getElementById('cladeToolbar');
    if (toolbar) {
      var x = Math.round(offsetAt(now) * 100) / 100;
      if (x !== last) { toolbar.style.setProperty('--shimmer-x', x + '%'); last = x; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
