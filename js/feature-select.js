// Feature selection on a dataframe column (loaded after select-tool.js). A marquee drawn
// over a dataframe column selects the bars (rows) of that layer: Shift adds, Alt removes,
// as for tips. The selected bars are outlined; the selection toolbar switches to a feature
// mode with a count, a Genes picker (which genes the selection takes: unticked genes are not
// picked up, now or by the next marquees on that layer; also reachable before any selection
// from a "Select: …" button next to the canvas tools),
// Copy rows (a TSV with the header, as the existing copy), Delete rows (also the Delete /
// Backspace key; the layer is loaded again through the data-replacement path, so its
// settings stay, and the deletion is an undo step) and Clear (also Escape). A tip
// selection and a feature selection never exist together.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ROW = Symbol.for('tm.row');
  var bars = new Map();              // dataframe id -> [{ x, w, y, h, gene, acc, row }] (drawing coordinates)
  var sel = { id: null, rows: new Set() };   // rows: row indices (TM_ROW) of the layer
  var restrict = new Map();               // dataframe id -> Set of genes the selection is limited to (absent: every gene); kept across selections
  function allowed(id, gene) { var r = restrict.get(id); return !r || r.has(gene); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rowIndex(r) { return r && r[ROW] !== undefined ? r[ROW] : -1; }
  // ------------------------------------------------------------ the bars drawn
  function beginLayer(id) { bars.set(id, []); }
  function bar(id, b) { var list = bars.get(id); if (!list) { list = []; bars.set(id, list); } var i = rowIndex(b.row); if (i >= 0) list.push({ x: b.x, w: b.w, y: b.y, h: b.h, gene: b.gene, acc: b.acc, i: i }); }
  function ctm() { var z = $('zoomable'); return z ? z.getScreenCTM() : null; }
  // the dataframe column under a screen point (rectangular layout)
  function layerAtScreenX(cx, cy) {
    if (typeof geometry !== 'undefined' && geometry === 'radial') return null;
    if (typeof root === 'undefined' || !root || typeof getPanelPositions !== 'function') return null;
    var m = ctm(); if (!m) return null;
    var x = (cx - m.e) / m.a;   // screen -> drawing (no rotation in the rectangular layout)
    var ps = getPanelPositions(), ids = Array.from(dataframes.keys()).sort(function (a, b) { return a - b; }), di = 0;
    for (var k = 0; k < ps.length; k++) {
      if (!/^dataframe\d+$/.test(ps[k].type)) continue;
      var id = ids[di++];
      if (x >= ps[k].x && x <= ps[k].rightEdge && id !== undefined && bars.has(id)) return id;
    }
    return null;
  }
  // the bars as screen rectangles, for the marquee (select-tool.js hit-tests rects by their names)
  function targets(id) {
    var m = ctm(), list = bars.get(id) || [], rects = [];
    if (!m) return { pts: [], rects: rects };
    list.forEach(function (b) {
      if (!allowed(id, b.gene)) return;   // a gene left out of the selection is not picked up
      var l = m.e + b.x * m.a, t = m.f + b.y * m.d;
      rects.push({ r: { left: l, right: l + b.w * m.a, top: t, bottom: t + b.h * m.d }, names: [b.i] });
    });
    return { pts: [], rects: rects };
  }
  // ------------------------------------------------------------ the selection
  function card() { return sel.id != null ? $('dataframeCard' + sel.id) : null; }
  function df() { return sel.id != null && typeof dataframes !== 'undefined' ? dataframes.get(sel.id) : null; }
  function geneOf(meta, r) { var ci = getDataframeColumnIndices(meta); return String(r[ci.geneCol] == null ? '' : r[ci.geneCol]); }
  // the rows in the selection, within the genes allowed: original rows of the layer's table
  function rowsSelected() {
    var d = df(); if (!d || !d.meta) return [];
    var meta = d.meta, out = [];
    meta.rows.forEach(function (r) { var i = rowIndex(r); if (sel.rows.has(i) && allowed(sel.id, geneOf(meta, r))) out.push(r); });
    return out;
  }
  // every gene of the layer, with how many of its rows are in the selection
  function layerGenes() {
    var d = df(), counts = new Map(); if (!d || !d.meta) return counts;
    d.meta.rows.forEach(function (r) { var g = geneOf(d.meta, r); if (!counts.has(g)) counts.set(g, 0); if (sel.rows.has(rowIndex(r))) counts.set(g, counts.get(g) + 1); });
    return counts;
  }
  function geneCounts() {
    var d = df(), counts = new Map(); if (!d || !d.meta) return counts;
    d.meta.rows.forEach(function (r) { if (sel.rows.has(rowIndex(r))) { var g = geneOf(d.meta, r); counts.set(g, (counts.get(g) || 0) + 1); } });
    return counts;
  }
  function apply(id, rows, mode) {
    var next;
    if (sel.id === id && mode === 'add') { next = new Set(sel.rows); rows.forEach(function (i) { next.add(i); }); }
    else if (sel.id === id && mode === 'remove') { next = new Set(sel.rows); rows.forEach(function (i) { next.delete(i); }); }
    else next = new Set(rows);
    if (!next.size) { clear(); return; }
    if (typeof clearCladeSelection === 'function' && typeof highlightedAccessions !== 'undefined' && highlightedAccessions.size) { try { clearCladeSelection(); } catch (e) {} }
    sel.id = id; sel.rows = next;
    show(); outline();
  }
  function clear(quiet) {
    if (sel.id == null) return;
    sel = { id: null, rows: new Set() }; closePop();
    document.querySelectorAll('#svg g.feature-selection, .tm-live-layer g.feature-selection').forEach(function (o) { o.remove(); });
    var tb = $('cladeToolbar'); if (tb) { tb.classList.remove('feature-mode'); if (!(typeof highlightedAccessions !== 'undefined' && highlightedAccessions.size)) tb.classList.remove('visible'); }
    if (!quiet && typeof setStatus === 'function') setStatus('Ready');
  }
  // ------------------------------------------------------------ on the drawing
  function layerEl(id) { try { var c = layerReuse.byKey.get('dataframe:' + id); return c && c.el ? c.el : null; } catch (e) { return null; } }
  function outline() {
    document.querySelectorAll('#svg g.feature-selection, .tm-live-layer g.feature-selection').forEach(function (o) { o.remove(); });
    if (sel.id == null) return;
    var list = bars.get(sel.id) || [], d = df(), host = layerEl(sel.id); if (!d || !host) return;
    var keep = new Set(rowsSelected().map(rowIndex));
    // inside the column's own group: it moves with the column and is part of the column's drawing
    var gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gEl.setAttribute('class', 'feature-selection'); gEl.setAttribute('pointer-events', 'none');
    host.appendChild(gEl);
    var g = d3.select(gEl);
    list.forEach(function (b) {
      if (!keep.has(b.i)) return;
      // inside the bar's own box (rows can be a few pixels apart), a thin stroke and a tint
      var sw = Math.max(0.5, Math.min(1, b.h * 0.18));
      g.append('rect').attr('x', b.x + sw / 2).attr('y', b.y + sw / 2).attr('width', Math.max(0.5, b.w - sw)).attr('height', Math.max(0.5, b.h - sw)).attr('rx', Math.min(1.5, b.h / 4))
        .attr('fill', 'rgba(255,107,53,0.28)').attr('stroke', '#ff6b35').attr('stroke-width', sw);
    });
  }
  function afterDraw(ctx) {
    syncToolButton();
    if (sel.id == null) return;
    if (ctx && ctx.isRadial) { clear(true); return; }
    if (!bars.has(sel.id) || !df()) { clear(true); return; }
    // rows that are no longer drawn (hidden genes, dropped tips) stay selected but are not outlined
    outline(); show();
  }
  // ------------------------------------------------------------ the gene picker
  // One popover, opened from the canvas toolbar (before any selection) or from the selection
  // toolbar: a layer to set it for, every gene of that layer with its rows (in the selection,
  // when there is one on that layer, else in the whole layer), All / None.
  var pickId = null;   // the layer the open picker is for
  function layerNames() { var out = []; if (typeof dataframes === 'undefined') return out; Array.from(dataframes.keys()).sort(function (a, b) { return a - b; }).forEach(function (id) { var c = $('dataframeCard' + id), t = c && c.querySelector('.pro-card-title'); out.push({ id: id, name: t ? t.textContent.trim() : 'Dataframe ' + id }); }); return out; }
  function genesOf(id) {
    var d = typeof dataframes !== 'undefined' ? dataframes.get(id) : null, counts = new Map(); if (!d || !d.meta) return counts;
    var inSel = sel.id === id;
    d.meta.rows.forEach(function (r) { var g = geneOf(d.meta, r); if (!counts.has(g)) counts.set(g, 0); if (!inSel || sel.rows.has(rowIndex(r))) counts.set(g, counts.get(g) + 1); });
    return counts;
  }
  function ensurePicker() {
    if ($('featGenesPop')) return;
    var pop = document.createElement('div'); pop.id = 'featGenesPop'; pop.className = 'feat-pop'; pop.hidden = true; pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', 'Genes the selection takes');
    pop.innerHTML = '<div class="feat-pop-head"><span>Select only</span><button type="button" id="featGenesAll" class="pro-status-link">All</button><button type="button" id="featGenesNone" class="pro-status-link">None</button></div>' +
      '<label class="feat-pop-layer" id="featLayerRow"><span>Layer</span><select id="featLayer" class="pro-select" data-session-skip data-no-undo></select></label>' +
      '<div class="feat-pop-list" id="featGenesList"></div><p class="feat-pop-note" id="featPopNote"></p>';
    document.body.appendChild(pop);
    $('featGenesAll').addEventListener('click', function () { restrict.delete(pickId); renderPicker(); show(); outline(); });
    $('featGenesNone').addEventListener('click', function () { restrict.set(pickId, new Set()); renderPicker(); show(); outline(); });
    $('featLayer').addEventListener('change', function () { pickId = +this.value; renderPicker(); });
    $('featGenesList').addEventListener('change', function (e) {
      var cb = e.target; if (!cb || cb.type !== 'checkbox') return;
      var all = Array.from(genesOf(pickId).keys()), r = restrict.get(pickId) || new Set(all);
      if (cb.checked) r.add(cb.value); else r.delete(cb.value);
      if (r.size === all.length && all.every(function (g) { return r.has(g); })) restrict.delete(pickId); else restrict.set(pickId, r);
      renderPicker(); show(); outline();
    });
    document.addEventListener('pointerdown', function (e) { var p = $('featGenesPop'); if (p && !p.hidden && !p.contains(e.target) && !(e.target.closest && e.target.closest('#featGenes, #proSelectGenes'))) closePop(); }, true);
  }
  function renderPicker() {
    var layers = layerNames(), lsel = $('featLayer'), row = $('featLayerRow');
    if (!layers.some(function (l) { return l.id === pickId; })) pickId = layers.length ? layers[0].id : null;
    lsel.innerHTML = layers.map(function (l) { return '<option value="' + l.id + '"' + (l.id === pickId ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('');
    row.hidden = layers.length < 2;
    var r = restrict.get(pickId), counts = genesOf(pickId), genes = Array.from(counts.keys()).sort();
    $('featGenesList').innerHTML = genes.map(function (g) { var on = !r || r.has(g); return '<label class="feat-gene"><input type="checkbox" value="' + esc(g) + '"' + (on ? ' checked' : '') + ' data-session-skip data-no-undo><span>' + esc(g || '(no gene)') + '</span><em>' + counts.get(g) + '</em></label>'; }).join('');
    $('featPopNote').textContent = pickId == null ? 'Load a dataframe first.' : (sel.id === pickId ? 'Rows in the selection per gene. Unticked genes are left out, now and by the next selections on this layer.' : 'Rows per gene. Only ticked genes are picked up when you drag over this column.');
    labelButtons();
  }
  function restrictLabel(id) { var r = restrict.get(id); if (!r) return 'all genes'; var g = Array.from(r).sort(); return !g.length ? 'no genes' : g.slice(0, 2).join(', ') + (g.length > 2 ? ' +' + (g.length - 2) : ''); }
  function labelButtons() {
    var tb = $('proSelectGenes');
    if (tb) {
      var ls = layerNames(), set = ls.filter(function (l) { return restrict.has(l.id); });
      var text = !set.length ? 'all genes' : set.length === 1 ? restrictLabel(set[0].id) + (ls.length > 1 ? ' in ' + set[0].name : '') : set.length + ' layers set';
      tb.querySelector('span').textContent = 'Select: ' + text; tb.title = 'Genes a drag over a dataframe column selects — ' + text; tb.setAttribute('aria-label', 'Select: ' + text); tb.classList.toggle('is-set', set.length > 0);
    }
    var fb = $('featGenes'); if (fb && sel.id != null) fb.querySelector('span').textContent = 'Genes: ' + restrictLabel(sel.id);
  }
  function openPicker(anchor, id) {
    ensurePicker(); pickId = id != null ? id : (sel.id != null ? sel.id : pickId); renderPicker();
    var pop = $('featGenesPop'), r = anchor.getBoundingClientRect(); pop.hidden = false; anchor.setAttribute('aria-expanded', 'true');
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 230, r.left)) + 'px';
    if (r.top > window.innerHeight / 2) { pop.style.top = ''; pop.style.bottom = (window.innerHeight - r.top + 6) + 'px'; } else { pop.style.bottom = ''; pop.style.top = (r.bottom + 6) + 'px'; }
  }
  function closePop() { var pop = $('featGenesPop'); if (pop && !pop.hidden) { pop.hidden = true; ['featGenes', 'proSelectGenes'].forEach(function (id) { var b = $(id); if (b) b.setAttribute('aria-expanded', 'false'); }); } }
  // the canvas-toolbar button, next to the Select / Pan tools, while dataframes are loaded
  function ensureToolButton() {
    if ($('proSelectGenes')) return;
    var tools = document.querySelector('.pro-tools'); if (!tools) return;
    // a third segment of the tool switch (an icon: the toolbar must not wrap on a laptop screen)
    var b = document.createElement('button'); b.type = 'button'; b.id = 'proSelectGenes'; b.className = 'seg feat-toolbtn'; b.hidden = true;
    b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg><span class="pro-sr-only">Select: all genes</span>';
    tools.appendChild(b);
    b.addEventListener('click', function () { var pop = $('featGenesPop'); if (pop && !pop.hidden) closePop(); else openPicker(b, null); });
  }
  function syncToolButton() {
    ensureToolButton(); var b = $('proSelectGenes'); if (!b) return;
    var have = typeof dataframes !== 'undefined' && dataframes.size > 0 && !(typeof geometry !== 'undefined' && geometry === 'radial');
    b.hidden = !have; if (have) labelButtons();
  }
  // ------------------------------------------------------------ the toolbar
  function ensureControls() {
    var tb = $('cladeToolbar'), content = tb && tb.querySelector('.clade-toolbar-content');
    if (!content || $('featCopy')) return;
    var box = document.createElement('div'); box.className = 'feat-ctl feat-box';
    box.innerHTML = '<button type="button" id="featGenes" class="clade-toolbar-btn feat-ctl" title="Which genes the selection takes (kept for the next selections of this layer)" aria-haspopup="true" aria-expanded="false"><span>Genes: all genes</span></button>' +
      '<button type="button" id="featCopy" class="clade-toolbar-btn feat-ctl" title="Copy the selected rows as a table (tab-separated, with the header)"><span>Copy rows</span></button>' +
      '<button type="button" id="featDelete" class="clade-toolbar-btn feat-ctl feat-danger" title="Delete the selected rows from this layer (Delete key; undo with ⌘Z)"><span>Delete rows</span></button>' +
      '<button type="button" id="featClear" class="clade-toolbar-btn feat-ctl" title="Clear the selection (Esc)"><span>Clear</span></button>';
    content.appendChild(box);
    $('featGenes').addEventListener('click', function () { var pop = $('featGenesPop'); if (pop && !pop.hidden) closePop(); else openPicker($('featGenes'), sel.id); });
    $('featCopy').addEventListener('click', copyRows);
    $('featDelete').addEventListener('click', deleteRows);
    $('featClear').addEventListener('click', function () { clear(); });
  }
  function show() {
    ensureControls();
    var tb = $('cladeToolbar'), st = $('cladeStatus'); if (!tb) return;
    if (sel.id == null) { tb.classList.remove('feature-mode'); return; }
    var counts = geneCounts(), rows = rowsSelected(), total = 0; counts.forEach(function (n) { total += n; });
    var d = df(), name = (function () { var c = card(), t = c && c.querySelector('.pro-card-title'); return t ? t.textContent.trim() : 'Dataframe ' + sel.id; })();
    tb.classList.add('visible'); tb.classList.add('feature-mode');
    var inSel = new Set(rows.map(function (x) { return geneOf(d.meta, x); }));
    if (st) st.textContent = rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' · ' + inSel.size + ' gene' + (inSel.size === 1 ? '' : 's') + ' in ' + name;
    labelButtons();
    var pop = $('featGenesPop'); if (pop && !pop.hidden && pickId === sel.id) renderPicker();
    $('featDelete').disabled = !rows.length; $('featCopy').disabled = !rows.length;
  }
  // ------------------------------------------------------------ copy and delete
  function tsv(meta, rows) {
    var cols = meta.columns.filter(function (c) { return c && c.trim(); });
    var cell = function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); };
    return [cols.join('\t')].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join('\t'); })).join('\r\n') + '\r\n';
  }
  function copyRows() {
    var d = df(), rows = rowsSelected(); if (!d || !rows.length) return;
    var text = tsv(d.meta, rows);
    var done = function () {
      var msg = 'Copied ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' (with the header) to the clipboard';
      if (typeof showNotification === 'function') showNotification(msg);   // the app's toast, as the other copies use
      if (typeof setStatus === 'function') setStatus(msg);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
  // the layer's table without the selected rows, in the table's own delimiter
  function tableWithout(meta, gone, delim) {
    var cols = meta.columns, lines = [cols.join(delim)];
    meta.rows.forEach(function (r) { if (gone.has(rowIndex(r))) return; lines.push(cols.map(function (c) { return String(r[c] == null ? '' : r[c]); }).join(delim)); });
    return lines.join('\n') + '\n';
  }
  var deleting = false;
  function deleteRows() {
    var d = df(), c = card(), rows = rowsSelected();
    if (deleting || !d || !c || !rows.length || !window.tmSession || typeof tmSession.replaceLayerData !== 'function') return;
    var src = tmSession.layerSource ? tmSession.layerSource(c) : null;
    var delim = src && src.text && src.text.split('\n')[0].indexOf('\t') >= 0 ? '\t' : (src && src.text && src.text.split('\n')[0].indexOf(',') >= 0 ? ',' : '\t');
    var before = src && src.text ? src.text : tableWithout(d.meta, new Set(), delim);
    var gone = new Set(rows.map(rowIndex)), after = tableWithout(d.meta, gone, delim), n = rows.length, id = sel.id;
    if (d.meta.rows.length - n < 1) { if (typeof setStatus === 'function') setStatus('Not deleted: that would leave the layer without rows (remove the layer instead)'); return; }
    deleting = true; clear(true);
    if (typeof setStatus === 'function') setStatus('Deleting ' + n + ' row' + (n === 1 ? '' : 's') + '…');
    Promise.resolve(tmSession.replaceLayerData(c, after)).then(function (r) {
      if (!r || !r.ok) { if (typeof setStatus === 'function') setStatus('Could not delete the rows: ' + ((r && r.error) || 'unknown problem')); return; }
      if (window.tmUndo && tmUndo.pushData) tmUndo.pushData({ label: 'delete ' + n + ' row' + (n === 1 ? '' : 's'), card: r.card || c, before: before, after: after });
      var msg = 'Deleted ' + n + ' row' + (n === 1 ? '' : 's') + ' from Dataframe ' + id + ' (⌘Z puts them back)';
      if (typeof setStatus === 'function') { setStatus(msg); setTimeout(function () { setStatus(msg); }, 400); }   // after the reload's own "Ready"
    }).catch(function (e) { if (typeof setStatus === 'function') setStatus('Could not delete the rows: ' + (e && e.message ? e.message : e)); }).then(function () { deleting = false; });
  }
  // ------------------------------------------------------------ keys and clicks
  function typing(t) { var tag = t && t.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable); }
  function overlayOpen() { return !!document.querySelector('.pro-modal:not([hidden]), .pro-menu:not([hidden]), .pro-pop:not([hidden])'); }
  document.addEventListener('keydown', function (e) {
    if (typing(e.target) || overlayOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { var pop0 = $('featGenesPop'); if (pop0 && !pop0.hidden) { e.preventDefault(); e.stopImmediatePropagation(); closePop(); return; } }
    if (sel.id == null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); deleteRows(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); clear(); }
  }, true);
  // a tip selected by a click or the keyboard: the feature selection goes
  var svgEl = $('svg');
  if (svgEl) svgEl.addEventListener('click', function (e) { if (sel.id != null && e.target.closest && e.target.closest('.node, text.label')) clear(true); }, true);
  var origApply = window.applyTipSelection;
  if (typeof origApply === 'function') window.applyTipSelection = function (names) { if (sel.id != null && names && (names.length || names.size)) clear(true); return origApply.apply(this, arguments); };
  window.tmFeatSel = { beginLayer: beginLayer, bar: bar, layerAtScreenX: layerAtScreenX, targets: targets, apply: apply, clear: clear, afterDraw: afterDraw,
    rows: rowsSelected, state: function () { var r = restrict.get(sel.id); return { id: sel.id, rows: Array.from(sel.rows), genes: r ? Array.from(r) : null }; }, restriction: function (id) { var r = restrict.get(id); return r ? Array.from(r) : null; }, restrictTo: function (id, genes) { if (genes == null) restrict.delete(id); else restrict.set(id, new Set(genes)); labelButtons(); show(); outline(); }, copy: copyRows, remove: deleteRows, bars: function (id) { return (bars.get(id) || []).slice(); } };
})();
