// Save / open a session (.treemapper file). Loaded after app.js.
//
// A session holds everything needed to rebuild the current work:
//   - the tree file and every data file (their original text),
//   - each data card's controls (visibility, colours, options) and gene order,
//   - the display settings (Style tab), theme and legend visibility,
//   - the root (manual re-root or midpoint rooting),
//   - tree edits (rotations, collapses, cartoons, drops),
//   - branch colours and clade highlights.
// Opening a session replays the files through the app's own loaders and then
// re-applies the rest, so the app's logic stays the single source of truth.
//
// Nodes are referred to by two tips whose lowest common ancestor is the node
// (plus a step count for single-child chains), computed on the full topology
// (including collapsed, cartooned and dropped parts). That stays small for any
// tree size and does not depend on drawing order.
(function () {
  'use strict';
  var FORMAT = 'treemapper-session', VERSION = 1;
  var LAYERS = [
    { type: 'dataframe', loader: 'handleMetaFile', container: 'dataframeContainer', map: function () { return dataframes; } },
    { type: 'heatmap', loader: 'handleHeatmapFile', container: 'heatmapContainer', map: function () { return heatmaps; } },
    { type: 'highlight', loader: 'handleHighlightFile', container: 'highlightContainer', map: function () { return highlights; } },
    { type: 'clade', loader: 'handleCladeFile', container: 'cladeContainer', map: function () { return clades; } },
    { type: 'chart', loader: 'handleChartFile', container: 'chartContainer', map: function () { return charts; } },
    { type: 'msa', loader: 'handleMsaFile', container: 'msaContainer', map: function () { return msas; } }
  ];
  var SETTING_IDS = ['tipSpacing', 'rotationDeg', 'openAngleDeg', 'hideLabels', 'labelGuides', 'orderEnable', 'orderDir',
    'transformEnable', 'layoutMode', 'edgeStyle', 'uniqueBranchTips', 'hideInternal', 'internalNodeShape', 'internalNodeSize',
    'showTipNodes', 'tipNodeShape', 'tipNodeSize', 'hideScaleBar', 'coverScaleBar', 'scaleRange', 'scaleStrokeWidth',
    'showBootstrap', 'bootstrapDataSource', 'bootstrapMinRange', 'bootstrapMaxRange', 'bootstrapSymbolType',
    'bootstrapFillColor', 'bootstrapBorderColor', 'bootstrapBorderWidth', 'bootstrapMinSize', 'bootstrapMaxSize',
    'bootstrapPosition', 'bootstrapFontSize', 'bootstrapFontColor', 'bootstrapBold', 'bootstrapItalic',
    'bootstrapTextPosition', 'bootstrapVerticalShift', 'bootstrapScaleFactor', 'bootstrapRounding', 'bootstrapScientific',
    'bootstrapPercent', 'bootstrapShowAll', 'bootstrapColorMin', 'bootstrapColorMidToggle', 'bootstrapColorMid',
    'bootstrapColorMax', 'branchStrokeWidth', 'dataMargin', 'axesBelow', 'axisTitleButtons', 'trackWidth', 'metaColumn',
    'groupMarksSourceWanted', 'groupMarksManual', 'groupMarksLines', 'groupMarksDashed', 'groupMarksWidth', 'groupMarksColor', 'groupMarksLabels', 'groupMarksFont',
    'labelTextSourceWanted', 'labelItalic', 'labelColorSourceWanted',
    'tangleName', 'tangleTree', 'tangleShow', 'tangleOrderMode', 'tangleUnique', 'tangleGuides', 'tangleLinks'];   // the name before the tree: the tree's load reads it
  var ROOT_IDS = ['rootEnable', 'rootMode'];

  function $(id) { return document.getElementById(id); }
  function call(fn) { try { return fn(); } catch (e) { console.warn('[session]', e); return undefined; } }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function fetchText(url) {
    var r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  function readFile(f) {
    if (f && typeof f.text === 'function') return f.text();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(f); });
  }

  // ------------------------------------------------- remember loaded files
  var treeSource = null;                  // { name, text }
  var cardSource = new WeakMap();          // card element -> { name, text }
  var pending = {};                        // type -> [{ name, text }] waiting for their card
  function wrapLoader(name, onText, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function (f) {
      var text = null, src = null;
      try { text = await readFile(f); } catch (e) {}
      if (text !== null) { src = { name: (f && f.name) || 'file', text: text }; if (f && f.url) src.url = String(f.url); onText(src); }
      try { return await orig.apply(this, arguments); }
      finally { if (src && after) { await Promise.resolve(); after(src); } }
    };
  }
  wrapLoader('handleTreeFile', function (src) { treeSource = src; });
  LAYERS.forEach(function (L) {
    // a file that made no card (not loaded, cancelled) must not be given to the next card
    wrapLoader(L.loader, function (src) { (pending[L.type] = pending[L.type] || []).push(src); },
      function (src) { var q = pending[L.type], i = q ? q.indexOf(src) : -1; if (i >= 0) q.splice(i, 1); });
    var box = $(L.container);
    if (!box) return;
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1 || n.tagName !== 'DETAILS' || cardSource.has(n)) return;
          var q = pending[L.type];
          if (q && q.length) cardSource.set(n, q.shift());
        });
      });
    }).observe(box, { childList: true });
  });

  // ---------------------------------------------------- tree node references
  function fullChildren(n, droppedByParent) {
    var out = [], seen = new Set();
    [n.children, n._children, n._originalChildren, droppedByParent.get(n)].forEach(function (c) {
      if (c) for (var i = 0; i < c.length; i++) if (!seen.has(c[i])) { seen.add(c[i]); out.push(c[i]); }
    });
    return out;
  }
  function droppedIndex() {
    var m = new Map();
    droppedNodes.forEach(function (d) { if (d.parent) { if (!m.has(d.parent)) m.set(d.parent, []); m.get(d.parent).push(d); } });
    return m;
  }
  function makeRefs() {
    var dbp = droppedIndex();
    var first = new Map(), last = new Map();      // node -> a leaf name on its left / right edge
    var all = [], stack = [[root, false]];
    while (stack.length) {
      var it = stack.pop(), n = it[0];
      if (it[1]) {
        var kids = fullChildren(n, dbp);
        if (!kids.length) { var nm = String(n.data && n.data.name); first.set(n, nm); last.set(n, nm); }
        else { first.set(n, first.get(kids[0])); last.set(n, last.get(kids[kids.length - 1])); }
        continue;
      }
      all.push(n); stack.push([n, true]);
      fullChildren(n, dbp).forEach(function (c) { stack.push([c, false]); });
    }
    function ref(n) {
      if (!first.has(n)) return null;
      var a = first.get(n), b = last.get(n);
      if (a === b) {
        // a tip, or a single-child chain ending in one tip: count steps above the tip
        var up = 0, x = n; while (x && fullChildren(x, dbp).length) { x = fullChildren(x, dbp)[0]; up++; }
        return [a, a, up];
      }
      // steps from the deepest node holding both tips up to n (single-child chains)
      var up2 = 0, y = n;
      while (true) {
        var ks = fullChildren(y, dbp);
        if (ks.length !== 1) break;
        y = ks[0]; up2++;
      }
      return [a, b, up2];
    }
    return { ref: ref, all: all, dbp: dbp };
  }
  function makeResolver() {
    var dbp = droppedIndex(), byName = new Map(), parent = new Map();
    var stack = [root];
    while (stack.length) {
      var n = stack.pop(), kids = fullChildren(n, dbp);
      if (!kids.length && n.data && n.data.name != null && !byName.has(String(n.data.name))) byName.set(String(n.data.name), n);
      kids.forEach(function (c) { parent.set(c, n); stack.push(c); });
    }
    return function (r) {
      if (!r) return null;
      var a = byName.get(r[0]), b = byName.get(r[1]);
      if (!a || !b) return null;
      var anc = new Set(), x = a;
      while (x) { anc.add(x); x = parent.get(x); }
      var lca = b; while (lca && !anc.has(lca)) lca = parent.get(lca);
      if (!lca) return null;
      if (r[0] === r[1]) {
        // tip (+ single-child chain above it)
        var t = a; for (var i = 0; i < r[2]; i++) t = parent.get(t);
        return t || null;
      }
      var node = lca;
      for (var j = 0; j < r[2]; j++) node = parent.get(node);
      return node || null;
    };
  }

  // ------------------------------------------------------------- controls
  function readCtl(el) {
    if (el.tagName === 'BUTTON') return el.getAttribute('aria-pressed') === 'true';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value;
  }
  function writeCtl(el, v, force) {
    if (readCtl(el) === v) {
      // force: the control already shows the value but the app may not have applied it
      if (!force || el.tagName === 'BUTTON') return false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.tagName === 'BUTTON') { el.click(); return true; }
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function cardControls(card) {
    return Array.prototype.filter.call(card.querySelectorAll('input, select, textarea, button[aria-pressed]'), function (el) {
      return el.type !== 'file' && el.type !== 'search' && !el.classList.contains('pro-search') && !el.closest('[data-session-skip]');
    });
  }
  // a description of each control that does not depend on the card's number
  function describe(card) {
    var counts = {}, out = [];
    cardControls(card).forEach(function (el) {
      var row = el.closest('[data-gene],[data-value],[data-column]');
      var rowKey = row && card.contains(row) ? (row.getAttribute('data-gene') || row.getAttribute('data-value') || row.getAttribute('data-column') || '') : '';
      var sig = rowKey + '|' + el.tagName + '.' + (el.type || '') + '.' + (el.id || '').replace(/\d+/g, '#') + '.' +
        Array.prototype.slice.call(el.classList).sort().join(' ') + '.' + (el.getAttribute('data-column') || el.getAttribute('data-gene') || el.name || '').replace(/\d+$/, '');
      counts[sig] = (counts[sig] || 0) + 1;
      out.push({ d: sig + '#' + counts[sig], el: el });
    });
    return out;
  }

  function layerObject(L, card) {
    var m = /(\d+)$/.exec(card.id || '');
    return m ? call(function () { return L.map().get(+m[1]); }) : null;
  }

  // ------------------------------------------------------------------ save
  // opts.link: sources fetched from a URL are saved as the URL alone (fetched again on open)
  function linked(src, opts) {
    var out = { name: src.name, text: src.text };
    if (src.url) { out.url = src.url; if (opts && opts.link) delete out.text; }
    return out;
  }
  function collect(opts) {
    if (!root || !treeSource) throw new Error('Load a tree first.');
    var R = makeRefs(), ref = R.ref;
    var s = { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), tree: linked(treeSource, opts) };

    var settings = {};
    SETTING_IDS.concat(ROOT_IDS).forEach(function (id) { var el = $(id); if (el) settings[id] = readCtl(el); });
    var tab = document.querySelector('.bootstrap-tab.active'); if (tab) settings.__supportTab = tab.getAttribute('data-tab');
    var treeTitle = call(function () { return treeAxisTitle; }); if (treeTitle) settings.__treeAxisTitle = treeTitle;
    if (window.tmLegendOrder && tmLegendOrder.get()) settings.__legendByLayer = true;
    settings.__theme = document.documentElement.getAttribute('data-theme') || 'light';
    settings.__legendHidden = document.body.classList.contains('pro-legend-hidden');
    settings.__layout = (typeof geometry !== 'undefined' && geometry === 'radial') ? 'radial' : 'rect';
    if (window.tmSearch) settings.__search = window.tmSearch.get();   // Look in / Exact match
    s.settings = settings;

    s.layers = [];
    LAYERS.forEach(function (L) {
      var box = $(L.container); if (!box) return;
      Array.prototype.forEach.call(box.children, function (card) {
        if (card.tagName !== 'DETAILS') return;
        var src = cardSource.get(card);
        if (!src) return;   // not loaded from a file (should not happen)
        var entry = linked(src, opts); entry.type = L.type; entry.open = card.open;
        entry.controls = describe(card).map(function (c) { return [c.d, readCtl(c.el)]; });
        var obj = layerObject(L, card);
        if (obj && Array.isArray(obj.geneOrder) && obj.geneOrder.length) entry.geneOrder = obj.geneOrder.slice();
        if (obj && obj.axisTitle) entry.axisTitle = obj.axisTitle;   // the axis title (unit) of this layer
        s.layers.push(entry);
      });
    });

    // root: re-rooted by hand (midpoint rooting is part of the settings)
    var midpoint = settings.rootEnable && settings.rootMode === 'midpoint';
    if (!midpoint && call(function () { return !!originalRootNewick; })) {
      // the tips on each side of the root; with two sides (the app roots on a branch)
      // also where on that branch: rootFrac = share of the branch on the first side
      var rk = fullChildren(root, R.dbp);
      s.rootSides = rk.map(function (k) {
        var names = [], st = [k];
        while (st.length) { var n = st.pop(), ks = fullChildren(n, R.dbp); if (!ks.length) names.push(String(n.data.name)); else ks.forEach(function (c) { st.push(c); }); }
        return names;
      });
      if (rk.length === 2) {
        var la = rk[0].data.length, lb = rk[1].data.length, tot = (la || 0) + (lb || 0);
        s.rootFrac = tot !== 0 ? (la || 0) / tot : 0.5;
      }
    }

    var edits = { order: [], rotations: [], collapsed: [], cartooned: [], dropped: [] };
    R.all.forEach(function (n) {
      var kids = fullChildren(n, R.dbp);
      if (kids.length > 1) edits.order.push([ref(n), kids.map(function (k) { return ref(k); })]);
    });
    nodeRotationCounts.forEach(function (c, n) { var r = ref(n); if (r && c) edits.rotations.push([r, c]); });
    collapsedNodes.forEach(function (n) { var r = ref(n); if (r) edits.collapsed.push(r); });
    cartoonedNodes.forEach(function (n) { var r = ref(n); if (r) edits.cartooned.push(r); });
    droppedNodes.forEach(function (n) { if (!(n.children || n._children) && n.data) edits.dropped.push(String(n.data.name)); });
    s.edits = edits;

    var col = { clade: [], perm: [], bg: [], paths: [], layerTs: [], pathCounter: pathCounter, colorActionCounter: colorActionCounter };
    cladeColors.forEach(function (c, n) { var r = ref(n); if (r) col.clade.push([r, c, cladeColorTs.get(n) || 0]); });
    cladeBackgroundColors.forEach(function (c, n) { var r = ref(n); if (r) col.bg.push([r, c]); });
    R.all.forEach(function (n) {
      if (!n.permanentColors || !n.permanentColors.size) return;
      var entries = [], layerTs = [];
      n.permanentColors.forEach(function (v, k) {
        // Clade-card colours are rebuilt from the cards (in the same order); only
        // their ages are kept, because the newest colour wins where colours overlap
        if (String(k).indexOf('clade_path_') === 0) { layerTs.push(v && v.ts || 0); return; }
        entries.push([k, v && v.color !== undefined ? v.color : v, v && v.ts || 0]);
      });
      if (entries.length || layerTs.length) {
        var r = ref(n);
        if (entries.length) col.perm.push([r, entries]);
        if (layerTs.length) col.layerTs.push([r, layerTs]);
      }
    });
    if (window.pathLeafNames) window.pathLeafNames.forEach(function (names, k) {
      if (String(k).indexOf('clade_path_') !== 0) col.paths.push([k, Array.from(names)]);
    });
    s.colours = col;
    return s;
  }

  function hasUrlSources() {
    if (treeSource && treeSource.url) return true;
    var any = false;
    LAYERS.forEach(function (L) { var box = $(L.container); if (!box) return; Array.prototype.forEach.call(box.children, function (card) { var src = cardSource.get(card); if (src && src.url) any = true; }); });
    return any;
  }
  function save(opts) {
    var s;
    if (!opts && hasUrlSources()) opts = { link: confirm('Some of the data was fetched from URLs.\n\nOK: save the URLs (a small session; the data is fetched again when it is opened).\nCancel: save copies of the data in the session.') };
    try { s = collect(opts); } catch (e) { alert('Cannot save the session: ' + e.message); return; }
    var base = (treeSource && treeSource.name || 'tree').replace(/\.[^.]+$/, '');
    var name = prompt('Save session as:', base + '.treemapper');
    if (name === null) return;
    name = name.trim() || base + '.treemapper';
    if (!/\.treemapper$/i.test(name)) name += '.treemapper';
    var blob = new Blob([JSON.stringify(s)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    call(function () { setStatus('Session saved as ' + name); });
  }

  // ------------------------------------------------------- finding the root
  // Each tip gets a pseudo-random 52-bit number; a set of tips is identified by
  // the XOR of its numbers, so every node's sides can be compared cheaply.
  function tipHash(name) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < name.length; i++) {
      var c = name.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 + c, 2246822519) >>> 0;
    }
    return [h1, h2 & 0xfffff];
  }
  function xor(a, b) { return [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0]; }
  function key(h) { return h[0] + ':' + h[1]; }
  function setHash(names) { var h = [0, 0]; names.forEach(function (n) { h = xor(h, tipHash(String(n))); }); return h; }
  // ------------------------------------------------------------------ open
  var busy = false;
  async function waitForRootChange(before, ms) {
    var t = 0;
    while (root === before && t < ms) { await wait(50); t += 50; }
    await wait(50);
  }
  async function load(fileOrText) {
    if (busy) return;
    var s;
    try {
      var text = typeof fileOrText === 'string' ? fileOrText : await readFile(fileOrText);
      s = JSON.parse(text);
    } catch (e) { alert('This file is not a TreeMapper session.'); return; }
    if (!s || s.format !== FORMAT || !s.tree || (typeof s.tree.text !== 'string' && typeof s.tree.url !== 'string')) { alert('This file is not a TreeMapper session.'); return; }
    if (s.version > VERSION) { alert('This session was saved by a newer version of TreeMapper.'); return; }
    if (root && !confirm('Open this session? The current tree and data will be replaced.')) return;

    busy = true;
    // linked data: fetch what the session holds only as a URL
    var fetchProblems = [];
    async function fill(src, what) {
      if (!src || typeof src.text === 'string' || typeof src.url !== 'string') return;
      call(function () { setStatus('Fetching ' + what + '…'); });
      try { src.text = await fetchText(src.url); }
      catch (e) { fetchProblems.push(what + ' could not be fetched from ' + src.url + ' (' + e.message + ')'); }
    }
    await fill(s.tree, 'the tree');
    for (var li = 0; li < (s.layers || []).length; li++) await fill(s.layers[li], 'the ' + s.layers[li].type + ' ' + (s.layers[li].name || ''));
    if (typeof s.tree.text !== 'string') { busy = false; alert('Could not open the session: ' + fetchProblems[0]); call(function () { setStatus('Could not open the session'); }); return; }
    s.layers = (s.layers || []).filter(function (l) { return typeof l.text === 'string'; });
    if (window.tmUndo) tmUndo.suspend(true);
    var origConfirm = window.confirm, origAlert = window.alert, origDraw = window.drawTree, needDraw = false;
    window.confirm = function () { return true; };
    window.alert = function (m) { console.warn('[session]', m); };
    var problems = fetchProblems.slice(), T0 = performance.now(), timings = {};
    function mark(n) { var t = performance.now(); timings[n] = Math.round(t - T0); T0 = t; }
    // while replaying, redraws and legend rebuilds are deferred to one at the end
    var origLegend = window.updateMetadataLegend, origCladeApply = window.applyCladeColorsToTree, cladeApplyNeeded = false;
    function stubDraw() {
      window.drawTree = function () { needDraw = true; };
      if (origLegend) window.updateMetadataLegend = function () {};
      if (origCladeApply) window.applyCladeColorsToTree = function () { cladeApplyNeeded = true; };
    }
    function realDraw() {
      window.drawTree = origDraw;
      if (origLegend) window.updateMetadataLegend = origLegend;
      if (origCladeApply) window.applyCladeColorsToTree = origCladeApply;
      if (cladeApplyNeeded) { cladeApplyNeeded = false; call(origCladeApply); }   // clade-card colours, once
    }
    try {
      call(function () { setStatus('Opening session…'); });
      // 1. remove current data cards
      LAYERS.forEach(function (L) {
        var box = $(L.container); if (!box) return;
        Array.prototype.slice.call(box.querySelectorAll(':scope > details .df-delete')).reverse().forEach(function (b) { call(function () { b.click(); }); });
      });
      await wait(50);

      mark('clear');
      // 2. tree
      var treeFile = new File([s.tree.text], s.tree.name || 'tree.nwk'); if (s.tree.url) treeFile.url = s.tree.url;
      await window.handleTreeFile(treeFile);
      await wait(50);
      if (!root) throw new Error('the tree could not be loaded');

      mark('tree');
      // 3. layout + display settings (one redraw at the end)
      var st = s.settings || {};
      stubDraw();
      if (st.__layout === 'radial' && $('btnRadial') && geometry !== 'radial') $('btnRadial').click();
      if (st.__layout === 'rect' && $('btnRect') && geometry === 'radial') $('btnRect').click();
      SETTING_IDS.forEach(function (id) { var el = $(id); if (el && id in st) call(function () { writeCtl(el, st[id], true); }); });
      if (window.tmTangle && tmTangle.panelWanted()) call(function () { tmTangle.relayout(); });   // the comparison tree's panel
      if (st.__supportTab) { var t = document.querySelector('.bootstrap-tab[data-tab="' + st.__supportTab + '"]'); if (t && !t.classList.contains('active')) t.click(); }
      call(function () { treeAxisTitle = st.__treeAxisTitle || ''; });
      if (window.tmLegendOrder) tmLegendOrder.set(!!st.__legendByLayer);
      if (st.__theme) {
        var dark = st.__theme === 'dark', tg = $('themeToggle');
        if (tg && tg.checked !== dark) tg.click();
      }
      document.body.classList.toggle('pro-legend-hidden', !!st.__legendHidden);
      var lt = $('proLegendToggle'); if (lt) lt.setAttribute('aria-pressed', String(!st.__legendHidden));
      realDraw();

      mark('settings');
      // 4. root (midpoint through its controls, a manual re-root through its split)
      var r0 = root;
      if (st.rootEnable && st.rootMode === 'midpoint') {
        ROOT_IDS.forEach(function (id) { var el = $(id); if (el && id in st) call(function () { writeCtl(el, st[id], true); }); });
        await waitForRootChange(r0, 15000);
      } else if (s.rootSides && s.rootSides.length >= 2) {
        // two sides: on that branch at the saved position; more: at the node with those sides
        var spec = s.rootSides.length === 2
          ? { side: s.rootSides[0], frac: typeof s.rootFrac === 'number' ? s.rootFrac : 0.5 }
          : { sides: s.rootSides };
        await rerootAtNode(spec, true);
        if (root === r0) problems.push('the saved root could not be found');
      }

      mark('root');
      // 5. data layers, in their saved order
      for (var i = 0; i < (s.layers || []).length; i++) {
        var lay = s.layers[i], L = LAYERS.filter(function (x) { return x.type === lay.type; })[0];
        if (!L || typeof window[L.loader] !== 'function') { problems.push('unknown layer type ' + lay.type); continue; }
        var box = $(L.container), before = new Set(box ? box.children : []);
        stubDraw();   // the loaders redraw the whole tree when they finish; one redraw at the end is enough
        var layFile = new File([lay.text], lay.name || (lay.type + '.csv')); if (lay.url) layFile.url = lay.url;   // kept, so the session can be saved with links again
        try { await window[L.loader](layFile); }
        finally { realDraw(); }
        await wait(80);
        var card = null;
        if (box) Array.prototype.forEach.call(box.children, function (c) { if (c.tagName === 'DETAILS' && !before.has(c)) card = c; });
        if (!card) { problems.push('could not reload ' + lay.name); continue; }
        mark('layer ' + lay.type);
        // card controls (one redraw at the end)
        stubDraw();
        var saved = lay.controls || [], index = null, dirty = true;
        var mo = new MutationObserver(function () { dirty = true; });
        mo.observe(card, { childList: true, subtree: true });
        for (var k = 0; k < saved.length; k++) {
          if (dirty) { index = new Map(); describe(card).forEach(function (c) { index.set(c.d, c.el); }); dirty = false; }
          var el = index.get(saved[k][0]);
          if (el && el.isConnected && !el.disabled) call(function () { writeCtl(el, saved[k][1]); });
        }
        mo.disconnect();
        // gene order (drag & drop in the card)
        var obj = layerObject(L, card);
        if (lay.geneOrder && obj) {
          obj.geneOrder = lay.geneOrder.slice();
          var list = card.querySelector('.gene-card') ? card.querySelector('.gene-card').parentNode : null;
          if (list) lay.geneOrder.forEach(function (g) {
            var row = list.querySelector('.gene-card[data-gene="' + (window.CSS && CSS.escape ? CSS.escape(g) : g) + '"]');
            if (row) list.appendChild(row);
          });
        }
        if (obj && typeof lay.axisTitle === 'string') obj.axisTitle = lay.axisTitle;
        if (typeof lay.open === 'boolean') card.open = lay.open;
        realDraw();
        call(function () { updateMetadataLegend(); });
        mark('controls ' + lay.type);
      }

      // search options (after the layers: Look in may name one of them)
      if (st.__search && window.tmSearch) call(function () { window.tmSearch.set(st.__search); });

      // 6. tree edits and colours (applied directly, then one redraw)
      stubDraw();
      var find = makeResolver(), E = s.edits || {}, C = s.colours || {};
      (E.order || []).forEach(function (o) {
        var n = find(o[0]); if (!n) return;
        var want2 = o[1].map(find), list2 = n.children || n._children;
        if (!list2 || want2.some(function (x) { return !x; })) return;
        var ordered = want2.filter(function (x) { return list2.indexOf(x) >= 0; });
        if (ordered.length === list2.length) { list2.length = 0; ordered.forEach(function (x) { list2.push(x); }); }
      });
      nodeRotationCounts.clear();
      (E.rotations || []).forEach(function (r) { var n = find(r[0]); if (n) nodeRotationCounts.set(n, r[1]); });
      // collapse deepest first so nested collapses work
      (E.collapsed || []).map(find).filter(Boolean).sort(function (a, b) { return b.depth - a.depth; })
        .forEach(function (n) { if (n.children) call(function () { toggleCollapse(n); }); });
      (E.cartooned || []).map(find).filter(Boolean).forEach(function (n) { if (!cartoonedNodes.has(n)) call(function () { cartoonClade(n); }); });
      var tipByName = new Map(); root.leaves().forEach(function (l) { tipByName.set(String(l.data.name), l); });
      (E.dropped || []).forEach(function (nm) { var l = tipByName.get(nm); if (l && !droppedNodes.has(l)) call(function () { dropNode(l); }); });

      (C.clade || []).forEach(function (c) { var n = find(c[0]); if (n) { cladeColors.set(n, c[1]); cladeColorTs.set(n, c[2] || 0); } });
      (C.bg || []).forEach(function (c) { var n = find(c[0]); if (n) cladeBackgroundColors.set(n, c[1]); });
      (C.perm || []).forEach(function (p) {
        var n = find(p[0]); if (!n) return;
        if (!n.permanentColors) n.permanentColors = new Map();
        p[1].forEach(function (e) { n.permanentColors.set(e[0], { color: e[1], ts: e[2] || 0 }); });
      });
      (C.layerTs || []).forEach(function (p) {
        var n = find(p[0]); if (!n || !n.permanentColors) return;
        var ages = Array.isArray(p[1]) ? p[1] : [p[1]], i = 0;
        n.permanentColors.forEach(function (v, k) {
          if (String(k).indexOf('clade_path_') !== 0 || !v || typeof v !== 'object') return;
          v.ts = ages[Math.min(i, ages.length - 1)]; i++;
        });
      });
      if (!window.pathLeafNames) window.pathLeafNames = new Map();
      (C.paths || []).forEach(function (p) { window.pathLeafNames.set(p[0], new Set(p[1])); });
      if (C.pathCounter) pathCounter = Math.max(pathCounter, C.pathCounter);
      if (C.colorActionCounter) colorActionCounter = Math.max(colorActionCounter, C.colorActionCounter);
      realDraw();

      [resetFontTruncationCache, resetEventDelegation, updateRestoreDroppedButtonVisibility, updateResetRotationsButtonVisibility,
       updateResetCollapsesButtonVisibility, updateResetCartoonsButtonVisibility, updateResetHighlightsButtonVisibility,
       updateColorPathCardVisibility, updateMetadataLegend].forEach(function (f) { call(f); });
      drawTree();
      var exp = $('tipSpacing') ? +$('tipSpacing').value || 0 : 0;
      if (geometry === 'radial') call(centerRadial);
      else if (exp <= 0) call(onFitToViewRect);
      mark('edits+draw');
      window.tmSession.lastTimings = timings;
      if (window.tmUndo) tmUndo.refresh();
      call(function () { setStatus('Session opened' + (problems.length ? ' (with problems: ' + problems.join('; ') + ')' : '')); });
      if (problems.length) origAlert('The session was opened, but:\n- ' + problems.join('\n- '));
    } catch (e) {
      realDraw();
      origAlert('Could not open the session: ' + e.message);
      call(function () { setStatus('Could not open the session'); });
    } finally {
      window.drawTree = origDraw; if (origLegend) window.updateMetadataLegend = origLegend; if (origCladeApply) window.applyCladeColorsToTree = origCladeApply;
      window.confirm = origConfirm; window.alert = origAlert;
      busy = false;
      if (window.tmUndo) { tmUndo.suspend(false); tmUndo.clear(); }
    }
  }

  // ---------------------------------------------- replace a layer's data
  // Used by the data editor (js/data-editor.js): the layer is rebuilt from the edited
  // table through its own loader, put where it was, and given the card's settings
  // (visibility, colours, options, gene order, axis title, open state) where they
  // still apply. Columns keep their widths on the canvas.
  // Nothing is lost when the table cannot be loaded: dataframes, heatmaps and charts
  // are loaded next to the old card, which is only removed once the new one is there;
  // a highlight or clade layer (only one of each) is loaded again from its old table.
  // Returns { ok: true, card } or { ok: false, error }.
  var VALIDATE = { dataframe: 'validateDataframeFormat', highlight: 'validateHighlightFormat', clade: 'validateCladeFormat', chart: 'validateChartFormat' };
  var DELETE = { dataframe: 'deleteDataframeCard', heatmap: 'deleteHeatmapCard', chart: 'deleteChartCard', msa: 'deleteMsaCard' };
  var REORDER = { dataframe: 'updateDataframeOrder', heatmap: 'updateHeatmapOrder', chart: 'updateChartOrder', msa: 'updateMsaOrder' };
  function layerOfCard(card) {
    for (var i = 0; i < LAYERS.length; i++) { var box = $(LAYERS[i].container); if (box && box.contains(card)) return LAYERS[i]; }
    return null;
  }
  function cardNumber(card) { var m = /(\d+)$/.exec(card.id || ''); return m ? +m[1] : null; }
  var replacing = false;
  async function replaceLayerData(card, text) {
    if (replacing || busy) return { ok: false, error: 'another change is still being made' };
    var L = layerOfCard(card);
    if (!L || !card.isConnected) return { ok: false, error: 'the layer was not found' };
    var src = cardSource.get(card);
    var name = (src && src.name) || (L.type + '.txt');
    var vfn = VALIDATE[L.type];
    if (vfn && typeof window[vfn] === 'function') {
      var v = call(function () { return window[vfn](text); });
      if (v && v.valid === false) return { ok: false, error: v.error || 'the table is not in the expected format' };
    }
    var box = $(L.container);
    var saved = describe(card).map(function (c) { return [c.d, readCtl(c.el)]; });
    var obj = layerObject(L, card);
    var geneOrder = obj && Array.isArray(obj.geneOrder) ? obj.geneOrder.slice() : null;
    var axisTitle = obj ? obj.axisTitle : null;
    // a dataframe's alignment (align by gene, its type, the group rules) lives on the layer
    // object, not only in its controls: carried over as data and put back after the reload
    var oldNum = cardNumber(card);
    // (the layer object's fields are what the drawing uses; the first card's old globals only as a fallback)
    var align = (L.type === 'dataframe' && obj) ? {
      on: !!(obj.alignByGeneEnabled !== undefined ? obj.alignByGeneEnabled : (oldNum === 1 && typeof alignByGeneEnabled !== 'undefined' ? alignByGeneEnabled : false)),
      gene: String((obj.alignGeneName !== undefined ? obj.alignGeneName : (oldNum === 1 && typeof alignGeneName !== 'undefined' ? alignGeneName : '')) || ''),
      type: String((obj.alignType !== undefined ? obj.alignType : (oldNum === 1 && typeof alignType !== 'undefined' ? alignType : 'left')) || 'left'),
      rules: Array.isArray(obj.alignRules) ? JSON.parse(JSON.stringify(obj.alignRules)) : []
    } : null;
    var wasOpen = card.open;
    var widths = call(function () { return panelWidths.slice(); }), count = call(function () { return panelCount; });
    replacing = true;
    var origConfirm = window.confirm, origAlert = window.alert, origDraw = window.drawTree, needDraw = false, said = [];
    var origLegend = window.updateMetadataLegend;
    window.confirm = function () { return true; };   // "replace the existing highlight?", "proceed anyway?"
    window.alert = function (m) { said.push(String(m)); };
    // one redraw at the end (the loader and every restored control would redraw)
    window.drawTree = function () { needDraw = true; };
    if (origLegend) window.updateMetadataLegend = function () {};
    if (window.tmUndo) tmUndo.suspend(true);
    function finish() {
      window.confirm = origConfirm; window.alert = origAlert; window.drawTree = origDraw;
      if (origLegend) window.updateMetadataLegend = origLegend;
      if (window.tmUndo) tmUndo.suspend(false);
      replacing = false;
    }
    async function loadTable(t) {
      var before = new Set(box.children), made = null;
      await window[L.loader](new File([t], name, { type: 'text/plain' }));
      Array.prototype.forEach.call(box.children, function (c) { if (!before.has(c) && c.tagName === 'DETAILS') made = c; });
      return made;
    }
    function restoreSettings(card2) {
      var dirty = true, idx = null;
      var mo = new MutationObserver(function () { dirty = true; }); mo.observe(card2, { childList: true, subtree: true });
      for (var k = 0; k < saved.length; k++) {
        if (dirty) { idx = new Map(); describe(card2).forEach(function (c) { idx.set(c.d, c.el); }); dirty = false; }
        var el = idx.get(saved[k][0]);
        if (el && el.isConnected && !el.disabled) call(function () { writeCtl(el, saved[k][1]); });
      }
      mo.disconnect();
      var obj2 = layerObject(L, card2);
      if (obj2 && geneOrder && Array.isArray(obj2.geneOrder)) {
        var have = new Set(obj2.geneOrder);
        var order = geneOrder.filter(function (g) { return have.has(g); });
        obj2.geneOrder.forEach(function (g) { if (order.indexOf(g) < 0) order.push(g); });
        obj2.geneOrder = order;
        var first = card2.querySelector('.gene-card'), list = first ? first.parentNode : null;
        if (list) order.forEach(function (g) {
          var row = list.querySelector(':scope > .gene-card[data-gene="' + (window.CSS && CSS.escape ? CSS.escape(g) : g) + '"]');
          if (row) list.appendChild(row);
        });
      }
      if (obj2 && axisTitle) obj2.axisTitle = axisTitle;
      if (obj2 && align) restoreAlignment(card2, obj2, align);
      card2.open = wasOpen;
    }
    // the reorder renames the card but not every control inside it (the align switch and gene
    // list kept the load-time number, so the next reload's lookups by id missed them and the
    // gene list came back empty): ids and radio names ending in that number get the card's own
    function renumberInside(card2, from, to) {
      if (from == null || to == null || from === to) return;
      var re = /^(.*?[^0-9])(\d+)$/;
      Array.prototype.forEach.call(card2.querySelectorAll('[id], [name]'), function (el) {
        ['id', 'name'].forEach(function (a) {
          var v = el.getAttribute(a), m = v && re.exec(v);
          if (m && +m[2] === from) el.setAttribute(a, m[1] + to);
        });
      });
    }
    function restoreAlignment(card2, obj2, al) {
      var id2 = cardNumber(card2), meta = obj2.meta, genes = new Set();
      call(function () { var gc = getDataframeColumnIndices(meta).geneCol; (meta.rows || []).forEach(function (r) { genes.add(String(r[gc])); }); });
      var gene = genes.has(al.gene) ? al.gene : '';   // the aligned gene may have been deleted
      obj2.alignByGeneEnabled = al.on; obj2.alignGeneName = gene; obj2.alignType = al.type; obj2.alignRules = al.rules;
      if (id2 === 1) call(function () { alignByGeneEnabled = al.on; alignGeneName = gene; alignType = al.type; });
      // (the controls inside a reloaded card keep the number it was loaded with: found in the card)
      var cb = card2.querySelector('input[id^="metaAlignEnable"]'), sl = card2.querySelector('select[id^="metaAlignGene"]');
      if (cb) cb.checked = al.on;
      if (sl) { sl.value = gene; sl.disabled = !al.on; }
      card2.querySelectorAll('input[name^="metaAlignType"]').forEach(function (r) { r.checked = r.value === al.type; r.disabled = !al.on; });
      call(function () { if (typeof ALIGNMENT_OPTIMIZATIONS !== 'undefined' && ALIGNMENT_OPTIMIZATIONS.cache) { ALIGNMENT_OPTIMIZATIONS.cache.clear(); ALIGNMENT_OPTIMIZATIONS.lastProcessedFrame = null; } });
      if (window.tmAlignRules) call(function () { tmAlignRules.refresh(id2); });
    }
    var card2 = null, error = null, restored = null;
    try {
      if (DELETE[L.type]) {
        // next to the old one first; the old one goes once the new one is there
        card2 = await loadTable(text);
        if (!card2) error = 'the layer could not be built from the table' + (said.length ? ' (' + said[0] + ')' : '');
        else {
          var loadedNum = cardNumber(card2);   // (the number the new layer was built with: its controls' ids end in it)
          box.insertBefore(card2, card);
          var oldId = cardNumber(card);
          if (oldId !== null) call(function () { window[DELETE[L.type]](oldId); });
          if (card.isConnected) card.remove();
          call(function () { window[REORDER[L.type]](); });
          renumberInside(card2, loadedNum, cardNumber(card2));
        }
      } else {
        // only one layer of this kind: its loader replaces it
        var original = src && typeof src.text === 'string' ? src.text : null;
        card2 = await loadTable(text);
        if (!card2) {
          error = 'the layer could not be built from the table' + (said.length ? ' (' + said[0] + ')' : '');
          if (!card.isConnected && original !== null) {
            var back = await loadTable(original);   // the old table again
            if (back) { cardSource.set(back, src); restoreSettings(back); restored = back; error += '; the layer was loaded again as it was'; }
          }
        }
      }
      if (card2) {
        cardSource.set(card2, { name: name, text: text });
        restoreSettings(card2);
        // the columns keep their widths
        if (widths && count === call(function () { return panelCount; })) call(function () { panelWidths = widths; updatePanelPositions(); updateSplitterPositions(); });
      }
    } catch (e) {
      error = (e && e.message) ? e.message : String(e);
    } finally {
      finish();
    }
    call(function () { origDraw(); });
    if (origLegend) call(function () { origLegend(); });
    if (card2 && L.type === 'clade' && window.tmUndo && tmUndo.clear) tmUndo.clear();   // its steps refer to the old card
    // the layer has a new card: undo steps that name the old one follow it (each deletion and
    // each undo reloads the layer, and the earlier steps were lost with their card)
    var now = card2 || restored;
    if (now && now !== card && window.tmUndo && tmUndo.cardReplaced) call(function () { tmUndo.cardReplaced(card, now); });
    return error ? { ok: false, error: error, card: restored || (card.isConnected ? card : null) } : { ok: true, card: card2 };
  }

  window.tmSession = {
    save: save, load: load, collect: collect,
    // the table a layer was loaded from (for the data editor)
    layerSource: function (card) { var s = cardSource.get(card); return s ? { name: s.name, text: s.text } : null; },
    replaceLayerData: replaceLayerData,
    isSessionFile: function (f) { return !!f && /\.treemapper$/i.test(f.name || ''); },
    canSave: function () { return !!(root && treeSource); },
    hasUrlSources: hasUrlSources, fetchText: fetchText,
    // true while a session is being opened or a layer's data replaced (loaders then skip their dialogs)
    isLoading: function () { return !!(busy || replacing); }
  };
})();
