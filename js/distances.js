// Distances along the tree (loaded after app.js). With tips selected, the selection toolbar
// shows "Distances":
//   - with one tip selected: every other tip and its path distance (the sum of the branch
//     lengths between them), nearest first, with a filter; "Select tips within X" selects the
//     tips at that distance or less (the tip itself included);
//   - CSV exports: the distances from the tip, the cophenetic matrix of the selected tips
//     (two or more selected) and of every tip (dropped tips left out; large trees ask first).
// Distances come from the branch lengths of the tree as loaded (d.data.length); re-rooting
// does not change them.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(x) { return x === 0 ? '0' : (Math.abs(x) >= 1000 || Math.abs(x) < 1e-4 ? x.toExponential(3) : String(+x.toPrecision(6))); }
  function shownLeaves() { return (typeof root !== 'undefined' && root) ? root.leaves().filter(function (l) { return !l._removedAsDuplicate && !(typeof droppedNodes !== 'undefined' && droppedNodes.has(l)); }) : []; }
  function selectedLeaves() {
    var names = (typeof highlightedAccessions !== 'undefined') ? highlightedAccessions : new Set();
    return shownLeaves().filter(function (l) { return names.has(l.data.name); });
  }
  // depth from the root in branch length, computed on demand (the drawing keeps cumLen too)
  function depthMap(leaves) {
    var m = new Map();
    function depth(n) { if (m.has(n)) return m.get(n); var d = (n.parent ? depth(n.parent) : 0) + (n.parent ? (+n.data.length || 0) : 0); m.set(n, d); return d; }
    leaves.forEach(depth);
    return function (n) { return depth(n); };
  }
  // path distance a–b: depth(a) + depth(b) - 2 depth(lca)
  function distancer(leaves) {
    var depth = depthMap(leaves), anc = new Map();
    function ancestors(n) { if (anc.has(n)) return anc.get(n); var s = new Set(); for (var x = n; x; x = x.parent) s.add(x); anc.set(n, s); return s; }
    return function (a, b) {
      if (a === b) return 0;
      var A = ancestors(a), x = b;
      while (x && !A.has(x)) x = x.parent;
      return depth(a) + depth(b) - 2 * (x ? depth(x) : 0);
    };
  }
  function csvCell(s) { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function download(text, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function fromTip(tip, leaves) {
    var dist = distancer(leaves);
    return leaves.filter(function (l) { return l !== tip; }).map(function (l) { return { leaf: l, name: String(l.data.name), d: dist(tip, l) }; }).sort(function (a, b) { return a.d - b.d || a.name.localeCompare(b.name); });
  }
  function matrixCsv(leaves) {
    var dist = distancer(leaves), names = leaves.map(function (l) { return String(l.data.name); });
    var out = [''].concat(names.map(csvCell)).join(',') + '\n';
    for (var i = 0; i < leaves.length; i++) {
      var row = [csvCell(names[i])];
      for (var j = 0; j < leaves.length; j++) row.push(i === j ? '0' : fmt(dist(leaves[i], leaves[j])));
      out += row.join(',') + '\n';
    }
    return out;
  }

  // ------------------------------------------------------------------ dialog
  var modal = null, state = { tip: null, rows: [], all: false, q: '' };
  function ensure() {
    if (modal) return modal;
    modal = document.createElement('div'); modal.className = 'pro-modal'; modal.id = 'proDistances'; modal.hidden = true;
    modal.innerHTML = '<div class="pro-modal-card ds-card" role="dialog" aria-modal="true" aria-labelledby="dsTitle">' +
      '<div class="pro-panel-head"><span class="pro-panel-title" id="dsTitle">Distances</span><button type="button" class="pro-icon-btn pro-icon-btn-sm" id="dsClose" aria-label="Close"><svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="pro-modal-body ds-body" id="dsBody"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    $('dsClose').addEventListener('click', close);
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } });
    modal.addEventListener('click', onClick);
    modal.addEventListener('input', function (e) { if (e.target.id === 'dsFilter') { state.q = e.target.value.trim().toLowerCase(); renderTable(); } });
    return modal;
  }
  function close() { if (modal) modal.hidden = true; }
  function render() {
    var leaves = shownLeaves(), sel = selectedLeaves(), tip = sel.length === 1 ? sel[0] : null;
    state.tip = tip; state.rows = tip ? fromTip(tip, leaves) : []; state.all = false; state.q = '';
    var html = '';
    if (tip) {
      html += '<div class="ds-section"><div class="ds-head"><b>From ' + esc(tip.data.name) + '</b><span class="ds-muted">' + state.rows.length + ' other tips, nearest first</span></div>' +
        '<div class="ds-tools"><input type="text" id="dsFilter" class="pro-search ds-filter" placeholder="Filter tips" aria-label="Filter tips">' +
        '<span class="ds-within"><label for="dsWithin">Select tips within</label><input type="number" id="dsWithin" class="pro-num" step="any" min="0" value="' + esc(fmt(state.rows.length ? state.rows[Math.min(4, state.rows.length - 1)].d : 0)) + '"><button type="button" class="pro-btn" id="dsSelectWithin">Select</button></span></div>' +
        '<div class="ds-table" id="dsTable"></div></div>';
    } else {
      html += '<p class="ds-muted">Select one tip to list the distances from it. ' + (sel.length > 1 ? sel.length + ' tips are selected: their cophenetic matrix can be exported below.' : '') + '</p>';
    }
    html += '<div class="ds-section"><div class="ds-head"><b>Export (CSV)</b></div><div class="ds-exports">' +
      (tip ? '<button type="button" class="pro-btn" id="dsExportFrom">Distances from ' + esc(tip.data.name) + '</button>' : '') +
      (sel.length > 1 ? '<button type="button" class="pro-btn" id="dsExportSel">Cophenetic matrix of the ' + sel.length + ' selected tips</button>' : '') +
      '<button type="button" class="pro-btn" id="dsExportAll">Cophenetic matrix of all ' + leaves.length + ' tips</button></div>' +
      '<p class="ds-muted">Path distances: the sum of the branch lengths between two tips. Dropped tips are left out.</p></div>';
    $('dsBody').innerHTML = html;
    renderTable();
  }
  function renderTable() {
    var box = $('dsTable'); if (!box) return;
    var rows = state.rows.filter(function (r) { return !state.q || r.name.toLowerCase().indexOf(state.q) >= 0; });
    var shown = state.all || state.q ? rows : rows.slice(0, 50);
    box.innerHTML = '<table class="ds-grid"><thead><tr><th>Tip</th><th class="ds-num">Distance</th></tr></thead><tbody>' +
      shown.map(function (r) { return '<tr data-name="' + esc(r.name) + '"><td>' + esc(r.name) + '</td><td class="ds-num">' + esc(fmt(r.d)) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (rows.length > shown.length ? '<button type="button" class="ds-more" id="dsMore">Show all ' + rows.length + '</button>' : '') + (rows.length === 0 ? '<p class="ds-muted">No match</p>' : '');
  }
  function onClick(e) {
    var t = e.target.closest('button, tr[data-name]'); if (!t) return;
    var leaves = shownLeaves(), sel = selectedLeaves();
    if (t.id === 'dsMore') { state.all = true; renderTable(); }
    else if (t.id === 'dsSelectWithin' && state.tip) {
      var x = +$('dsWithin').value; if (!isFinite(x)) return;
      var names = [String(state.tip.data.name)].concat(state.rows.filter(function (r) { return r.d <= x + 1e-12; }).map(function (r) { return r.name; }));
      close();
      if (typeof applyTipSelection === 'function') applyTipSelection(names);
      if (typeof setStatus === 'function') setStatus(names.length + ' tips within ' + fmt(x) + ' of ' + state.tip.data.name);
    }
    else if (t.id === 'dsExportFrom' && state.tip) {
      download('tip,distance\n' + state.rows.map(function (r) { return csvCell(r.name) + ',' + fmt(r.d); }).join('\n') + '\n', 'distances_from_' + String(state.tip.data.name).replace(/[^\w.-]+/g, '_') + '.csv');
    }
    else if (t.id === 'dsExportSel') download(matrixCsv(sel), 'cophenetic_selected.csv');
    else if (t.id === 'dsExportAll') {
      if (leaves.length > 3000 && !confirm('The matrix has ' + leaves.length + ' × ' + leaves.length + ' cells and may take a while. Continue?')) return;
      download(matrixCsv(leaves), 'cophenetic_all.csv');
    }
    else if (t.tagName === 'TR') {
      // a row: that tip and the reference selected together
      var n = t.getAttribute('data-name'); close();
      if (typeof applyTipSelection === 'function') applyTipSelection([String(state.tip.data.name), n]);
    }
  }
  function open() { ensure(); render(); modal.hidden = false; var f = $('dsFilter'); if (f) f.focus(); }

  // the toolbar button, shown while tips are selected
  var bar = $('cladeToolbar');
  if (bar) {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'distancesBtn'; b.className = 'clade-toolbar-btn'; b.title = 'Distances along the tree from the selected tip; cophenetic matrix export'; b.style.display = 'none';
    b.innerHTML = '<svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17h18"/><path d="M6 14v3M10 15v2M14 14v3M18 15v2"/><path d="M5 7l4-3 5 4 5-3"/></svg><span>Distances</span>';
    // among the other clade buttons (they wrap together when the canvas is narrow; appended after
    // them the toolbar grew wider than the canvas)
    var anchor = $('isolateLUCA'); if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor.nextSibling); else bar.appendChild(b);
    b.addEventListener('click', open);
    var refresh = function () { b.style.display = selectedLeaves().length ? '' : 'none'; };
    new MutationObserver(refresh).observe(bar, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });
    refresh();
  }
  window.tmDistances = { open: open, distancer: distancer, matrixCsv: matrixCsv, fromTip: fromTip };
})();
