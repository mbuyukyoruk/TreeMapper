// Data editor: a pencil on each data layer card opens the layer's uploaded table in
// a spreadsheet-like window. Cells can be edited (headers stay as they are), rows
// added or deleted, and blocks pasted from Excel. Apply rebuilds the layer from the
// edited table through its normal loader (tmSession.replaceLayerData keeps the card's
// place and settings); Cancel leaves everything unchanged.
(function () {
  'use strict';
  var TYPES = [
    { box: 'dataframeContainer', type: 'dataframe', label: 'Dataframe' },
    { box: 'heatmapContainer', type: 'heatmap', label: 'Heatmap' },
    { box: 'highlightContainer', type: 'highlight', label: 'Highlight' },
    { box: 'cladeContainer', type: 'clade', label: 'Clade groups' },
    { box: 'chartContainer', type: 'chart', label: 'Chart' },
    { box: 'msaContainer', type: 'msa', label: 'Alignment' }
  ];
  var PAGE = 500;   // rows shown at a time (large tables are paged)
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var PENCIL = '<svg class="pro-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';

  // ---------------------------------------------------------------- pencils
  function addPencil(card, T) {
    if (!card || card.tagName !== 'DETAILS') return;
    var sum = card.querySelector(':scope > summary'); if (!sum || sum.querySelector('.pro-edit-data')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pro-edit-data'; b.title = 'Edit data'; b.setAttribute('aria-label', 'Edit the data of this layer');
    b.setAttribute('draggable', 'false');
    b.innerHTML = PENCIL;
    var del = sum.querySelector('.df-delete');
    sum.insertBefore(b, del || null);
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(card, T); });
    b.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  }
  TYPES.forEach(function (T) {
    var box = $(T.box); if (!box) return;
    Array.prototype.forEach.call(box.children, function (c) { addPencil(c, T); });
    new MutationObserver(function () { Array.prototype.forEach.call(box.children, function (c) { addPencil(c, T); }); })
      .observe(box, { childList: true, subtree: T.type === 'msa' });
  });

  // ------------------------------------------------------------ table model
  // The text is split the way the layer loaders split it: lines (CR removed), the
  // delimiter is a tab when the first data line has one, otherwise a comma, no quoting.
  // Blank and '#' comment lines are kept aside and put back unchanged.
  function parse(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
    if (trailingNewline) lines.pop();
    var keep = [], data = [];
    lines.forEach(function (l, i) { if (!l.trim().length || l.trim().charAt(0) === '#') keep.push([i, l]); else data.push(l); });
    if (!data.length) return null;
    var delim = data[0].indexOf('\t') >= 0 ? '\t' : ',';
    var header = data[0].split(delim);
    var rows = data.slice(1).map(function (l) {
      var p = l.split(delim);
      while (p.length < header.length) p.push('');
      return p;
    });
    var extra = rows.reduce(function (m, r) { return Math.max(m, r.length); }, header.length);
    return { delim: delim, header: header, rows: rows, width: extra, comments: keep.filter(function (k) { return k[0] === 0 || true; }), trailingNewline: trailingNewline, firstDataLine: lines.indexOf(data[0]) };
  }
  function build(m) {
    if (m.msa) {
      if (m.msa.format === 'table') return 'accession\tsequence\n' + m.rows.map(function (r) { return (r[0] || '') + '\t' + (r[1] || ''); }).join('\n') + '\n';
      return m.rows.map(function (r) { return '>' + (r[0] || '') + '\n' + (r[1] || ''); }).join('\n') + '\n';
    }
    var out = [];
    // comment / blank lines that came before the header stay before it; the others after it
    m.comments.forEach(function (k) { if (k[0] < m.firstDataLine) out.push(k[1]); });
    out.push(m.header.join(m.delim));
    m.rows.forEach(function (r) {
      var cells = r.slice();
      while (cells.length > m.header.length && cells[cells.length - 1] === '') cells.pop();
      out.push(cells.join(m.delim));
    });
    m.comments.forEach(function (k) { if (k[0] > m.firstDataLine) out.push(k[1]); });
    return out.join('\n') + (m.trailingNewline ? '\n' : '');
  }

  // numeric columns per layer type: a cell there must be a number (or empty where allowed)
  function columnRules(T, header) {
    var rules = header.map(function () { return null; });
    var low = header.map(function (h) { return String(h).trim().toLowerCase(); });
    if (T.type === 'dataframe') {
      low.forEach(function (h, i) { if (h === 'start' || h === 'end') rules[i] = 'number'; });
    } else if (T.type === 'chart') {
      low.forEach(function (h, i) { if (i > 0) rules[i] = 'number-or-empty'; });
    }
    rules[0] = 'required';   // the accession / id column
    return rules;
  }
  function validate(T, m) {
    if (T.type === 'msa') return validateMsa(m);
    var problems = [], rules = columnRules(T, m.header);
    for (var r = 0; r < m.rows.length && problems.length < 50; r++) {
      for (var c = 0; c < m.rows[r].length; c++) {
        var v = m.rows[r][c];
        if (v.indexOf(m.delim) >= 0 || /[\r\n]/.test(v)) problems.push({ r: r, c: c, msg: (m.delim === '\t' ? 'a tab' : 'a comma') + ' or a line break inside a cell' });
        else if (c < rules.length && rules[c] === 'required' && !v.trim()) problems.push({ r: r, c: c, msg: 'empty ' + (m.header[0] || 'id') });
        else if (c < rules.length && rules[c] === 'number' && !(v.trim() !== '' && isFinite(+v))) problems.push({ r: r, c: c, msg: '"' + v + '" is not a number' });
        else if (c < rules.length && rules[c] === 'number-or-empty' && v.trim() !== '' && !isFinite(+v)) problems.push({ r: r, c: c, msg: '"' + v + '" is not a number' });
      }
    }
    if (!m.rows.length) problems.push({ r: -1, c: -1, msg: 'the table has no rows' });
    return problems;
  }

  // an alignment: every changed or added row needs an accession and an aligned sequence of the
  // alignment's length (rows left as they were may stay as they are: the loader skips bad ones)
  function validateMsa(m) {
    var problems = [], touched = new Set();
    state.changed.forEach(function (k) { touched.add(+k.split(':')[0]); });
    state.original.forEach(function (o, i) { if (o === null) touched.add(i); });
    var seen = new Map();
    m.rows.forEach(function (r, i) { var a = String(r[0] || '').trim(); if (a) seen.set(a, (seen.get(a) || 0) + 1); });
    touched.forEach(function (i) {
      if (problems.length >= 50 || i >= m.rows.length) return;
      var r = m.rows[i], acc = String(r[0] || '').trim(), sq = String(r[1] || '').replace(/\s+/g, '');
      if (!acc) problems.push({ r: i, c: 0, msg: 'empty accession' });
      else if (seen.get(acc) > 1) problems.push({ r: i, c: 0, msg: acc + ' is in the table more than once' });
      if (!/^[A-Za-z*.~?\-]+$/.test(sq)) problems.push({ r: i, c: 1, msg: sq ? 'only letters, "-" (gap), "." and "*" can be in a sequence' : 'empty sequence' });
      else if (m.msa.L && sq.length !== m.msa.L) problems.push({ r: i, c: 1, msg: 'length ' + sq.length + ', the alignment has ' + m.msa.L + ' columns' });
    });
    if (!m.rows.length) problems.push({ r: -1, c: -1, msg: 'the table has no rows' });
    return problems;
  }

  // ------------------------------------------------------------------ window
  var dlg = null, state = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.className = 'pro-modal pro-data-editor'; dlg.hidden = true;
    dlg.innerHTML =
      '<div class="pro-modal-card pro-de-card" role="dialog" aria-modal="true" aria-labelledby="proDeTitle">' +
        '<div class="pro-panel-head"><span class="pro-panel-title" id="proDeTitle">Edit data</span><span class="pro-de-file" id="proDeFile"></span></div>' +
        '<div class="pro-de-tools">' +
          '<input type="search" class="pro-search pro-de-filter" id="proDeFilter" placeholder="Filter rows" autocomplete="off" aria-label="Filter rows">' +
          '<button type="button" class="pro-btn pro-btn-ghost" id="proDeAdd">Add row</button>' +
          '<button type="button" class="pro-btn pro-btn-ghost" id="proDeDelete" disabled>Delete selected rows</button>' +
          '<span class="pro-de-info" id="proDeInfo"></span>' +
        '</div>' +
        '<div class="pro-de-grid" id="proDeGrid" tabindex="-1"></div>' +
        '<div class="pro-de-pager" id="proDePager"></div>' +
        '<div class="pro-de-msg" id="proDeMsg" role="alert"></div>' +
        '<div class="pro-de-foot">' +
          '<span class="pro-de-hint" id="proDeHint">Headers stay as they are. Paste a block from Excel into a cell to fill several cells.</span>' +
          '<button type="button" class="pro-btn" id="proDeCancel">Cancel</button>' +
          '<button type="button" class="pro-btn pro-btn-primary" id="proDeApply">Apply</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    $('proDeCancel').addEventListener('click', function () { tryClose(); });
    $('proDeApply').addEventListener('click', apply);
    $('proDeAdd').addEventListener('click', addRow);
    $('proDeDelete').addEventListener('click', deleteRows);
    $('proDeFilter').addEventListener('input', function () { state.page = 0; render(); });
    dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) tryClose(); });
    dlg.addEventListener('keydown', onKey, true);
    // Escape closes the window wherever the focus is (e.g. after Apply was pressed)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !dlg || dlg.hidden || dlg.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation(); tryClose();
    }, true);
    var grid = $('proDeGrid');
    grid.addEventListener('input', onCellInput);
    grid.addEventListener('paste', onPaste);
    grid.addEventListener('change', function (e) {
      if (e.target.classList.contains('pro-de-rowsel')) { var i = +e.target.getAttribute('data-r'); if (e.target.checked) state.selected.add(i); else state.selected.delete(i); $('proDeDelete').disabled = !state.selected.size; }
    });
    return dlg;
  }
  function open(card, T) {
    var src = window.tmSession && tmSession.layerSource ? tmSession.layerSource(card) : null;
    if (!src || typeof src.text !== 'string') { alert('The data of this layer is not available for editing.'); return; }
    var m;
    if (T.type === 'msa') {
      // an alignment: one row per sequence (whatever the file format), the skipped rows too
      var rec = window.tmMsa ? tmMsa.records(src.text) : null;
      var idm = /(\d+)$/.exec(card.id || ''), layer = idm && window.tmMsa ? tmMsa.get(+idm[1]) : null;
      if (!rec || !rec.rows.length) { alert('This alignment has no rows to edit.'); return; }
      m = { delim: '\t', header: ['accession', 'sequence'], rows: rec.rows.map(function (r) { return [r[0], r[1]]; }), width: 2, comments: [], trailingNewline: true, firstDataLine: 0,
        msa: { format: rec.format, L: layer ? layer.L : 0 } };
    } else m = parse(src.text);
    if (!m) { alert('This layer has no table to edit.'); return; }
    ensureDialog();
    var t = card.querySelector('.pro-card-title');
    state = { card: card, T: T, model: m, original: m.rows.map(function (r) { return r.slice(); }), changed: new Set(), page: 0, selected: new Set(), filterRows: null, structural: false };
    $('proDeTitle').textContent = 'Edit data — ' + (t ? t.textContent.trim() : T.label);
    $('proDeFile').textContent = src.name || '';
    $('proDeHint').textContent = m.msa ? 'One row per sequence; rows the alignment skipped are listed too, so they can be fixed. ' + (m.msa.format === 'table' ? 'Saved as a table.' : 'Saved as FASTA.')
      : 'Headers stay as they are. Paste a block from Excel into a cell to fill several cells.';
    $('proDeFilter').value = '';
    $('proDeMsg').textContent = '';
    $('proDeDelete').disabled = true;
    render();
    dlg.hidden = false;
    var first = $('proDeGrid').querySelector('td[contenteditable]'); if (first) first.focus();
  }
  function visibleRows() {
    var f = $('proDeFilter').value.trim().toLowerCase(), rows = state.model.rows, out = [];
    for (var i = 0; i < rows.length; i++) if (!f || rows[i].some(function (v) { return String(v).toLowerCase().indexOf(f) >= 0; })) out.push(i);
    return out;
  }
  function render() {
    var m = state.model, rows = visibleRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    var from = state.page * PAGE, to = Math.min(rows.length, from + PAGE);
    var width = Math.max(m.header.length, m.rows.reduce(function (a, r) { return Math.max(a, r.length); }, 0));
    var h = ['<table class="pro-de-table"><thead><tr><th class="pro-de-num"></th>'];
    for (var c = 0; c < width; c++) h.push('<th scope="col">' + esc(c < m.header.length ? m.header[c] : '') + '</th>');
    h.push('</tr></thead><tbody>');
    for (var k = from; k < to; k++) {
      var i = rows[k], r = m.rows[i];
      h.push('<tr data-r="' + i + '"><th class="pro-de-num" scope="row"><label><input type="checkbox" class="pro-de-rowsel" data-r="' + i + '"' + (state.selected.has(i) ? ' checked' : '') + '>' + (i + 1) + '</label></th>');
      for (var c2 = 0; c2 < width; c2++) {
        var key = i + ':' + c2, v = c2 < r.length ? r[c2] : '';
        var cls = (state.changed.has(key) ? 'is-changed' : '') + (m.msa && c2 === 1 ? ' is-seq' : '');
        h.push('<td contenteditable="plaintext-only" spellcheck="false" data-r="' + i + '" data-c="' + c2 + '"' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + '>' + esc(v) + '</td>');
      }
      h.push('</tr>');
    }
    h.push('</tbody></table>');
    $('proDeGrid').innerHTML = h.join('');
    // a browser without plaintext-only falls back to plain contenteditable
    var probe = $('proDeGrid').querySelector('td'); if (probe && probe.contentEditable !== 'plaintext-only') $('proDeGrid').querySelectorAll('td[contenteditable]').forEach(function (td) { td.setAttribute('contenteditable', 'true'); });
    var pager = $('proDePager');
    if (pages > 1) {
      pager.innerHTML = '<button type="button" class="pro-btn pro-btn-ghost" data-p="-1"' + (state.page ? '' : ' disabled') + '>Previous</button><span>Rows ' + (from + 1) + '–' + to + ' of ' + rows.length + '</span><button type="button" class="pro-btn pro-btn-ghost" data-p="1"' + (state.page < pages - 1 ? '' : ' disabled') + '>Next</button>';
      Array.prototype.forEach.call(pager.querySelectorAll('button'), function (b) { b.addEventListener('click', function () { state.page += +b.getAttribute('data-p'); render(); $('proDeGrid').scrollTop = 0; }); });
    } else pager.innerHTML = '';
    info();
  }
  function info() {
    var n = state.changed.size, m = state.model;
    $('proDeInfo').textContent = m.rows.length.toLocaleString() + ' rows' + (n ? ' · ' + n + ' cell' + (n === 1 ? '' : 's') + ' changed' : '') + (state.structural ? ' · rows added or deleted' : '');
  }
  function setCell(i, c, v) {
    var r = state.model.rows[i]; while (r.length <= c) r.push('');
    r[c] = v;
    var orig = state.original[i];
    var key = i + ':' + c;
    if (orig && (c < orig.length ? orig[c] : '') === v) state.changed.delete(key); else state.changed.add(key);
  }
  function onCellInput(e) {
    var td = e.target.closest && e.target.closest('td[data-c]'); if (!td) return;
    var v = td.textContent.replace(/\r?\n/g, ' ');
    setCell(+td.getAttribute('data-r'), +td.getAttribute('data-c'), v);
    td.classList.toggle('is-changed', state.changed.has(td.getAttribute('data-r') + ':' + td.getAttribute('data-c')));
    $('proDeMsg').textContent = '';
    info();
  }
  // a block copied from Excel / Sheets (tabs and lines) fills cells to the right and below
  function onPaste(e) {
    var td = e.target.closest && e.target.closest('td[data-c]'); if (!td) return;
    var cd = e.clipboardData || window.clipboardData;
    var text = cd && cd.getData ? cd.getData('text/plain') : '';
    if (!text) return;
    e.preventDefault();
    var block = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (l) { return l.split('\t'); });
    var vis = visibleRows(), startK = vis.indexOf(+td.getAttribute('data-r')), c0 = +td.getAttribute('data-c');
    var m = state.model;
    block.forEach(function (cells, k) {
      var idx = vis[startK + k];
      if (idx === undefined) {   // past the last row: new rows
        var nr = m.header.map(function () { return ''; }); m.rows.push(nr); state.original.push(null); idx = m.rows.length - 1; state.structural = true;
      }
      cells.forEach(function (v, j) { setCell(idx, c0 + j, v); });
    });
    render();
  }
  function addRow() {
    var m = state.model, nr = m.header.map(function () { return ''; });
    m.rows.push(nr); state.original.push(null); state.structural = true;
    $('proDeFilter').value = '';
    state.page = Math.floor((m.rows.length - 1) / PAGE);
    render();
    var cell = $('proDeGrid').querySelector('tr[data-r="' + (m.rows.length - 1) + '"] td[data-c="0"]'); if (cell) { cell.focus(); cell.scrollIntoView({ block: 'nearest' }); }
  }
  function deleteRows() {
    if (!state.selected.size) return;
    var keep = [], keepOrig = [], m = state.model;
    var changed = new Set();
    m.rows.forEach(function (r, i) { if (!state.selected.has(i)) { keep.push(r); keepOrig.push(state.original[i]); } });
    // re-key the changed cells for the rows that stay
    var map = new Map(); var n = 0; m.rows.forEach(function (r, i) { if (!state.selected.has(i)) map.set(i, n++); });
    state.changed.forEach(function (k) { var p = k.split(':'), ni = map.get(+p[0]); if (ni !== undefined) changed.add(ni + ':' + p[1]); });
    m.rows = keep; state.original = keepOrig; state.changed = changed; state.selected.clear(); state.structural = true;
    $('proDeDelete').disabled = true;
    render();
  }
  function dirty() { return state && (state.changed.size > 0 || state.structural); }
  function close() { if (dlg) dlg.hidden = true; state = null; }
  function tryClose() {
    if (dirty() && !confirm('Discard the changes to this table?')) return;
    close();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tryClose(); return; }
    var td = e.target.closest && e.target.closest('td[data-c]'); if (!td) return;
    var r = td.parentNode, c = +td.getAttribute('data-c');
    var move = function (row, col) { var t = row && row.querySelector('td[data-c="' + col + '"]'); if (t) { t.focus(); var s = window.getSelection(); if (s) { s.selectAllChildren(t); } } };
    if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? r.previousElementSibling : r.nextElementSibling, c); }
    else if (e.key === 'Tab') { e.preventDefault(); var cols = r.querySelectorAll('td[data-c]').length; if (e.shiftKey) { if (c > 0) move(r, c - 1); else move(r.previousElementSibling, cols - 1); } else { if (c < cols - 1) move(r, c + 1); else move(r.nextElementSibling, 0); } }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(r.nextElementSibling, c); }
    else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(r.previousElementSibling, c); }
  }
  async function apply() {
    if (!state) return;
    if (!dirty()) { close(); return; }
    var m = state.model;
    var problems = validate(state.T, m);
    var msg = $('proDeMsg');
    $('proDeGrid').querySelectorAll('td.is-bad').forEach(function (td) { td.classList.remove('is-bad'); });
    if (problems.length) {
      msg.textContent = 'Please fix ' + (problems.length >= 50 ? 'these (first 50 shown)' : (problems.length === 1 ? 'this' : 'these ' + problems.length)) + ' before applying: ' +
        problems.slice(0, 5).map(function (p) { return p.r < 0 ? p.msg : 'row ' + (p.r + 1) + ', ' + (m.header[p.c] || 'column ' + (p.c + 1)) + ': ' + p.msg; }).join('; ') + (problems.length > 5 ? '; …' : '');
      // show the first problem
      var p0 = problems[0];
      if (p0.r >= 0) {
        $('proDeFilter').value = ''; state.page = Math.floor(p0.r / PAGE); render();
        problems.forEach(function (p) { var td = $('proDeGrid').querySelector('td[data-r="' + p.r + '"][data-c="' + p.c + '"]'); if (td) td.classList.add('is-bad'); });
        var td0 = $('proDeGrid').querySelector('td[data-r="' + p0.r + '"][data-c="' + p0.c + '"]'); if (td0) { td0.focus(); td0.scrollIntoView({ block: 'nearest' }); }
      }
      return;
    }
    var text = build(m);
    var applyBtn = $('proDeApply'); applyBtn.disabled = true; msg.textContent = 'Applying…';
    var result;
    try { result = await tmSession.replaceLayerData(state.card, text); }
    catch (e) { result = { ok: false, error: e && e.message ? e.message : String(e) }; }
    applyBtn.disabled = false;
    if (!result || !result.ok) {
      var err = (result && result.error) || 'unknown problem';
      if (result && result.card) state.card = result.card;   // (a layer loaded again is a new card)
      msg.textContent = 'The changes could not be applied: ' + err + (/loaded again as it was/.test(err) ? '.' : '. Nothing was changed.');
      applyBtn.focus();
      return;
    }
    msg.textContent = '';
    close();
    if (typeof setStatus === 'function') setStatus('Data updated');
  }
  window.tmDataEditor = { open: function (card) { var T = TYPES.filter(function (t) { var b = $(t.box); return b && b.contains(card); })[0]; if (T) open(card, T); }, parse: parse, build: build };
})();
