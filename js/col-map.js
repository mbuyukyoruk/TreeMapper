// Column mapping for dataframes and heatmaps (loaded after session.js). When a table's
// columns cannot be told apart by their names (a dataframe without molecule / gene /
// start / end headers, or a heatmap whose id column matches no tip of the tree), a dialog
// shows the first rows and asks which column is which, with the number of tips each
// candidate id column matches. The table is then rewritten with the canonical headers
// (molecule, gene, start, end, orientation; id) in front and handed to the usual loader,
// so everything downstream (cards, legends, sessions, the data editor) sees a plain table.
// Session restores and data replacements skip the dialog: their text is already mapped.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ID_RE = /^(id|name|label|taxon|seq|leaf)$/i, MOL_RE = /^(molecule|accession|id|name|label|taxon|seq|leaf)$/i;
  var GENE_RE = /^(gene|genename|gene_name)$/i, START_RE = /^(start|startpos|start_pos|begin|from)$/i, END_RE = /^(end|endpos|end_pos|stop|to)$/i, OR_RE = /^(orientation|orient|strand|direction)$/i;
  var FIELDS = {
    dataframe: [
      { key: 'molecule', label: 'Molecule / accession', hint: 'matched to the tips of the tree', re: MOL_RE, required: true, id: true },
      { key: 'gene', label: 'Gene', hint: 'one row per gene', re: GENE_RE, required: true },
      { key: 'start', label: 'Start', hint: 'bp', re: START_RE, required: true, numeric: true },
      { key: 'end', label: 'End', hint: 'bp', re: END_RE, required: true, numeric: true },
      { key: 'orientation', label: 'Strand', hint: 'optional: +/−, 1/−1, forward/reverse', re: OR_RE, required: false }
    ],
    heatmap: [{ key: 'id', label: 'Accession', hint: 'matched to the tips of the tree; the other columns are the heatmap values', re: ID_RE, required: true, id: true }]
  };
  function parse(text) {
    var lines = String(text).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim().length && l.trim()[0] !== '#'; });
    if (!lines.length) return null;
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var header = lines[0].split(delim).map(function (s) { return s.trim(); });
    var rows = lines.slice(1).map(function (l) { return l.split(delim).map(function (s) { return s.trim(); }); });
    return { header: header, rows: rows, delim: delim };
  }
  function tipKeys() {
    var keys = new Set();
    if (typeof root !== 'undefined' && root) root.leaves().forEach(function (l) { keys.add(normalizeAccession(String(l.data.name))); });
    return keys;
  }
  // how many tips each column matches, and the share of numeric cells per column
  function profile(t) {
    var keys = tipKeys(), n = t.header.length, matches = [], numeric = [];
    for (var c = 0; c < n; c++) {
      var seen = new Set(), num = 0, filled = 0;
      t.rows.forEach(function (r) { var v = r[c]; if (v === undefined || v === '') return; filled++; if (keys.has(normalizeAccession(v))) seen.add(normalizeAccession(v)); if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) num++; });
      matches.push(seen.size); numeric.push(filled ? num / filled : 0);
    }
    return { matches: matches, numeric: numeric, tips: keys.size };
  }
  // the app's own guess (its regexes, then the column positions) and whether it can be trusted
  function analyze(text, kind) {
    var t = parse(text); if (!t) return null;
    var P = profile(t), guess = {}, confident = true, taken = new Set();
    FIELDS[kind].forEach(function (f, i) {
      var idx = -1;
      for (var c = 0; c < t.header.length; c++) if (f.re.test(t.header[c])) { idx = c; break; }
      if (idx < 0 && f.id) {
        // the app falls back to the first column; that is fine when it matches the tips
        if (P.tips > 0 && P.matches[0] === 0) confident = false;
        var best = -1; P.matches.forEach(function (m, c) { if (m > 0 && (best < 0 || m > P.matches[best])) best = c; }); idx = best >= 0 ? best : 0;
      } else if (idx < 0 && f.required) { confident = false; }
      if (idx < 0 && f.required) { for (var c2 = 0; c2 < t.header.length; c2++) if (!taken.has(c2)) { idx = c2; break; } }
      if (idx >= 0) taken.add(idx);
      guess[f.key] = idx;
    });
    FIELDS[kind].forEach(function (f) { if (f.id && P.tips > 0 && guess[f.key] >= 0 && P.matches[guess[f.key]] === 0) confident = false; });
    return { table: t, profile: P, guess: guess, confident: confident, kind: kind };
  }
  // the table with the mapped columns first, under their canonical names
  function rewrite(a, mapping) {
    var t = a.table, fields = FIELDS[a.kind], order = [], names = [], used = new Set();
    fields.forEach(function (f) { var c = mapping[f.key]; if (c === undefined || c < 0) return; order.push(c); names.push(f.key); used.add(c); });
    var canon = new Set(names);
    t.header.forEach(function (h, c) {
      if (used.has(c)) return;
      var name = h, clash = canon.has(name.toLowerCase()) || fields.some(function (f) { return f.re.test(name); });
      if (clash) name = name + ' (original)';
      order.push(c); names.push(name);
    });
    var lines = [names.join(a.table.delim)];
    t.rows.forEach(function (r) { lines.push(order.map(function (c) { return r[c] === undefined ? '' : r[c]; }).join(a.table.delim)); });
    return lines.join('\n') + '\n';
  }
  // ------------------------------------------------------------------ dialog
  var modal = null, resolveFn = null;
  function ensure() {
    if (modal) return modal;
    modal = document.createElement('div'); modal.className = 'pro-modal'; modal.id = 'proColMap'; modal.hidden = true;
    modal.innerHTML = '<div class="pro-modal-card cm-card" role="dialog" aria-modal="true" aria-labelledby="cmTitle">' +
      '<div class="pro-panel-head"><span class="pro-panel-title" id="cmTitle">Map the columns</span><button type="button" class="pro-icon-btn pro-icon-btn-sm" id="cmClose" aria-label="Close"><svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="pro-modal-body cm-body" id="cmBody"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) finish(null); });
    $('cmClose').addEventListener('click', function () { finish(null); });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { finish(null); e.stopPropagation(); } });
    modal.addEventListener('click', function (e) {
      if (e.target.closest('#cmCancel')) finish(null);
      else if (e.target.closest('#cmLoad')) submit();
    });
    modal.addEventListener('change', function (e) { if (e.target.classList.contains('cm-select')) validate(); });
    return modal;
  }
  var current = null;
  function finish(v) { if (modal) modal.hidden = true; var r = resolveFn; resolveFn = null; current = null; if (r) r(v); }
  function colLabel(a, c) {
    var h = a.table.header[c] || ('column ' + (c + 1)), m = a.profile.matches[c];
    return h + (a.profile.tips > 0 ? ' — matches ' + m + ' of ' + a.profile.tips + ' tips' : '');
  }
  function render(a, name) {
    var fields = FIELDS[a.kind], t = a.table, head = t.header, preview = t.rows.slice(0, 5);
    var why = a.kind === 'dataframe' ? 'The headers do not say which column is the molecule, the gene, the start and the end' : 'No column of this table matches the tips of the tree';
    if (a.kind === 'dataframe' && FIELDS.dataframe.every(function (f) { return !f.required || head.some(function (h) { return f.re.test(h); }); })) why = 'The molecule column matches no tip of the tree';
    var html = '<p class="ds-muted cm-why">' + esc(why) + ' (' + esc(name) + ': ' + t.rows.length + ' rows, ' + head.length + ' columns). Choose the columns below; the table is loaded with them.</p>';
    html += '<div class="cm-fields">';
    fields.forEach(function (f) {
      html += '<label class="cm-field"><span class="cm-label">' + esc(f.label) + (f.required ? '' : ' <span class="cm-opt">optional</span>') + '<span class="cm-hint">' + esc(f.hint) + '</span></span>';
      html += '<select class="pro-select cm-select" id="cm_' + f.key + '" data-key="' + f.key + '">';
      if (!f.required) html += '<option value="-1"' + (a.guess[f.key] < 0 ? ' selected' : '') + '>(none)</option>';
      head.forEach(function (h, c) {
        var extra = f.id ? colLabel(a, c) : (f.numeric ? h + (a.profile.numeric[c] >= 0.9 ? ' — numbers' : a.profile.numeric[c] > 0 ? ' — some numbers' : ' — text') : h);
        html += '<option value="' + c + '"' + (a.guess[f.key] === c ? ' selected' : '') + '>' + esc(extra) + '</option>';
      });
      html += '</select></label>';
    });
    html += '</div>';
    html += '<div class="ds-table cm-table"><table class="ds-grid"><thead><tr>' + head.map(function (h, c) { return '<th data-col="' + c + '">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      preview.map(function (r) { return '<tr>' + head.map(function (h, c) { return '<td data-col="' + c + '">' + esc(r[c] === undefined ? '' : r[c]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    html += '<p class="cm-error" id="cmError" hidden></p>';
    html += '<div class="cm-actions"><button type="button" class="pro-btn" id="cmCancel">Cancel</button><button type="button" class="pro-btn pro-btn-primary" id="cmLoad">Load with these columns</button></div>';
    $('cmBody').innerHTML = html;
    $('cmTitle').textContent = a.kind === 'dataframe' ? 'Map the dataframe columns' : 'Map the heatmap columns';
    validate();
  }
  function mapping() {
    var m = {};
    if (!current) return m;
    FIELDS[current.kind].forEach(function (f) { var s = $('cm_' + f.key); m[f.key] = s ? +s.value : -1; });
    return m;
  }
  function validate() {
    if (!current) return false;
    var m = mapping(), used = {}, err = '', fields = FIELDS[current.kind];
    fields.forEach(function (f) { var c = m[f.key]; if (c < 0) return; if (used[c]) err = err || ('"' + current.table.header[c] + '" is chosen for both ' + used[c] + ' and ' + f.label.toLowerCase()); used[c] = f.label.toLowerCase(); });
    fields.forEach(function (f) { if (f.id && current.profile.tips > 0 && m[f.key] >= 0 && current.profile.matches[m[f.key]] === 0) err = err || ('"' + current.table.header[m[f.key]] + '" matches no tip of the tree'); });
    var e = $('cmError'); if (e) { e.textContent = err; e.hidden = !err; }
    // mark the chosen columns in the preview
    var chosen = {}; fields.forEach(function (f) { if (m[f.key] >= 0) chosen[m[f.key]] = f.key; });
    modal.querySelectorAll('.cm-table [data-col]').forEach(function (cell) { var k = chosen[+cell.getAttribute('data-col')]; cell.classList.toggle('cm-chosen', !!k); if (cell.tagName === 'TH') cell.setAttribute('data-role', k || ''); });
    var b = $('cmLoad'); if (b) b.disabled = !!err;
    return !err;
  }
  function submit() { if (!validate()) return; finish(mapping()); }
  function ask(a, name) {
    ensure(); current = a; render(a, name); modal.hidden = false;
    var first = modal.querySelector('select'); if (first) first.focus();
    return new Promise(function (res) { resolveFn = res; });
  }
  // ------------------------------------------------------------------ the loaders
  function readText(f) { if (f && typeof f.text === 'function') return f.text(); return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(f); }); }
  function wrap(name, kind) {
    var orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = async function (f) {
      if (window.tmSession && tmSession.isLoading && tmSession.isLoading()) return orig(f);
      if (!f || /\.treemapper$/i.test(f.name || '')) return orig(f);
      var text; try { text = await readText(f); } catch (e) { return orig(f); }
      var a = analyze(text, kind);
      if (!a || a.confident || a.table.header.length < 2) return orig(f);
      var m = await ask(a, f.name || 'table');
      if (!m) { setStatus('Not loaded: ' + (f.name || 'table')); return; }
      var out = new File([rewrite(a, m)], f.name || (kind + '.csv'), { type: 'text/plain' });
      return orig(out);
    };
  }
  wrap('handleMetaFile', 'dataframe');
  wrap('handleHeatmapFile', 'heatmap');
  window.tmColMap = { analyze: analyze, rewrite: rewrite, parse: parse };
})();
