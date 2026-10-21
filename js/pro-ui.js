// UI glue for index.html (the application-shell layout).
// Loaded after app.js. It only wires the new layout to the app's existing
// controls (by id) and replaces two layout helpers that assumed the classic
// page (the classic version now lives outside this repository).
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
  ['dataframeContainer', 'heatmapContainer', 'highlightContainer', 'cladeContainer', 'chartContainer', 'msaContainer', 'textContainer'].forEach(function (id) {
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
      // a saved session goes to the session loader instead of the tree parser
      if (window.tmSession && tmSession.isSessionFile(treeInput.files[0])) {
        var sf = treeInput.files[0];
        try { currentLoadedTreeFile = null; selectedTreeFile = null; updateLoadSelectedButtonState(); } catch (e) {}
        tmSession.load(sf);
        return;
      }
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
  // legend order: A–Z per layer type (default) or grouped by layer
  var orderBtn = $('proLegendOrder'), orderLabel = $('proLegendOrderLabel');
  function setLegendOrder(byLayer, quiet) {
    byLayer = !!byLayer;
    if (orderBtn) orderBtn.setAttribute('aria-pressed', String(byLayer));
    if (orderLabel) orderLabel.textContent = byLayer ? 'By layer' : 'A–Z';
    call(function () { if (legendOrderByLayer !== byLayer) setLegendOrderByLayer(byLayer); });
    if (!quiet) saveSettings();
  }
  if (orderBtn) orderBtn.addEventListener('click', function () { setLegendOrder(orderBtn.getAttribute('aria-pressed') !== 'true'); });
  window.tmLegendOrder = { get: function () { return !!call(function () { return legendOrderByLayer; }); }, set: function (v) { setLegendOrder(v, true); } };

  // ------------------------------------------------ minimized side panel
  // The side panel can shrink to an icon rail: the Layers/Style icons and one tile
  // per data layer (the card itself, shown small, so dragging a tile reorders the
  // layers exactly as dragging the card does). Clicking a tile or an icon opens the
  // panel again. The canvas gets the width back (redrawn by the width watcher below).
  var leftToggle = $('proLeftToggle');
  var CARD_BOXES = ['dataframeContainer', 'heatmapContainer', 'highlightContainer', 'cladeContainer', 'chartContainer', 'msaContainer', 'textContainer'];
  function leftMinimized() { return body.classList.contains('pro-left-minimized'); }
  function railLabels() {
    var mini = leftMinimized();
    CARD_BOXES.forEach(function (id) {
      var box = $(id); if (!box) return;
      Array.prototype.forEach.call(box.children, function (card) {
        var sum = card.tagName === 'DETAILS' && card.querySelector(':scope > summary'); if (!sum) return;
        var t = card.querySelector('.pro-card-title'), name = t ? t.textContent.trim() : '';
        var m = /(\d+)\s*$/.exec(name);
        if (sum.getAttribute('data-rail-num') !== (m ? m[1] : '')) sum.setAttribute('data-rail-num', m ? m[1] : '');
        // the card name as a tooltip while minimized (the full header shows it otherwise)
        if (mini) { if (sum.title !== name) sum.title = name + ' — click to open, drag to reorder'; }
        else if (sum.hasAttribute('title') && /click to open, drag to reorder$/.test(sum.title)) sum.removeAttribute('title');
      });
    });
  }
  function setLeftMinimized(on, quiet) {
    on = !!on;
    if (on === leftMinimized()) return;
    body.classList.toggle('pro-left-minimized', on);
    if (leftToggle) {
      leftToggle.setAttribute('aria-pressed', String(on));
      leftToggle.setAttribute('aria-label', on ? 'Expand the side panel' : 'Minimize the side panel');
      leftToggle.title = (on ? 'Expand the side panel' : 'Minimize the side panel') + ' ([)';
    }
    railLabels();
    if (!quiet) saveSettings();
  }
  if (leftToggle) leftToggle.addEventListener('click', function () { setLeftMinimized(!leftMinimized()); });
  if (aside) {
    // minimized: a tile or tab click opens the panel (the tile's card opened and shown)
    aside.addEventListener('click', function (e) {
      if (!leftMinimized()) return;
      var tab = e.target.closest('.pro-tab');
      if (tab) { setLeftMinimized(false); return; }   // the tab's own handler shows that tab
      var sum = e.target.closest('.card-container > details > summary');
      if (!sum) return;
      e.preventDefault(); e.stopPropagation();
      var card = sum.parentNode;
      setLeftMinimized(false);
      showTab('layers');
      if (!card.open) card.open = true;
      requestAnimationFrame(function () { if (card.scrollIntoView) card.scrollIntoView({ block: 'nearest' }); });
    }, true);
    // tile numbers and tooltips follow added, removed and renamed cards
    new MutationObserver(function () { railLabels(); }).observe(aside, { childList: true, subtree: true, characterData: true });
  }
  railLabels();

  // ------------------------------------------------ canvas width changes
  // app.js re-lays out its columns (tree, labels, dataframes, heatmaps) only
  // on a browser-window resize. Here the canvas also changes width when the
  // legend panel is shown/hidden. For those changes the columns are
  // re-measured and the tree redrawn once, right away: inside the resize
  // callback, before the browser paints, so there is no frame with the old
  // layout overlapping the legend. The app's own resize redraws (one on the
  // next frame and another 120 ms later) are cancelled, since they would only
  // repeat the same drawing.
  function redrawForNewWidth() {
    call(function () { if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = null; } });
    call(function () { if (_resizeTO) { clearTimeout(_resizeTO); _resizeTO = null; } });
    if (!treeRoot()) return;
    call(function () { normalizeWidths(); updatePanelPositions(); updateSplitterPositions(); updatePanelHeights(); });
    // same drawing and fitting the app does after a window resize
    call(function () {
      if (geometry === 'radial') {
        // circular layout: refit the data rings first, as a window resize does
        if (radialSvg && !radialSvg.empty()) { fitRadialRingsToCanvas(); calculateRadialRings(); drawRadialPanels(); }
        drawTree(); centerRadial();
        // centring uses a zero-length d3 transition, which would only apply on the next frame
        if (window.d3 && d3.timerFlush) d3.timerFlush();
        return;
      }
      var expPct = tipSpacingSel ? (+tipSpacingSel.value || 0) : 0;
      if (expPct <= 0) { onFitToViewRect(); return; }   // fitting redraws by itself
      drawTree(); anchorTopLeftPreserveScale(); try { updateMetaAddButtonY(); } catch (e) {}
    });
  }
  (function () {
    var canvas = $('canvas');
    if (!canvas || !window.ResizeObserver) return;
    var lastW = canvas.clientWidth, lastWin = window.innerWidth + 'x' + window.innerHeight;
    new ResizeObserver(function () {
      var w = canvas.clientWidth, win = window.innerWidth + 'x' + window.innerHeight;
      if (w === lastW) return;
      lastW = w;
      if (win !== lastWin) { lastWin = win; return; }   // a real window resize: the app handles it
      redrawForNewWidth();
    }).observe(canvas);
  })();

  // When the canvas is too narrow for all its toolbar controls, the toolbar takes a
  // second row instead of hiding the last controls (search, legend) out of reach.
  (function () {
    var tb = document.querySelector('.pro-canvas-toolbar');
    if (!tb || !window.ResizeObserver) return;
    var busy = false;
    function fit() {
      if (busy) return; busy = true;
      tb.classList.remove('is-wrapped');
      var over = tb.scrollWidth > tb.clientWidth + 1;
      tb.classList.toggle('is-wrapped', over);
      busy = false;   // (the drawing follows the new height by itself: app.js watches the canvas size)
    }
    var pending = 0;
    function later() { if (!pending) pending = requestAnimationFrame(function () { pending = 0; fit(); }); }   // (not inside the observer's own call)
    new ResizeObserver(later).observe(tb);
    // controls that come and go (Reset, Restore, Copy rows...)
    new MutationObserver(later).observe(tb, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
    fit();
  })();

  // ------------------------------------------------------- shared helpers
  var SVG = function (paths, size) {
    return '<svg class="pro-ico" width="' + (size || 15) + '" height="' + (size || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function shown(el) { return !!el && el.style.display !== 'none'; }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  // place a body-level pop-up next to an anchor, flipping above / left when needed
  function place(pop, anchor, align) {
    var a = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = align === 'right' ? a.right - w : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    var top = a.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  var openPop = null;   // { el, anchor, close }
  function closePop() { if (openPop) { var p = openPop; openPop = null; p.close(); } }
  document.addEventListener('mousedown', function (e) {
    if (openPop && !openPop.el.contains(e.target) && !(openPop.anchor && openPop.anchor.contains(e.target))) closePop();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openPop) { e.preventDefault(); var a = openPop.anchor; closePop(); if (a && a.focus) a.focus(); } });
  window.addEventListener('resize', closePop);

  // ------------------------------------------------- unified colour pop-up
  // One colour chooser for every way of colouring the tree: search matches,
  // selected clades, clade backgrounds and recolouring from the Colours list.
  // It writes the chosen colour into the app's own picker and presses the
  // app's own Apply button, so the colouring logic itself is unchanged.
  var PALETTE = ['#E5484D', '#F76B15', '#FFB224', '#46A758', '#12A594', '#0090FF', '#3E63DD', '#8E4EC6',
                 '#D6409F', '#A18072', '#6F6E77', '#1C2024'];
  var cp = $('proColorPop'), cpGrid = $('proColorPopGrid'), cpRecent = $('proColorPopRecent'), cpRecentLabel = $('proColorPopRecentLabel');
  var cpInput = $('proColorPopInput'), cpHex = $('proColorPopHex'), cpApply = $('proColorPopApply');
  var cpTitle = $('proColorPopTitle'), cpSub = $('proColorPopSub');
  var cpAction = null;
  function loadRecent() { try { return JSON.parse(localStorage.getItem('treemapper.recentColours') || '[]').filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c); }); } catch (e) { return []; } }
  function pushRecent(c) {
    var r = loadRecent().filter(function (x) { return x.toLowerCase() !== c.toLowerCase(); }); r.unshift(c);
    try { localStorage.setItem('treemapper.recentColours', JSON.stringify(r.slice(0, 12))); } catch (e) {}
  }
  function swatches(box, list, current) {
    box.innerHTML = list.map(function (c) {
      var on = current && c.toLowerCase() === current.toLowerCase();
      return '<button type="button" class="pro-sw' + (on ? ' is-current' : '') + '" data-c="' + c + '" style="--sw:' + c + '" title="' + c + '" aria-label="Use ' + c + '"></button>';
    }).join('');
  }
  function setCustom(c) { if (cpInput) cpInput.value = c; if (cpHex) cpHex.value = c; }
  function applyColour(c) {
    if (!cpAction) return;
    var act = cpAction; pushRecent(c); closePop(); act(c); refreshAnno();
  }
  function openColour(anchor, title, sub, initial, action, align) {
    if (!cp) return;
    if (openPop && openPop.el === cp && openPop.anchor === anchor) { closePop(); return; }
    closePop();
    cpAction = action;
    cpTitle.textContent = title; cpSub.textContent = sub || '';
    initial = /^#[0-9a-f]{6}$/i.test(initial || '') ? initial : PALETTE[0];
    swatches(cpGrid, PALETTE, initial);
    var rec = loadRecent().filter(function (c) { return PALETTE.indexOf(c.toUpperCase()) < 0; }).slice(0, 12);
    swatches(cpRecent, rec, initial); cpRecent.hidden = cpRecentLabel.hidden = !rec.length;
    setCustom(initial);
    cp.hidden = false; place(cp, anchor, align);
    anchor.setAttribute('aria-expanded', 'true');
    openPop = { el: cp, anchor: anchor, close: function () { cp.hidden = true; cpAction = null; anchor.setAttribute('aria-expanded', 'false'); } };
    var cur = cp.querySelector('.pro-sw.is-current') || cp.querySelector('.pro-sw'); if (cur) cur.focus();
  }
  if (cp) {
    cp.addEventListener('click', function (e) { var b = e.target.closest('.pro-sw'); if (b) applyColour(b.getAttribute('data-c')); });
    cpInput.addEventListener('input', function () { cpHex.value = cpInput.value; });
    cpHex.addEventListener('input', function () { var v = cpHex.value.trim(); if (!/^#/.test(v)) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) cpInput.value = v; });
    cpHex.addEventListener('keydown', function (e) { if (e.key === 'Enter') cpApply.click(); });
    cpApply.addEventListener('click', function () { applyColour(cpInput.value); });
  }
  // route the app's colour buttons through the shared pop-up
  function viaApp(pickerId, applyId) {
    return function (c) { var pk = $(pickerId), ap = $(applyId); if (!pk || !ap) return; pk.value = c; ap.click(); };
  }
  function cladeSub() { var n = call(function () { return highlightedClades.size; }) || 0; var s = $('cladeStatus'); return n > 1 ? n + ' clades selected' : (s ? s.textContent : ''); }
  [['cladeColorBtn', 'Colour clade', 'cladeColorPicker', 'applyCladeColor'],
   ['highlightCladeBackground', 'Highlight background', 'highlightBackgroundPicker', 'applyHighlightBackground']].forEach(function (d) {
    var btn = $(d[0]); if (!btn) return;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', function () {
      openColour(btn, d[1], cladeSub(), ($(d[2]) || {}).value, viaApp(d[2], d[3]));
    });
  });
  var pathBtn = $('proColorPathBtn'), pathDot = $('proColorPathDot'), pathPicker = $('pathColorPicker');
  function syncPathDot() { if (pathDot && pathPicker) pathDot.style.background = pathPicker.value; }
  if (pathBtn) {
    syncPathDot();
    pathBtn.addEventListener('click', function () {
      var n = call(function () { return highlightedAccessions.size; }) || 0;
      openColour(pathBtn, 'Colour matches', 'Branches from ' + n + ' matching tip' + (n === 1 ? '' : 's') + ' to the root',
        pathPicker && pathPicker.value, function (c) { viaApp('pathColorPicker', 'applyPathColor')(c); syncPathDot(); });
    });
  }

  // ------------------------------------------------------------ Reset group
  // The app shows each reset/restore button only when there is something to
  // undo. Several of them live in the selection toolbar, which is hidden until
  // a node is selected; here they all sit in one Reset menu in the canvas
  // toolbar instead (the buttons themselves are kept, hidden, and clicked).
  var resetBox = $('proReset'), resetBtn = $('proResetBtn'), resetCount = $('proResetCount'), resetMenu = $('proResetMenu');
  var restoreBtn = $('proRestoreDropped'), restoreCount = $('proRestoreCount'), sources = $('proResetSources');
  var I_UNDO = '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>';
  var RESET_ITEMS = [
    { id: 'restoreDroppedNodes', label: 'Restore dropped tips', icon: '<path d="M12 5v14M5 12h14"/>' },
    { id: 'resetCollapses', label: 'Expand collapsed clades', icon: '<path d="M4 14h6v6M20 10h-6V4"/>' },
    { id: 'resetCartoons', label: 'Undo cartoon clades', icon: '<path d="M4 12l16-8v16z"/>' },
    { id: 'resetRotations', label: 'Undo clade rotations', icon: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>' },
    { id: 'resetRoot', label: 'Restore original root', icon: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8"/>' },
    { sep: true },
    { id: 'resetPathColors', label: 'Reset branch colours', icon: '<path d="M4 20c4 0 4-8 8-8s4 8 8 8M12 12V4"/>' },
    { id: 'resetHighlights', label: 'Reset highlights', icon: '<rect x="3" y="7" width="18" height="10" rx="2"/>' },
    { id: 'clearAllColors', label: 'Clear all colours and highlights', icon: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', all: true },
  ];
  function anyColour() {
    return call(function () { return cladeColors.size > 0 || cladeBackgroundColors.size > 0; }) || shown($('resetPathColors')) || shown($('resetHighlights'));
  }
  // how many tips are dropped now (from the app itself: the hidden button's text keeps
  // an old number after the tips were brought back)
  function droppedCount() {
    var n = call(function () { return droppedNodes.size; });
    if (typeof n === 'number') return n;
    var b = $('restoreDroppedNodes'); var m = b && shown(b) && /\((\d+)\)/.exec(b.textContent); return m ? +m[1] : 0;
  }
  function activeItems() {
    var out = [], lastSep = false;
    RESET_ITEMS.forEach(function (it) {
      if (it.sep) { if (out.length && !lastSep) { out.push(it); lastSep = true; } return; }
      var on = it.all ? anyColour() : shown($(it.id));
      if (on) { out.push(it); lastSep = false; }
    });
    if (lastSep) out.pop();
    return out;
  }
  function refreshReset() {
    if (!resetBox) return;
    var items = activeItems(), n = items.filter(function (i) { return !i.sep && !i.all; }).length;
    resetBox.hidden = !items.length;
    resetCount.textContent = n; resetCount.hidden = !n;
    var d = droppedCount();
    restoreBtn.hidden = !d; restoreCount.textContent = d;
    if (openPop && openPop.el === resetMenu) { if (items.length) renderResetMenu(items); else closePop(); }
  }
  function renderResetMenu(items) {
    resetMenu.innerHTML = items.map(function (it) {
      if (it.sep) return '<div class="pro-menu-sep" role="separator"></div>';
      var label = it.id === 'restoreDroppedNodes' ? 'Restore ' + droppedCount() + ' dropped' : it.label;
      return '<button type="button" role="menuitem" class="pro-menu-item' + (it.all ? ' is-danger' : '') + '" data-src="' + it.id + '">' + SVG(it.icon) + '<span>' + esc(label) + '</span></button>';
    }).join('');
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (openPop && openPop.el === resetMenu) { closePop(); return; }
      closePop();
      renderResetMenu(activeItems());
      resetMenu.hidden = false; place(resetMenu, resetBtn, 'right');
      resetBtn.setAttribute('aria-expanded', 'true');
      openPop = { el: resetMenu, anchor: resetBtn, close: function () { resetMenu.hidden = true; resetBtn.setAttribute('aria-expanded', 'false'); } };
      var f = resetMenu.querySelector('.pro-menu-item'); if (f) f.focus();
    });
    resetMenu.addEventListener('click', function (e) {
      var b = e.target.closest('.pro-menu-item'); if (!b) return;
      closePop();
      var src = $(b.getAttribute('data-src')); if (src) src.click();
      setTimeout(function () { refreshReset(); refreshAnno(); }, 0);
    });
    resetMenu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var its = Array.prototype.slice.call(resetMenu.querySelectorAll('.pro-menu-item')), i = its.indexOf(document.activeElement);
      its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length].focus(); e.preventDefault();
    });
    restoreBtn.addEventListener('click', function () { var s = $('restoreDroppedNodes'); if (s) s.click(); setTimeout(refreshReset, 0); });
  }
  var srcObserver = new MutationObserver(function () { refreshReset(); });
  function watchSource(el) { srcObserver.observe(el, { attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true }); }
  RESET_ITEMS.forEach(function (it) { var el = it.id && $(it.id); if (el) watchSource(el); });
  // app.js creates the rotation/collapse/cartoon/restore buttons inside the
  // selection toolbar shortly after start-up; move them here once they exist.
  var DYNAMIC = ['restoreDroppedNodes', 'resetCollapses', 'resetCartoons', 'resetRotations'];
  function adoptDynamic() {
    if (!sources || !$('restoreDroppedNodes')) return false;
    DYNAMIC.forEach(function (id) { var el = $(id); if (el && el.parentNode !== sources) { sources.appendChild(el); watchSource(el); } });
    refreshReset();
    return true;
  }
  if (!adoptDynamic()) {
    var cladeContent = document.querySelector('#cladeToolbar .clade-toolbar-content');
    if (cladeContent) {
      var adoptObs = new MutationObserver(function () { if (adoptDynamic()) adoptObs.disconnect(); });
      adoptObs.observe(cladeContent, { childList: true });
    }
  }

  // --------------------------------------------- Copy rows (selected genes)
  // The button lives in the canvas toolbar so it is reachable without a node
  // selection; app.js shows/hides it and puts the gene count in its title.
  var copyBtn = $('copySelectedFeatures'), copyCount = $('proCopyCount');
  function syncCopyCount() {
    if (!copyBtn || !copyCount) return;
    var m = /for (\d+) selected/.exec(copyBtn.title || '');
    copyCount.textContent = m ? m[1] : '';
    copyCount.hidden = !m || m[1] === '1';
  }
  if (copyBtn) { new MutationObserver(syncCopyCount).observe(copyBtn, { attributes: true, attributeFilter: ['title', 'style'] }); syncCopyCount(); }

  // ------------------------------------------- Colours & highlights list
  // Every colour the user has applied (to search matches or to selected
  // clades) and every clade background, newest first, each with its own
  // recolour and remove. Colours coming from Clade layer cards are managed by
  // those cards and are not listed.
  var anno = $('proAnno'), annoList = $('proAnnoList'), annoEntries = [];
  function allNodes() {
    var r = treeRoot(); if (!r) return [];
    var out = [], seen = new Set(), st = [r];
    while (st.length) {
      var n = st.pop(); if (!n || seen.has(n)) continue; seen.add(n); out.push(n);
      [n.children, n._children, n._originalChildren].forEach(function (c) { if (c) for (var i = 0; i < c.length; i++) st.push(c[i]); });
    }
    return out;
  }
  function leafCount(n) { var c = 0, st = [n]; while (st.length) { var x = st.pop(); var k = x.children || x._children; if (k && k.length) for (var i = 0; i < k.length; i++) st.push(k[i]); else c++; } return c; }
  function nodeLabel(n) { var c = leafCount(n); return c === 1 && n.data && n.data.name ? n.data.name : 'Clade of ' + plural(c, 'tip'); }
  function collectAnno() {
    var byKey = new Map(), out = [];
    allNodes().forEach(function (n) {
      if (!n.permanentColors || !n.permanentColors.size) return;
      n.permanentColors.forEach(function (v, k) {
        if (!/^(path|clade)_\d+$/.test(k)) return;      // clade_path_* belongs to Clade layer cards
        var e = byKey.get(k);
        if (!e) { e = { key: k, kind: k.indexOf('path_') === 0 ? 'path' : 'clade', color: v && v.color || v, ts: v && v.ts || 0, nodes: [] }; byKey.set(k, e); }
        e.nodes.push(n);
      });
    });
    byKey.forEach(function (e) {
      if (e.kind === 'path') {
        var names = call(function () { return window.pathLeafNames && window.pathLeafNames.get(e.key); });
        var list = names ? Array.from(names) : [];
        e.title = list.length === 1 ? list[0] : (list.length ? plural(list.length, 'matching tip') : 'Search matches');
        e.sub = list.length === 1 ? 'Path to root' : 'Paths to root' + (list.length ? ' · ' + list.slice(0, 2).join(', ') + (list.length > 2 ? '…' : '') : '');
      } else {
        // the key sits on each selected node of that action
        e.title = e.nodes.length === 1 ? nodeLabel(e.nodes[0]) : e.nodes.length + ' clades';
        e.sub = 'Clade branches';
      }
      out.push(e);
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    call(function () {
      cladeBackgroundColors.forEach(function (c, n) { out.push({ kind: 'bg', color: c, node: n, title: nodeLabel(n), sub: 'Background highlight' }); });
    });
    return out;
  }
  function renderAnno() {
    if (!anno) return;
    annoEntries = collectAnno();
    anno.hidden = !annoEntries.length;
    if (!annoEntries.length) { annoList.innerHTML = ''; return; }
    annoList.innerHTML = annoEntries.map(function (e, i) {
      return '<div class="pro-anno-row" data-i="' + i + '">' +
        '<button type="button" class="pro-anno-sw' + (e.kind === 'bg' ? ' is-bg' : '') + '" style="--sw:' + esc(e.color) + '" title="Change colour" aria-label="Change colour of ' + esc(e.title) + '" aria-haspopup="dialog"></button>' +
        '<div class="pro-anno-text"><div class="pro-anno-title">' + esc(e.title) + '</div><div class="pro-anno-sub">' + esc(e.sub) + '</div></div>' +
        '<button type="button" class="pro-anno-x" title="Remove" aria-label="Remove ' + esc(e.title) + '">' + SVG('<path d="M6 6l12 12M18 6L6 18"/>', 13) + '</button></div>';
    }).join('');
  }
  var annoQueued = false;
  function refreshAnno() { if (annoQueued) return; annoQueued = true; requestAnimationFrame(function () { annoQueued = false; renderAnno(); refreshReset(); }); }
  function afterColourChange() {
    call(function () { updateColorPathCardVisibility(); });
    call(function () { updateResetHighlightsButtonVisibility(); });
    call(function () { drawTree(); });
    refreshAnno();
  }
  function cladeTs(e) { return +e.key.split('_')[1]; }
  function editEntry(e, colour) {   // colour === null removes the entry
    if (window.setDrawScope) setDrawScope('tree');   // colours only change the tree's own drawing
    var done = window.tmUndo ? tmUndo.begin(colour === null ? 'remove colour' : 'recolour', 'anno') : function () {};
    if (e.kind === 'bg') {
      if (colour === null) cladeBackgroundColors.delete(e.node); else cladeBackgroundColors.set(e.node, colour);
    } else {
      if (e.kind === 'clade') {
        var ts = cladeTs(e), hit = [];
        cladeColorTs.forEach(function (t, n) { if (t === ts) hit.push(n); });
        hit.forEach(function (n) { if (colour === null) { cladeColors.delete(n); cladeColorTs.delete(n); } else cladeColors.set(n, colour); });
      }
      e.nodes.forEach(function (n) {
        if (colour === null) n.permanentColors.delete(e.key);
        else { var v = n.permanentColors.get(e.key); n.permanentColors.set(e.key, { color: colour, ts: v && v.ts || 0 }); }
      });
      if (colour === null && e.kind === 'path') call(function () { window.pathLeafNames.delete(e.key); });
    }
    afterColourChange();
    done();
  }
  if (annoList) {
    annoList.addEventListener('click', function (ev) {
      var row = ev.target.closest('.pro-anno-row'); if (!row) return;
      var e = annoEntries[+row.getAttribute('data-i')]; if (!e) return;
      if (ev.target.closest('.pro-anno-x')) { editEntry(e, null); return; }
      var sw = ev.target.closest('.pro-anno-sw');
      if (sw) openColour(sw, e.kind === 'bg' ? 'Background colour' : 'Branch colour', e.title, e.color, function (c) { editEntry(e, c); });
    });
  }
  if ($('proAnnoClear')) $('proAnnoClear').addEventListener('click', function () { var b = $('clearAllColors'); if (b) b.click(); refreshAnno(); });
  // the app applies search-path colours without a full redraw; catch those too
  ['applyPathColor', 'applyCladeColor', 'applyHighlightBackground'].forEach(function (id) {
    var b = $(id); if (b) b.addEventListener('click', function () { setTimeout(refreshAnno, 0); });
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

  // ------------------------------------------------- pinned header (expanded)
  // In the expanded view the scale bar, dataframe/chart axes and heatmap
  // titles sit above the first row and would scroll away with the tree.
  // After each redraw they are gathered into one group that is shifted down
  // just enough to stay at the top of the canvas while scrolling.
  var SVGNS = 'http://www.w3.org/2000/svg';
  var sticky = null;   // { g, bg, top }
  function isRectLayout() { var b = $('btnRect'); return !b || b.classList.contains('active'); }
  // With "Axes below the tree" the axis row is under the last tip instead: it is
  // gathered the same way into a footer that stays at the bottom of the canvas.
  var stickyFoot = null;   // { g, bg, bottom, dy, moved }
  function stickyCandidates() {
    var cands = [];
    for (var c0 = zoomable.firstElementChild; c0; c0 = c0.nextElementSibling) {
      var cl = c0.getAttribute('class') || '';
      if (cl === 'layers-container') {
        for (var l = c0.firstElementChild; l; l = l.nextElementSibling) for (var c1 = l.firstElementChild; c1; c1 = c1.nextElementSibling) cands.push(c1);
      } else if (cl !== 'pro-sticky-header') cands.push(c0);
    }
    return cands.filter(function (c) { return !/svg-splitters|handles|right-gutter/.test(c.getAttribute('class') || ''); });
  }
  function buildStickyFooter() {
    stickyFoot = null;
    var row = window.currentAxisRow, svgEl = $('svg');
    if (!row || !row.below || !zoomable || !svgEl || svgEl.classList.contains('no-pan') || !isRectLayout()) return;
    var ctm = zoomable.getScreenCTM(); if (!ctm || !ctm.d) return;
    var k = ctm.d, foot = [], footTop = Infinity, footBottom = -Infinity;
    stickyCandidates().forEach(function (c) {
      var r = c.getBoundingClientRect(); if (!r.height && !r.width) return;
      var top = (r.top - ctm.f) / k, bottom = (r.bottom - ctm.f) / k;
      if (top >= row.y - 6) { foot.push(c); footTop = Math.min(footTop, top); footBottom = Math.max(footBottom, bottom); }
    });
    if (!foot.length) return;
    var g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'pro-sticky-header');
    var bg = document.createElementNS(SVGNS, 'rect'); bg.setAttribute('class', 'pro-sticky-header-bg');
    var bb = null; try { bb = zoomable.getBBox(); } catch (e) {}
    var rectTop = Math.min(footTop, row.y) - 6, rectBottom = footBottom + 6;
    bg.setAttribute('x', bb ? bb.x - 20 : -2000); bg.setAttribute('width', bb ? bb.width + 40 : 8000);
    bg.setAttribute('y', rectTop); bg.setAttribute('height', Math.max(1, rectBottom - rectTop));
    bg.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#fff');
    bg.setAttribute('visibility', 'hidden');
    g.appendChild(bg);
    var moved = foot.map(function (h) { return [h, h.parentNode, h.nextSibling]; });
    foot.forEach(function (h) { h.__liveHome = h.parentNode; carryParentShift(h); g.appendChild(h); });
    zoomable.appendChild(g);
    stickyFoot = { g: g, bg: bg, bottom: rectBottom, dy: 0, moved: moved };
  }
  function updateStickyFooter() {
    if (!stickyFoot || !stickyFoot.g.isConnected) return;
    var svgEl = $('svg'), canvasEl = $('canvas'), ctm = zoomable.getScreenCTM(); if (!ctm || !ctm.d || !svgEl) return;
    var sr = svgEl.getBoundingClientRect(), cr = canvasEl ? canvasEl.getBoundingClientRect() : sr;
    var visBottom = (Math.min(sr.bottom, cr.bottom) - ctm.f) / ctm.d;   // lowest visible drawing y
    var dy = Math.min(0, visBottom - stickyFoot.bottom);                 // lift the row while the end is off screen
    if (Math.abs(dy - stickyFoot.dy) < 0.01) return;
    stickyFoot.dy = dy;
    if (dy) stickyFoot.g.setAttribute('transform', 'translate(0,' + dy + ')'); else stickyFoot.g.removeAttribute('transform');
    stickyFoot.bg.setAttribute('visibility', dy ? 'visible' : 'hidden');
  }
  // an element taken out of a column that is moved sideways (splitter drag preview)
  // keeps that shift while it is pinned
  function carryParentShift(el) {
    var par = el.parentNode, t = par && par.getAttribute && par.getAttribute('transform');
    if (!t || !/\bdata-layer\b/.test(par.getAttribute('class') || '')) return;
    var own = el.getAttribute('transform');
    el.setAttribute('data-own-transform', own === null ? '' : own);
    el.setAttribute('transform', t + (own ? ' ' + own : ''));
  }
  function dropParentShift(el) {
    if (!el.hasAttribute('data-own-transform')) return;
    var own = el.getAttribute('data-own-transform');
    if (own) el.setAttribute('transform', own); else el.removeAttribute('transform');
    el.removeAttribute('data-own-transform');
  }
  function restoreGroup(s) {
    for (var i = s.moved.length - 1; i >= 0; i--) {
      var m = s.moved[i], el = m[0], parent = m[1], next = m[2];
      dropParentShift(el);
      if (!parent || !parent.isConnected) continue;
      parent.insertBefore(el, next && next.parentNode === parent ? next : null);
    }
    if (s.g.parentNode) s.g.parentNode.removeChild(s.g);
  }
  function buildStickyHeader() {
    sticky = null;
    buildStickyFooter(); updateStickyFooter();
    var svgEl = $('svg');
    if (!zoomable || !svgEl || svgEl.classList.contains('no-pan') || !isRectLayout()) return;
    var vTop = window.currentVTop; if (!(vTop > 0)) return;
    var ctm = zoomable.getScreenCTM(); if (!ctm || !ctm.d) return;
    var k = ctm.d, header = [], contentTop = Infinity, headTop = Infinity;
    // candidates: top-level drawing groups, and the groups inside each data layer
    var cands = [];
    for (var c0 = zoomable.firstElementChild; c0; c0 = c0.nextElementSibling) {
      if ((c0.getAttribute('class') || '') === 'layers-container') {
        for (var l = c0.firstElementChild; l; l = l.nextElementSibling) for (var c1 = l.firstElementChild; c1; c1 = c1.nextElementSibling) cands.push(c1);
      } else cands.push(c0);
    }
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci];
      var cls = c.getAttribute('class') || '';
      if (/svg-splitters|handles|right-gutter/.test(cls)) continue;
      var r = c.getBoundingClientRect(); if (!r.height && !r.width) continue;
      var top = (r.top - ctm.f) / k, bottom = (r.bottom - ctm.f) / k;
      if (bottom <= vTop + 12 && top < vTop) { header.push(c); headTop = Math.min(headTop, top); }
      else contentTop = Math.min(contentTop, top);
    }
    if (!header.length) return;
    var g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'pro-sticky-header');
    var bg = document.createElementNS(SVGNS, 'rect'); bg.setAttribute('class', 'pro-sticky-header-bg');
    var bb = null; try { bb = zoomable.getBBox(); } catch (e) {}
    var rectTop = headTop - 4, rectBottom = Math.min(contentTop - 1, vTop + 10);
    bg.setAttribute('x', bb ? bb.x - 20 : -2000); bg.setAttribute('width', bb ? bb.width + 40 : 8000);
    bg.setAttribute('y', rectTop); bg.setAttribute('height', Math.max(1, rectBottom - rectTop));
    bg.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#fff');
    bg.setAttribute('visibility', 'hidden');
    g.appendChild(bg);
    // remember where each header element came from: before every redraw they go
    // back, so data layers that are kept between redraws keep their axes
    var moved = header.map(function (h) { return [h, h.parentNode, h.nextSibling]; });
    header.forEach(function (h) { h.__liveHome = h.parentNode; carryParentShift(h); g.appendChild(h); });
    zoomable.appendChild(g);
    sticky = { g: g, bg: bg, top: rectTop, dy: 0, moved: moved };
    updateStickyHeader();
  }
  function restoreStickyHeader() {
    if (sticky) { var s = sticky; sticky = null; restoreGroup(s); }
    if (stickyFoot) { var f = stickyFoot; stickyFoot = null; restoreGroup(f); }
  }
  // called by drawTree before it rebuilds the drawing (every path into drawTree)
  window.onBeforeRedraw = restoreStickyHeader;
  function updateStickyHeader() {
    updateStickyFooter();
    if (!sticky || !sticky.g.isConnected) return;
    var m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(\s*([-\d.e]+)/.exec(zoomable.getAttribute('transform') || '');
    var ty = m ? parseFloat(m[2]) : 0, k = m ? parseFloat(m[3]) : 1;
    var dy = Math.max(0, -ty / k - sticky.top);   // keep the whole header on screen
    if (dy === sticky.dy) return;
    sticky.dy = dy;
    if (dy) sticky.g.setAttribute('transform', 'translate(0,' + dy + ')'); else sticky.g.removeAttribute('transform');
    sticky.bg.setAttribute('visibility', dy ? 'visible' : 'hidden');
  }

  // ------------------------------------------------------------ zoom value
  var zoomEl = $('proZoom');
  var zoomable = $('zoomable');
  function updateZoom() {
    if (!zoomEl || !zoomable) return;
    var m = /scale\(\s*([-\d.e]+)/.exec(zoomable.getAttribute('transform') || '');
    var k = m ? parseFloat(m[1]) : 1;
    var txt = Math.round(k * 100) + '%';
    if (zoomEl.textContent !== txt) zoomEl.textContent = txt;   // scrolling changes only the position
  }
  if (zoomable) {
    // redraws replace #zoomable's children; zooming changes its transform
    var zoomObs = new MutationObserver(function (muts) {
      var redraw = false, zoom = false;
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].type !== 'childList') { zoom = true; continue; }
        if (window.tmDragLive && tmDragLive.ownMutation && tmDragLive.ownMutation(muts[i])) continue;   // parts lifted out for a column drag, or put back
        // our own pinned-header group being inserted is not a redraw
        var own = muts[i].addedNodes.length === 1 && muts[i].addedNodes[0].getAttribute && muts[i].addedNodes[0].getAttribute('class') === 'pro-sticky-header';
        if (!own && (muts[i].addedNodes.length || muts[i].removedNodes.length)) redraw = true;
      }
      if (redraw) { updateDoc(); refreshAnno(); buildStickyHeader(); zoomObs.takeRecords(); if (window.tmUndo) tmUndo.refresh(); }   // drop the records of our own regrouping
      if (zoom || redraw) { updateZoom(); updateStickyHeader(); }
    });
    zoomObs.observe(zoomable, { childList: true, attributes: true, attributeFilter: ['transform'] });
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

  // ---------------------------------------------------------------- sessions
  if ($('proSaveSession') && window.tmSession) $('proSaveSession').addEventListener('click', function () { tmSession.save(); });
  // dropping a .treemapper file on the canvas opens it (before the app's own tree drop handler)
  var canvasEl2 = $('canvas');
  if (canvasEl2 && window.tmSession) canvasEl2.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    var sf = files.filter(function (f) { return tmSession.isSessionFile(f); })[0];
    if (!sf) return;
    e.preventDefault(); e.stopImmediatePropagation();
    tmSession.load(sf);
  }, true);

  // --------------------------------------------------------- search options
  // "Look in" (where to search) and "Exact match", inside the search box.
  // app.js reads window.tmSearchOptions when the search box is used; searches
  // the app runs itself (e.g. Clade layer colouring) never use these options.
  var searchOpts = window.tmSearchOptions = { scope: 'all', exact: false };
  var scopeBtn = $('proSearchScope'), scopeLabel = $('proSearchScopeLabel'), scopeMenu = $('proSearchScopeMenu');
  var exactBtn = $('proSearchExact'), searchBox = $('accessionSearch');
  var LAYER_SCOPES = [['dataframeContainer', 'dataframe'], ['heatmapContainer', 'heatmap'], ['chartContainer', 'chart'],
    ['highlightContainer', 'highlight'], ['cladeContainer', 'clade']];
  function scopeChoices() {
    var out = [{ v: 'all', label: 'All', hint: 'Accessions and every data layer' },
               { v: 'accession', label: 'Accessions', hint: 'Tip names only' }];
    var dfBox = $('dataframeContainer');
    if (dfBox && dfBox.querySelector('details')) out.push({ v: 'genes', label: 'Genes', hint: 'Gene column of every dataframe' });
    var layers = [];
    LAYER_SCOPES.forEach(function (x) {
      var box = $(x[0]); if (!box) return;
      Array.prototype.forEach.call(box.children, function (card) {
        if (card.tagName !== 'DETAILS') return;
        var m = /(\d+)$/.exec(card.id || ''); if (!m) return;
        var t = card.querySelector('.pro-card-title');
        layers.push({ v: x[1] + ':' + m[1], label: (t && t.textContent.trim()) || (x[1] + ' ' + m[1]), hint: 'Only this layer' });
      });
    });
    if (layers.length) { out.push({ sep: true }); out = out.concat(layers); }
    return out;
  }
  function choiceFor(v) { var c = scopeChoices().filter(function (x) { return x.v === v; })[0]; return c || null; }
  function placeholderFor(c) {
    if (!c || c.v === 'all') return 'Search accessions or genes';
    if (c.v === 'accession') return 'Search accessions';
    if (c.v === 'genes') return 'Search genes';
    return 'Search ' + c.label;
  }
  function rerunSearch() {
    if (searchBox && searchBox.value.trim()) searchBox.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function showScope() {
    var c = choiceFor(searchOpts.scope) || choiceFor('all');
    if (scopeLabel) scopeLabel.textContent = c.label;
    if (scopeBtn) { scopeBtn.classList.toggle('is-narrowed', c.v !== 'all'); scopeBtn.title = 'Where to search: ' + c.label + (c.hint ? ' (' + c.hint.toLowerCase() + ')' : ''); }
    if (searchBox) searchBox.placeholder = placeholderFor(c);
  }
  function setScope(v, quiet) {
    if (!choiceFor(v)) v = 'all';
    var changed = searchOpts.scope !== v;
    searchOpts.scope = v; showScope();
    if (changed && !quiet) { rerunSearch(); saveSettings(); }
  }
  function setExact(on, quiet) {
    on = !!on;
    var changed = searchOpts.exact !== on;
    searchOpts.exact = on;
    if (exactBtn) exactBtn.setAttribute('aria-pressed', String(on));
    if (changed && !quiet) { rerunSearch(); saveSettings(); }
  }
  function renderScopeMenu() {
    scopeMenu.innerHTML = scopeChoices().map(function (c) {
      if (c.sep) return '<div class="pro-menu-sep" role="separator"></div><div class="pro-menu-label">Data layers</div>';
      var on = c.v === searchOpts.scope;
      return '<button type="button" role="menuitemradio" aria-checked="' + on + '" class="pro-menu-item' + (on ? ' is-current' : '') + '" data-scope="' + esc(c.v) + '">' +
        '<span class="pro-menu-check">' + (on ? SVG('<path d="M5 12l5 5L20 7"/>', 14) : '') + '</span><span class="pro-menu-text"><b>' + esc(c.label) + '</b><small>' + esc(c.hint) + '</small></span></button>';
    }).join('');
  }
  if (scopeBtn && scopeMenu) {
    scopeBtn.addEventListener('click', function () {
      if (openPop && openPop.el === scopeMenu) { closePop(); return; }
      closePop();
      renderScopeMenu();
      scopeMenu.hidden = false; place(scopeMenu, scopeBtn, 'left');
      scopeBtn.setAttribute('aria-expanded', 'true');
      openPop = { el: scopeMenu, anchor: scopeBtn, close: function () { scopeMenu.hidden = true; scopeBtn.setAttribute('aria-expanded', 'false'); } };
      var cur = scopeMenu.querySelector('.is-current') || scopeMenu.querySelector('.pro-menu-item'); if (cur) cur.focus();
    });
    scopeMenu.addEventListener('click', function (e) {
      var b = e.target.closest('.pro-menu-item'); if (!b) return;
      closePop(); setScope(b.getAttribute('data-scope'));
      if (searchBox) searchBox.focus();
    });
    scopeMenu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var its = Array.prototype.slice.call(scopeMenu.querySelectorAll('.pro-menu-item')), i = its.indexOf(document.activeElement);
      its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length].focus(); e.preventDefault();
    });
  }
  if (exactBtn) exactBtn.addEventListener('click', function () { setExact(!searchOpts.exact); });
  // a layer that is searched in may be removed (or renamed): keep the choice valid
  LAYER_SCOPES.forEach(function (x) {
    var box = $(x[0]); if (!box) return;
    new MutationObserver(function () { if (!choiceFor(searchOpts.scope)) setScope('all'); else showScope(); }).observe(box, { childList: true, subtree: true, characterData: true });
  });
  window.tmSearch = {
    get: function () { return { scope: searchOpts.scope, exact: searchOpts.exact }; },
    set: function (o) { if (!o) return; if ('exact' in o) setExact(o.exact, true); if ('scope' in o) setScope(o.scope, true); rerunSearch(); }
  };
  showScope();

  // ------------------------------------------------------------ undo / redo
  var undoBtn = $('proUndo'), redoBtn = $('proRedo');
  function syncUndo() {
    if (!window.tmUndo || !undoBtn) return;
    var u = tmUndo.canUndo(), r = tmUndo.canRedo();
    undoBtn.disabled = !u; redoBtn.disabled = !r;
    undoBtn.title = u ? 'Undo ' + tmUndo.undoLabel() + ' (⌘Z)' : 'Undo (⌘Z)';
    redoBtn.title = r ? 'Redo ' + tmUndo.redoLabel() + ' (⇧⌘Z)' : 'Redo (⇧⌘Z)';
  }
  if (window.tmUndo && undoBtn) {
    tmUndo.onChange(syncUndo);
    undoBtn.addEventListener('click', function () { tmUndo.undo(); });
    redoBtn.addEventListener('click', function () { tmUndo.redo(); });
    syncUndo();
  }

  // ----------------------------------------------------------------- export
  var exportBtn = $('proExportBtn'), exportMenu = $('proExportMenu');
  function askName(def) {
    var n = prompt('File name:', def);
    if (n === null) return null;
    n = n.trim() || def;
    var ext = def.slice(def.lastIndexOf('.'));
    return n.toLowerCase().endsWith(ext) ? n : n + ext;
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function exportPng(scale) {
    var out; try { out = window.buildExportSvgSource(); } catch (e) { alert('Export failed: ' + e.message); return; }
    var name = askName('tree.png'); if (!name) return;
    // browsers limit canvas size; lower the scale for very large trees
    var maxSide = 16000, maxArea = 120e6, w = out.width, h = out.height;
    var fit = Math.min(scale, maxSide / w, maxSide / h, Math.sqrt(maxArea / (w * h)));
    if (fit < scale) setStatus('Tree is very large: PNG made at ' + fit.toFixed(2) + '× instead of ' + scale + '×');
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * fit)); c.height = Math.max(1, Math.round(h * fit));
      var ctx = c.getContext('2d');
      ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'dark'
        ? getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#0F1419' : '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (blob) {
        if (!blob) { alert('PNG export failed (the image may be too large for this browser).'); return; }
        download(blob, name);
        setStatus('Exported ' + name + ' (' + c.width + ' × ' + c.height + ' px)');
      }, 'image/png');
    };
    img.onerror = function () { alert('PNG export failed: the browser could not render the tree image.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.src);
  }
  function exportPdf() {
    var out; try { out = window.buildExportSvgSource(); } catch (e) { alert('Export failed: ' + e.message); return; }
    // one page the size of the tree (vector); browsers that ignore custom page
    // sizes fit it to the paper size chosen in the print dialog
    var w = out.width / 96, h = out.height / 96, big = Math.max(w, h);
    if (big > 200) { w *= 200 / big; h *= 200 / big; }
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    var doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><title>TreeMapper tree</title><style>@page{size:' + w.toFixed(2) + 'in ' + h.toFixed(2) +
      'in;margin:0}html,body{margin:0;padding:0}svg{display:block;width:100%;height:auto;page-break-inside:avoid}</style></head><body>' +
      out.src + '</body></html>');
    doc.close();
    setTimeout(function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { alert('Could not open the print dialog: ' + e.message); }
      setTimeout(function () { frame.remove(); }, 60000);
    }, 250);
    setStatus('Choose "Save as PDF" in the print dialog');
  }
  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', function () {
      if (openPop && openPop.el === exportMenu) { closePop(); return; }
      closePop();
      exportMenu.hidden = false; place(exportMenu, exportBtn, 'right');
      exportBtn.setAttribute('aria-expanded', 'true');
      openPop = { el: exportMenu, anchor: exportBtn, close: function () { exportMenu.hidden = true; exportBtn.setAttribute('aria-expanded', 'false'); } };
      var f = exportMenu.querySelector('.pro-menu-item'); if (f) f.focus();
    });
    exportMenu.addEventListener('click', function (e) {
      var b = e.target.closest('.pro-menu-item'); if (!b) return;
      closePop();
      var kind = b.getAttribute('data-export');
      if (kind === 'svg') $('exportSVG').click();
      else if (kind === 'png2') exportPng(2);
      else if (kind === 'png4') exportPng(4);
      else if (kind === 'pdf') exportPdf();
    });
    exportMenu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var its = Array.prototype.slice.call(exportMenu.querySelectorAll('.pro-menu-item')), i = its.indexOf(document.activeElement);
      its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length].focus(); e.preventDefault();
    });
  }

  // ------------------------------------------------------ keyboard shortcuts
  var keysModal = $('proKeysModal');
  function openKeys() { if (keysModal) { keysModal.hidden = false; var c = $('proKeysClose'); if (c) c.focus(); } }
  function closeKeys() { if (keysModal && !keysModal.hidden) { keysModal.hidden = true; return true; } return false; }
  if ($('proKeysBtn')) $('proKeysBtn').addEventListener('click', openKeys);
  if ($('proKeysClose')) $('proKeysClose').addEventListener('click', closeKeys);
  if (keysModal) keysModal.addEventListener('mousedown', function (e) { if (e.target === keysModal) closeKeys(); });
  function typing(t) { var tag = t && t.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable); }
  // a field where text is being typed (Escape belongs to it)
  function textEntry(t) {
    if (!t) return false;
    if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
    if (t.tagName !== 'INPUT') return false;
    return !/^(checkbox|radio|range|button|submit|reset|color|file|image)$/i.test(t.type || 'text');
  }
  function shown2(id) { var el = $(id); return !!el && el.offsetParent !== null && !el.disabled; }
  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey, k = e.key;
    // undo / redo work everywhere except while editing a text field
    if (mod && !e.altKey && (k === 's' || k === 'S') && window.tmSession) {
      e.preventDefault();
      if (tmSession.canSave()) tmSession.save();
      return;
    }
    if (mod && !e.altKey && (k === 'o' || k === 'O')) { e.preventDefault(); openTree(); return; }
    if (mod && !e.altKey && (k === 'z' || k === 'Z' || k === 'y' || k === 'Y') && !typing(e.target) && window.tmUndo) {
      var redoKey = k === 'y' || k === 'Y' || e.shiftKey;
      if (redoKey ? tmUndo.redo() : tmUndo.undo()) e.preventDefault();
      return;
    }
    // Escape clears the selection also when a checkbox, slider or button still has the
    // focus (clicking the drawing does not take it away); not while text is typed
    if (k === 'Escape' && !mod && !e.altKey && !textEntry(e.target)) {
      if (e.defaultPrevented || closeKeys() || openPop || (modal && !modal.hidden)) return;   // a menu or dialog took this Escape
      if (document.querySelector('.pro-modal:not([hidden]), .axis-title-input')) return;
      if (shown2('clearCladeSelection')) { $('clearCladeSelection').click(); e.preventDefault(); }
      else if (call(function () { return highlightedAccessions.size > 0 || !!highlightedClade; })) { call(function () { clearCladeSelection(); }); e.preventDefault(); }
      return;
    }
    if (mod || e.altKey || typing(e.target)) return;
    if (k === 'Escape') return;
    if (!keysModal || !keysModal.hidden) return;
    if (k === '/') { var s = $('accessionSearch'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
    else if (k === '?') { e.preventDefault(); openKeys(); }
    else if (k === 'f' || k === 'F') { if ($('fit')) { e.preventDefault(); $('fit').click(); } }
    else if (k === '+' || k === '=') { if ($('zoomIn')) { e.preventDefault(); $('zoomIn').click(); } }
    else if (k === '-' || k === '_') { if ($('zoomOut')) { e.preventDefault(); $('zoomOut').click(); } }
    else if (k === 'l' || k === 'L') { e.preventDefault(); setLegend(body.classList.contains('pro-legend-hidden')); }
    else if (k === '[') { e.preventDefault(); setLeftMinimized(!leftMinimized()); }
    else if (k === 'Delete' || k === 'Backspace') { if (shown2('dropNode')) { e.preventDefault(); $('dropNode').click(); } }
  });

  // --------------------------------------------- remember display settings
  // Style-tab preferences are saved in this browser and applied again on the
  // next visit. Settings that depend on the loaded tree or its data (rooting,
  // layout/expansion, label hiding, ranges, data columns) are not remembered.
  var SETTINGS_KEY = 'treemapper.settings.v1';
  var REMEMBER = ['labelGuides', 'edgeStyle', 'orderEnable', 'orderDir', 'transformEnable', 'layoutMode', 'hideInternal',
    'internalNodeShape', 'internalNodeSize', 'showTipNodes', 'tipNodeShape', 'tipNodeSize', 'hideScaleBar', 'coverScaleBar',
    'scaleStrokeWidth', 'showBootstrap', 'bootstrapSymbolType', 'bootstrapFillColor', 'bootstrapBorderColor',
    'bootstrapBorderWidth', 'bootstrapMinSize', 'bootstrapMaxSize', 'bootstrapPosition', 'bootstrapFontSize',
    'bootstrapFontColor', 'bootstrapBold', 'bootstrapItalic', 'bootstrapTextPosition', 'bootstrapVerticalShift',
    'bootstrapScaleFactor', 'bootstrapRounding', 'bootstrapScientific', 'bootstrapPercent', 'bootstrapShowAll',
    'bootstrapColorMin', 'bootstrapColorMidToggle', 'bootstrapColorMid', 'bootstrapColorMax', 'branchStrokeWidth', 'dataMargin', 'axesBelow', 'axisTitleButtons'];
  function readCtl(el) {
    if (el.tagName === 'BUTTON') return el.getAttribute('aria-pressed') === 'true';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value;
  }
  // the value written in the page itself (Firefox restores form values on
  // reload, so the current value at start-up is not necessarily the default)
  function defaultOf(el) {
    if (el.tagName === 'BUTTON') return el.getAttribute('aria-pressed') === 'true';
    if (el.type === 'checkbox' || el.type === 'radio') return el.defaultChecked;
    if (el.tagName === 'SELECT') {
      for (var i = 0; i < el.options.length; i++) if (el.options[i].defaultSelected) return el.options[i].value;
      return el.options.length ? el.options[0].value : '';
    }
    return el.defaultValue;
  }
  function writeCtl(el, v) {
    if (readCtl(el) === v) return false;
    if (el.tagName === 'BUTTON') { el.click(); return true; }          // bold / italic toggles
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  var defaults = {}, applying = false, saveTimer = 0;
  function loadSaved() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveSettings() {
    if (applying) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var out = {};
      REMEMBER.forEach(function (id) { var el = $(id); if (el && readCtl(el) !== defaults[id]) out[id] = readCtl(el); });
      var tab = document.querySelector('.bootstrap-tab.active');
      if (tab) out.__supportTab = tab.getAttribute('data-tab');
      if (body.classList.contains('pro-legend-hidden')) out.__legendHidden = true;
      if (body.classList.contains('pro-left-minimized')) out.__leftMinimized = true;
      if (orderBtn && orderBtn.getAttribute('aria-pressed') === 'true') out.__legendByLayer = true;
      // search options; a single data layer is not remembered (it may not exist next time)
      if (searchOpts.exact) out.__searchExact = true;
      if (searchOpts.scope === 'accession' || searchOpts.scope === 'genes') out.__searchScope = searchOpts.scope;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(out)); } catch (e) {}
    }, 300);
  }
  function applySettings(values) {
    applying = true;
    REMEMBER.forEach(function (id) {
      var el = $(id); if (!el || !(id in values)) return;
      try { writeCtl(el, values[id]); } catch (e) {}
    });
    if (values.__supportTab) { var t = document.querySelector('.bootstrap-tab[data-tab="' + values.__supportTab + '"]'); if (t && !t.classList.contains('active')) t.click(); }
    setLegend(!values.__legendHidden);
    setLeftMinimized(!!values.__leftMinimized, true);
    setLegendOrder(!!values.__legendByLayer, true);
    setExact(!!values.__searchExact, true);
    setScope(values.__searchScope || 'all', true);
    applying = false;
  }
  REMEMBER.forEach(function (id) {
    var el = $(id); if (!el) return;
    defaults[id] = defaultOf(el);
    el.addEventListener('change', saveSettings); el.addEventListener('input', saveSettings);
    if (el.tagName === 'BUTTON') el.addEventListener('click', function () { setTimeout(saveSettings, 0); });
  });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.bootstrap-tab, #proLegendToggle, #proLegendClose')) setTimeout(saveSettings, 0); });
  // apply after app.js has finished wiring its controls
  setTimeout(function () { var saved = loadSaved(); if (Object.keys(saved).length) applySettings(saved); }, 0);
  if ($('proResetSettings')) $('proResetSettings').addEventListener('click', function () {
    var vals = {}; REMEMBER.forEach(function (id) { vals[id] = defaults[id]; });
    vals.__supportTab = 'symbol';
    applySettings(vals);
    rerunSearch();
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
    setStatus('Display settings restored to their defaults');
  });

  updateDoc();
  updateZoom();
  refreshAnno();

  // ------------------------------------------------- overlay scrollbars
  // Scrollbars that float over the content (macOS) cover the right edge of the card
  // lists, where the colour boxes are: a click on a box then lands on the scrollbar.
  // With such scrollbars the lists keep their right edge free (pro.css).
  (function () {
    var probe = document.createElement('div');
    probe.className = 'pro-list';
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:50px;max-height:50px;overflow-y:scroll;visibility:hidden';
    probe.innerHTML = '<div style="height:200px"></div>';
    document.body.appendChild(probe);
    var overlay = probe.offsetWidth - probe.clientWidth === 0;
    probe.remove();
    document.documentElement.classList.toggle('pro-overlay-scrollbars', overlay);
  })();
})();
