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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openPop) { var a = openPop.anchor; closePop(); if (a && a.focus) a.focus(); } });
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
  function droppedCount() { var b = $('restoreDroppedNodes'); var m = b && /\((\d+)\)/.exec(b.textContent); return m ? +m[1] : 0; }
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
      if (redraw) { updateDoc(); refreshAnno(); }
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

  // "/" focuses the search box (unless already typing somewhere)
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    var s = $('accessionSearch'); if (s) { e.preventDefault(); s.focus(); s.select(); }
  });

  updateDoc();
  updateZoom();
  refreshAnno();
})();
