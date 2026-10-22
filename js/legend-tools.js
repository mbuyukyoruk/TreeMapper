// Legend panel: a cap and a filter for long colour keys (loaded after app.js).
//
// Each group of the legend (genes, a heatmap's values, highlights, ...) shows at most CAP
// entries, then "Show all N" / "Show fewer". With more than FILTER_FROM entries in the whole
// legend a filter box appears under the panel's title; typing lists only the matching
// entries of every group (the cap is lifted while filtering). The SVG export still carries
// every entry: hidden rows stay in the page. The legend is rebuilt by the app after every
// change, so this watches it and applies the cap and filter again each time.
(function () {
  'use strict';
  var CAP = 30, FILTER_FROM = 12;
  var legend = document.getElementById('metadataLegend');
  var body = legend && legend.closest('.pro-legend-body');
  if (!legend || !body) return;
  var query = '', expanded = new Set();   // groups shown in full (by their element)
  var busy = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function groups() { return Array.prototype.slice.call(legend.querySelectorAll('.legend-items')); }
  function rowsOf(g) { return Array.prototype.filter.call(g.children, function (el) { return el.classList.contains('legend-item'); }); }
  function labelOf(row) { var s = row.querySelector('.legend-label, span:last-child'); return (s ? s.textContent : row.textContent).trim().toLowerCase(); }

  function apply() {
    if (busy) return;
    busy = true;
    try {
      var q = query.trim().toLowerCase(), total = 0;
      groups().forEach(function (g) {
        var rows = rowsOf(g), old = g.querySelector('.lt-more');
        if (old) old.remove();
        total += rows.length;
        var shown = 0, matched = 0;
        rows.forEach(function (row) {
          var hit = !q || labelOf(row).indexOf(q) >= 0;
          if (hit) matched++;
          var visible = hit && (q || expanded.has(g) || shown < CAP);
          if (visible) shown++;
          row.hidden = !visible;
          row.classList.toggle('lt-hidden', !visible);
        });
        var subs = Array.prototype.filter.call(g.children, function (el) { return el.classList.contains('legend-subtitle'); });
        if (q) {
          // a layer's subtitle stays only when one of its rows matched
          subs.forEach(function (s) { var n = s.nextElementSibling, any = false; while (n && !n.classList.contains('legend-subtitle')) { if (n.classList.contains('legend-item') && !n.hidden) any = true; n = n.nextElementSibling; } s.hidden = !any; });
        } else subs.forEach(function (s) { s.hidden = false; });
        if (!q && rows.length > CAP) {
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'lt-more';
          var all = expanded.has(g);
          b.textContent = all ? 'Show fewer' : 'Show all ' + rows.length.toLocaleString();
          b.title = all ? 'Show the first ' + CAP + ' only' : rows.length - CAP + ' more entries';
          b.addEventListener('click', function () { if (expanded.has(g)) expanded.delete(g); else expanded.add(g); apply(); });
          g.appendChild(b);
        }
        if (q) {
          var note = document.createElement('div'); note.className = 'lt-more lt-count';
          if (rows.length && !matched) { note.textContent = 'No match'; g.appendChild(note); }
        }
      });
      var box = body.querySelector('.lt-filter');
      if (total > FILTER_FROM || q) {
        if (!box) {
          box = document.createElement('div');
          box.className = 'pro-search-row lt-filter';
          box.innerHTML = '<input type="text" class="pro-search lt-input" placeholder="Filter legend" aria-label="Filter the legend">' +
            '<button type="button" class="pro-search-clear lt-clear" title="Clear" aria-label="Clear the filter"></button>';
          body.insertBefore(box, body.firstChild);
          var inp = box.querySelector('.lt-input');
          inp.addEventListener('input', function () { query = inp.value; apply(); });
          inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { inp.value = ''; query = ''; apply(); inp.blur(); } });
          box.querySelector('.lt-clear').addEventListener('click', function () { inp.value = ''; query = ''; apply(); inp.focus(); });
        }
        box.classList.toggle('has-text', !!q);
        box.hidden = legend.style.display === 'none';
      } else if (box) box.hidden = true;
    } finally { busy = false; }
  }
  // the app rebuilds the legend's groups (innerHTML) after every change: apply again, once per frame
  var pending = 0;
  new MutationObserver(function (muts) {
    if (busy) return;
    // the app's rebuilds, not this script's own buttons
    var mine = function (n) { return n.nodeType === 1 && n.classList.contains('lt-more'); };
    var real = muts.some(function (m) {
      if (m.type !== 'childList') return m.attributeName === 'style';
      return Array.prototype.some.call(m.addedNodes, function (n) { return !mine(n); }) || Array.prototype.some.call(m.removedNodes, function (n) { return !mine(n); });
    });
    if (!real) return;
    if (!pending) pending = requestAnimationFrame(function () { pending = 0; apply(); });
  }).observe(legend, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  apply();
  window.tmLegendTools = { apply: apply, CAP: CAP, FILTER_FROM: FILTER_FROM, setQuery: function (q) { query = q || ''; var i = body.querySelector('.lt-input'); if (i) i.value = query; apply(); } };
})();
