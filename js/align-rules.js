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
  var openRules = new WeakSet();      // rules shown with their editor
  var ICO = {
    chev: '<path d="M6 9l6 6 6-6"/>',
    up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    tree: '<path d="M4 6h5v12h5"/><path d="M9 12h6"/><circle cx="18" cy="12" r="2"/><circle cx="17" cy="18" r="2"/><circle cx="4" cy="6" r="1.5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    target: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'
  };
  function svg(name, size) {
    return '<svg class="pro-ico" width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICO[name] + '</svg>';
  }
  function colourOf(df, gname) {
    var m = (df && df.geneColors) || (typeof geneColors !== 'undefined' ? geneColors : null);
    return (gname && m && m.get(gname)) || '';
  }
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
  function bpText(v) { return (v < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' bp'; }
  function edgeName(e) { return e === 'center' ? 'Centre' : e === 'right' ? 'Right' : 'Left'; }

  // how many of the rule's tips are on screen, and how many have its gene
  function counts(df, rule) {
    var out = { tips: 0, have: 0 };
    if (typeof root === 'undefined' || !root) return out;
    var m = membersOf(rule), byAll = df.meta.byIdAll, col = geneColOf(df);
    root.leaves().forEach(function (l) {
      var k = norm(l.data.name);
      if (!m.has(k)) return;
      out.tips++;
      var recs = byAll && byAll.get(k);
      if (rule.g && recs && recs.some(function (r) { return String(r[col]) === rule.g; })) out.have++;
    });
    return out;
  }
  function countText(df, rule) {
    var c = counts(df, rule);
    return rule.g ? c.have + ' of ' + c.tips + ' tip' + (c.tips === 1 ? '' : 's') + ' have ' + esc(rule.g)
      : c.tips + ' tip' + (c.tips === 1 ? '' : 's') + ' · choose a gene to line up';
  }
  function sourceHtml(rule) {
    if (rule.t === 'clade') {
      var n = (rule.tips || []).length;
      return svg('tree') + '<span>Clade on the tree <b>' + esc(rule.tips[0] || '') + (n > 1 ? ' … ' + esc(rule.tips[n - 1]) : '') + '</b></span>';
    }
    var h = heatmapFor(rule);
    return svg('grid') + '<span>' + (h ? 'Heatmap ' + h.id : '<span class="ar-warn">Heatmap not loaded</span>') + ' · ' + esc(rule.col) + ' = <b>' + esc(rule.val) + '</b></span>';
  }
  // the one-line summary of a folded rule
  function summaryHtml(df, rule) {
    var c = counts(df, rule), dot = '<span class="ar-dot"> · </span>', line1, line2;
    if (!rule.g) line1 = '<span class="ar-sum-none">Choose a gene</span>';
    else {
      var bp = lastTarget.get(rule);
      var at = isPlace(rule.p) ? bpText(+rule.p) : (bp != null && df.alignByGeneEnabled ? bpText(bp) : '');
      line1 = '<span class="ar-sum-gene"><i style="background:' + esc(colourOf(df, rule.g) || 'var(--muted)') + '"></i>' + esc(rule.g) + '</span>' + dot + edgeName(rule.e) +
        (at ? dot + '<span title="' + (isPlace(rule.p) ? 'Set position' : 'Where the gene typically sits in these tips') + '">' + at + '</span>' : '');
    }
    line2 = '<span title="' + (rule.g ? c.have + ' of ' + c.tips + ' tips have ' + esc(rule.g) : c.tips + ' tips') + '">' + (rule.g ? c.have + ' of ' : '') + c.tips + ' tips</span>' +
      (rule.h && rule.h.length ? dot + '<span class="ar-sum-hide">' + rule.h.length + ' gene' + (rule.h.length === 1 ? '' : 's') + ' hidden</span>' : '');
    return '<span class="ar-sum-l">' + line1 + '</span><span class="ar-sum-l">' + line2 + '</span>';
  }
  // an empty "Place at" shows where the typical spot came out
  function showPlaces(card) {
    var df = dfOf(card);
    if (!df) return;
    Array.prototype.forEach.call(card.querySelectorAll('.align-rules .ar-rule'), function (row) {
      var r = rulesOf(df)[+row.getAttribute('data-i')], inp = row.querySelector('.ar-place');
      if (!r || !inp) return;
      var bp = lastTarget.get(r);
      inp.placeholder = r.g && bp != null && df.alignByGeneEnabled ? String(Math.round(bp)) : '';
      inp.title = 'Empty: the gene goes where it typically sits in these tips' + (bp != null && r.g ? ' (' + Math.round(bp) + ' bp)' : '') + '. A number puts it there exactly, e.g. 0.';
      var sum = row.querySelector('.ar-sum'); if (sum) sum.innerHTML = summaryHtml(df, r);
    });
  }
  // an edit inside one rule: its controls stay (focus), only its texts change
  function edited(card, df, i) {
    save(card, df);
    var row = card.querySelector('.align-rules .ar-rule[data-i="' + i + '"]'), r = rulesOf(df)[i];
    if (row && r) {
      var cnt = row.querySelector('.ar-count'); if (cnt) cnt.innerHTML = countText(df, r);
      row.style.setProperty('--ar-c', colourOf(df, r.g) || 'var(--border)');
      Array.prototype.forEach.call(row.querySelectorAll('.ar-chip'), function (c) { c.setAttribute('aria-pressed', String((r.h || []).indexOf(c.getAttribute('data-gene')) >= 0)); });
    }
    redraw(card);
  }

  function render(card) {
    var box = card && card.querySelector('.align-rules');
    var df = dfOf(card);
    if (!box || !df || !df.meta) return;
    var rules = rulesOf(df), genes = genesOf(df), folded = !!df._arFolded;
    box.classList.toggle('is-off', !df.alignByGeneEnabled);
    box.classList.toggle('is-folded', folded);
    var html = '<div class="ar-head">' +
      '<button type="button" class="ar-fold" aria-expanded="' + !folded + '" title="' + (folded ? 'Show' : 'Hide') + ' the rules">' + svg('chev', 14) + '</button>' +
      '<span class="ar-title">Group rules</span>' + (rules.length ? '<span class="ar-badge">' + rules.length + '</span>' : '') +
      '<button type="button" class="ar-add" aria-haspopup="menu">' + svg('plus', 13) + '<span>Add rule</span></button></div>';
    html += '<div class="ar-body"' + (folded ? ' hidden' : '') + '>';
    if (!df.alignByGeneEnabled) html += '<p class="ar-note">Rules apply while <b>Align bars by gene</b> is on.</p>';
    if (!rules.length) {
      html += '<div class="ar-empty">' + svg('layers', 18) + '<div><b>Line up each group on its own gene</b>' +
        '<span>Pick a clade on the tree, or make one rule per value of a heatmap column (e.g. Clade 1–4). Tips without the rule’s gene stay on the gene above.</span></div></div>';
    } else {
      html += '<ol class="ar-list">';
      rules.forEach(function (r, i) {
        var open = openRules.has(r), name = 'ar-edge-' + (++uid);
        html += '<li class="ar-rule' + (open ? ' is-open' : '') + '" data-i="' + i + '" style="--ar-c:' + esc(colourOf(df, r.g) || 'var(--border)') + '">' +
          '<div class="ar-row">' +
            '<span class="ar-num" title="Earlier rules win">' + (i + 1) + '</span>' +
            '<div class="ar-main"><input type="text" class="ar-name" value="' + esc(r.n || '') + '" placeholder="Rule ' + (i + 1) + '" aria-label="Rule name" spellcheck="false">' +
              '<div class="ar-sum">' + summaryHtml(df, r) + '</div></div>' +
            '<button type="button" class="ar-btn ar-expand" aria-expanded="' + open + '" title="' + (open ? 'Fold' : 'Edit') + ' rule" aria-label="' + (open ? 'Fold' : 'Edit') + ' rule">' + svg('chev', 14) + '</button>' +
          '</div>' +
          '<div class="ar-edit"' + (open ? '' : ' hidden') + '>' +
            '<div class="ar-src">' + sourceHtml(r) + '</div>' +
            '<div class="ar-meta"><span class="ar-count">' + countText(df, r) + '</span>' +
              (r.t === 'clade' ? '<button type="button" class="ar-link ar-reclade" title="Replace this rule\'s tips with the clade selected on the tree">Use selected clade</button>' : '') + '</div>' +
            '<div class="ar-grid">' +
              '<label class="ar-label">Gene</label><select class="pro-select ar-gene">' +
                '<option value="">Choose a gene…</option>' +
                genes.map(function (gname) { return '<option value="' + esc(gname) + '"' + (gname === r.g ? ' selected' : '') + '>' + esc(gname) + '</option>'; }).join('') +
              '</select>' +
              '<span class="ar-label">Anchor</span><span class="pro-radio-seg" role="radiogroup" aria-label="Rule anchor">' +
                EDGES.map(function (e) { return '<label><input type="radio" class="ar-edge" name="' + name + '" value="' + e[0] + '"' + ((r.e || 'left') === e[0] ? ' checked' : '') + '><span>' + e[1] + '</span></label>'; }).join('') +
              '</span>' +
              '<label class="ar-label">Place at</label><span class="ar-place-wrap"><span class="pro-num-wrap"><input type="number" step="1" class="pro-num ar-place" value="' + (isPlace(r.p) ? esc(r.p) : '') + '" placeholder="" aria-label="Position of the gene edge (empty: where it typically sits)"><span class="pro-unit">bp</span></span>' +
                (isPlace(r.p) ? '<button type="button" class="ar-link ar-typical" title="Back to where the gene typically sits">Use typical</button>' : '<span class="ar-typ" title="Where the gene typically sits in these tips. Type a number to set it.">typical</span>') + '</span>' +
            '</div>' +
            '<div class="ar-hide"><span class="ar-label">Hide in these tips</span><div class="ar-chips">' +
              genes.map(function (gname) {
                var on = (r.h || []).indexOf(gname) >= 0;
                return '<button type="button" class="ar-chip" data-gene="' + esc(gname) + '" aria-pressed="' + on + '" title="' + (on ? 'Show' : 'Hide') + ' ' + esc(gname) + ' in these tips"><i style="background:' + esc(colourOf(df, gname) || 'var(--muted)') + '"></i>' + esc(gname) + '</button>';
              }).join('') + '</div></div>' +
            '<div class="ar-actions">' +
              '<button type="button" class="ar-act ar-up" title="Earlier rules win"' + (i ? '' : ' disabled') + '>' + svg('up', 12) + '<span>Up</span></button>' +
              '<button type="button" class="ar-act ar-down"' + (i < rules.length - 1 ? '' : ' disabled') + '>' + svg('down', 12) + '<span>Down</span></button>' +
              '<button type="button" class="ar-act ar-del">' + svg('trash', 12) + '<span>Remove</span></button>' +
            '</div>' +
          '</div></li>';
      });
      html += '</ol><p class="ar-foot">The first rule that covers a tip and whose gene the tip has places it; that gene lines up where it typically sits in the group, or at the bp you set.</p>';
    }
    html += '</div>';
    box.innerHTML = html;
  }

  // the "Add rule" choices: the selected clade, and each value of each heatmap column with few values
  function addChoices() {
    var out = [];
    var node = (typeof highlightedClade !== 'undefined') ? highlightedClade : null;
    var tips = node ? cladeTips(node) : [];
    out.push({ group: 'From the tree', icon: 'tree', label: 'Selected clade', note: tips.length > 1 ? tips.length + ' tips' : 'Select a clade on the tree first', off: tips.length < 2, make: function () { return [{ t: 'clade', tips: tips, n: '' }]; } });
    heatmapList().forEach(function (x) {
      var d = x.hm.data;
      d.columns.forEach(function (col) {
        if (col === d.idCol) return;
        var cnt = new Map(), numeric = true;
        d.rows.forEach(function (r) {
          var v = String(r[col] == null ? '' : r[col]).trim();
          if (!v) return;
          if (numeric && !isFinite(+v)) numeric = false;
          cnt.set(v, (cnt.get(v) || 0) + 1);
        });
        if (!cnt.size || cnt.size > MAX_VALUES || (numeric && cnt.size > 12)) return;
        var vals = Array.from(cnt.keys()).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
        var group = 'Heatmap ' + x.id + ' · ' + col;
        out.push({ group: group, icon: 'layers', label: 'One rule per value', note: vals.length + ' rules: ' + vals.slice(0, 3).join(', ') + (vals.length > 3 ? '…' : ''), strong: true,
          make: function () { return vals.map(function (v) { return { t: 'value', hm: x.id, col: col, val: v, n: v }; }); } });
        vals.forEach(function (v) { out.push({ group: group, icon: 'grid', label: v, note: cnt.get(v) + ' tips', make: function () { return [{ t: 'value', hm: x.id, col: col, val: v, n: v }]; } }); });
      });
    });
    if (out.length === 1) out.push({ group: 'From a heatmap', icon: 'grid', label: 'No heatmap column with groups', note: 'Load a heatmap with a column such as Clade', off: true });
    return out;
  }

  // the menu under "Add rule"
  var menu = null;
  function closeMenu() {
    if (!menu) return;
    if (menu.anchor) menu.anchor.setAttribute('aria-expanded', 'false');
    if (menu.el.parentNode) menu.el.parentNode.removeChild(menu.el);
    menu = null;
  }
  function openMenu(btn) {
    closeMenu();
    var ch = addChoices(), el = document.createElement('div'), html = '', group = null;
    el.className = 'pro-menu ar-menu';
    el.setAttribute('role', 'menu');
    ch.forEach(function (c, i) {
      if (c.group !== group) { if (group !== null) html += '<div class="pro-menu-sep" role="separator"></div>'; html += '<div class="ar-menu-label">' + esc(c.group) + '</div>'; group = c.group; }
      html += '<button type="button" role="menuitem" class="pro-menu-item ar-menu-item' + (c.strong ? ' is-strong' : '') + '" data-c="' + i + '"' + (c.off ? ' disabled' : '') + '>' +
        svg(c.icon, 15) + '<span class="pro-menu-text"><b>' + esc(c.label) + '</b><small>' + esc(c.note) + '</small></span></button>';
    });
    el.innerHTML = html;
    document.body.appendChild(el);
    btn.setAttribute('aria-expanded', 'true');
    menu = { el: el, anchor: btn, card: cardOf(btn), choices: ch, w: Math.max(250, el.offsetWidth), h: el.offsetHeight };
    placeMenu();
    var first = el.querySelector('.ar-menu-item:not([disabled])'); if (first) first.focus();
  }
  // under the button (above it when there is no room), following it while the panel scrolls
  function placeMenu() {
    if (!menu) return;
    var el = menu.el, r = menu.anchor.getBoundingClientRect(), w = menu.w;
    if (!r.width || r.bottom < 0 || r.top > window.innerHeight) { closeMenu(); return; }
    var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    var below = window.innerHeight - r.bottom - 12, above = r.top - 12, top;
    if (below < Math.min(menu.h, 220) && above > below) { var hh = Math.min(menu.h, above); el.style.maxHeight = hh + 'px'; top = r.top - 4 - hh; }
    else { el.style.maxHeight = Math.max(120, below) + 'px'; top = r.bottom + 4; }
    el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px'; el.style.width = w + 'px';
  }
  document.addEventListener('mousedown', function (ev) {
    if (menu && !menu.el.contains(ev.target) && !menu.anchor.contains(ev.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (!menu) return;
    if (ev.key === 'Escape') { var a = menu.anchor; closeMenu(); a.focus(); ev.preventDefault(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    var its = Array.prototype.slice.call(menu.el.querySelectorAll('.ar-menu-item:not([disabled])')), i = its.indexOf(document.activeElement);
    if (its.length) { its[(i + (ev.key === 'ArrowDown' ? 1 : its.length - 1) + its.length) % its.length].focus(); ev.preventDefault(); }
  });
  window.addEventListener('resize', placeMenu);
  document.addEventListener('scroll', function (ev) { if (menu && ev.target !== menu.el) placeMenu(); }, true);

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
    if (/^metaAlignEnable\d+$/.test(t.id || '')) { var c0 = cardOf(t); if (c0) setTimeout(function () { render(c0); showPlaces(c0); }, 0); return; }
    if (!t.closest('.align-rules')) return;
    var x = ruleOf(t);
    if (!x.df || !x.rule) return;
    if (t.classList.contains('ar-gene')) x.rule.g = t.value || '';
    else if (t.classList.contains('ar-edge')) x.rule.e = t.value;
    else if (t.classList.contains('ar-name')) { x.rule.n = t.value; save(x.card, x.df); return; }
    else if (t.classList.contains('ar-place')) {
      var had = isPlace(x.rule.p);
      x.rule.p = t.value.trim() === '' || !isFinite(+t.value) ? '' : +t.value;
      if (had !== isPlace(x.rule.p)) { changed(x.card, x.df); return; }   // the "Typical" button comes or goes
    } else return;
    edited(x.card, x.df, x.i);
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    // a menu choice
    var item = t.closest('.ar-menu-item');
    if (item && menu) {
      ev.preventDefault();
      var m = menu, c = m.choices[+item.getAttribute('data-c')];
      closeMenu();
      var df0 = dfOf(m.card);
      if (!c || c.off || !df0) return;
      var made = c.make();
      made.forEach(function (r) { rulesOf(df0).push(r); });
      if (made.length === 1) openRules.add(made[0]);
      df0._arFolded = false;
      changed(m.card, df0);
      var last = m.card.querySelector('.ar-rule:last-child .ar-gene'); if (last && made.length === 1) last.focus();
      return;
    }
    if (!t.closest('.align-rules')) return;
    var card = cardOf(t), df = dfOf(card);
    if (!df) return;
    if (t.closest('.ar-fold')) { df._arFolded = !df._arFolded; render(card); showPlaces(card); return; }
    if (t.closest('.ar-add')) { var btn = t.closest('.ar-add'); if (menu && menu.anchor === btn) closeMenu(); else openMenu(btn); return; }
    var x = ruleOf(t);
    if (!x.rule) return;
    var rules = rulesOf(df), b = t.closest('button');
    if (b && b.classList.contains('ar-chip')) {
      var h = new Set(x.rule.h || []), gname = b.getAttribute('data-gene');
      if (h.has(gname)) h.delete(gname); else h.add(gname);
      x.rule.h = Array.from(h);
      edited(card, df, x.i);
      return;
    }
    if (b && b.classList.contains('ar-del')) rules.splice(x.i, 1);
    else if (b && b.classList.contains('ar-up') && x.i > 0) { rules.splice(x.i - 1, 0, rules.splice(x.i, 1)[0]); }
    else if (b && b.classList.contains('ar-down') && x.i < rules.length - 1) { rules.splice(x.i + 1, 0, rules.splice(x.i, 1)[0]); }
    else if (b && b.classList.contains('ar-typical')) x.rule.p = '';
    else if (b && b.classList.contains('ar-reclade')) {
      var node = (typeof highlightedClade !== 'undefined') ? highlightedClade : null;
      var tips = node ? cladeTips(node) : [];
      if (tips.length < 2) { if (typeof setStatus === 'function') setStatus('Select a clade on the tree first'); return; }
      x.rule.tips = tips;
    } else if ((b && b.classList.contains('ar-expand')) || (!b && t.closest('.ar-row') && !t.closest('input'))) {
      if (openRules.has(x.rule)) openRules.delete(x.rule); else openRules.add(x.rule);
      var row = t.closest('.ar-rule'), open = openRules.has(x.rule), ex = row.querySelector('.ar-expand');
      row.classList.toggle('is-open', open);
      row.querySelector('.ar-edit').hidden = !open;
      ex.setAttribute('aria-expanded', String(open)); ex.title = (open ? 'Fold' : 'Edit') + ' rule'; ex.setAttribute('aria-label', ex.title);
      return;
    } else return;
    changed(card, df);
  });

  // a heatmap loaded or removed changes what value rules cover (a session puts the dataframe
  // card back before its heatmaps): draw every card's rules again
  function refreshAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[id^="dataframeCard"] .align-rules'), function (box) {
      var card = cardOf(box);
      if (card && dfOf(card)) { render(card); showPlaces(card); }
    });
  }
  ['handleHeatmapFile', 'deleteHeatmapCard'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var r = orig.apply(this, arguments);
      Promise.resolve(r).then(function () { setTimeout(refreshAll, 0); });
      return r;
    };
  });

  window.tmAlignRules = {
    refreshAll: refreshAll,
    plan: plan,
    // the card was filled (a file was loaded): draw its rules
    refresh: function (dataframeId) { var card = document.getElementById('dataframeCard' + dataframeId); if (card) { render(card); setTimeout(function () { showPlaces(card); }, 0); } },
    _membersOf: membersOf
  };
})();
