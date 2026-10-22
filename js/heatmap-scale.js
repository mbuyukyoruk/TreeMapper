// Continuous colour scale for numeric heatmap columns (loaded after app.js).
//
// A heatmap column whose values are numbers (GC %, length, a score) is drawn on a gradient
// instead of one colour per distinct value: min → (mid) → max colours, linear or log, with
// the range taken from the data or set by hand. The card shows the gradient controls in
// place of the value list; the legend shows the bar with its range; the SVG export draws
// the same gradient. Sessions keep the settings through the card's controls.
// "Categories" switches a column back to one colour per value (the earlier behaviour).
(function () {
  'use strict';
  var DEFAULTS = { mode: 'auto', minColor: '#440154', midColor: '#21918c', maxColor: '#fde725', midEnabled: true, log: false, min: '', max: '' };
  var AUTO_MIN_DISTINCT = 8;     // fewer distinct numbers than this: categories (e.g. a 1–4 score)

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (v === '' || v == null) return NaN; var x = +String(v).trim(); return isFinite(x) ? x : NaN; }
  // numbers as the data shows them: up to 2 decimals, trimmed; very large or small ones in e-notation
  function fmt(x) {
    if (!isFinite(x)) return '';
    var a = Math.abs(x);
    if (a === 0) return '0';
    if (a >= 1e7 || a < 1e-3) return x.toExponential(2);
    if (a >= 1000) return String(Math.round(x));
    return String(+x.toFixed(a >= 100 ? 1 : 2));
  }

  // numbers in the column, and the data range; cached on the heatmap by its value list
  function stats(hm) {
    var vals = hm.uniqueValues || [];
    if (hm._hsStats && hm._hsStats.key === vals.length + ':' + vals[0] + ':' + vals[vals.length - 1]) return hm._hsStats;
    var nums = [], other = 0;
    vals.forEach(function (v) { var x = num(v); if (isNaN(x)) other++; else nums.push(x); });
    var st = { key: vals.length + ':' + vals[0] + ':' + vals[vals.length - 1], nums: nums.length, other: other,
      min: nums.length ? Math.min.apply(null, nums) : NaN, max: nums.length ? Math.max.apply(null, nums) : NaN };
    st.numeric = nums.length >= 2 && other <= Math.max(1, Math.floor(vals.length * 0.05));   // a few NA/blank entries are fine
    hm._hsStats = st;
    return st;
  }
  function scaleOf(hm) {
    if (!hm.scale) hm.scale = Object.assign({}, DEFAULTS);
    return hm.scale;
  }
  function isGradient(hm) {
    if (!hm) return false;
    var s = scaleOf(hm), st = stats(hm);
    if (!st.numeric) return false;
    if (s.mode === 'gradient') return true;
    if (s.mode === 'categories') return false;
    return st.nums >= AUTO_MIN_DISTINCT;
  }
  // the range drawn: by hand where set, else the data's
  function domain(hm) {
    var s = scaleOf(hm), st = stats(hm);
    var lo = num(s.min), hi = num(s.max);
    if (isNaN(lo)) lo = st.min;
    if (isNaN(hi)) hi = st.max;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    var log = !!s.log && lo > 0 && hi > 0;
    return { lo: lo, hi: hi, log: log };
  }
  function interpolator(hm) {
    var s = scaleOf(hm), d = domain(hm);
    var key = [s.minColor, s.midColor, s.maxColor, s.midEnabled, d.lo, d.hi, d.log].join('|');
    if (hm._hsInterp && hm._hsInterp.key === key) return hm._hsInterp.f;
    var sc = d.log ? d3.scaleLog() : d3.scaleLinear();
    var mid = d.log ? Math.sqrt(d.lo * d.hi) : (d.lo + d.hi) / 2;
    if (s.midEnabled) sc.domain([d.lo, mid, d.hi]).range([s.minColor, s.midColor, s.maxColor]);
    else sc.domain([d.lo, d.hi]).range([s.minColor, s.maxColor]);
    sc.interpolate(d3.interpolateRgb).clamp(true);
    var f = function (v) { var x = num(v); if (isNaN(x)) return '#d4d4d4'; if (d.log && x <= 0) return s.minColor; return d.lo === d.hi ? s.maxColor : sc(x); };
    hm._hsInterp = { key: key, f: f };
    return f;
  }
  function colorFor(hm, value) { return interpolator(hm)(value); }
  function cssGradient(hm) {
    var s = scaleOf(hm);
    return 'linear-gradient(90deg, ' + s.minColor + (s.midEnabled ? ', ' + s.midColor : '') + ', ' + s.maxColor + ')';
  }

  // ------------------------------------------------------------------ card
  function renderControls(heatmapId, hm) {
    var box = document.getElementById('heatmapData' + heatmapId);
    if (!box) return;
    var s = scaleOf(hm), st = stats(hm), d = domain(hm);
    var head = box.previousElementSibling && box.previousElementSibling.querySelector('.pro-section-title');
    if (head) head.textContent = 'Colour scale';
    box.classList.add('hs-box');
    box.innerHTML =
      '<div class="hs-mode pro-row"><span>Scale</span><span class="pro-radio-seg" role="radiogroup" aria-label="Heatmap scale">' +
        '<label><input type="radio" name="hsMode' + heatmapId + '" class="hs-mode-radio" value="gradient"' + (isGradient(hm) ? ' checked' : '') + '><span>Gradient</span></label>' +
        '<label><input type="radio" name="hsMode' + heatmapId + '" class="hs-mode-radio" value="categories"' + (!isGradient(hm) ? ' checked' : '') + '><span>Categories</span></label></span></div>' +
      '<div class="hs-bar" style="background:' + cssGradient(hm) + '"></div>' +
      '<div class="hs-range"><span class="hs-lo">' + esc(fmt(d.lo)) + '</span><span class="hs-note">' + st.nums + ' values' + (st.other ? ' · ' + st.other + ' not numbers (grey)' : '') + '</span><span class="hs-hi">' + esc(fmt(d.hi)) + '</span></div>' +
      '<div class="pro-row pro-sub"><span>Colours</span><span class="pro-inline hs-colours">' +
        '<input type="color" class="hs-min pro-color" value="' + s.minColor + '" title="Colour at the low end" aria-label="Low colour">' +
        '<input type="checkbox" class="hs-mid-enable pro-check" title="Use a middle colour"' + (s.midEnabled ? ' checked' : '') + ' aria-label="Use a middle colour">' +
        '<input type="color" class="hs-mid pro-color" value="' + s.midColor + '" title="Colour in the middle" aria-label="Middle colour"' + (s.midEnabled ? '' : ' disabled') + '>' +
        '<input type="color" class="hs-max pro-color" value="' + s.maxColor + '" title="Colour at the high end" aria-label="High colour"></span></div>' +
      '<div class="pro-row pro-sub"><span>Range</span><span class="pro-inline hs-minmax">' +
        '<input type="number" step="any" class="pro-num hs-rmin" value="' + esc(s.min) + '" placeholder="' + esc(fmt(st.min)) + '" title="Low end of the scale (empty: the data\'s minimum)" aria-label="Scale minimum">' +
        '<span class="hs-dash">–</span>' +
        '<input type="number" step="any" class="pro-num hs-rmax" value="' + esc(s.max) + '" placeholder="' + esc(fmt(st.max)) + '" title="High end of the scale (empty: the data\'s maximum)" aria-label="Scale maximum"></span></div>' +
      '<label class="pro-row pro-sub"><span>Log scale' + (st.min <= 0 ? ' <small class="hs-muted">(needs values above 0)</small>' : '') + '</span><input type="checkbox" class="hs-log pro-switch"' + (s.log ? ' checked' : '') + (st.min <= 0 ? ' disabled' : '') + '></label>' +
      '<p class="hs-hint">Values below the range take the low colour, above it the high colour.</p>';
  }
  function refreshBar(card, hm) {
    var bar = card.querySelector('.hs-bar'), d = domain(hm);
    if (bar) bar.style.background = cssGradient(hm);
    var lo = card.querySelector('.hs-lo'), hi = card.querySelector('.hs-hi');
    if (lo) lo.textContent = fmt(d.lo);
    if (hi) hi.textContent = fmt(d.hi);
    var mid = card.querySelector('.hs-mid'); if (mid) mid.disabled = !scaleOf(hm).midEnabled;
  }
  function redraw(hm) {
    hm._hsInterp = null;
    if (typeof updateMetadataLegend === 'function') updateMetadataLegend();
    if (typeof root !== 'undefined' && root) {
      if (typeof setDrawScope === 'function') setDrawScope('heatmap:' + hm.id);
      drawTree();
    }
  }
  function hmOf(el) {
    var card = el.closest('[id^="heatmapCard"]'); var m = card && /(\d+)$/.exec(card.id);
    var hm = m && typeof heatmaps !== 'undefined' && heatmaps.get(+m[1]);
    return hm ? { card: card, hm: hm, id: +m[1] } : null;
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.classList || !t.closest('.hs-box, .heatmap-value-card, [id^="heatmapData"]')) return;
    var x = hmOf(t); if (!x) return;
    var s = scaleOf(x.hm);
    if (t.classList.contains('hs-mode-radio')) {
      if (!t.checked) return;
      s.mode = t.value;
      // the card is built again for the other mode (populateHeatmapCard draws the value list)
      if (typeof populateHeatmapCard === 'function') populateHeatmapCard(x.id, x.hm.data);
      redraw(x.hm); return;
    }
    if (t.classList.contains('hs-min')) s.minColor = t.value;
    else if (t.classList.contains('hs-mid')) s.midColor = t.value;
    else if (t.classList.contains('hs-max')) s.maxColor = t.value;
    else if (t.classList.contains('hs-mid-enable')) s.midEnabled = t.checked;
    else if (t.classList.contains('hs-log')) s.log = t.checked;
    else if (t.classList.contains('hs-rmin')) s.min = t.value.trim() === '' ? '' : num(t.value);
    else if (t.classList.contains('hs-rmax')) s.max = t.value.trim() === '' ? '' : num(t.value);
    else return;
    refreshBar(x.card, x.hm);
    redraw(x.hm);
  });
  // colour inputs fire input while dragging: keep the bar live, draw on change
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t || !t.classList || !(t.classList.contains('hs-min') || t.classList.contains('hs-mid') || t.classList.contains('hs-max'))) return;
    var x = hmOf(t); if (!x) return;
    var s = scaleOf(x.hm);
    if (t.classList.contains('hs-min')) s.minColor = t.value; else if (t.classList.contains('hs-mid')) s.midColor = t.value; else s.maxColor = t.value;
    refreshBar(x.card, x.hm);
  });

  // ------------------------------------------------------------------ legend
  // the same markup the export already understands (data-legend-type gradient with its stops)
  function legendHTML(hm, label) {
    var s = scaleOf(hm), d = domain(hm);
    return '<div class="legend-item legend-gradient" data-legend-type="gene-gradient" data-legend-colors="" data-min-color="' + s.minColor + '" data-mid-color="' + s.midColor + '" data-max-color="' + s.maxColor + '" data-mid-enabled="' + (s.midEnabled ? '1' : '0') + '"' +
      ' data-lo-label="' + esc(fmt(d.lo)) + '" data-hi-label="' + esc(fmt(d.hi)) + '" data-gradient-label="' + esc(label || '') + (d.log ? ' (log)' : '') + '">' +
      '<span class="hs-leg-lo">' + esc(fmt(d.lo)) + '</span><span class="hs-leg-bar" style="background:' + cssGradient(hm) + '"></span><span class="hs-leg-hi">' + esc(fmt(d.hi)) + '</span>' +
      (label ? '<span class="hs-leg-label">' + esc(label) + (d.log ? ' (log)' : '') + '</span>' : '') + '</div>';
  }

  window.tmHeatScale = { isGradient: isGradient, colorFor: colorFor, renderControls: renderControls, legendHTML: legendHTML, stats: stats, domain: domain, DEFAULTS: DEFAULTS };
})();
