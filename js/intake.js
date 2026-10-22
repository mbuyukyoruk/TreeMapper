// Paste data, and drop any file on the canvas (loaded after col-map.js). A dropped or
// pasted text is sniffed: a session, a tree (Newick / NEXUS), an alignment (FASTA, Clustal,
// Stockholm, PHYLIP), a dataframe (molecule / gene / start / end headers), or a table that
// could be a heatmap, highlight, clade-group or chart layer. What is unambiguous loads at
// once; a table is offered in a dialog with its first lines, the guessed layer type
// preselected, and loads as the type chosen. "Paste data…" in the Add data menu (and
// Ctrl/Cmd+V with nothing focused) opens the same dialog with a box to paste into.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var KINDS = [
    { key: 'tree', label: 'Tree', loader: 'handleTreeFile', ext: 'nwk', needsTree: false },
    { key: 'dataframe', label: 'Dataframe', loader: 'handleMetaFile', ext: 'csv' },
    { key: 'heatmap', label: 'Heatmap', loader: 'handleHeatmapFile', ext: 'csv' },
    { key: 'highlight', label: 'Highlight', loader: 'handleHighlightFile', ext: 'csv' },
    { key: 'clade', label: 'Clade groups', loader: 'handleCladeFile', ext: 'csv' },
    { key: 'chart', label: 'Chart', loader: 'handleChartFile', ext: 'csv' },
    { key: 'msa', label: 'Alignment', loader: 'handleMsaFile', ext: 'fasta', needsTree: false },
    { key: 'session', label: 'Session', loader: null, ext: 'treemapper', needsTree: false }
  ];
  function kindOf(key) { return KINDS.filter(function (k) { return k.key === key; })[0]; }
  var NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
  function table(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim().length && l.trim()[0] !== '#'; });
    if (lines.length < 2) return null;
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : (lines[0].indexOf(',') >= 0 ? ',' : null);
    if (!delim) return null;
    var header = lines[0].split(delim).map(function (s) { return s.trim(); });
    var rows = lines.slice(1, 60).map(function (l) { return l.split(delim).map(function (s) { return s.trim(); }); });
    var widths = rows.map(function (r) { return r.length; }), same = widths.filter(function (w) { return w === header.length; }).length;
    if (same < rows.length * 0.8) return null;
    return { header: header, rows: rows, delim: delim };
  }
  // what a text looks like: { kind, sure, why }
  function sniff(text, name) {
    var t = String(text || ''), s = t.trim(), n = String(name || '');
    if (/\.treemapper$/i.test(n) || (s[0] === '{' && /"format"\s*:\s*"treemapper-session"/.test(s.slice(0, 400)))) return { kind: 'session', sure: true, why: 'a TreeMapper session' };
    if (/\.(nwk|newick|tree|nexus|nxs|tre)$/i.test(n) || /^#NEXUS/i.test(s) || (s[0] === '(' && /\)\s*[^()]*;?\s*$/.test(s))) return { kind: 'tree', sure: true, why: /^#NEXUS/i.test(s) ? 'a NEXUS tree' : 'a Newick tree' };
    if (s[0] === '>' || /^CLUSTAL/i.test(s) || /^# STOCKHOLM/i.test(s) || /\.(fa|fasta|fas|faa|fna|afa|aln|clustal|sto|stk|stockholm|phy|phylip)$/i.test(n)) return { kind: 'msa', sure: true, why: s[0] === '>' ? 'a FASTA alignment' : 'a sequence alignment' };
    if (/^\s*\d+\s+\d+\s*\n/.test(t) && /^[^\s]+\s+[A-Za-z\-.]{10,}/m.test(t)) return { kind: 'msa', sure: true, why: 'a PHYLIP alignment' };
    var tb = table(t);
    if (!tb) return { kind: null, sure: false, why: 'not a table, a tree or an alignment' };
    var h = tb.header.map(function (x) { return x.toLowerCase(); });
    var has = function (re) { return h.some(function (x) { return re.test(x); }); };
    if (has(/^(molecule|accession)$/) && has(/^(gene|genename|gene_name)$/) && has(/^(start|startpos|start_pos|begin|from)$/) && has(/^(end|endpos|end_pos|stop|to)$/)) return { kind: 'dataframe', sure: true, why: 'a dataframe (molecule, gene, start, end)' };
    if (has(/^gene$/) && has(/^start$/) && has(/^end$/)) return { kind: 'dataframe', sure: false, why: 'gene / start / end columns' };
    if (tb.header.length === 2 && tb.rows.every(function (r) { return /^[A-Z\-.*]{10,}$/i.test(r[1] || ''); })) return { kind: 'msa', sure: false, why: 'a table of sequences' };
    if (tb.header.length === 2) {
      var numeric = tb.rows.filter(function (r) { return NUM_RE.test(r[1] || ''); }).length;
      if (numeric >= tb.rows.length * 0.9) return { kind: 'chart', sure: false, why: 'two columns with numbers (a chart, or a heatmap / highlight / clade groups)' };
      return { kind: 'highlight', sure: false, why: 'two columns with categories (a highlight, clade groups, or a heatmap)' };
    }
    return { kind: 'heatmap', sure: false, why: tb.header.length + ' columns (a heatmap, or another layer type)' };
  }
  function load(kind, text, name, url) {
    var k = kindOf(kind); if (!k) return Promise.reject(new Error('unknown type ' + kind));
    if (k.key === 'session') return Promise.resolve(window.tmSession && tmSession.load(text));
    var fn = window[k.loader]; if (typeof fn !== 'function') return Promise.reject(new Error(k.loader + ' is missing'));
    var fname = name && /\.[a-z0-9]+$/i.test(name) ? name : (name || 'pasted') + '.' + k.ext;
    var f = new File([text], fname, { type: 'text/plain' }); if (url) f.url = url;   // remembered by sessions
    return Promise.resolve(fn(f));
  }
  // ------------------------------------------------------------------ dialog
  var modal = null, resolveFn = null, state = null;
  function ensure() {
    if (modal) return modal;
    modal = document.createElement('div'); modal.className = 'pro-modal'; modal.id = 'proIntake'; modal.hidden = true;
    modal.innerHTML = '<div class="pro-modal-card it-card" role="dialog" aria-modal="true" aria-labelledby="itTitle">' +
      '<div class="pro-panel-head"><span class="pro-panel-title" id="itTitle">Add data</span><button type="button" class="pro-icon-btn pro-icon-btn-sm" id="itClose" aria-label="Close"><svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="pro-modal-body it-body">' +
      '<p class="ds-muted it-source" id="itSource"></p>' +
      '<textarea class="pro-textarea it-text" id="itText" spellcheck="false" placeholder="Paste a table (tab- or comma-separated, with a header row), a Newick tree, or a FASTA alignment here"></textarea>' +
      '<div class="it-row"><span class="it-sniff" id="itSniff"></span></div>' +
      '<div class="it-kinds"><span class="pro-file-label">Add as</span><span class="pro-radio-seg it-seg" role="radiogroup" aria-label="Layer type" id="itKinds"></span></div>' +
      '<p class="cm-error" id="itError" hidden></p>' +
      '<div class="cm-actions"><button type="button" class="pro-btn" id="itCancel">Cancel</button><button type="button" class="pro-btn pro-btn-primary" id="itAdd">Add</button></div>' +
      '</div></div>';
    document.body.appendChild(modal);
    $('itKinds').innerHTML = KINDS.map(function (k) { return '<label><input type="radio" name="itKind" value="' + k.key + '"><span>' + esc(k.label) + '</span></label>'; }).join('');
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) finish(null); });
    $('itClose').addEventListener('click', function () { finish(null); });
    $('itCancel').addEventListener('click', function () { finish(null); });
    $('itAdd').addEventListener('click', submit);
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { finish(null); e.stopPropagation(); } });
    $('itText').addEventListener('input', function () { resniff(true); });
    $('itKinds').addEventListener('change', function () { state.manual = true; validate(); });
    return modal;
  }
  function finish(v) { if (modal) modal.hidden = true; var r = resolveFn; resolveFn = null; state = null; if (r) r(v); }
  function chosen() { var r = modal.querySelector('input[name="itKind"]:checked'); return r ? r.value : null; }
  function choose(kind) { modal.querySelectorAll('input[name="itKind"]').forEach(function (r) { r.checked = r.value === kind; }); }
  function resniff(fromTyping) {
    if (!state) return;
    var text = $('itText').value, s = sniff(text, state.name);
    state.sniff = s;
    $('itSniff').textContent = text.trim() ? (s.kind ? 'Looks like ' + s.why : 'This is ' + s.why) : '';
    if (!state.manual || !chosen()) { if (s.kind) choose(s.kind); }
    validate();
  }
  function validate() {
    var kind = chosen(), text = $('itText').value, err = '';
    if (!text.trim()) err = 'Nothing to add yet';
    else if (!kind) err = 'Choose what to add this as';
    else { var k = kindOf(kind); if (k.needsTree !== false && !(typeof root !== 'undefined' && root)) err = 'Load a tree first: a ' + k.label.toLowerCase() + ' layer needs tips to match'; }
    var e = $('itError'); e.textContent = err; e.hidden = !err;
    $('itAdd').disabled = !!err;
    return !err;
  }
  function submit() { if (!validate()) return; finish({ kind: chosen(), text: $('itText').value }); }
  // opens the dialog; resolves to { kind, text } or null
  function ask(opts) {
    ensure(); state = { name: opts.name || '', manual: false };
    $('itTitle').textContent = opts.title || 'Add data';
    $('itSource').textContent = opts.source || '';
    $('itSource').hidden = !opts.source;
    var ta = $('itText'); ta.value = opts.text || ''; ta.readOnly = !!opts.readOnly; ta.classList.toggle('it-preview', !!opts.readOnly);
    modal.hidden = false;
    resniff(false);
    if (opts.kind) { choose(opts.kind); state.manual = true; validate(); }
    (opts.readOnly ? $('itAdd') : ta).focus();
    return new Promise(function (res) { resolveFn = res; });
  }
  async function intakeText(text, name, source, url) {
    var s = sniff(text, name);
    if (s.sure && s.kind) { await load(s.kind, text, name, url); return s.kind; }
    var r = await ask({ title: 'Add ' + (name || 'data'), source: source || (name ? 'Dropped file: ' + name : ''), text: text, name: name, readOnly: true, kind: s.kind });
    if (!r) { setStatus('Not added: ' + (name || 'pasted data')); return null; }
    await load(r.kind, r.text, name, url);
    return r.kind;
  }
  function readText(f) { if (f && typeof f.text === 'function') return f.text(); return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(f); }); }
  async function intakeFiles(files) {
    var done = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i], text;
      try { text = await readText(f); } catch (e) { setStatus('Could not read ' + f.name); continue; }
      try { var k = await intakeText(text, f.name); if (k) done.push(k); } catch (e) { console.error(e); setStatus('Could not load ' + f.name + ': ' + e.message); }
    }
    return done;
  }
  async function paste(text) {
    var r = await ask({ title: 'Paste data', source: '', text: text || '', readOnly: false });
    if (!r) return null;
    try { await load(r.kind, r.text, 'pasted'); } catch (e) { console.error(e); setStatus('Could not load the pasted data: ' + e.message); return null; }
    return r.kind;
  }
  // ------------------------------------------------------------------ wiring
  var canvas = $('canvas');
  if (canvas) canvas.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    if (!files.length) return;
    if (window.tmSession && files.some(function (f) { return tmSession.isSessionFile(f); })) return;   // pro-ui opens sessions
    e.preventDefault(); e.stopImmediatePropagation();
    intakeFiles(files);
  }, true);
  // the Add data menu entry
  var sub = $('addDataframeSubcard');
  if (sub) {
    var sec = document.createElement('div'); sec.className = 'add-dataframe-section';
    sec.innerHTML = '<button id="addPasteOption" class="clade-toolbar-btn" title="Paste a table, a tree or an alignment from the clipboard"><span>Paste data…</span></button>';
    var content = sub.querySelector('.clade-color-card-content') || sub; content.appendChild(sec);
    $('addPasteOption').addEventListener('click', function (ev) {
      ev.stopPropagation();
      sub.style.display = 'none'; var main = $('addDataframe'); if (main) main.classList.remove('active');
      paste('');
    });
  }
  // Ctrl/Cmd+V with nothing editable focused
  document.addEventListener('paste', function (e) {
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
    if (modal && !modal.hidden) return;
    if (document.querySelector('.pro-modal:not([hidden])')) return;
    var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text || !text.trim()) return;
    e.preventDefault();
    paste(text);
  });
  window.tmIntake = { sniff: sniff, text: intakeText, files: intakeFiles, paste: paste, KINDS: KINDS.map(function (k) { return k.key; }) };
})();
