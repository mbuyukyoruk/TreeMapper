// A tree from the loaded alignment (loaded after app.js and msa.js). Generate tree → Source:
// "Loaded alignment": p-distances between the sequences (the share of differing sites among
// the sites where both have a residue; gaps are left out), then neighbour-joining or UPGMA
// with the app's own functions, and optional bootstrap replicates: the columns are resampled
// with replacement, a tree is built from each replicate and each clade of the final tree is
// labelled with the percentage of replicates that contain it (support values). Replicates
// run in chunks, so the page stays responsive and the status shows the progress.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isGap(ch) { return ch === '-' || ch === '.' || ch === '?' || ch === ' ' || ch === '' ; }
  // the sequences of an alignment layer, as upper-case strings
  function sequencesOf(m) {
    var ids = m.ids || [], seqs = m.seqs || [];
    var out = [];
    for (var i = 0; i < ids.length; i++) { var s = String(seqs[i] || '').toUpperCase(); if (s.length) out.push({ name: String(ids[i]), seq: s }); }
    return out;
  }
  // p-distance matrix over the given columns (all columns when cols is null)
  function pDistances(records, cols) {
    var n = records.length, D = [], i, j, k;
    for (i = 0; i < n; i++) { D.push(new Array(n).fill(0)); }
    var L = cols ? cols.length : (records[0] ? records[0].seq.length : 0);
    for (i = 0; i < n; i++) {
      var a = records[i].seq;
      for (j = i + 1; j < n; j++) {
        var b = records[j].seq, same = 0, comp = 0;
        for (k = 0; k < L; k++) {
          var c = cols ? cols[k] : k, x = a[c], y = b[c];
          if (x === undefined || y === undefined || isGap(x) || isGap(y)) continue;
          comp++; if (x === y) same++;
        }
        D[i][j] = D[j][i] = comp ? 1 - same / comp : 1;
      }
    }
    return D;
  }
  function tipsOf(node) { var out = []; (function w(x) { if (x.children) x.children.forEach(w); else out.push(x.name); })(node); return out; }
  // the clades of a tree as keys: the sorted names of the side without the first name
  function cladeKeys(tree, allNames) {
    var first = allNames.slice().sort()[0], all = new Set(allNames), keys = new Set();
    (function w(x, isRoot) {
      if (!x.children) return [x.name];
      var names = []; x.children.forEach(function (c) { names = names.concat(w(c, false)); });
      if (!isRoot) {
        var side = names.slice().sort();
        if (side.indexOf(first) >= 0) { var S = new Set(side); side = []; all.forEach(function (nm) { if (!S.has(nm)) side.push(nm); }); side.sort(); }
        if (side.length >= 2 && side.length <= allNames.length - 2) { x._key = side.join('\u0001'); keys.add(x._key); }
      }
      return names;
    })(tree, true);
    return keys;
  }
  function newickWithSupport(node, support) {
    function w(x) {
      if (!x.children) return String(x.name).replace(/[(),:;\s]/g, '_') + (x.branchLength !== undefined ? ':' + (+x.branchLength).toFixed(6) : '');
      var s = '(' + x.children.map(w).join(',') + ')';
      if (support && x._key && support.has(x._key)) s += support.get(x._key);
      if (x.branchLength !== undefined) s += ':' + (+x.branchLength).toFixed(6);
      return s;
    }
    return w(node) + ';';
  }
  // builds the tree; calls progress(done, total) during the bootstrap; resolves to { newick, n, L, replicates }
  function build(opts) {
    var m = opts.alignment, records = sequencesOf(m), names = records.map(function (r) { return r.name; });
    if (records.length < 3) return Promise.reject(new Error('At least 3 sequences are needed'));
    var L = records[0].seq.length;
    var algo = opts.method === 'upgma' ? upgmaTree : neighborJoiningTree;
    var D = pDistances(records, null), tree = algo(D, names);
    var reps = Math.max(0, Math.floor(+opts.replicates || 0));
    if (!reps) return Promise.resolve({ newick: newickWithSupport(tree, null), n: records.length, L: L, replicates: 0, tree: tree });
    var main = cladeKeys(tree, names), counts = new Map(); main.forEach(function (k) { counts.set(k, 0); });
    var seed = 12345 + records.length * 7 + L;   // the same replicates every time for the same alignment
    var rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    var done = 0;
    return new Promise(function (resolve) {
      function step() {
        var t0 = performance.now();
        while (done < reps && performance.now() - t0 < 40) {
          var cols = new Array(L); for (var k = 0; k < L; k++) cols[k] = Math.floor(rnd() * L);
          var Dr = pDistances(records, cols), tr = algo(Dr, names), keys = cladeKeys(tr, names);
          keys.forEach(function (key) { if (counts.has(key)) counts.set(key, counts.get(key) + 1); });
          done++;
        }
        if (opts.progress) opts.progress(done, reps);
        if (done < reps) setTimeout(step, 0);
        else {
          var support = new Map(); counts.forEach(function (c, key) { support.set(key, Math.round(100 * c / reps)); });
          resolve({ newick: newickWithSupport(tree, support), n: records.length, L: L, replicates: reps, tree: tree, support: support });
        }
      }
      step();
    });
  }
  // ------------------------------------------------------------------ the dialog
  function alignments() { var out = []; if (typeof msas !== 'undefined' && msas) msas.forEach(function (m, id) { if (m && m.ids && m.ids.length) out.push({ id: id, m: m, label: (m.name || ('Alignment ' + id)) + ' (' + m.ids.length + ' sequences, ' + m.L + ' columns)' }); }); return out; }
  function refresh() {
    var sel = $('atAlignment'), box = $('atSection'), src = $('genSourceAlignment'); if (!sel || !box) return;
    var list = alignments();
    sel.innerHTML = list.length ? list.map(function (a) { return '<option value="' + a.id + '">' + esc(a.label) + '</option>'; }).join('') : '<option value="">(load an alignment layer first)</option>';
    if (src) { src.disabled = !list.length; if (!list.length && src.checked) { var g = $('genSourceTable'); if (g) g.checked = true; } }
    var useAl = src && src.checked && list.length;
    box.hidden = !useAl;
    var tbl = $('genTableSection'); if (tbl) tbl.hidden = !!useAl;
    var btn = $('generateTreeBtn'); if (btn && useAl) { btn.disabled = false; btn.title = 'Build the tree from the alignment'; }
    var title = $('proGenerateTitle'); if (title) title.textContent = useAl ? 'Generate tree from the alignment' : 'Generate tree from gene content';
  }
  var running = false;
  function generate() {
    if (running) return;
    var sel = $('atAlignment'), id = sel && +sel.value, m = (typeof msas !== 'undefined' && msas) ? msas.get(id) : null;
    if (!m) { setStatus('Choose an alignment'); return; }
    var method = ($('algorithmUPGMA') && $('algorithmUPGMA').checked) ? 'upgma' : 'nj';
    var reps = +(($('atReplicates') || {}).value) || 0;
    if (m.ids.length > 200 && reps > 0 && !confirm(m.ids.length + ' sequences: ' + reps + ' bootstrap replicates may take a while. Continue?')) return;
    running = true; setStatus('Computing distances from the alignment…');
    build({ alignment: m, method: method, replicates: reps, progress: function (d, t) { setStatus('Bootstrap: ' + d + ' of ' + t + ' replicates'); } })
      .then(function (res) {
        var f = new File([res.newick], 'tree_from_alignment.newick', { type: 'text/plain' });
        return handleTreeFile(f).then(function () {
          var modal = $('proGenerateModal'); if (modal) modal.hidden = true;
          if (res.replicates && $('showBootstrap') && !$('showBootstrap').checked) { $('showBootstrap').click(); }
          var msg = 'Tree from the alignment: ' + res.n + ' sequences, ' + res.L + ' columns, ' + (method === 'upgma' ? 'UPGMA' : 'neighbour-joining') + (res.replicates ? ', ' + res.replicates + ' bootstrap replicates (support values on the clades)' : '');
          setStatus(msg); setTimeout(function () { setStatus(msg); }, 400);   // after the redraw's own "Ready"
        });
      })
      .catch(function (e) { setStatus('Could not build the tree: ' + e.message); })
      .then(function () { running = false; });
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.id) return;
    if (t.id === 'genSourceTable' || t.id === 'genSourceAlignment') refresh();
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('#generateTreeBtn') : null; if (!b) return;
    var src = $('genSourceAlignment'); if (src && src.checked && !src.disabled) { ev.preventDefault(); ev.stopImmediatePropagation(); generate(); }
  }, true);
  var modal = $('proGenerateModal');
  if (modal) new MutationObserver(function () { if (!modal.hidden) refresh(); }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  window.tmAlignTree = { build: build, pDistances: pDistances, refresh: refresh, generate: generate };
})();
