// Alignment rules for groups of tips (dataframe card, Alignment section). Loaded after app.js.
//
// "Align bars by gene" puts one gene's edge at 0 bp in every row. A rule does the
// same for a group of tips with a gene of its own:
//   - the group is a clade picked on the tree (its tip names are kept), or the tips
//     with one value in a heatmap column (e.g. Clade = "Clade 1");
//   - for each tip, the first rule that covers it and whose gene the tip has decides
//     the row: that gene's left / centre / right edge goes to the rule's position, by
//     default where that edge typically sits in the rule's tips under the card's own
//     alignment (the median, worked out in prepareDataframeForDrawing), or a set bp;
//   - tips no rule covers, or without the rule's gene, use the card's own gene;
//   - a rule can also hide genes in its tips (stray hits).
// The rules live on the dataframe (df.alignRules) and, for sessions, as JSON in a
// hidden input of the card; their own controls are skipped by the session.
(function () {
  'use strict';
  var EDGES = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
  var MAX_VALUES = 60;          // a heatmap column with more distinct values is not offered
  var uid = 0;
  var lastTarget = new WeakMap();   // rule -> bp its gene was placed at in the last drawing

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(v) { return normalizeAccession(v == null ? '' : v); }
  function cardOf(el) { return el && el.closest ? el.closest('[id^="dataframeCard"]') : null; }
  function idOf(card) { var m = /(\d+)$/.exec(card.id || ''); return m ? +m[1] : 0; }
  function dfOf(card) { return card ? dataframes.get(idOf(card)) : null; }
  function rulesOf(df) { if (!Array.isArray(df.alignRules)) df.alignRules = []; return df.alignRules; }
  function heatmapList() { var out = []; if (typeof heatmaps !== 'undefined' && heatmaps) heatmaps.forEach(function (h, id) { if (h && h.data) out.push({ id: id, hm: h }); }); return out; }

  // the heatmap a value rule reads: its own, else the first one with that column (ids change when cards are renumbered)
  function heatmapFor(rule) {
    var list = heatmapList(), own = list.filter(function (x) { return x.id === rule.hm; })[0];
    if (own && own.hm.data.columns.indexOf(rule.col) >= 0) return own;
    return list.filter(function (x) { return x.hm.data.columns.indexOf(rule.col) >= 0; })[0] || null;
  }
  function membersOf(rule) {
    var set = new Set();
    if (rule.t === 'clade') { (rule.tips || []).forEach(function (n) { set.add(norm(n)); }); return set; }
    var h = heatmapFor(rule);
    if (!h) return set;
    var d = h.hm.data;
    d.rows.forEach(function (r) { if (String(r[rule.col] == null ? '' : r[rule.col]).trim() === rule.val) set.add(norm(r[d.idCol])); });
    return set;
  }
  function geneColOf(df) { return getDataframeColumnIndices(df.meta).geneCol; }
  function genesOf(df) {
    var col = geneColOf(df), seen = new Set();
    df.meta.rows.forEach(function (r) { var gname = r[col]; if (gname != null && gname !== '') seen.add(String(gname)); });
    return Array.from(seen).sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }); });
  }

  // ------------------------------------------------------------------ drawing
  // what prepareDataframeForDrawing needs: null when no rule does anything
  function plan(df) {
    if (!df || !df.meta) return null;
    var rules = rulesOf(df).filter(function (r) { return r.g || (r.h && r.h.length); });
    if (!rules.length) return null;
    var compiled = rules.map(function (r) { return { r: r, m: membersOf(r), hide: new Set(r.h || []) }; });
    var sig = JSON.stringify(rules) + '|' + heatmapList().map(function (x) { return x.id + ':' + x.hm.data.rows.length; }).join(',');
    return {
      sig: sig,
      // the gene and edge that place this tip's row, or null for the card's own gene
      ruleFor: function (key, recs, geneCol) {
        for (var i = 0; i < compiled.length; i++) {
          var c = compiled[i];
          if (!c.r.g || !c.m.has(key)) continue;
          if (recs && recs.some(function (row) { return String(row[geneCol]) === c.r.g; })) return { gene: c.r.g, edge: c.r.e || 'left', rule: c.r };
        }
        return null;
      },
      // where each rule's gene went (bp), for the card
      noteTargets: function (m) { m.forEach(function (bp, r) { lastTarget.set(r, bp); }); },
      // genes hidden in this tip's row (every rule that covers it), or null
      hidden: function (key) {
        var out = null;
        for (var i = 0; i < compiled.length; i++) {
          var c = compiled[i];
          if (c.hide.size && c.m.has(key)) { if (!out) out = new Set(); c.hide.forEach(function (x) { out.add(x); }); }
        }
        return out;
      }
    };
  }

  // ------------------------------------------------------------------ card
  function save(card, df) {
    var st = card.querySelector('.align-rules-state');
    if (st) st.value = rulesOf(df).length ? JSON.stringify(rulesOf(df)) : '';
  }
  function redraw(card) {
    if (ALIGNMENT_OPTIMIZATIONS && ALIGNMENT_OPTIMIZATIONS.cache) { ALIGNMENT_OPTIMIZATIONS.cache.clear(); ALIGNMENT_OPTIMIZATIONS.lastProcessedFrame = null; }
    if (typeof root === 'undefined' || !root) return;
    if (typeof setDrawScope === 'function') setDrawScope('dataframe:' + idOf(card));
    drawTree();
    showPlaces(card);
  }
  function changed(card, df) { save(card, df); render(card); redraw(card); }
  function isPlace(p) { return p !== '' && p != null && isFinite(+p); }
  // an empty "Place at" shows where the typical spot came out
  function showPlaces(card) {
    var df = dfOf(card);
    if (!df) return;
    Array.prototype.forEach.call(card.querySelectorAll('.align-rules .ar-rule'), function (row) {
      var r = rulesOf(df)[+row.getAttribute('data-i')], inp = row.querySelector('.ar-place');
      if (!r || !inp) return;
      var bp = lastTarget.get(r);
      inp.placeholder = r.g && bp != null && df.alignByGeneEnabled ? 'typical: ' + Math.round(bp) : 'typical';
      inp.title = 'Empty: the gene goes where it typically sits in these tips' + (bp != null && r.g ? ' (' + Math.round(bp) + ' bp)' : '') + '. A number puts it there exactly, e.g. 0.';
    });
  }
  // an edit inside one rule: its controls stay (focus, open lists), only its texts change
  function edited(card, df, i) {
    save(card, df);
    var row = card.querySelector('.align-rules .ar-rule[data-i="' + i + '"]'), r = rulesOf(df)[i];
    if (row && r) {
      var cnt = row.querySelector('.ar-count'); if (cnt) cnt.innerHTML = countText(df, r);
      var sum = row.querySelector('.ar-hide summary'); if (sum) sum.textContent = 'Hide genes in these tips: ' + ((r.h && r.h.length) ? r.h.join(', ') : 'none');
    }
    redraw(card);
  }

  function sourceText(rule) {
    if (rule.t === 'clade') {
      var n = (rule.tips || []).length;
      return 'Clade on the tree: ' + esc(rule.tips[0] || '') + (n > 1 ? ' … ' + esc(rule.tips[n - 1]) : '');
    }
    var h = heatmapFor(rule);
    return (h ? 'Heatmap ' + h.id : '<span class="ar-warn">Heatmap not loaded</span>') + ' · ' + esc(rule.col) + ' = ' + esc(rule.val);
  }
  function countText(df, rule) {
    if (typeof root === 'undefined' || !root) return '';
    var m = membersOf(rule), byAll = df.meta.byIdAll, col = geneColOf(df), tips = 0, have = 0;
    root.leaves().forEach(function (l) {
      var k = norm(l.data.name);
      if (!m.has(k)) return;
      tips++;
      var recs = byAll && byAll.get(k);
      if (rule.g && recs && recs.some(function (r) { return String(r[col]) === rule.g; })) have++;
    });
    return tips + ' tip' + (tips === 1 ? '' : 's') + (rule.g ? ' · ' + have + ' with ' + esc(rule.g) : '');
  }

  function render(card) {
    var box = card && card.querySelector('.align-rules');
    var df = dfOf(card);
    if (!box || !df || !df.meta) return;
    var rules = rulesOf(df), genes = genesOf(df);
    // hide lists that are open stay open (by rule, which may have moved)
    var open = [], wasOpen = new Set();
    Array.prototype.forEach.call(box.querySelectorAll('.ar-rule'), function (row) {
      var d = row.querySelector('.ar-hide'), j = +row.getAttribute('data-i');
      if (d && d.open && box._rules && box._rules[j]) wasOpen.add(box._rules[j]);
    });
    rules.forEach(function (r, j) { open[j] = wasOpen.has(r); });
    box._rules = rules.slice();
    box.classList.toggle('is-off', !df.alignByGeneEnabled);
    var html = '<div class="ar-title">Rules for groups of tips</div>' +
      '<p class="ar-hint">' + (df.alignByGeneEnabled ? '' : '<b>Switch on “Align bars by gene” to use them.</b> ') +
      'For each tip, the first rule that covers it and whose gene the tip has lines that gene up with the rule\'s other tips, where it typically sits (or at the bp you set). Other tips use the gene above.</p>';
    rules.forEach(function (r, i) {
      var name = 'ar-edge-' + (++uid);
      html += '<div class="ar-rule" data-i="' + i + '">' +
        '<div class="ar-top"><span class="ar-num">' + (i + 1) + '</span>' +
          '<input type="text" class="ar-name" value="' + esc(r.n || '') + '" placeholder="Rule ' + (i + 1) + '" aria-label="Rule name">' +
          '<button type="button" class="ar-btn ar-up" title="Move up (earlier rules win)"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" class="ar-btn ar-del" title="Remove rule">×</button></div>' +
        '<div class="ar-src">' + sourceText(r) + '</div>' +
        '<div class="ar-count">' + countText(df, r) + '</div>' +
        (r.t === 'clade' ? '<button type="button" class="ar-btn ar-reclade" title="Replace this rule\'s tips with the clade selected on the tree">Use selected clade</button>' : '') +
        '<div class="pro-row pro-sub"><label>Gene</label><select class="pro-select ar-gene">' +
          '<option value="">(none: keep the gene above)</option>' +
          genes.map(function (gname) { return '<option value="' + esc(gname) + '"' + (gname === r.g ? ' selected' : '') + '>' + esc(gname) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="pro-row pro-sub"><span>Anchor</span><span class="pro-radio-seg" role="radiogroup" aria-label="Rule anchor">' +
          EDGES.map(function (e) { return '<label><input type="radio" class="ar-edge" name="' + name + '" value="' + e[0] + '"' + ((r.e || 'left') === e[0] ? ' checked' : '') + '><span>' + e[1] + '</span></label>'; }).join('') +
        '</span></div>' +
        '<div class="pro-row pro-sub"><label>Place at</label><span class="pro-num-wrap"><input type="number" step="1" class="pro-num ar-place" value="' + (isPlace(r.p) ? esc(r.p) : '') + '" placeholder="typical" aria-label="Position of the gene edge (empty: where it typically sits)"><span class="pro-unit">bp</span></span></div>' +
        '<details class="ar-hide"' + (open[i] ? ' open' : '') + '><summary>Hide genes in these tips: ' + ((r.h && r.h.length) ? esc(r.h.join(', ')) : 'none') + '</summary>' +
          '<div class="ar-hide-list">' + genes.map(function (gname) {
            return '<label class="ar-hide-item"><input type="checkbox" class="ar-hide-cb" value="' + esc(gname) + '"' + ((r.h || []).indexOf(gname) >= 0 ? ' checked' : '') + '><span>' + esc(gname) + '</span></label>';
          }).join('') + '</div></details>' +
        '</div>';
    });
    html += '<select class="pro-select ar-add" aria-label="Add a rule"><option value="">+ Add a rule for…</option></select>';
    box.innerHTML = html;
    fillAdd(box.querySelector('.ar-add'));
  }

  // the "Add a rule" choices: the selected clade, and each value of each heatmap column with few values
  function addChoices() {
    var out = [];
    var node = (typeof highlightedClade !== 'undefined') ? highlightedClade : null;
    var tips = node ? cladeTips(node) : [];
    out.push({ label: tips.length > 1 ? 'Clade selected on the tree (' + tips.length + ' tips)' : 'Clade selected on the tree (select a node first)', off: tips.length < 2, make: function () { return [{ t: 'clade', tips: tips, n: '' }]; } });
    heatmapList().forEach(function (x) {
      var d = x.hm.data;
      d.columns.forEach(function (col) {
        if (col === d.idCol) return;
        var counts = new Map(), numeric = true;
        d.rows.forEach(function (r) {
          var v = String(r[col] == null ? '' : r[col]).trim();
          if (!v) return;
          if (numeric && !isFinite(+v)) numeric = false;
          counts.set(v, (counts.get(v) || 0) + 1);
        });
        if (!counts.size || counts.size > MAX_VALUES || (numeric && counts.size > 12)) return;
        var vals = Array.from(counts.keys()).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
        var group = 'Heatmap ' + x.id + ' · ' + col;
        out.push({ group: group, label: 'One rule per value (' + vals.length + ')', make: function () { return vals.map(function (v) { return { t: 'value', hm: x.id, col: col, val: v, n: v }; }); } });
        vals.forEach(function (v) { out.push({ group: group, label: v + ' (' + counts.get(v) + ')', make: function () { return [{ t: 'value', hm: x.id, col: col, val: v, n: v }]; } }); });
      });
    });
    return out;
  }
  function fillAdd(sel) {
    if (!sel) return;
    var ch = addChoices(), html = '<option value="">+ Add a rule for…</option>', open = null;
    ch.forEach(function (c, i) {
      if (c.group !== open) { if (open) html += '</optgroup>'; if (c.group) html += '<optgroup label="' + esc(c.group) + '">'; open = c.group || null; }
      html += '<option value="' + i + '"' + (c.off ? ' disabled' : '') + '>' + esc(c.label) + '</option>';
    });
    if (open) html += '</optgroup>';
    sel.innerHTML = html;
    sel._choices = ch;
  }
  function cladeTips(node) {
    var out = [], st = [node], seen = new Set();
    while (st.length) {
      var n = st.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      var kids = [];
      [n.children, n._children, n._originalChildren].forEach(function (c) { if (c) kids = kids.concat(c); });
      if (!kids.length) out.push(String(n.data.name)); else kids.forEach(function (k) { st.push(k); });
    }
    return out.reverse();
  }

  function ruleOf(el) {
    var card = cardOf(el), df = dfOf(card), row = el.closest('.ar-rule');
    var i = row ? +row.getAttribute('data-i') : -1;
    return { card: card, df: df, i: i, rule: df && i >= 0 ? rulesOf(df)[i] : null };
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('align-rules-state')) {
      // a session puts the rules back
      var card = cardOf(t), df = dfOf(card);
      if (!df) return;
      var list = [];
      try { list = t.value ? JSON.parse(t.value) : []; } catch (e) { list = []; }
      df.alignRules = Array.isArray(list) ? list : [];
      render(card); redraw(card);
      return;
    }
    if (/^metaAlignEnable\d+$/.test(t.id || '')) { var c0 = cardOf(t); if (c0) setTimeout(function () { render(c0); }, 0); return; }
    if (!t.closest('.align-rules')) return;
    var x = ruleOf(t);
    if (!x.df) return;
    if (t.classList.contains('ar-add')) {
      var ch = t._choices && t._choices[+t.value];
      if (ch && !ch.off) ch.make().forEach(function (r) { rulesOf(x.df).push(r); });
      changed(x.card, x.df);
      return;
    }
    if (!x.rule) return;
    if (t.classList.contains('ar-gene')) x.rule.g = t.value || '';
    else if (t.classList.contains('ar-edge')) x.rule.e = t.value;
    else if (t.classList.contains('ar-name')) { x.rule.n = t.value; save(x.card, x.df); return; }
    else if (t.classList.contains('ar-place')) x.rule.p = t.value.trim() === '' || !isFinite(+t.value) ? '' : +t.value;
    else if (t.classList.contains('ar-hide-cb')) {
      var h = new Set(x.rule.h || []);
      if (t.checked) h.add(t.value); else h.delete(t.value);
      x.rule.h = Array.from(h);
    } else return;
    edited(x.card, x.df, x.i);
  });
  // the add list is built again when opened (the selected clade and the heatmaps change)
  ['mousedown', 'focusin', 'keydown'].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains('ar-add') && (type !== 'keydown' || !t._filled)) { fillAdd(t); t._filled = type === 'focusin'; }
    }, true);
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.align-rules .ar-btn') : null;
    if (!b) return;
    ev.preventDefault();
    var x = ruleOf(b);
    if (!x.df || !x.rule) return;
    var rules = rulesOf(x.df);
    if (b.classList.contains('ar-del')) rules.splice(x.i, 1);
    else if (b.classList.contains('ar-up') && x.i > 0) { var r = rules.splice(x.i, 1)[0]; rules.splice(x.i - 1, 0, r); }
    else if (b.classList.contains('ar-reclade')) {
      var node = (typeof highlightedClade !== 'undefined') ? highlightedClade : null;
      var tips = node ? cladeTips(node) : [];
      if (tips.length < 2) { if (typeof setStatus === 'function') setStatus('Select a clade on the tree first'); return; }
      x.rule.tips = tips;
    } else return;
    changed(x.card, x.df);
  });

  window.tmAlignRules = {
    plan: plan,
    // the card was filled (a file was loaded): draw its rules
    refresh: function (dataframeId) { var card = document.getElementById('dataframeCard' + dataframeId); if (card) { render(card); setTimeout(function () { showPlaces(card); }, 0); } },
    _membersOf: membersOf
  };
})();
