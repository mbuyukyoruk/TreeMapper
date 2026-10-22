// Tip labels from data (loaded after app.js). Style → Labels:
//   - Label text: the accession (default) or a layer's value for the tip (a heatmap,
//     highlight or clade-group table whose second column holds the name to show, e.g. a
//     species or strain name); tips without a value keep their accession;
//   - Italic (species names);
//   - Colour by: a layer's categories (its colours) or a numeric heatmap's gradient.
// The app's label code asks this module for each tip's text and style; search, tooltips and
// sessions still use the accession. The choices are Style controls (kept in sessions).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(v) { return typeof normalizeAccession === 'function' ? normalizeAccession(v == null ? '' : v) : String(v); }
  function layerSources() {
    var out = [];
    [['heatmap', typeof heatmaps !== 'undefined' ? heatmaps : null, 'Heatmap'], ['highlight', typeof highlights !== 'undefined' ? highlights : null, 'Highlight'], ['clade', typeof clades !== 'undefined' ? clades : null, 'Clade groups']].forEach(function (t) {
      if (!t[1]) return;
      t[1].forEach(function (d, id) {
        if (!d || !d.accessionToValue || !d.accessionToValue.size) return;
        var title = $(t[0] + 'Title' + id);
        out.push({ value: t[0] + ':' + id, label: (title ? title.textContent : t[2] + ' ' + id), layer: d, type: t[0] });
      });
    });
    return out;
  }
  function wanted(id) { var w = $(id + 'Wanted'); return (w && w.value) || (($(id) || {}).value) || ''; }
  function sourceOf(id) { var v = wanted(id); return v ? layerSources().filter(function (s) { return s.value === v; })[0] || null : null; }
  function refreshOptions() {
    ['labelTextSource', 'labelColorSource'].forEach(function (id) {
      var sel = $(id); if (!sel) return;
      var want = wanted(id);
      var html = '<option value="">' + (id === 'labelTextSource' ? 'Accession' : '(none)') + '</option>' + layerSources().map(function (s) { return '<option value="' + esc(s.value) + '">' + esc(s.label) + '</option>'; }).join('');
      if (sel.innerHTML !== html) sel.innerHTML = html;
      sel.value = want; if (sel.value !== want) sel.value = '';
    });
  }
  // the label's text for a tip (d: the node) given the default
  function text(d, dflt) {
    var src = sourceOf('labelTextSource'); if (!src) return dflt;
    var v = src.layer.accessionToValue.get(norm(d && d.data ? d.data.name : ''));
    return (v == null || v === '') ? dflt : String(v);
  }
  // fill / font-style for a tip, over the base style the app chose (selection colours win)
  function style(d, base) {
    var italic = $('labelItalic') && $('labelItalic').checked;
    var src = sourceOf('labelColorSource');
    var fill = base.fill;
    if (src && base.fill === 'var(--text)') {
      var v = src.layer.accessionToValue.get(norm(d && d.data ? d.data.name : ''));
      if (v != null && v !== '') {
        if (src.type === 'heatmap' && window.tmHeatScale && tmHeatScale.isGradient(src.layer)) fill = tmHeatScale.colorFor(src.layer, v);
        else if (src.layer.valueColors && src.layer.valueColors.get(String(v))) fill = src.layer.valueColors.get(String(v));
      }
    }
    if (fill === base.fill && !italic) return base;
    return { fill: fill, fontWeight: base.fontWeight, display: base.display, fontStyle: italic ? 'italic' : null };
  }
  // the colour from data for a tip, or null for the usual text colour
  function fillFor(d) { var f = style(d, { fill: 'var(--text)' }).fill; return f === 'var(--text)' ? null : f; }
  function active() { return !!(sourceOf('labelTextSource') || sourceOf('labelColorSource') || ($('labelItalic') && $('labelItalic').checked)); }
  // the labels panel widens to the longest label (up to its maximum), so names from data are not cut short
  function fitLabelsPanel() {
    if (typeof panelWidths === 'undefined' || !panelWidths || panelWidths.length < 2 || typeof geometry !== 'undefined' && geometry === 'radial') return;
    var hide = $('hideLabels'); if (hide && hide.checked) return;
    var src = sourceOf('labelTextSource'); if (!src || typeof root === 'undefined' || !root) return;
    var svg = document.getElementById('svg'); if (!svg) return;
    // the size the truncation measures with: the label size setting (the drawing may shrink it)
    var px = (typeof labelFontPxOverride !== 'undefined' && labelFontPxOverride != null) ? labelFontPxOverride : (parseFloat(($('labelSize') || {}).value) || 12);
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('class', 'label'); t.style.fontSize = px + 'px'; t.style.visibility = 'hidden';
    var longest = '';
    root.leaves().forEach(function (l) { var x = text(l, String(l.data.name || '')); if (x.length > longest.length) longest = x; });
    t.textContent = longest; svg.appendChild(t);
    var w = 0; try { w = t.getComputedTextLength(); } catch (e) {} svg.removeChild(t);
    var need = Math.ceil(w) + 24, max = (typeof MAX_LABELS_PANEL_WIDTH !== 'undefined') ? MAX_LABELS_PANEL_WIDTH : 300;
    if (need > panelWidths[1]) { panelWidths[1] = Math.min(max, need); if (typeof normalizeWidths === 'function') { try { normalizeWidths(); } catch (e) {} } }
  }
  function redraw() {
    if (typeof root === 'undefined' || !root || typeof drawTree !== 'function') return;
    if (typeof resetFontTruncationCache === 'function') resetFontTruncationCache();
    try { fitLabelsPanel(); } catch (e) {}
    drawTree();
  }
  // before every redraw (a session opening, a layer loading): the panel widens if needed.
  // Installed once the page has loaded, after the other scripts set their own hook.
  function installHook() {
    var prev = window.onBeforeRedraw;
    if (prev && prev._tmLabelStyle) return;
    var hook = function () { try { fitLabelsPanel(); } catch (e) {} if (typeof prev === 'function') return prev.apply(this, arguments); };
    hook._tmLabelStyle = true;
    window.onBeforeRedraw = hook;
  }
  if (document.readyState === 'complete') installHook(); else window.addEventListener('load', installHook);
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.id) return;
    if (t.id === 'labelTextSource' || t.id === 'labelColorSource') { var w = $(t.id + 'Wanted'); if (w) { w.value = t.value; w.dispatchEvent(new Event('change', { bubbles: true })); } redraw(); }
    else if (t.id === 'labelTextSourceWanted' || t.id === 'labelColorSourceWanted') refreshOptions();
    else if (t.id === 'labelItalic') redraw();
  });
  ['heatmapContainer', 'highlightContainer', 'cladeContainer'].forEach(function (id) {
    var el = $(id); if (el) new MutationObserver(function () { setTimeout(refreshOptions, 0); }).observe(el, { childList: true, subtree: true, characterData: true });
  });
  refreshOptions();
  window.tmLabelStyle = { text: text, style: style, fillFor: fillFor, active: active, refreshOptions: refreshOptions };
})();
