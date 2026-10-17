// UI glue for index-pro.html (the application-shell layout).
// Loaded after app.js. It only wires the new layout to the app's existing
// controls (by id) and replaces two layout helpers that assumed the classic
// page; app.js itself is unchanged and the classic index.html never loads this.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var aside = document.querySelector('aside.sidepanel');
  var body = document.body;

  // ---------------------------------------------------------------- layout
  // The classic page sized the sidebar from the canvas/legend; here the
  // app-shell layout sizes it, so make the helper a no-op and clear what it set.
  window.updateSidebarHeight = function () {};
  if (aside) { aside.style.removeProperty('max-height'); aside.style.removeProperty('overflow'); }

  // diagnostic switch: ?nocontain turns off the CSS layout containment
  if (/[?&]nocontain\b/.test(location.search)) document.documentElement.classList.add('pro-no-contain');

  // ------------------------------------------------------------------ tabs
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.pro-tab'));
  function showTab(name) {
    if (!aside) return;
    aside.setAttribute('data-pro-tab', name);
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-pro-tab') === name)); });
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-pro-tab')); });
  });
  // a newly added data card shows up in the Layers tab
  ['dataframeContainer', 'heatmapContainer', 'highlightContainer', 'cladeContainer', 'chartContainer', 'textContainer'].forEach(function (id) {
    var c = $(id);
    if (!c) return;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { showTab('layers'); updateDoc(); return; }
      }
      updateDoc();
    }).observe(c, { childList: true });
  });

  // ------------------------------------------------------------- open tree
  var treeInput = $('treeFile');
  var loadBtn = $('loadSelected');
  function selectMode(mode) {
    var radio = $(mode === 'generate' ? 'treeModeGenerate' : 'treeModeFile');
    if (radio && !radio.checked) radio.click();
  }
  function openTree() {
    if (!treeInput) return;
    selectMode('file');
    treeInput.value = '';           // allow picking the same file again
    treeInput.click();
  }
  ['proOpenTree', 'proEmptyOpen'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', openTree); });
  if (treeInput && loadBtn) {
    // runs after app.js's own listener (which records the selected file)
    treeInput.addEventListener('change', function () {
      if (!treeInput.files || !treeInput.files[0]) return;
      if (loadBtn.disabled) {
        // the classic page refuses to reload a file with the same name; allow it here
        try { currentLoadedTreeFile = null; updateLoadSelectedButtonState(); } catch (e) {}
      }
      if (!loadBtn.disabled) loadBtn.click();
    });
  }

  // ------------------------------------------------------- generate dialog
  var modal = $('proGenerateModal');
  var lastFocus = null;
  function openGenerate() {
    if (!modal) return;
    selectMode('generate');
    lastFocus = document.activeElement;
    modal.hidden = false;
    var first = modal.querySelector('#geneDataFile') || modal.querySelector('button');
    if (first) first.focus();
  }
  function closeGenerate() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  ['proGenerate', 'proEmptyGenerate'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', openGenerate); });
  if ($('proGenerateClose')) $('proGenerateClose').addEventListener('click', closeGenerate);
  if (modal) {
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) closeGenerate(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeGenerate(); });
  }
  if ($('generateTreeBtn')) $('generateTreeBtn').addEventListener('click', function () { setTimeout(closeGenerate, 0); });

  // ---------------------------------------------------------------- legend
  var legendToggle = $('proLegendToggle');
  function setLegend(open) {
    body.classList.toggle('pro-legend-hidden', !open);
    if (legendToggle) legendToggle.setAttribute('aria-pressed', String(open));
  }
  if (legendToggle) legendToggle.addEventListener('click', function () { setLegend(body.classList.contains('pro-legend-hidden')); });
  if ($('proLegendClose')) $('proLegendClose').addEventListener('click', function () { setLegend(false); });

  // ------------------------------------------- pop-up cards near the bottom
  // app.js opens the colour/highlight pickers just below their button; the
  // selection toolbar sits at the bottom of the canvas here, so open them
  // above the button when there is no room below.
  [['colorPickerCard', 'cladeColorBtn'], ['highlightBackgroundCard', 'highlightCladeBackground']].forEach(function (pair) {
    var card = $(pair[0]), btn = $(pair[1]);
    if (!card || !btn) return;
    new MutationObserver(function () {
      if (card.style.display === 'none') return;
      var r = card.getBoundingClientRect();
      if (r.bottom <= window.innerHeight - 8) return;
      var b = btn.getBoundingClientRect();
      card.style.top = Math.max(8, b.top - card.offsetHeight - 8 + window.pageYOffset) + 'px';
    }).observe(card, { attributes: true, attributeFilter: ['style'] });
  });

  // ------------------------------------------- states formerly done with :has()
  var legend = $('metadataLegend'), legendBody = legend ? legend.parentElement : null;
  function updateLegendEmpty() { if (legendBody) legendBody.classList.toggle('pro-legend-is-empty', legend.style.display === 'none'); }
  if (legend) new MutationObserver(updateLegendEmpty).observe(legend, { attributes: true, attributeFilter: ['style'] });
  updateLegendEmpty();
  var nodesInput = $('hideInternalClade'), nodesLabel = nodesInput ? nodesInput.closest('.pro-toggle') : null;
  function updateNodesToggle() { if (nodesLabel) nodesLabel.classList.toggle('is-on', !!nodesInput.checked); }
  ['hideInternalClade', 'hideInternal'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', function () { setTimeout(updateNodesToggle, 0); }); });
  updateNodesToggle();

  // ------------------------------------------------ document / tree status
  var docName = $('proDocName'), docMeta = $('proDocMeta'), counts = $('proCounts');
  function treeRoot() { try { return root; } catch (e) { return null; } }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function updateLayersEmpty() {
    if (!aside) return;
    var any = false, cs = aside.querySelectorAll('.card-container');
    for (var i = 0; i < cs.length && !any; i++) if (cs[i].firstElementChild) any = true;
    aside.classList.toggle('pro-no-layers', !any);
  }
  function updateDoc() {
    updateLayersEmpty();
    var r = treeRoot();
    body.classList.toggle('pro-has-tree', !!r);
    if (!r) {
      if (docName) docName.textContent = 'No tree loaded';
      if (docMeta) docMeta.textContent = '';
      if (counts) counts.textContent = '';
      return;
    }
    var name = '';
    try { name = currentLoadedTreeFile || ''; } catch (e) {}
    var tips = 0, nodes = 0;
    try { tips = r.leaves().length; nodes = r.descendants().length; } catch (e) {}
    var layers = document.querySelectorAll('.card-container > details').length;
    if (docName) docName.textContent = name || 'Tree';
    if (docMeta) docMeta.textContent = plural(tips, 'tip') + (layers ? ' · ' + plural(layers, 'data layer') : '');
    if (counts) counts.textContent = plural(tips, 'tip') + ' · ' + plural(nodes, 'node');
  }

  // ------------------------------------------------------------ zoom value
  var zoomEl = $('proZoom');
  var zoomable = $('zoomable');
  function updateZoom() {
    if (!zoomEl || !zoomable) return;
    var m = /scale\(\s*([-\d.e]+)/.exec(zoomable.getAttribute('transform') || '');
    var k = m ? parseFloat(m[1]) : 1;
    zoomEl.textContent = Math.round(k * 100) + '%';
  }
  if (zoomable) {
    // redraws replace #zoomable's children; zooming changes its transform
    new MutationObserver(function (muts) {
      var redraw = false, zoom = false;
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].type === 'childList') redraw = true; else zoom = true;
      }
      if (redraw) updateDoc();
      if (zoom || redraw) updateZoom();
    }).observe(zoomable, { childList: true, attributes: true, attributeFilter: ['transform'] });
  }

  // ---------------------------------------------------------- status text
  // Keep the status bar readable: drop the canvas/spacing diagnostics the
  // classic page appended to "Fit to view".
  if (typeof window.setStatus === 'function') {
    var origSetStatus = window.setStatus;
    window.setStatus = function (msg) {
      if (typeof msg === 'string' && msg.indexOf('Fit to view —') === 0) msg = 'Fit to view';
      var out = origSetStatus.call(this, msg);
      updateDoc();   // e.g. "Tree loaded" arrives after the file name is recorded
      return out;
    };
  }

  updateDoc();
  updateZoom();
})();
