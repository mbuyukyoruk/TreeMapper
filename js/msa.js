// Sequence alignment layers (loaded after app.js, before session.js).
//
// An alignment file (FASTA, Clustal, Stockholm, PHYLIP, or a two-column table of
// accession + aligned sequence) is shown as a column after the charts: one row per tip,
// one box per aligned residue or nucleotide at its alignment column, gaps left empty.
// The card sets the colours (residue colours or grey), a reference sequence (found with
// the card's find box) and its positions, numbered along the reference without gaps
// (sequence positions) or with them (alignment columns). Picked positions highlight
// their alignment columns: always in residue colours, with a band, and optionally at a
// width of their own so that the region stands out.
//
// The drawing is a few pictures (one pixel per cell, scaled up without smoothing), so
// large alignments draw quickly and export as part of the SVG. The highlighted columns
// are kept as alignment columns; a reference position is converted to its column.
(function () {
  'use strict';

  // --------------------------------------------------------------- parsing
  var HEADER_WORDS = /^(id|ids|name|names|accession|accessions|molecule|molecules|seq|seqs|sequence|sequences|alignment|aligned|taxon|taxa|label|tip)$/i;

  function splitLines(text) { return String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/); }

  // [{ id, raw, line }] from the text, plus the format's name
  function readRecords(text) {
    var lines = splitLines(text), i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    var first = (lines[i] || '').trim();
    if (!first) return { format: 'empty', recs: [] };
    if (first.charAt(0) === '>') return { format: 'FASTA', recs: readFasta(lines) };
    if (/^#\s*STOCKHOLM/i.test(first)) return { format: 'Stockholm', recs: readBlocks(lines, i + 1, true) };
    if (/^(CLUSTAL|MUSCLE|PROBCONS|T-COFFEE|MAFFT|KALIGN)/i.test(first)) return { format: 'Clustal', recs: readBlocks(lines, i + 1, false) };
    if (/^\d+\s+\d+(\s+\S.*)?$/.test(first)) {
      var ph = readPhylip(lines, i);
      if (ph) return { format: 'PHYLIP', recs: ph };
    }
    return { format: 'table', recs: readTable(lines) };
  }
  function readFasta(lines) {
    var recs = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.charAt(0) === '>') {
        var id = l.slice(1).trim().split(/\s+/)[0] || ('sequence_' + (recs.length + 1));
        cur = { id: id, raw: '', line: i + 1 };
        recs.push(cur);
      } else if (cur && l.charAt(0) !== ';') cur.raw += l.replace(/\s+/g, '');
    }
    return recs;
  }
  // Clustal / Stockholm: blocks of "id  sequence-part" lines
  function readBlocks(lines, from, stockholm) {
    var byId = new Map(), recs = [];
    for (var i = from; i < lines.length; i++) {
      var l = lines[i];
      if (!l.trim()) continue;
      if (stockholm && (l.charAt(0) === '#' || l.trim() === '//')) continue;
      if (/^\s/.test(l)) continue;   // Clustal conservation line (*, :, .)
      var m = /^(\S+)\s+(\S+)(?:\s+\d+)?\s*$/.exec(l);
      if (!m) continue;
      var r = byId.get(m[1]);
      if (!r) { r = { id: m[1], raw: '', line: i + 1 }; byId.set(m[1], r); recs.push(r); }
      r.raw += m[2];
    }
    return recs;
  }
  // PHYLIP: sequential or interleaved, relaxed (names end at a space) or strict (10 characters)
  function readPhylip(lines, at) {
    var hm = /^(\d+)\s+(\d+)/.exec(lines[at].trim());
    var n = +hm[1], L = +hm[2];
    if (!n || !L) return null;
    var body = [];
    for (var i = at + 1; i < lines.length; i++) if (lines[i].trim()) body.push({ t: lines[i], line: i + 1 });
    if (body.length < n) return null;
    function named(b) {
      var t = b.t.replace(/^\s+/, '');
      var m = /^(\S+)\s+(.*)$/.exec(t);
      if (m) return { id: m[1], raw: m[2].replace(/\s+/g, ''), line: b.line };
      return { id: t.slice(0, 10).trim(), raw: t.slice(10).replace(/\s+/g, ''), line: b.line };
    }
    function clean(b) { return b.t.replace(/\s+/g, ''); }
    // sequential: a sequence continues on the next lines until it is complete
    var seq = [], k = 0;
    while (k < body.length && seq.length <= n) {
      var r = named(body[k++]);
      while (r.raw.length < L && k < body.length) r.raw += clean(body[k++]);
      seq.push(r);
    }
    if (seq.length === n && k === body.length && seq.every(function (x) { return x.raw.length === L; })) return seq;
    // interleaved: names in the first block, then the blocks follow in the same order
    var rows = [];
    for (var j = 0; j < n; j++) rows.push(named(body[j]));
    for (var q = n; q < body.length; q++) rows[(q - n) % n].raw += clean(body[q]);
    return rows;
  }
  // a table: accession, then the aligned sequence (tab, comma or spaces between them)
  function readTable(lines) {
    var rows = [];
    lines.forEach(function (l, i) { if (l.trim() && l.charAt(0) !== '#') rows.push({ t: l, line: i + 1 }); });
    if (!rows.length) return [];
    var sep = rows[0].t.indexOf('\t') >= 0 ? '\t' : (rows[0].t.indexOf(',') >= 0 ? ',' : null);
    var cells = rows.map(function (r) {
      var c = sep ? r.t.split(sep) : r.t.trim().split(/\s+/);
      return c.map(function (x) { return x.trim().replace(/^"(.*)"$/, '$1'); });
    });
    // the sequence column: the one with the longest values (after the first)
    var width = cells.reduce(function (m, c) { return Math.max(m, c.length); }, 0), best = 1, bestLen = -1;
    for (var col = 1; col < width; col++) {
      var tot = 0, cnt = 0;
      for (var r2 = 0; r2 < Math.min(cells.length, 50); r2++) if (cells[r2][col] !== undefined) { tot += cells[r2][col].length; cnt++; }
      if (cnt && tot / cnt > bestLen) { bestLen = tot / cnt; best = col; }
    }
    var recs = cells.map(function (c, i) { return { id: c[0] || '', raw: (c[best] || '').replace(/\s+/g, ''), line: rows[i].line }; });
    // a header row
    if (recs.length && (HEADER_WORDS.test(recs[0].id) || HEADER_WORDS.test(recs[0].raw))) recs[0].header = true;
    return recs;
  }

  var RESIDUE_RE = /^[A-Z*\-]+$/;
  // the alignment: accepted rows, skipped rows (with the reason), length, type
  function parseAlignment(text) {
    var read = readRecords(text), recs = read.recs.filter(function (r) { return !r.header; });
    var skipped = [], ok = [];
    recs.forEach(function (r) {
      var s = r.raw.replace(/[.~?]/g, '-').toUpperCase();
      if (!r.id) { skipped.push({ id: '(no name)', line: r.line, why: 'no accession' }); return; }
      if (!s) { skipped.push({ id: r.id, line: r.line, why: 'no sequence' }); return; }
      if (!RESIDUE_RE.test(s)) { skipped.push({ id: r.id, line: r.line, why: 'not a sequence: "' + (r.raw.length > 24 ? r.raw.slice(0, 24) + '…' : r.raw) + '"' }); return; }
      ok.push({ id: r.id, seq: s, line: r.line });
    });
    // the alignment length: the most common row length
    var lens = new Map();
    ok.forEach(function (r) { lens.set(r.seq.length, (lens.get(r.seq.length) || 0) + 1); });
    var L = 0, best = -1;
    lens.forEach(function (c, len) { if (c > best || (c === best && len > L)) { best = c; L = len; } });
    var ids = [], seqs = [], byAcc = new Map();
    ok.forEach(function (r) {
      if (r.seq.length !== L) { skipped.push({ id: r.id, line: r.line, why: 'length ' + r.seq.length + ', the alignment has ' + L + ' columns' }); return; }
      var key = normalizeAccession(r.id);
      if (byAcc.has(key)) { skipped.push({ id: r.id, line: r.line, why: 'the same accession again (the first one is used)' }); return; }
      byAcc.set(key, ids.length); ids.push(r.id); seqs.push(r.seq);
    });
    skipped.sort(function (a, b) { return a.line - b.line; });
    // nucleotides or amino acids
    var nuc = 0, all = 0;
    for (var i = 0; i < seqs.length && all < 200000; i++) {
      var s = seqs[i];
      for (var j = 0; j < s.length; j++) {
        var ch = s.charCodeAt(j);
        if (ch === 45) continue;
        all++;
        if (ch === 65 || ch === 67 || ch === 71 || ch === 84 || ch === 85 || ch === 78) nuc++;
      }
    }
    var type = all && nuc / all >= 0.9 ? 'nucleotide' : 'protein';
    return { format: read.format, ids: ids, seqs: seqs, byAcc: byAcc, L: L, type: type, skipped: skipped };
  }

  // ------------------------------------------------------------- colours
  // Colour schemes (as in Jalview / Clustal X); each group of residues can also be given
  // a colour of its own in the card (kept per scheme).
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  var PROTEIN_GROUPS = [
    ['Hydrophobic', 'AILMFWV', '#80a0f0'], ['Positive', 'KR', '#f01505'], ['Negative', 'DE', '#c048c0'],
    ['Polar', 'NQST', '#15c015'], ['Cysteine', 'C', '#f08080'], ['Glycine', 'G', '#f09048'],
    ['Proline', 'P', '#c0c000'], ['Aromatic', 'HY', '#15a4a4']
  ];
  var NUC_GROUPS = [['A', 'A', '#3cb44b'], ['C', 'C', '#4363d8'], ['G', 'G', '#f5a623'], ['T / U', 'TU', '#e6194b']];
  var OTHER_COLOR = '#bdbdbd', GREY = '#a3a3a3';
  function perResidue(map) { return Object.keys(map).map(function (k) { return [k, k, map[k]]; }); }
  var SCHEMES = {
    protein: [
      { key: 'clustal', label: 'Clustal', groups: PROTEIN_GROUPS },
      { key: 'zappo', label: 'Zappo (physico-chemical)', groups: [['Aliphatic', 'ILVAM', '#ffafaf'], ['Aromatic', 'FWY', '#ffc800'], ['Positive', 'KRH', '#6464ff'],
        ['Negative', 'DE', '#ff0000'], ['Hydrophilic', 'STNQ', '#00ff00'], ['Conformational', 'PG', '#ff00ff'], ['Cysteine', 'C', '#ffff00']] },
      { key: 'taylor', label: 'Taylor (each residue)', groups: perResidue({ A: '#ccff00', R: '#0000ff', N: '#cc00ff', D: '#ff0000', C: '#ffff00', Q: '#ff00cc', E: '#ff0066',
        G: '#ff9900', H: '#0066ff', I: '#66ff00', L: '#33ff00', K: '#6600ff', M: '#00ff00', F: '#00ff66', P: '#ffcc00', S: '#ff3300', T: '#ff6600', W: '#00ccff', Y: '#00ffcc', V: '#99ff00' }) },
      { key: 'hydro', label: 'Hydrophobicity (Kyte-Doolittle)', groups: perResidue({ I: '#ff0000', V: '#f60009', L: '#ea0015', F: '#cb0034', C: '#c2003d', M: '#b0004f', A: '#ad0052',
        G: '#6a0095', T: '#61009e', S: '#5e00a1', W: '#5b00a4', Y: '#4f00b0', P: '#4600b9', H: '#1500ea', E: '#0c00f3', Q: '#0c00f3', D: '#0c00f3', N: '#0c00f3', K: '#0000ff', R: '#0000ff' }) }
    ],
    nucleotide: [
      { key: 'nuc', label: 'Nucleotides', groups: NUC_GROUPS },
      { key: 'purpyr', label: 'Purine / pyrimidine', groups: [['Purine (A, G)', 'AG', '#ff83fa'], ['Pyrimidine (C, T, U)', 'CTU', '#40e0d0']] }
    ]
  };
  var AA3 = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys',
    M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', X: 'any', B: 'Asx', Z: 'Glx', U: 'Sec', O: 'Pyl', '*': 'stop' };
  function rgba32(c) { var v = hex(c); return ((255 << 24) | (v[2] << 16) | (v[1] << 8) | v[0]) >>> 0; }
  function schemeOf(m) {
    var list = SCHEMES[m.type] || SCHEMES.protein;
    return list.filter(function (x) { return x.key === m.scheme; })[0] || list[0];
  }
  // the groups of the layer's scheme with their colours now: [{ label, letters, color, base }],
  // then "Other" (any other letter) and "Grey" (boxes when residue colours are off)
  function colourGroups(m) {
    var sc = schemeOf(m), cu = (m.custom && m.custom[sc.key]) || {};
    var out = sc.groups.map(function (g) { return { key: g[1], label: g[0] === g[1] ? g[0] + (m.type === 'protein' && AA3[g[0]] ? ' (' + AA3[g[0]] + ')' : '') : g[0] + ' (' + g[1].split('').join(', ') + ')', letters: g[1], color: cu[g[1]] || g[2], base: g[2] }; });
    out.push({ key: 'other', label: 'Other', letters: '', color: cu.other || OTHER_COLOR, base: OTHER_COLOR });
    out.push({ key: 'grey', label: 'Grey (colours off)', letters: '', color: cu.grey || GREY, base: GREY, grey: true });
    return out;
  }
  function lutOf(m) {
    var sig = m.type + '|' + JSON.stringify(m.custom || {}) + '|' + m.scheme;
    if (m._lut && m._lut.sig === sig) return m._lut;
    var css = new Array(128).fill(null), px = new Uint32Array(128), groups = colourGroups(m);
    var other = groups.filter(function (g) { return g.key === 'other'; })[0].color;
    for (var ch = 65; ch <= 90; ch++) { css[ch] = other; px[ch] = rgba32(other); }
    css[42] = other; px[42] = rgba32(other);
    groups.forEach(function (g) { for (var i = 0; i < g.letters.length; i++) { var c = g.letters.charCodeAt(i); css[c] = g.color; px[c] = rgba32(g.color); } });
    var grey = groups.filter(function (g) { return g.grey; })[0].color;
    m._lut = { sig: sig, css: css, px: px, grey: rgba32(grey), greyCss: grey };
    return m._lut;
  }
  function residueColor(m, ch) { return lutOf(m).css[ch.charCodeAt(0)] || OTHER_COLOR; }
  function accentColor() { return (typeof cssVar === 'function' && cssVar('--accent')) || '#0B8276'; }

  // ---------------------------------------------------------- the model
  // msas (app.js): id -> layer. Ids are 1..n in card order (the panels are in that order).
  function residueName(m, ch) {
    if (ch === '-') return 'gap';
    if (m.type === 'protein') return ch + (AA3[ch] ? ' (' + AA3[ch] + ')' : '');
    return ch;
  }
  // sequence position (1-based) of each column of a row; 0 at a gap
  function positionsOf(m, row) {
    if (!m._pos) m._pos = new Map();
    var p = m._pos.get(row);
    if (p) return p;
    var s = m.seqs[row], out = new Int32Array(m.L + 1), u = 0;
    for (var c = 1; c <= m.L; c++) { if (s.charCodeAt(c - 1) !== 45) out[c] = ++u; }
    m._pos.set(row, out);
    if (m._pos.size > 64) m._pos.delete(m._pos.keys().next().value);
    return out;
  }
  function refRow(m) { return m.ref != null && m.byAcc.has(normalizeAccession(m.ref)) ? m.byAcc.get(normalizeAccession(m.ref)) : -1; }
  // Tip names and alignment names are matched exactly; failing that, without a RefSeq
  // "NZ_" prefix, then without the version (".1"), then without both - each only when it
  // leaves exactly one sequence (CP012345.1 = NZ_CP012345.1 = CP012345).
  var LOOSE = [
    function (s) { return s.replace(/^NZ_/, ''); },
    function (s) { return s.replace(/\.\d+$/, ''); },
    function (s) { return s.replace(/^NZ_/, '').replace(/\.\d+$/, ''); }
  ];
  function plainName(s) { return String(s == null ? '' : s).trim().replace(/^["']|["']$/g, '').toUpperCase(); }
  function looseKey(s) { return LOOSE[2](plainName(s)); }
  function indexNames(m) {
    m.loose = LOOSE.map(function () { return new Map(); });
    m.ids.forEach(function (id, i) {
      var n = plainName(id);
      LOOSE.forEach(function (f, j) { var k = f(n); m.loose[j].set(k, m.loose[j].has(k) && m.loose[j].get(k) !== i ? -2 : i); });
    });
    m.skippedBy = new Map();
    m.skipped.forEach(function (s) { if (s.id && s.id !== '(no name)') { m.skippedBy.set(normalizeAccession(s.id), s.why); m.skippedBy.set('~' + looseKey(s.id), s.why); } });
    m._rowOf = new Map();
  }
  // the sequence row of a tip (-1: none)
  function rowForName(m, name) {
    var key = normalizeAccession(name);
    var hit = m._rowOf.get(key);
    if (hit !== undefined) return hit;
    var r = m.byAcc.get(key);
    if (r === undefined) {
      r = -1;
      var n = plainName(key);
      // the tip's name loosened the same way: the same name
      for (var j = 0; j < LOOSE.length && r < 0; j++) {
        var v = m.loose[j].get(LOOSE[j](n));
        if (v >= 0) r = v;
      }
    }
    m._rowOf.set(key, r);
    return r;
  }
  // why a tip has no sequence
  function noSequenceReason(m, name) {
    var key = normalizeAccession(name);
    var why = m.skippedBy.get(key) || m.skippedBy.get('~' + looseKey(key));
    if (why) return 'its row in the file was skipped (' + why + ')';
    if (m.loose.some(function (mp, j) { return mp.get(LOOSE[j](plainName(key))) === -2; })) return 'more than one sequence has a similar name (with and without NZ_ or a version)';
    return 'not in the alignment file';
  }
  // tips of the tree: [{ name, row }]
  function tipRows(m) {
    if (typeof root === 'undefined' || !root) return [];
    return root.leaves().filter(function (l) { return !(typeof droppedNodes !== 'undefined' && droppedNodes.has(l)); })
      .map(function (l) { return { name: String(l.data.name), row: rowForName(m, l.data.name) }; });
  }
  // the column of sequence position u of a row (0 if there is none)
  function columnOfPosition(m, row, u) {
    var p = positionsOf(m, row);
    for (var c = 1; c <= m.L; c++) if (p[c] === u) return c;
    return 0;
  }
  function selectedSorted(m) { return Array.from(m.selected).filter(function (c) { return c >= 1 && c <= m.L; }).sort(function (a, b) { return a - b; }); }
  function runsOf(list) {
    var out = [];
    list.forEach(function (c) { var l = out[out.length - 1]; if (l && c === l[1] + 1) l[1] = c; else out.push([c, c]); });
    return out;
  }

  // the width wanted for a highlighted column: its own (set per group in the card), else
  // the default for highlighted columns; 0 = the normal width
  function wantedWidth(m, c) {
    var own = m.colWidth && m.colWidth[c];
    return own > 0 ? own : (m.hiWidth > 0 ? m.hiWidth : 0);
  }
  // the x layout of the columns in a width W: highlighted columns may have widths of their
  // own (together at most 85% of W; scaled down to fit), the others share the rest
  function columnLayout(m, W) {
    var L = m.L, wide = new Float64Array(L + 1), nWide = 0, total = 0;
    m.selected.forEach(function (c) { if (c >= 1 && c <= L) { var w = wantedWidth(m, c); if (w > 0) { wide[c] = w; nWide++; total += w; } } });
    var f = 1;
    if (nWide && nWide === L) f = W / total;
    else if (total > W * 0.85) f = W * 0.85 / total;
    var ow = nWide < L ? (W - total * f) / (L - nWide) : 0;
    var starts = new Float64Array(L + 1), runs = [];
    for (var c = 1; c <= L; c++) {
      var w = wide[c] ? wide[c] * f : ow, isWide = !!wide[c];
      starts[c] = starts[c - 1] + w;
      var last = runs[runs.length - 1];
      // a run: neighbouring columns of the same width
      if (last && last.wide === isWide && Math.abs(last.w - w) < 1e-9) last.c1 = c; else runs.push({ c0: c, c1: c, wide: isWide, w: w });
    }
    return { starts: starts, runs: runs, ow: ow, hw: nWide ? (total * f) / nWide : 0, W: W };
  }
  function columnAt(lay, x) {
    var s = lay.starts, lo = 1, hi = s.length - 1;
    if (x < 0 || x >= s[hi]) return 0;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (s[mid] <= x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // ------------------------------------------------------------ pictures
  var MAX_TILE = 4096;
  var scratch = null;
  function pictureURL(w, h, fill) {
    if (!scratch) scratch = document.createElement('canvas');
    scratch.width = w; scratch.height = h;
    var ctx = scratch.getContext('2d');
    var img = ctx.createImageData(w, h);
    fill(new Uint32Array(img.data.buffer));
    ctx.putImageData(img, 0, 0);
    var url = scratch.toDataURL('image/png');
    scratch.width = 1; scratch.height = 1;
    return url;
  }
  // Per column how its boxes are coloured: 0 grey, 1 residue colours, 2 residue colours
  // only where the residue is the column's consensus (grey elsewhere). Highlighted
  // columns always keep their residue colours.
  // The consensus of a column (majority rule, as in AliView): the residue that the shown
  // sequences have most often there, when its share (gaps counted) reaches the threshold.
  var CONS_LEVELS = [[50, 'Majority (more than 50%)'], [70, 'At least 70%'], [90, 'At least 90%'], [100, 'Identical (100%)']];
  function consensusOf(m, rows) {
    var key = rows.join(',') + '|' + m.consLevel;
    if (m._cons && m._cons.key === key) return m._cons;
    var L = m.L, cons = new Uint8Array(L + 1), share = new Float32Array(L + 1), n = rows.length, cnt = new Int32Array(128);
    for (var c = 1; c <= L; c++) {
      cnt.fill(0);
      for (var i = 0; i < n; i++) cnt[m.seqs[rows[i]].charCodeAt(c - 1)]++;
      var best = 0, bc = 0, tie = false;
      for (var ch = 42; ch < 91; ch++) { if (ch === 45) continue; if (cnt[ch] > best) { best = cnt[ch]; bc = ch; tie = false; } else if (cnt[ch] === best && best) tie = true; }
      share[c] = n ? best / n : 0;
      var lv = m.consLevel || 50, okShare = lv === 50 ? share[c] > 0.5 : share[c] >= lv / 100 - 1e-9;
      if (best && !tie && okShare) cons[c] = bc;
    }
    m._cons = { key: key, cons: cons, share: share };
    return m._cons;
  }
  function colourPlan(m, rows) {
    var mode = new Uint8Array(m.L + 1);
    mode.fill(m.colorOn ? (m.consOn ? 2 : 1) : 0);
    m.selected.forEach(function (c) { if (c >= 1 && c <= m.L) mode[c] = 1; });
    return { mode: mode, cons: m.colorOn && m.consOn ? consensusOf(m, rows).cons : null };
  }
  function shownRows(rowOf) { var r = []; for (var i = 0; i < rowOf.length; i++) if (rowOf[i] >= 0) r.push(rowOf[i]); return r; }

  // -------------------------------------------------- drawing: rectangular
  // The rectangular picture: sharp tiles where the screen is - drawn at the screen's
  // resolution (zoom x device pixels: one picture pixel per screen pixel, so nothing is
  // scaled or smoothed) - over one picture of the whole column at a lower resolution (with
  // a hole where the sharp tiles are), for the parts off screen. Both are drawn again after
  // zooming or panning. Small columns are drawn sharp in one go. Every box is filled in
  // whole pixels: its edges are the column / row edges rounded to the picture's pixels, so
  // boxes neither overlap nor leave seams; boxes wide enough get a thin gap between them.
  var TILE_PX = 2048, FAR_PX = 6e6, EXPORT_PX = 64e6;
  function screenScale() { return (d3.zoomTransform(svg.node()).k || 1) * (window.devicePixelRatio || 1); }
  // the part of the drawing on screen (and a quarter screen around it), in drawing units
  function viewWindow() {
    var t = d3.zoomTransform(svg.node()), el = svg.node(), r = el.getBoundingClientRect();
    // (the part of the svg the canvas shows: the svg can be larger than its window)
    var cv = document.getElementById('canvas'), cr = cv ? cv.getBoundingClientRect() : r;
    var w = Math.max(r.width, cr.right - r.left) || 1000, h = Math.max(r.height, cr.bottom - r.top) || 800;
    var x0 = -t.x / t.k, y0 = -t.y / t.k, x1 = (w - t.x) / t.k, y1 = (h - t.y) / t.k, mx = (x1 - x0) / 4, my = (y1 - y0) / 4;
    return { x0: x0 - mx, x1: x1 + mx, y0: y0 - my, y1: y1 + my };
  }
  function renderRect(job, forExport) {
    var s = screenScale(), area = job.lay.W * job.H, all = { x0: 0, y0: 0, x1: job.lay.W, y1: job.H };
    if (!job.hi) { job.hi = job.pics.append('g').attr('class', 'msa-sharp'); job.lo = null; job.loTiles = []; job.hiTiles = new Map(); }
    var sHi = s, sLo = Math.min(s, Math.sqrt(FAR_PX / area)), rect;
    if (forExport) { sHi = Math.min(s, Math.max(sLo, Math.sqrt(EXPORT_PX / area))); rect = all; }
    else if (sLo >= s * 0.999) rect = all;
    else {
      var v = viewWindow();
      rect = { x0: Math.max(0, v.x0 - job.x0), x1: Math.min(job.lay.W, v.x1 - job.x0), y0: Math.max(0, v.y0 - job.top), y1: Math.min(job.H, v.y1 - job.top) };
      if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) rect = null;
    }
    // the sharp tiles (on a grid of TILE_PX picture pixels)
    var tu = TILE_PX / sHi, keep = new Set(), fresh = [];
    if (rect) {
      var i0 = Math.floor(rect.x0 / tu), i1 = Math.ceil(rect.x1 / tu), j0 = Math.floor(rect.y0 / tu), j1 = Math.ceil(rect.y1 / tu);
      rect = { x0: i0 * tu, y0: j0 * tu, x1: Math.min(job.lay.W, i1 * tu), y1: Math.min(job.H, j1 * tu) };
      for (var j = j0; j < j1; j++) for (var i = i0; i < i1; i++) {
        var key = i + ',' + j + '@' + sHi.toFixed(5);
        keep.add(key);
        if (job.hiTiles.has(key)) continue;
        var tile = { x0: i * tu, y0: j * tu, w: Math.min(tu, job.lay.W - i * tu), h: Math.min(tu, job.H - j * tu) };
        if (tile.w <= 0 || tile.h <= 0) continue;
        var el = drawPicture(job, job.hi, tile, sHi, null);
        job.hiTiles.set(key, el); if (el) fresh.push(el);
      }
    }
    var old = [];
    job.hiTiles.forEach(function (el, key) { if (!keep.has(key)) { if (el) old.push(el); job.hiTiles.delete(key); } });
    // the whole column at a lower resolution, with a hole for the sharp tiles
    var full = rect && rect.x0 <= 0 && rect.y0 <= 0 && rect.x1 >= job.lay.W && rect.y1 >= job.H;
    var loKey = full ? 'none' : sLo.toFixed(5) + '|' + (rect ? [rect.x0, rect.y0, rect.x1, rect.y1].map(function (q) { return q.toFixed(3); }).join(',') : '');
    if (loKey !== job.loKey) {
      job.loTiles.forEach(function (el) { if (el) old.push(el); });
      job.loTiles = [];
      if (!full) {
        if (!job.lo) job.lo = job.pics.insert('g', ':first-child').attr('class', 'msa-far');
        var tl = TILE_PX / sLo;
        for (var ty = 0; ty < job.H; ty += tl) for (var tx = 0; tx < job.lay.W; tx += tl)
        { var lt = drawPicture(job, job.lo, { x0: tx, y0: ty, w: Math.min(tl, job.lay.W - tx), h: Math.min(tl, job.H - ty) }, sLo, rect); job.loTiles.push(lt); if (lt) fresh.push(lt); }
      }
      job.loKey = loKey;
    }
    job.scale = sHi;
    // what was shown before goes once the new pictures are loaded (no blank frame while
    // the browser decodes them); at once for an export
    if (job.under) { old.push(d3.select(job.under)); job.under = null; }
    whenLoaded(fresh, forExport, function () { old.forEach(function (el) { el.remove(); }); });
  }
  // f() once every picture in `group` has loaded (or after a moment)
  // f() once the new pictures (d3 selections) have loaded, or after a moment
  function whenLoaded(fresh, now, f) {
    if (now || !fresh.length) { f(); return; }
    var left = fresh.length, done = false;
    var finish = function () { if (!done) { done = true; f(); } };
    fresh.forEach(function (sel) {
      var im = sel.node();
      if (im.__msaLoaded) { if (--left <= 0) finish(); return; }
      var one = function () { if (--left <= 0) finish(); };
      im.addEventListener('load', one, { once: true }); im.addEventListener('error', one, { once: true });
    });
    setTimeout(finish, 1500);
  }
  // one picture of the part `tile` (drawing units, from the column's top left) at s pixels
  // per unit; nothing is drawn inside `hole`
  function drawPicture(job, parent, tile, s, hole) {
    var m = job.m, lay = job.lay, L = m.L;
    var w = Math.max(1, Math.round(tile.w * s)), h = Math.max(1, Math.round(tile.h * s)), sx = w / tile.w, sy = h / tile.h;
    var cA = columnAt(lay, tile.x0) || 1, cB = columnAt(lay, Math.min(lay.W * (1 - 1e-12), tile.x0 + tile.w)) || L;
    var rows = [];
    for (var i = 0; i < job.leaves.length; i++) {
      if (job.rowOf[i] < 0) continue;
      var y = job.leaves[i].x - job.top, ya = Math.round((y - job.boxH / 2 - tile.y0) * sy), yb = Math.round((y + job.boxH / 2 - tile.y0) * sy);
      if (yb <= ya) yb = ya + 1;
      if (yb <= 0 || ya >= h) continue;
      rows.push([job.rowOf[i], Math.max(0, ya), Math.min(h, yb)]);
    }
    if (!rows.length || cB < cA) return null;
    var xa = new Int32Array(L + 1), xb = new Int32Array(L + 1);
    for (var c = cA; c <= cB; c++) {
      var a = Math.round((lay.starts[c - 1] - tile.x0) * sx), b = Math.round((lay.starts[c] - tile.x0) * sx);
      if (b <= a) b = a + 1;
      // wide boxes: a gap between them
      var fullW = (lay.starts[c] - lay.starts[c - 1]) * sx;
      if (fullW >= 6) { var gap = Math.max(1, Math.round(fullW * 0.12)), ga = gap >> 1;
        if (lay.starts[c - 1] >= tile.x0) a += ga; if (lay.starts[c] <= tile.x0 + tile.w) b -= gap - ga; }
      xa[c] = Math.max(0, a); xb[c] = Math.min(w, b);
    }
    // the hole in this picture's pixels (rounded outwards: the sharp tiles are drawn there)
    var hx0 = 0, hx1 = 0, hy0 = 0, hy1 = 0;
    if (hole) { hx0 = Math.floor((hole.x0 - tile.x0) * sx); hx1 = Math.ceil((hole.x1 - tile.x0) * sx); hy0 = Math.floor((hole.y0 - tile.y0) * sy); hy1 = Math.ceil((hole.y1 - tile.y0) * sy); }
    var lut = lutOf(m).px, grey = lutOf(m).grey, plan = job.plan, mode = plan.mode, cons = plan.cons;
    var url = pictureURL(w, h, function (buf) {
      rows.forEach(function (rw) {
        var seq = m.seqs[rw[0]], y0 = rw[1], y1 = rw[2];
        for (var cc = cA; cc <= cB; cc++) {
          var ch = seq.charCodeAt(cc - 1);
          if (ch === 45 || xb[cc] <= xa[cc]) continue;
          var md = mode[cc], col = md === 1 || (md === 2 && cons[cc] === ch) ? (lut[ch] || lut[88]) : grey, x0 = xa[cc], x1 = xb[cc];
          for (var yy = y0; yy < y1; yy++) { var o = yy * w; for (var xx = x0; xx < x1; xx++) buf[o + xx] = col; }
        }
      });
      if (hole) for (var yy2 = Math.max(0, hy0); yy2 < Math.min(h, hy1); yy2++) buf.fill(0, yy2 * w + Math.max(0, hx0), yy2 * w + Math.max(0, Math.min(w, hx1)));
    });
    var im = parent.append('image').attr('class', 'msa-img');
    im.node().addEventListener('load', function () { im.node().__msaLoaded = true; }, { once: true });
    return im
      .attr('x', job.x0 + tile.x0).attr('y', job.top + tile.y0).attr('width', tile.w).attr('height', tile.h)
      .attr('preserveAspectRatio', 'none').attr('image-rendering', 'optimizeSpeed')
      .style('image-rendering', 'pixelated').attr('data-scale', +s.toFixed(4))
      .attr('href', url);
  }
  // ---------------------------------------------------------------- export
  // An export gets the boxes as vector shapes (editable, sharp at any size; programs such as
  // Illustrator also do not read pictures embedded the way the screen uses them): in each row,
  // neighbouring boxes of one colour are one rectangle (circular layout: one ring segment),
  // and all boxes of a colour are one path.
  var SVGNS = 'http://www.w3.org/2000/svg';
  function fmt2(v) { return Math.round(v * 100) / 100; }
  function cellColour(m, plan, lut, ch, c) {
    if (ch === 45) return null;
    var md = plan.mode[c];
    return md === 1 || (md === 2 && plan.cons[c] === ch) ? (lut.css[ch] || lut.css[88]) : lut.greyCss;
  }
  function pathsInto(doc, parent, byColour, cls) {
    var g = doc.createElementNS(SVGNS, 'g');
    g.setAttribute('class', cls);
    byColour.forEach(function (d, colour) {
      var p = doc.createElementNS(SVGNS, 'path');
      p.setAttribute('fill', colour); p.setAttribute('stroke', 'none'); p.setAttribute('d', d);
      g.appendChild(p);
    });
    parent.appendChild(g);
    return g;
  }
  // Boxes of one colour, as merged blocks: in each row the neighbouring boxes of one colour
  // are one run; a run continues into the next row when that row touches it and has the same
  // run there (common in conserved columns). blocks(colour, a, b, t0, t1): a..b across the
  // columns, t0..t1 along the rows (y in the rectangular layout, the angle in the circle).
  function mergedBlocks(job, edges, rowSpan, emit) {
    var m = job.m, L = m.L, lut = lutOf(m), plan = job.plan || colourPlan(m, shownRows(job.rowOf));
    var open = new Map();   // colour|a|b -> [t0, t1] of a block still growing
    var lastT1 = null;
    job.leaves.forEach(function (d, i) {
      var row = job.rowOf[i];
      if (row < 0) return;
      var span = rowSpan(d), seq = m.seqs[row], seen = new Set();
      var touching = lastT1 !== null && Math.abs(span[0] - lastT1) < 1e-6;
      if (!touching) { open.forEach(function (v, k) { emit(k, v); }); open.clear(); }
      var runCol = null, runA = 0, runB = 0;
      var close = function () {
        if (runCol === null) return;
        var key = runCol + '|' + runA + '|' + runB, o = open.get(key);
        if (o) o[1] = span[1]; else open.set(key, [span[0], span[1]]);
        seen.add(key);
        runCol = null;
      };
      for (var c = 1; c <= L; c++) {
        var ch = seq.charCodeAt(c - 1), col = cellColour(m, plan, lut, ch, c);
        if (col !== null && col === runCol && !edges.gapped[c] && !edges.gapped[c - 1]) { runB = edges.b[c]; continue; }
        close();
        if (col !== null) { runCol = col; runA = edges.a[c]; runB = edges.b[c]; }
      }
      close();
      // blocks that this row does not continue are finished
      open.forEach(function (v, k) { if (!seen.has(k)) { emit(k, v); open.delete(k); } });
      lastT1 = span[1];
    });
    open.forEach(function (v, k) { emit(k, v); });
  }
  function columnEdges(job, base, inset) {
    var lay = job.lay, L = job.m.L, a = new Float64Array(L + 1), b = new Float64Array(L + 1), gapped = new Uint8Array(L + 1);
    for (var c = 1; c <= L; c++) {
      var x0 = base + lay.starts[c - 1], x1 = base + lay.starts[c], w = x1 - x0;
      if (w >= 6) { x0 += w * inset; x1 -= w * inset; gapped[c] = 1; }
      a[c] = fmt2(x0); b[c] = fmt2(x1);
    }
    return { a: a, b: b, gapped: gapped };
  }
  function rectVectors(doc, job) {
    var byColour = new Map(), last = new Map();
    mergedBlocks(job, columnEdges(job, job.x0, 0.06), function (d) { return [fmt2(d.x - job.boxH / 2), fmt2(d.x + job.boxH / 2)]; }, function (key, t) {
      var k = key.split('|'), colour = k[0], a = +k[1], b = +k[2], y0 = t[0], h = fmt2(t[1] - t[0]);
      // relative to where the previous block of this colour started (shorter)
      var prev = last.get(colour), mv = prev ? 'm' + fmt2(a - prev[0]) + ' ' + fmt2(y0 - prev[1]) : 'M' + a + ' ' + y0;
      last.set(colour, [a, y0]);
      byColour.set(colour, (byColour.get(colour) || '') + mv + 'h' + fmt2(b - a) + 'v' + h + 'h' + fmt2(a - b) + 'z');
    });
    return byColour;
  }
  function ringVectors(job) {
    var byColour = new Map(), half = job.span * job.fill / 2;
    var pt = function (r, t) { return fmt2(r * Math.sin(t)) + ' ' + fmt2(-r * Math.cos(t)); };
    mergedBlocks(job, columnEdges(job, job.r0, 0.1), function (d) { return [d.a - half, d.a + half]; }, function (key, t) {
      var k = key.split('|'), colour = k[0], ra = +k[1], rb = +k[2], t0 = t[0], t1 = t[1], da = t1 - t0, d;
      // a narrow segment: straight sides (the curve is far below a hundredth of a unit)
      if (rb * (1 - Math.cos(da / 2)) < 0.01) d = 'M' + pt(ra, t0) + 'L' + pt(rb, t0) + ' ' + pt(rb, t1) + ' ' + pt(ra, t1) + 'Z';
      else { var lg = da > Math.PI ? 1 : 0; d = 'M' + pt(ra, t0) + 'L' + pt(rb, t0) + 'A' + rb + ' ' + rb + ' 0 ' + lg + ' 1 ' + pt(rb, t1) + 'L' + pt(ra, t1) + 'A' + ra + ' ' + ra + ' 0 ' + lg + ' 0 ' + pt(ra, t0) + 'Z'; }
      byColour.set(colour, (byColour.get(colour) || '') + d);
    });
    return byColour;
  }
  // in a copy of the drawing (an export): the pictures of every alignment become vector shapes
  function vectorize(clone) {
    var doc = clone.ownerDocument || document, done = 0;
    msas.forEach(function (m) {
      var rj = m._rect;
      if (rj && rj.pics && rj.pics.node() && rj.pics.node().isConnected) {
        clone.querySelectorAll('.msa-layer[data-msa-id="' + m.id + '"] .msa-pictures').forEach(function (pics) {
          var parent = pics.parentNode, g = pathsInto(doc, parent, rectVectors(doc, rj), 'msa-boxes');
          parent.insertBefore(g, pics); pics.remove(); done++;
        });
      }
      var jr = m._ring;
      if (jr && jr.img && jr.img.node() && jr.img.node().isConnected) {
        clone.querySelectorAll('.radial-msa[data-msa-id="' + m.id + '"] image.msa-ring-img').forEach(function (im) {
          var parent = im.parentNode, g = pathsInto(doc, parent, ringVectors(jr), 'msa-boxes');
          parent.insertBefore(g, im); im.remove(); done++;
        });
      }
    });
    // (nothing of the screen pictures is left behind)
    clone.querySelectorAll('image.msa-img, image.msa-ring-img, .msa-prev').forEach(function (n) { n.remove(); });
    return done;
  }

  function drawRect(id, o) {
    var m = msas.get(id);
    if (!m) return;
    var panel = o.panel, g = o.g, x0 = panel.x + 8, W = Math.max(1, panel.width - 16);
    var leaves = o.leaves.filter(function (d) { return Number.isFinite(d.x); }).slice().sort(function (a, b) { return a.x - b.x; });
    var rowOf = leaves.map(function (d) { return rowForName(m, d.data.name); });
    var matches = rowOf.filter(function (r) { return r >= 0; }).length;
    m.hasMatchingData = matches > 0;
    m.shownMatches = matches;
    // the card's "N of M tips have a sequence" follows drops, collapses and new trees
    var infoSig = leaves.length + ':' + matches + ':' + (typeof root !== 'undefined' && root ? root.leaves().length : 0);
    if (m._infoSig !== infoSig) { m._infoSig = infoSig; m._rowOf = new Map(); setTimeout(function () { refreshInfo(m); }, 0); }
    var layer = g.append('g').attr('class', 'msa-layer msa-layer-' + id).attr('data-msa-id', id);
    if (!leaves.length) return;
    if (!matches) { drawNoMatch(layer, m, x0, W, leaves); return; }
    var leafSep = o.leafSep > 0 ? o.leafSep : (leaves.length > 1 ? (leaves[leaves.length - 1].x - leaves[0].x) / (leaves.length - 1) : 10);
    var gapRows = leafSep >= 5;
    var boxH = gapRows ? leafSep * 0.8 : leafSep;
    var lay = columnLayout(m, W);
    var top = leaves[0].x - leafSep / 2, bottom = leaves[leaves.length - 1].x + leafSep / 2;
    var acc = accentColor();
    var sel = selectedSorted(m), selRuns = runsOf(sel);
    var colX = function (c) { return x0 + lay.starts[c - 1]; };
    // highlighted columns: a band behind the boxes
    var bands = layer.append('g').attr('class', 'msa-bands');
    selRuns.forEach(function (r) {
      bands.append('rect').attr('x', colX(r[0]) - 0.5).attr('y', top - 2).attr('width', lay.starts[r[1]] - lay.starts[r[0] - 1] + 1).attr('height', bottom - top + 4)
        .attr('fill', acc).attr('fill-opacity', 0.16).attr('stroke', 'none');
    });
    // tips without a sequence: a faint band (and the reason on hover), so the empty rows read as "no data"
    var noSeq = layer.append('g').attr('class', 'msa-noseq').attr('pointer-events', 'none');
    for (var ri = 0; ri < leaves.length; ri++) {
      if (rowOf[ri] >= 0) continue;
      var rj2 = ri; while (rj2 + 1 < leaves.length && rowOf[rj2 + 1] < 0) rj2++;
      var ya = ri === 0 ? top : (leaves[ri - 1].x + leaves[ri].x) / 2, yb = rj2 === leaves.length - 1 ? bottom : (leaves[rj2].x + leaves[rj2 + 1].x) / 2;
      noSeq.append('rect').attr('x', x0).attr('y', ya).attr('width', W).attr('height', Math.max(0.1, yb - ya)).attr('fill', '#9ca3af').attr('fill-opacity', 0.13);
      ri = rj2;
    }
    // the boxes: pictures drawn at the screen's resolution (drawn again after zooming)
    var rowsKey = rowOf.join(','), prev = m._rect, prevNode = prev && prev.pics && prev.pics.node();
    var sameRows = !!(prev && prevNode && prev.ver === m._ver && prev.rowsKey === rowsKey && Math.abs(prev.top - top) < 1e-6 && Math.abs(prev.H - (bottom - top)) < 1e-6);
    // maps the earlier pictures onto this column (the same rows; another width / place)
    var stretch = function () { return 'translate(' + x0 + ',0) scale(' + (lay.W / prev.lay.W) + ',1) translate(' + (-prev.x0) + ',0)'; };
    var job;
    if (sameRows && typeof panelDragPreview !== 'undefined' && panelDragPreview) {
      // while a column is resized: the pictures already shown, stretched (no new pictures
      // to make and decode on every move; the real ones are drawn when the drag ends)
      layer.node().appendChild(prevNode);
      prevNode.setAttribute('transform', stretch());
      job = prev;
    } else {
      var pics = layer.append('g').attr('class', 'msa-pictures');
      job = { kind: 'rect', m: m, pics: pics, x0: x0, top: top, H: bottom - top, lay: lay, leaves: leaves, rowOf: rowOf, rowsKey: rowsKey, ver: m._ver, boxH: boxH, scale: 0,
        plan: colourPlan(m, shownRows(rowOf)) };
      // the earlier pictures stay underneath until the new ones are shown (no blank frame)
      if (sameRows && !prevNode.isConnected) {
        prevNode.setAttribute('transform', stretch());
        prevNode.classList.add('msa-prev');
        layer.node().insertBefore(prevNode, pics.node());
        job.under = prevNode;
      }
      renderRect(job);
      m._rect = job;
    }
    // letters in cells that are large enough (highlighted columns first)
    var fs = Math.min(boxH * 0.78, 16);
    var letterCols = [];
    if (fs >= 6) {
      if (lay.ow * 0.9 >= fs * 0.7 && matches * m.L <= 15000) for (var c2 = 1; c2 <= m.L; c2++) letterCols.push(c2);
      else if (lay.hw && lay.hw * 0.9 >= fs * 0.7 && matches * sel.length <= 15000) letterCols = sel;
      else if (!lay.hw && lay.ow * 0.9 >= fs * 0.7 && matches * sel.length <= 15000) letterCols = sel;
    }
    if (letterCols.length) {
      var tg = layer.append('g').attr('class', 'msa-letters').attr('font-size', fs.toFixed(2) + 'px').attr('font-family', 'Menlo, Consolas, monospace')
        .attr('text-anchor', 'middle').attr('fill', '#1f2937').attr('pointer-events', 'none');
      leaves.forEach(function (d, i) {
        var row = rowOf[i];
        if (row < 0) return;
        var s = m.seqs[row];
        letterCols.forEach(function (c) {
          var ch = s.charAt(c - 1);
          if (ch === '-') return;
          tg.append('text').attr('x', +(colX(c) + (lay.starts[c] - lay.starts[c - 1]) / 2).toFixed(3)).attr('y', +(d.x + fs * 0.36).toFixed(3)).text(ch);
        });
      });
    }
    // highlighted columns: outlined
    selRuns.forEach(function (r) {
      layer.append('rect').attr('class', 'msa-band-edge').attr('x', colX(r[0]) - 0.5).attr('y', top - 2).attr('width', lay.starts[r[1]] - lay.starts[r[0] - 1] + 1).attr('height', bottom - top + 4)
        .attr('fill', 'none').attr('stroke', acc).attr('stroke-width', 1).attr('pointer-events', 'none');
    });
    // the reference row: outlined
    var rr = refRow(m);
    if (rr >= 0) {
      var li = rowOf.indexOf(rr);
      if (li >= 0) layer.append('rect').attr('class', 'msa-ref-row').attr('x', x0 - 1.5).attr('y', leaves[li].x - boxH / 2 - 1.5).attr('width', W + 3).attr('height', boxH + 3)
        .attr('fill', 'none').attr('stroke', acc).attr('stroke-width', 1.5).attr('rx', 2).attr('pointer-events', 'none');
    }
    // hover: what is under the pointer; click: highlight that column
    var xs = leaves.map(function (d) { return d.x; });
    var hit = layer.append('rect').attr('class', 'meta-click msa-hit').attr('x', x0).attr('y', top).attr('width', W).attr('height', bottom - top)
      .attr('fill', 'transparent').style('pointer-events', 'all').style('cursor', 'pointer');
    function cellAt(ev) {
      var pt = d3.pointer(ev, hit.node());
      var c = columnAt(lay, pt[0] - x0);
      var i = nearest(xs, pt[1]);
      if (!c || i < 0 || Math.abs(xs[i] - pt[1]) > leafSep / 2 + 1e-6) return null;
      return { c: c, leaf: leaves[i], row: rowOf[i] };
    }
    hit.on('mousemove', function (ev) {
      if (isDragging || window.__draggingSplitter) return;
      var cell = cellAt(ev);
      if (!cell) { hideTip(); return; }
      showTip(ev, cell.leaf, true, { v: tipHTML(m, cell.row, cell.c, cell.leaf.data.name) });
    }).on('mouseleave', function () { hideTip(); })
      .on('click', function (ev) {
        if (isDragging || window.__draggingSplitter) return;
        var cell = cellAt(ev);
        if (!cell) return;
        ev.stopPropagation();
        toggleColumns(m, [cell.c]);
      });
    // the axis: alignment columns
    drawAxis(layer, m, lay, x0, o.axisY, sel);
    m._geo = { kind: 'rect', node: hit.node(), x0: x0, lay: lay, leaves: leaves, boxH: boxH };
  }
  function nearest(xs, y) {
    if (!xs.length) return -1;
    var lo = 0, hi = xs.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (xs[mid] < y) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(xs[lo - 1] - y) <= Math.abs(xs[lo] - y)) lo--;
    return lo;
  }
  function tipHTML(m, row, c, name) {
    var esc = escapeHTML;
    var html = '<b>' + esc(typeof displayAccession === 'function' ? displayAccession(name) : name) + '</b>';
    if (row < 0) return html + '<br>No sequence: ' + esc(noSequenceReason(m, name));
    var ch = m.seqs[row].charAt(c - 1), u = positionsOf(m, row)[c];
    html += '<br>Alignment column ' + c + ': ' + esc(residueName(m, ch));
    if (ch !== '-') html += '<br>Sequence position ' + u;
    if (m.colorOn && m.consOn && m._cons) {
      var cc = m._cons.cons[c], sh = m._cons.share[c];
      html += '<br>Consensus: ' + (cc ? esc(String.fromCharCode(cc)) + ' (' + Math.round(sh * 100) + '%)' + (ch === String.fromCharCode(cc) ? '' : ' – this residue differs') : 'none (' + Math.round(sh * 100) + '% at most)');
    }
    var rr = refRow(m);
    if (rr >= 0 && rr !== row) {
      var ur = positionsOf(m, rr)[c];
      html += '<br>' + esc(m.ids[rr]) + ': ' + (ur ? 'position ' + ur + ' (' + esc(m.seqs[rr].charAt(c - 1)) + ')' : 'gap');
    }
    html += '<br><span style="opacity:.7">Click: ' + (m.selected.has(c) ? 'remove the highlight' : 'highlight this column') + '</span>';
    return html;
  }
  function escapeHTML(v) { return String(v).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
  function drawNoMatch(layer, m, x0, W, leaves) {
    var top = leaves[0].x, bottom = leaves[leaves.length - 1].x;
    layer.append('rect').attr('x', x0).attr('y', top - 6).attr('width', W).attr('height', Math.max(12, bottom - top + 12))
      .attr('fill', 'rgba(245, 158, 11, 0.05)').attr('stroke', '#f59e0b').attr('stroke-width', 2).attr('rx', 4).attr('ry', 4);
    var tZ = d3.zoomTransform(svg.node()), svgEl = document.getElementById('svg');
    var cy = ((svgEl ? svgEl.clientHeight : 0) / 2 - tZ.y) / Math.max(0.0001, tZ.k);
    cy = Math.max(top + 14, Math.min(bottom - 14, cy));
    layer.append('text').attr('x', x0 + W / 2).attr('y', cy - 8).attr('text-anchor', 'middle').attr('font-size', 12).attr('font-weight', 600).attr('fill', '#f59e0b').text('No matching accessions');
    layer.append('text').attr('x', x0 + W / 2).attr('y', cy + 8).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#6b7280').text('Alignment ' + m.id + ' doesn\'t match the tree');
  }
  // the axis scale: piecewise linear over the column layout (column c spans c-0.5 .. c+0.5)
  function axisScale(lay, len, r0) {
    var dom = [0.5], rng = [r0];
    lay.runs.forEach(function (r) { dom.push(r.c1 + 0.5); rng.push(r0 + lay.starts[r.c1]); });
    if (dom.length < 2) { dom.push(len + 0.5); rng.push(r0 + lay.W); }
    return d3.scaleLinear().domain(dom).range(rng);
  }
  function tickValues(m, lay, labelW) {
    var base = d3.scaleLinear().domain([1, m.L]).range([0, lay.W]);
    var n = typeof axisTickCount === 'function' ? axisTickCount(base) : 4;
    var t = base.ticks(n).filter(function (v) { return Number.isInteger(v) && v >= 1 && v <= m.L; });
    if (!t.length) t = [1];
    return t;
  }
  var measureCtx = null;
  function textWidth(s, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    var svgEl = document.getElementById('svg');
    measureCtx.font = font + ' ' + (typeof drawingFontFamily === 'function' ? drawingFontFamily(svgEl) : ((svgEl && getComputedStyle(svgEl).fontFamily) || 'sans-serif'));
    return measureCtx.measureText(s).width;
  }
  function drawAxis(layer, m, lay, x0, axisY, sel) {
    var ag = layer.append('g').attr('class', 'msa-axis').attr('id', 'msa-scale-' + m.id).attr('transform', 'translate(' + x0 + ',' + axisY + ')');
    var sc = axisScale(lay, m.L, 0);
    var normal = tickValues(m, lay);
    // labels of highlighted columns that are wide enough for their number
    var labelled = sel.filter(function (c) { return (lay.starts[c] - lay.starts[c - 1]) >= textWidth(String(c), 'bold 12px') + 4; });
    var labelledSet = new Set(labelled);
    var placed = labelled.map(function (c) { var w = textWidth(String(c), 'bold 12px'); return [sc(c) - w / 2 - 3, sc(c) + w / 2 + 3]; });
    var ticks = labelled.slice();
    normal.forEach(function (v) {
      if (labelledSet.has(v)) return;
      var w = textWidth(String(v), 'bold 12px'), a = sc(v) - w / 2 - 3, b = sc(v) + w / 2 + 3;
      if (placed.some(function (p) { return a < p[1] && b > p[0]; })) return;
      placed.push([a, b]); ticks.push(v);
    });
    ticks.sort(function (a, b) { return a - b; });
    var axis = axisForRow(sc).tickValues(ticks).tickFormat(d3.format('d')).tickSizeOuter(0);
    ag.call(axis);
    ag.selectAll(':scope > .tick text').attr('fill', 'var(--tree)').attr('font-size', '12px').attr('font-weight', 'bold');
    ag.selectAll(':scope > path, :scope > .tick line').attr('stroke', 'var(--tree)').attr('stroke-width', '2px').attr('opacity', '1.0');
    var acc = accentColor();
    ag.selectAll(':scope > .tick').filter(function (d) { return labelledSet.has(d); }).selectAll('text, line').attr('fill', acc).attr('stroke', acc);
    ag.selectAll(':scope > .tick').filter(function (d) { return labelledSet.has(d); }).select('line').attr('stroke', acc);
    ag.selectAll(':scope > .tick').filter(function (d) { return labelledSet.has(d); }).select('text').attr('fill', acc).attr('stroke', null);
    // where the highlighted columns are, on the axis line
    runsOf(sel).forEach(function (r) {
      var a = lay.starts[r[0] - 1], b = lay.starts[r[1]];
      ag.append('rect').attr('class', 'msa-axis-mark').attr('x', a).attr('y', -2.5).attr('width', Math.max(2, b - a)).attr('height', 5).attr('fill', acc).attr('rx', 1);
    });
    renderAxisTitle(ag, 'msa:' + m.id, lay.W);
  }

  // ------------------------------------------------------ drawing: circular
  function drawRadial(id, o) {
    var m = msas.get(id);
    if (!m) return;
    var ring = o.ring, grp = o.group;
    var leaves = o.leaves.filter(function (d) { return Number.isFinite(d.a); }).slice().sort(function (a, b) { return a.a - b.a; });
    var rowOf = leaves.map(function (d) { return rowForName(m, d.data.name); });
    var matches = rowOf.filter(function (r) { return r >= 0; }).length;
    m.hasMatchingData = matches > 0; m.shownMatches = matches;
    var layer = grp.append('g').attr('class', 'radial-msa radial-msa-' + id).attr('data-msa-id', id);
    if (!leaves.length || !matches) return;
    var r0 = ring.innerRadius + 4, r1 = ring.outerRadius - 4, W = Math.max(1, r1 - r0);
    var lay = columnLayout(m, W);
    var n = leaves.length, openRad = o.openRad || 0;
    var span = n > 1 ? (2 * Math.PI - openRad) / n : 2 * Math.PI;
    var acc = accentColor(), sel = selectedSorted(m);
    // highlighted columns: rings behind the boxes
    var a0 = openRad, a1 = 2 * Math.PI;
    if (n > 1) { a0 = leaves[0].a - span / 2; a1 = leaves[n - 1].a + span / 2; }
    runsOf(sel).forEach(function (r) {
      var arc = d3.arc().innerRadius(r0 + lay.starts[r[0] - 1]).outerRadius(r0 + lay.starts[r[1]]).startAngle(a0).endAngle(a1);
      layer.append('path').attr('class', 'msa-band').attr('d', arc()).attr('fill', acc).attr('fill-opacity', 0.16).attr('stroke', acc).attr('stroke-width', 1);
    });
    var R = ring.outerRadius;
    var img = layer.append('image').attr('class', 'msa-ring-img').attr('x', -R).attr('y', -R).attr('width', 2 * R).attr('height', 2 * R)
      .attr('preserveAspectRatio', 'none').attr('data-r0', r0).attr('data-r1', r1).style('pointer-events', 'none');
    var gapAngles = span * r0 >= 5;   // rows far enough apart: a gap between them
    var job = { m: m, leaves: leaves, rowOf: rowOf, lay: lay, r0: r0, r1: r1, R: R, span: span, fill: gapAngles ? 0.9 : 1, img: img, res: 0 };
    renderRing(job, desiredRes(R));
    m._ring = job;
    m._geo = { kind: 'radial', node: layer.node(), lay: lay, leaves: leaves, r0: r0 };
    // hover / click on the ring
    var hitArc = d3.arc().innerRadius(r0).outerRadius(r1).startAngle(0).endAngle(2 * Math.PI);
    var hit = layer.append('path').attr('class', 'meta-click msa-hit').attr('d', hitArc()).attr('fill', 'transparent').style('pointer-events', 'auto').style('cursor', 'pointer');
    var angles = leaves.map(function (d) { return d.a; });
    function cellAt(ev) {
      var pt = d3.pointer(ev, layer.node()), r = Math.hypot(pt[0], pt[1]);
      var th = Math.atan2(pt[0], -pt[1]); if (th < 0) th += 2 * Math.PI;
      var c = columnAt(lay, r - r0);
      var i = nearestAngle(angles, th);
      if (!c || i < 0) return null;
      var dth = Math.abs(angles[i] - th); dth = Math.min(dth, 2 * Math.PI - dth);
      if (dth > span / 2 + 1e-9) return null;
      return { c: c, leaf: leaves[i], row: rowOf[i] };
    }
    hit.on('mousemove', function (ev) {
      if (isDragging || window.__draggingSplitter) return;
      var cell = cellAt(ev);
      if (!cell) { hideTip(); return; }
      showTip(ev, cell.leaf, true, { v: tipHTML(m, cell.row, cell.c, cell.leaf.data.name) });
    }).on('mouseleave', function () { hideTip(); })
      .on('click', function (ev) {
        if (isDragging || window.__draggingSplitter) return;
        var cell = cellAt(ev); if (!cell) return;
        ev.stopPropagation(); toggleColumns(m, [cell.c]);
      });
    // the axis in the opening gap (12 o'clock), numbers on its right
    var openDeg = openRad * 180 / Math.PI;
    var ticks = tickValues(m, lay), sc = axisScale(lay, m.L, r0);
    var maxW = ticks.reduce(function (w, t) { return Math.max(w, textWidth(String(t), '10px')); }, 0);
    var needDeg = ((maxW + 10) / ring.outerRadius) * 180 / Math.PI;
    if (openDeg >= needDeg && openDeg > 0) {
      var ringCol = cssVar('--tree') || '#e5e7eb';
      var bar = layer.append('g').attr('class', 'radial-msa-scale-bar');
      bar.append('line').attr('x1', 0).attr('y1', -r0).attr('x2', 0).attr('y2', -r1).attr('stroke', ringCol).attr('stroke-width', 2);
      ticks.forEach(function (t) {
        var r = sc(t);
        bar.append('line').attr('x1', 0).attr('y1', -r).attr('x2', 5).attr('y2', -r).attr('stroke', ringCol).attr('stroke-width', 2);
        bar.append('text').attr('x', 10).attr('y', -r).attr('text-anchor', 'start').attr('dominant-baseline', 'middle').attr('fill', ringCol).attr('font-size', '10px').text(String(t));
      });
      runsOf(sel).forEach(function (r) {
        var ra = r0 + lay.starts[r[0] - 1], rb = r0 + lay.starts[r[1]];
        bar.append('rect').attr('class', 'msa-axis-mark').attr('x', -2.5).attr('y', -rb).attr('width', 5).attr('height', Math.max(2, rb - ra)).attr('fill', acc).attr('rx', 1);
      });
      if (typeof radialAxisTitle === 'function') radialAxisTitle(bar, 'msa:' + id, ring.innerRadius, ring.outerRadius, openDeg, maxW);
    }
  }
  function nearestAngle(angles, th) {
    var i = nearest(angles, th);
    if (i < 0) return i;
    // across 0 / 2π
    var best = i, bd = Infinity;
    [i, 0, angles.length - 1].forEach(function (j) { var d = Math.abs(angles[j] - th); d = Math.min(d, 2 * Math.PI - d); if (d < bd) { bd = d; best = j; } });
    return best;
  }
  var MAX_RING_PX = 4096;
  function desiredRes(R) {
    var k = d3.zoomTransform(svg.node()).k || 1, dpr = window.devicePixelRatio || 1;
    return Math.max(0.5, Math.min(k * dpr, MAX_RING_PX / (2 * R)));
  }
  // the ring picture: for every pixel of the ring, the cell under it
  function renderRing(job, res) {
    var m = job.m, R = job.R, S = Math.max(1, Math.ceil(2 * R * res)), sc = S / (2 * R);
    var lay = job.lay, r0 = job.r0, r1 = job.r1, n = job.leaves.length;
    // angle -> row
    var T = Math.max(360, Math.ceil(2 * Math.PI * R * sc * 2)), rowAt = new Int32Array(T).fill(-1);
    var half = job.span * job.fill / 2;
    job.leaves.forEach(function (d, i) {
      if (job.rowOf[i] < 0) return;
      var aA = (d.a - half) / (2 * Math.PI) * T, aB = (d.a + half) / (2 * Math.PI) * T;
      for (var b = Math.floor(aA); b < Math.ceil(aB); b++) {
        var mid = (b + 0.5);
        if (mid < aA || mid > aB) continue;
        rowAt[((b % T) + T) % T] = job.rowOf[i];
      }
    });
    // radius -> column (gap between wide columns)
    var RB = Math.ceil((r1 - r0) * sc) + 1, colAt = new Int32Array(RB);
    for (var q = 0; q < RB; q++) {
      var rr = (q + 0.5) / sc, c = columnAt(lay, rr);
      if (c) {
        var w = lay.starts[c] - lay.starts[c - 1];
        if (w >= 6) { var f = (rr - lay.starts[c - 1]) / w; if (f < 0.1 || f > 0.9) c = 0; }
      }
      colAt[q] = c;
    }
    var plan = colourPlan(m, shownRows(job.rowOf)), mode = plan.mode, cons = plan.cons, lut = lutOf(m).px, greyPx = lutOf(m).grey;
    var url = pictureURL(S, S, function (buf) {
      var ri2 = r0 * r0 * sc * sc, ro2 = r1 * r1 * sc * sc, ctr = S / 2;
      for (var py = 0; py < S; py++) {
        var y = py + 0.5 - ctr, y2 = y * y;
        if (y2 > ro2) continue;
        var xo = Math.sqrt(ro2 - y2), xa = Math.max(0, Math.floor(ctr - xo)), xb = Math.min(S - 1, Math.ceil(ctr + xo));
        for (var px = xa; px <= xb; px++) {
          var x = px + 0.5 - ctr, d2 = x * x + y2;
          if (d2 < ri2 || d2 >= ro2) continue;
          var col = colAt[Math.floor(Math.sqrt(d2) - r0 * sc)];
          if (!col) continue;
          var th = Math.atan2(x, -y); if (th < 0) th += 2 * Math.PI;
          var row = rowAt[Math.min(T - 1, Math.floor(th / (2 * Math.PI) * T))];
          if (row < 0) continue;
          var ch = m.seqs[row].charCodeAt(col - 1);
          if (ch === 45) continue;
          var md = mode[col];
          buf[py * S + px] = md === 1 || (md === 2 && cons[col] === ch) ? (lut[ch] || lut[88]) : greyPx;
        }
      }
    });
    var oldImg = job.img.attr('href') ? job.img : null;
    if (oldImg) {
      // the new picture next to the old one; the old goes once the new one is shown
      var ni = d3.select(oldImg.node().cloneNode(false));
      oldImg.node().parentNode.insertBefore(ni.node(), oldImg.node().nextSibling);
      job.img = ni;
    }
    job.img.attr('href', url).attr('data-res', +res.toFixed(3));
    if (oldImg) whenLoaded([job.img], false, function () { oldImg.remove(); });
    job.res = res;
  }

  // after zooming: sharper pictures where needed
  var zoomTimer = null;
  function afterZoom() {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(function () {
      msas.forEach(function (m) {
        var rj = m._rect;
        if (rj && rj.pics.node() && rj.pics.node().isConnected) renderRect(rj);
      });
      msas.forEach(function (m) {
        var j = m._ring;
        if (!j || !j.img.node() || !j.img.node().isConnected) return;
        var want = desiredRes(j.R);
        if (want / j.res > 1.4 || j.res / want > 2) renderRing(j, want);
      });
    }, 120);
  }
  if (typeof zoom !== 'undefined' && zoom && zoom.on) zoom.on('end.msa', afterZoom);

  // ------------------------------------------------------------- the card
  function state(m) { return { c: m.colorOn, r: m.ref, m: m.mode, s: selectedSorted(m), w: m.hiWidth, sc: m.scheme, cu: m.custom || {}, cs: !!m.consOn, ct: m.consLevel || 50, cw: m.colWidth || {} }; }
  function saveState(m) { var el = $('msaState' + m.id); if (el) el.value = JSON.stringify(state(m)); }
  function $(id) { return document.getElementById(id); }

  function cardHTML(m) {
    var id = m.id, esc = escapeHTML;
    return '' +
      '<summary id="msaSummary' + id + '" class="df-summary">' +
        '<span class="pro-card-badge pro-badge-msa" aria-hidden="true">AL</span>' +
        '<span id="msaTitle' + id + '" class="pro-card-title">Alignment ' + id + '</span>' +
        '<span class="df-spacer"></span>' +
        '<button id="deleteMsa' + id + '" class="df-delete" title="Remove alignment" aria-label="Remove alignment"></button>' +
        '<span class="drag-handle" title="Drag to reorder alignments" aria-hidden="true"></span>' +
      '</summary>' +
      '<div class="section row2 pro-card-body">' +
        '<input type="hidden" id="msaState' + id + '" class="msa-state">' +
        '<div class="pro-card-section">' +
          '<div class="msa-info" id="msaInfo' + id + '"></div>' +
          '<label class="pro-row"><span>Colour residues</span><input type="checkbox" id="msaColor' + id + '" class="pro-switch"' + (m.colorOn ? ' checked' : '') + '></label>' +
          '<p class="pro-hint msa-hint">Off: grey boxes (highlighted columns keep their colours).</p>' +
          '<div class="pro-row"><label for="msaScheme' + id + '">Colour scheme</label><select id="msaScheme' + id + '" class="pro-select msa-scheme">' +
            (SCHEMES[m.type] || SCHEMES.protein).map(function (x) { return '<option value="' + x.key + '"' + (x.key === schemeOf(m).key ? ' selected' : '') + '>' + escapeHTML(x.label) + '</option>'; }).join('') +
          '</select></div>' +
          '<label class="pro-row" title="Residues that are their column\'s consensus keep their colour; the others are grey (like AliView\'s majority-rule consensus highlighting)"><span>Highlight consensus</span><input type="checkbox" id="msaCons' + id + '" class="pro-switch"' + (m.consOn ? ' checked' : '') + '></label>' +
          '<div class="pro-row pro-sub msa-cons-row" id="msaConsRow' + id + '"><label for="msaConsLevel' + id + '">Consensus</label><select id="msaConsLevel' + id + '" class="pro-select">' +
            CONS_LEVELS.map(function (x) { return '<option value="' + x[0] + '"' + ((m.consLevel || 50) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
          '<div class="pro-card-head msa-colours-head"><span class="pro-section-title">Colours</span><button type="button" class="msa-btn" id="msaColReset' + id + '" title="Back to the colours of the scheme">Reset</button></div>' +
          '<div class="pro-list msa-colours" id="msaColours' + id + '"></div>' +
        '</div>' +
        '<div class="pro-card-section">' +
          '<div class="pro-card-head"><span class="pro-section-title">Reference sequence</span></div>' +
          '<div class="pro-search-row msa-find-row">' +
            '<input type="text" id="msaFind' + id + '" class="pro-search msa-find" placeholder="Find an accession" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="msaFindList' + id + '">' +
            '<button type="button" id="msaFindClear' + id + '" class="pro-search-clear" title="Clear" aria-label="Clear"></button>' +
            '<div class="msa-suggest" id="msaFindList' + id + '" role="listbox" hidden></div>' +
          '</div>' +
          '<div class="msa-ref" id="msaRef' + id + '"></div>' +
        '</div>' +
        '<div class="pro-card-section msa-pos-section" id="msaPosSection' + id + '">' +
          '<div class="pro-card-head"><span class="pro-section-title">Positions</span>' +
            '<span class="pro-radio-seg" role="radiogroup" aria-label="Numbering">' +
              '<label title="Positions in the reference sequence, without gaps"><input type="radio" name="msaMode' + id + '" id="msaModeU' + id + '" value="ungapped"' + (m.mode !== 'gapped' ? ' checked' : '') + '><span>Ungapped</span></label>' +
              '<label title="Alignment columns, with gaps"><input type="radio" name="msaMode' + id + '" id="msaModeG' + id + '" value="gapped"' + (m.mode === 'gapped' ? ' checked' : '') + '><span>Gapped</span></label>' +
            '</span></div>' +
          '<div class="pro-search-row">' +
            '<input type="text" id="msaFilter' + id + '" class="pro-search msa-filter" placeholder="Filter: 10-20, 35 or residues (C K)" autocomplete="off" spellcheck="false" title="Numbers and ranges (10-20) in the chosen numbering, and/or residue letters. Enter highlights the matching positions.">' +
            '<button type="button" id="msaFilterClear' + id + '" class="pro-search-clear" title="Clear filter" aria-label="Clear filter"></button>' +
          '</div>' +
          '<div class="msa-pos-tools"><span class="msa-pos-count" id="msaPosCount' + id + '"></span>' +
            '<button type="button" class="msa-btn" id="msaSelShown' + id + '" title="Highlight every position that matches the filter">Highlight matching</button></div>' +
          '<div class="pro-list msa-pos-list" id="msaPosList' + id + '" role="listbox" aria-multiselectable="true" aria-label="Positions" tabindex="0"></div>' +
        '</div>' +
        '<div class="pro-card-section">' +
          '<div class="pro-card-head"><span class="pro-section-title">Highlighted columns</span>' +
            '<button type="button" class="msa-btn" id="msaClear' + id + '" title="Remove all highlights">Clear</button></div>' +
          '<div class="msa-hi" id="msaHi' + id + '"></div>' +
          '<div class="pro-row"><span>Default width</span><span class="pro-num-wrap"><input type="number" id="msaHiWidth' + id + '" min="0" max="400" step="1" value="' + (m.hiWidth || 0) + '" class="pro-num"><span class="pro-unit">px</span></span></div>' +
          '<p class="pro-hint msa-hint">Width of each highlighted column. Each group above can have its own (px box; empty = this default); 0 keeps the normal width.</p>' +
        '</div>' +
      '</div>';
  }

  // the card is put in its container first (its parts are found by id)
  function makeCard(m, box) {
    var card = document.createElement('details');
    card.className = 'msa-panel';
    card.setAttribute('draggable', 'true');
    card.setAttribute('open', '');
    card.id = 'msaCard' + m.id;
    card.setAttribute('data-msaid', String(m.id));
    box.appendChild(card);
    fillCard(card, m);
    return card;
  }
  function fillCard(card, m) {
    card.id = 'msaCard' + m.id;
    card.setAttribute('data-msaid', String(m.id));
    card.innerHTML = cardHTML(m);
    wireCard(card, m);
    saveState(m);
    refreshCard(m);
  }
  function cardOf(m) { return $('msaCard' + m.id); }

  function refreshInfo(m) {
    var el = $('msaInfo' + m.id);
    if (!el) return;
    var esc = escapeHTML, tips = tipRows(m), withSeq = tips.filter(function (t) { return t.row >= 0; });
    var exact = withSeq.filter(function (t) { return m.byAcc.has(normalizeAccession(t.name)); }).length;
    var parts = ['<div class="msa-info-name" title="' + esc(m.name) + '">' + esc(m.name) + '</div>',
      '<div>' + m.ids.length + ' sequences × ' + m.L + ' columns · ' + (m.type === 'nucleotide' ? 'nucleotides' : 'amino acids') + ' · ' + esc(m.format) + '</div>'];
    if (!root) parts.push('<div>no tree loaded</div>');
    else {
      parts.push('<div>' + withSeq.length + ' of ' + tips.length + ' tips have a sequence' + (withSeq.length > exact ? ' (' + (withSeq.length - exact) + ' matched without the NZ_ prefix or version)' : '') + '</div>');
      var none = tips.filter(function (t) { return t.row < 0; });
      if (none.length) {
        var li = none.slice(0, 200).map(function (t) { return '<li><b>' + esc(t.name) + '</b> – ' + esc(noSequenceReason(m, t.name)) + '</li>'; }).join('');
        parts.push('<button type="button" class="msa-skip-toggle is-warn" aria-expanded="false">' + none.length + ' tip' + (none.length === 1 ? '' : 's') + ' without a sequence (empty rows)</button>' +
          '<ul class="msa-skipped" hidden>' + li + (none.length > 200 ? '<li>… and ' + (none.length - 200) + ' more</li>' : '') + '</ul>');
      }
    }
    if (m.skipped.length) {
      var list = m.skipped.slice(0, 200).map(function (s2) { return '<li>' + (s2.line ? 'line ' + s2.line + ': ' : '') + esc(s2.id) + ' – ' + esc(s2.why) + '</li>'; }).join('');
      parts.push('<button type="button" class="msa-skip-toggle" aria-expanded="false">' + m.skipped.length + ' row' + (m.skipped.length === 1 ? '' : 's') + ' of the file skipped</button>' +
        '<ul class="msa-skipped" hidden>' + list + (m.skipped.length > 200 ? '<li>… and ' + (m.skipped.length - 200) + ' more</li>' : '') + '</ul>');
    }
    el.innerHTML = parts.join('');
  }
  // the sequence rows that tips of the tree show
  function rowsInTree(m) {
    var s = new Set();
    tipRows(m).forEach(function (t) { if (t.row >= 0) s.add(t.row); });
    return s;
  }

  function refreshRef(m) {
    var el = $('msaRef' + m.id), sec = $('msaPosSection' + m.id);
    if (!el) return;
    var rr = refRow(m), esc = escapeHTML;
    if (rr < 0) {
      el.innerHTML = '<span class="msa-muted">No reference: find an accession above to list its positions.</span>';
      if (sec) sec.hidden = true;
      return;
    }
    var p = positionsOf(m, rr), len = 0;
    for (var c = 1; c <= m.L; c++) if (p[c]) len = p[c];
    var inTree = rowsInTree(m).has(rr);
    el.innerHTML = '<span class="msa-ref-chip"><b>' + esc(m.ids[rr]) + '</b><button type="button" class="msa-ref-x" id="msaRefClear' + m.id + '" title="Remove the reference" aria-label="Remove the reference">×</button></span>' +
      '<span class="msa-muted">' + len + ' residues' + (inTree ? '' : ' · not in the tree') + '</span>';
    if (sec) sec.hidden = false;
  }

  // the positions that match the filter: [{ c, u, ch }]
  function parseFilter(text) {
    var t = String(text || '').trim().replace(/\s*[-–:]\s*/g, '-');
    var nums = [], letters = new Set(), bad = [];
    if (t) t.split(/[\s,;]+/).forEach(function (tok) {
      if (!tok) return;
      var r = /^(\d+)-(\d+)$/.exec(tok);
      if (r) { var a = +r[1], b = +r[2]; nums.push([Math.min(a, b), Math.max(a, b)]); return; }
      if (/^\d+$/.test(tok)) { nums.push([+tok, +tok]); return; }
      if (/^gaps?$/i.test(tok)) { letters.add('-'); return; }
      if (/^[A-Za-z*]$/.test(tok)) { letters.add(tok.toUpperCase()); return; }
      bad.push(tok);
    });
    return { nums: nums, letters: letters, bad: bad };
  }
  function matchingPositions(m) {
    var rr = refRow(m);
    if (rr < 0) return { list: [], bad: [] };
    var f = parseFilter(m.filter), p = positionsOf(m, rr), s = m.seqs[rr], out = [];
    var inNums = function (v) { if (!f.nums.length) return true; for (var i = 0; i < f.nums.length; i++) if (v >= f.nums[i][0] && v <= f.nums[i][1]) return true; return false; };
    for (var c = 1; c <= m.L; c++) {
      var u = p[c], ch = s.charAt(c - 1);
      if (m.mode !== 'gapped' && !u) continue;
      var num = m.mode === 'gapped' ? c : u;
      if (!inNums(num)) continue;
      if (f.letters.size && !f.letters.has(ch)) continue;
      out.push({ c: c, u: u, ch: ch });
    }
    return { list: out, bad: f.bad };
  }
  var LIST_CAP = 500;
  function refreshList(m) {
    var box = $('msaPosList' + m.id), cnt = $('msaPosCount' + m.id);
    if (!box) return;
    var res = matchingPositions(m), list = res.list, esc = escapeHTML;
    m._shown = list;
    var html = [];
    for (var i = 0; i < Math.min(list.length, LIST_CAP); i++) {
      var it = list[i], on = m.selected.has(it.c);
      var num = m.mode === 'gapped' ? it.c : it.u;
      var alt = m.mode === 'gapped' ? (it.u ? 'pos ' + it.u : 'gap') : 'col ' + it.c;
      var color = it.ch === '-' ? 'transparent' : residueColor(m, it.ch);
      html.push('<div class="pro-list-row msa-pos" role="option" aria-selected="' + on + '" data-col="' + it.c + '">' +
        '<span class="msa-check" aria-hidden="true"></span><span class="msa-num">' + num + '</span>' +
        '<span class="msa-res' + (it.ch === '-' ? ' is-gap' : '') + '" style="background:' + color + '">' + esc(it.ch) + '</span>' +
        '<span class="msa-alt">' + alt + '</span></div>');
    }
    if (!list.length) html.push('<i>' + (m.filter.trim() ? 'No position matches the filter' : 'No positions') + '</i>');
    box.innerHTML = html.join('');
    if (cnt) {
      var txt = list.length > LIST_CAP ? 'Showing ' + LIST_CAP + ' of ' + list.length : list.length + ' position' + (list.length === 1 ? '' : 's');
      if (res.bad.length) txt += ' · not understood: ' + res.bad.join(' ');
      cnt.textContent = txt;
      cnt.classList.toggle('is-bad', !!res.bad.length);
    }
    var b = $('msaSelShown' + m.id); if (b) b.disabled = !list.length;
  }
  function syncListSelection(m) {
    var box = $('msaPosList' + m.id);
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.msa-pos'), function (row) {
      var on = m.selected.has(+row.getAttribute('data-col'));
      if (row.getAttribute('aria-selected') !== String(on)) row.setAttribute('aria-selected', String(on));
    });
  }
  function refreshHi(m) {
    var el = $('msaHi' + m.id), w = $('msaHiWidth' + m.id), clr = $('msaClear' + m.id);
    if (!el) return;
    var sel = selectedSorted(m), esc = escapeHTML;
    if (clr) clr.disabled = !sel.length;
    if (w) w.disabled = !sel.length;
    if (!sel.length) { el.innerHTML = '<span class="msa-muted">None. Pick positions above, or click a column in the alignment.</span>'; return; }
    var rr = refRow(m), p = rr >= 0 ? positionsOf(m, rr) : null;
    var chips = runsOf(sel).slice(0, 60).map(function (r) {
      var lab = r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1];
      var sub = '';
      if (p) {
        var ua = 0, ub = 0;
        for (var c = r[0]; c <= r[1]; c++) if (p[c]) { if (!ua) ua = p[c]; ub = p[c]; }
        sub = ua ? (ua === ub ? ' · pos ' + ua : ' · pos ' + ua + '–' + ub) : ' · gap';
      }
      // the group's own width (empty: the default; "mixed" when its columns differ)
      var ws = new Set(); for (var c2 = r[0]; c2 <= r[1]; c2++) ws.add((m.colWidth && m.colWidth[c2]) || 0);
      var wv = ws.size === 1 ? Array.from(ws)[0] : null;
      return '<div class="msa-chip" data-c0="' + r[0] + '" data-c1="' + r[1] + '" title="Alignment column' + (r[0] === r[1] ? ' ' : 's ') + lab + (p ? ' (' + esc(m.ids[rr]) + sub.replace(' · ', ' ') + ')' : '') + '">' +
        '<span class="msa-chip-label">col ' + lab + '<span class="msa-muted">' + sub + '</span></span>' +
        '<span class="pro-num-wrap msa-chip-wrap"><input type="number" class="pro-num msa-chip-w" min="0" max="400" step="1" value="' + (wv ? wv : '') + '" placeholder="' + (wv === null ? 'mixed' : (m.hiWidth > 0 ? m.hiWidth : 'auto')) + '" aria-label="Width of columns ' + lab + ' (px)" title="Width of each of these columns, in px (empty: the default width below)"><span class="pro-unit">px</span></span>' +
        '<button type="button" class="msa-chip-x" aria-label="Remove this highlight" title="Remove">×</button></div>';
    });
    var more = runsOf(sel).length > 60 ? '<span class="msa-muted">… and more</span>' : '';
    el.innerHTML = '<div class="msa-hi-count">' + sel.length + ' column' + (sel.length === 1 ? '' : 's') + ' in ' + runsOf(sel).length + ' group' + (runsOf(sel).length === 1 ? '' : 's') + '</div><div class="msa-chips">' + chips.join('') + more + '</div>';
  }
  function refreshColours(m) {
    var box = $('msaColours' + m.id), reset = $('msaColReset' + m.id);
    if (!box) return;
    var esc = escapeHTML, groups = colourGroups(m);
    box.innerHTML = groups.map(function (g) {
      return '<div class="pro-list-row msa-colour" data-value="' + esc(g.key) + '"><input type="color" class="pro-swatch msa-swatch" value="' + g.color + '" data-key="' + esc(g.key) + '" aria-label="Colour of ' + esc(g.label) + '">' +
        '<span class="pro-list-name">' + esc(g.label) + '</span></div>';
    }).join('');
    var cu = (m.custom && m.custom[schemeOf(m).key]) || {};
    if (reset) reset.disabled = !Object.keys(cu).length;
  }
  function refreshCard(m) { refreshInfo(m); refreshColours(m); refreshRef(m); refreshList(m); refreshHi(m); }

  // a change of the layer: card, state, drawing
  function changed(m, what) {
    m._ver = (m._ver || 0) + 1;
    saveState(m);
    if (what === 'sel') { syncListSelection(m); refreshHi(m); }
    else if (what === 'colour') { refreshList(m); var rs = $('msaColReset' + m.id); if (rs) rs.disabled = !Object.keys((m.custom && m.custom[schemeOf(m).key]) || {}).length; }
    else refreshCard(m);
    if (typeof setDrawScope === 'function') setDrawScope('msa:' + m.id);
    if (typeof root !== 'undefined' && root) drawTree();
    call(function () { updateMetadataLegend(); });
  }
  function toggleColumns(m, cols, force) {
    var on = force !== undefined ? force : !cols.every(function (c) { return m.selected.has(c); });
    cols.forEach(function (c) { if (on) m.selected.add(c); else m.selected.delete(c); });
    changed(m, 'sel');
    if (cols.length === 1) setStatus((on ? 'Highlighted' : 'Removed the highlight of') + ' alignment column ' + cols[0]);
  }
  function setRef(m, acc) {
    m.ref = acc || null;
    changed(m, 'all');
    if (acc) setStatus('Reference: ' + acc);
  }
  function call(fn) { try { return fn(); } catch (e) { console.warn('[msa]', e); return undefined; } }

  function wireCard(card, m) {
    var id = m.id;
    $('deleteMsa' + id).addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); deleteMsaCard(m.id); });
    $('msaInfo' + id).addEventListener('click', function (e) {
      var b = e.target.closest('.msa-skip-toggle'); if (!b) return;
      var ul = b.nextElementSibling, open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open)); if (ul) ul.hidden = !open;
    });
    $('msaColor' + id).addEventListener('change', function (ev) { m.colorOn = ev.target.checked; changed(m, 'all'); });
    var consUi = function () { var on = m.colorOn; $('msaCons' + id).disabled = !on; $('msaConsRow' + id).hidden = !(on && m.consOn); };
    consUi();
    $('msaCons' + id).addEventListener('change', function (ev) { m.consOn = ev.target.checked; consUi(); changed(m, 'colour'); setStatus(m.consOn ? 'Consensus residues highlighted' : 'Consensus highlighting off'); });
    $('msaConsLevel' + id).addEventListener('change', function (ev) { m.consLevel = +ev.target.value; changed(m, 'colour'); });
    $('msaColor' + id).addEventListener('change', consUi);
    $('msaScheme' + id).addEventListener('change', function (ev) { m.scheme = ev.target.value; changed(m, 'all'); setStatus('Colour scheme: ' + schemeOf(m).label); });
    $('msaColours' + id).addEventListener('input', function (ev) {
      var t = ev.target; if (!t.classList.contains('msa-swatch')) return;
      var k = schemeOf(m).key;
      if (!m.custom) m.custom = {};
      if (!m.custom[k]) m.custom[k] = {};
      var base = colourGroups(m).filter(function (g) { return g.key === t.getAttribute('data-key'); })[0];
      if (base && t.value.toLowerCase() === base.base.toLowerCase()) delete m.custom[k][t.getAttribute('data-key')]; else m.custom[k][t.getAttribute('data-key')] = t.value;
      saveState(m);
      clearTimeout(m._colTimer);
      m._colTimer = setTimeout(function () { changed(m, 'colour'); }, 60);
    });
    $('msaColReset' + id).addEventListener('click', function () { if (m.custom) delete m.custom[schemeOf(m).key]; changed(m, 'all'); setStatus('Colours reset'); });
    // session restore: the whole state at once
    $('msaState' + id).addEventListener('change', function (ev) {
      var st = null; try { st = JSON.parse(ev.target.value); } catch (e) { return; }
      if (!st) return;
      m.colorOn = st.c !== false; m.ref = st.r || null; m.mode = st.m === 'gapped' ? 'gapped' : 'ungapped';
      m.selected = new Set((st.s || []).filter(function (c) { return c >= 1 && c <= m.L; })); m.hiWidth = Math.max(0, +st.w || 0);
      m.scheme = schemeOf({ type: m.type, scheme: st.sc }).key; m.custom = st.cu && typeof st.cu === 'object' ? st.cu : {};
      m.consOn = !!st.cs; m.consLevel = CONS_LEVELS.some(function (x) { return x[0] === +st.ct; }) ? +st.ct : 50;
      m.colWidth = {}; if (st.cw && typeof st.cw === 'object') Object.keys(st.cw).forEach(function (k) { var v = +st.cw[k]; if (v > 0 && +k >= 1 && +k <= m.L) m.colWidth[+k] = v; });
      if ($('msaCons' + id)) { $('msaCons' + id).checked = m.consOn; $('msaConsLevel' + id).value = String(m.consLevel); consUi(); }
      if ($('msaScheme' + id)) $('msaScheme' + id).value = m.scheme;
      $('msaColor' + id).checked = m.colorOn;
      $(m.mode === 'gapped' ? 'msaModeG' + id : 'msaModeU' + id).checked = true;
      $('msaHiWidth' + id).value = String(m.hiWidth);
      changed(m, 'all');
    });
    ['msaModeU', 'msaModeG'].forEach(function (k) {
      $(k + id).addEventListener('change', function (ev) { if (ev.target.checked) { m.mode = ev.target.value; saveState(m); refreshList(m); } });
    });
    var wIn = $('msaHiWidth' + id);
    var applyWidth = function () {
      var v = Math.max(0, Math.min(400, Math.round(+wIn.value || 0)));
      if (v === m.hiWidth) return;
      m.hiWidth = v; changed(m, 'width');
    };
    wIn.addEventListener('change', applyWidth);
    wIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyWidth(); } });
    $('msaClear' + id).addEventListener('click', function () { if (!m.selected.size) return; m.selected.clear(); changed(m, 'sel'); setStatus('Highlights removed'); });
    var groupWidth = function (inp) {
      var chip = inp.closest('.msa-chip'), v = Math.max(0, Math.min(400, Math.round(+inp.value || 0)));
      if (!m.colWidth) m.colWidth = {};
      for (var c = +chip.getAttribute('data-c0'); c <= +chip.getAttribute('data-c1'); c++) { if (v > 0) m.colWidth[c] = v; else delete m.colWidth[c]; }
      changed(m, 'width');
      setStatus(v > 0 ? 'Columns ' + chip.getAttribute('data-c0') + (chip.getAttribute('data-c1') !== chip.getAttribute('data-c0') ? '–' + chip.getAttribute('data-c1') : '') + ': ' + v + ' px wide' : 'Columns back to the default width');
    };
    $('msaHi' + id).addEventListener('change', function (e) { if (e.target.classList.contains('msa-chip-w')) groupWidth(e.target); });
    $('msaHi' + id).addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('msa-chip-w')) { e.preventDefault(); e.target.blur(); } });
    $('msaHi' + id).addEventListener('click', function (e) {
      var x = e.target.closest('.msa-chip-x');
      if (!x) return;
      var chip = x.closest('.msa-chip'), cols = [];
      for (var c = +chip.getAttribute('data-c0'); c <= +chip.getAttribute('data-c1'); c++) { cols.push(c); if (m.colWidth) delete m.colWidth[c]; }
      toggleColumns(m, cols, false);
    });
    // filter
    var filt = $('msaFilter' + id), ft = null;
    filt.value = m.filter || '';
    filt.addEventListener('input', function () { clearTimeout(ft); ft = setTimeout(function () { m.filter = filt.value; refreshList(m); }, 120); });
    filt.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(ft); m.filter = filt.value; refreshList(m); selectShown(m); }
      else if (e.key === 'Escape' && filt.value) { e.preventDefault(); e.stopPropagation(); filt.value = ''; m.filter = ''; refreshList(m); }
    });
    $('msaFilterClear' + id).addEventListener('click', function () { filt.value = ''; m.filter = ''; refreshList(m); filt.focus(); });
    $('msaSelShown' + id).addEventListener('click', function () { selectShown(m); });
    // the positions list: click toggles, Shift+click a range
    var list = $('msaPosList' + id);
    list.addEventListener('mousedown', function (e) { if (e.shiftKey) e.preventDefault(); });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('.msa-pos');
      if (!row) return;
      var c = +row.getAttribute('data-col');
      if (e.shiftKey && m._anchor) {
        var shown = (m._shown || []).map(function (x) { return x.c; });
        var a = shown.indexOf(m._anchor), b = shown.indexOf(c);
        if (a >= 0 && b >= 0) {
          var cols = shown.slice(Math.min(a, b), Math.max(a, b) + 1);
          toggleColumns(m, cols, !m.selected.has(c) || m.selected.has(m._anchor));
          return;
        }
      }
      m._anchor = c;
      toggleColumns(m, [c]);
    });
    // the reference: a find box with suggestions
    var find = $('msaFind' + id), sug = $('msaFindList' + id), active = -1, items = [];
    function close() { sug.hidden = true; find.setAttribute('aria-expanded', 'false'); active = -1; }
    function suggest() {
      var q = find.value.trim().toLowerCase();
      if (!q) { close(); return; }
      // alignment names, and tree tips (a tip shows the sequence it is matched to, or why it has none)
      var used = rowsInTree(m), hits = [], seen = new Set();
      for (var i = 0; i < m.ids.length; i++) {
        var at = m.ids[i].toLowerCase().indexOf(q);
        if (at < 0) continue;
        seen.add(i);
        hits.push({ label: m.ids[i], row: i, at: at, score: (at === 0 ? 0 : 2) + (used.has(i) ? 0 : 1), note: used.has(i) ? '' : 'not in the tree' });
      }
      tipRows(m).forEach(function (t) {
        var at2 = t.name.toLowerCase().indexOf(q);
        if (at2 < 0 || (t.row >= 0 && seen.has(t.row) && m.ids[t.row] === t.name)) return;
        if (t.row >= 0) { if (seen.has(t.row)) return; seen.add(t.row); hits.push({ label: t.name, row: t.row, at: at2, score: at2 === 0 ? 0 : 2, note: 'sequence ' + m.ids[t.row] }); }
        else hits.push({ label: t.name, row: -1, at: at2, score: 4, note: 'tree tip without a sequence: ' + noSequenceReason(m, t.name) });
      });
      hits.sort(function (x, y) { return x.score - y.score || x.label.localeCompare(y.label); });
      items = hits.slice(0, 40);
      var esc = escapeHTML;
      sug.innerHTML = items.length ? items.map(function (h, i) {
        var s2 = h.label, a2 = h.at, b2 = a2 + q.length;
        return '<div class="msa-sug' + (h.row < 0 ? ' is-off' : '') + '" role="option" id="msaSug' + id + '_' + i + '" data-i="' + i + '"' + (h.row < 0 ? ' aria-disabled="true"' : '') + '>' +
          esc(s2.slice(0, a2)) + '<b>' + esc(s2.slice(a2, b2)) + '</b>' + esc(s2.slice(b2)) + (h.note ? '<span class="msa-sug-note">' + esc(h.note) + '</span>' : '') + '</div>';
      }).join('') + (hits.length > items.length ? '<div class="msa-sug-more">' + (hits.length - items.length) + ' more – type more of the name</div>' : '')
        : '<div class="msa-sug-more">No accession in this alignment or the tree contains “' + esc(find.value.trim()) + '”</div>';
      sug.hidden = false; find.setAttribute('aria-expanded', 'true');
      active = -1; for (var j = 0; j < items.length; j++) if (items[j].row >= 0) { active = j; break; }
      mark();
    }
    function mark() {
      Array.prototype.forEach.call(sug.querySelectorAll('.msa-sug'), function (el, i) { el.classList.toggle('is-active', i === active); if (i === active) { find.setAttribute('aria-activedescendant', el.id); if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); } });
    }
    function pick(i) { var h = items[i]; if (!h || h.row < 0) return; close(); find.value = ''; setRef(m, m.ids[h.row]); }
    find.addEventListener('input', suggest);
    find.addEventListener('focus', function () { if (find.value.trim()) suggest(); });
    find.addEventListener('keydown', function (e) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !sug.hidden) {
        e.preventDefault();
        var d = e.key === 'ArrowDown' ? 1 : -1, j = active;
        do { j += d; } while (j >= 0 && j < items.length && items[j].row < 0);
        if (j >= 0 && j < items.length) { active = j; mark(); }
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (!sug.hidden && active >= 0) pick(active);
        else {
          // an exact name
          var r = rowForName(m, find.value.trim());
          if (r >= 0) { find.value = ''; close(); setRef(m, m.ids[r]); } else suggest();
        }
      } else if (e.key === 'Escape') { if (!sug.hidden || find.value) { e.preventDefault(); e.stopPropagation(); if (!sug.hidden) close(); else find.value = ''; } }
    });
    find.addEventListener('blur', function () { setTimeout(close, 150); });
    sug.addEventListener('mousedown', function (e) { e.preventDefault(); var el = e.target.closest('.msa-sug'); if (el) pick(+el.getAttribute('data-i')); });
    $('msaFindClear' + id).addEventListener('click', function () { find.value = ''; close(); find.focus(); });
    $('msaRef' + id).addEventListener('click', function (e) { if (e.target.closest('.msa-ref-x')) setRef(m, null); });
  }
  function selectShown(m) {
    var cols = (m._shown || []).map(function (x) { return x.c; });
    if (!cols.length) return;
    cols.forEach(function (c) { m.selected.add(c); });
    changed(m, 'sel');
    setStatus('Highlighted ' + cols.length + ' column' + (cols.length === 1 ? '' : 's'));
  }

  // ------------------------------------------------------- add / remove
  function relayoutPanels() {
    var heat = document.querySelectorAll('.heatmap-panel').length, df = document.querySelectorAll('.dataframe-panel').length;
    var ch = document.querySelectorAll('.chart-panel').length, al = msaPanelCount();
    var ph = df === 0 && ch === 0 && al === 0;
    panelCount = 2 + (ph ? 1 : 0) + heat + df + ch + al;
    window.panelCount = panelCount;
    initializePanels();
    call(function () { updatePanelHeights(); });
    if (window.radialPanelSystem && geometry === 'radial' && typeof window.radialPanelSystem.sync === 'function') call(function () { window.radialPanelSystem.sync(); });
  }
  async function handleMsaFile(f) {
    var text;
    try { text = await readFileAsText(f); } catch (e) { setStatus('Alignment: the file could not be read'); return null; }
    var name = (f && f.name) || 'alignment';
    var a;
    try { a = parseAlignment(text); } catch (e) { console.error(e); setStatus('Alignment parse error: ' + e.message); return null; }
    if (!a.ids.length || !a.L) {
      var why = a.skipped.length ? a.skipped.length + ' rows, none of them an aligned sequence (' + a.skipped[0].why + ')' : 'no sequences found';
      setStatus('Alignment not loaded: ' + why);
      alert('This file could not be read as a sequence alignment: ' + why + '.\n\nAccepted: FASTA, Clustal, Stockholm, PHYLIP, or a table with an accession column and an aligned-sequence column.');
      return null;
    }
    var id = msas.size + 1;
    var m = { id: id, name: name, format: a.format, ids: a.ids, seqs: a.seqs, byAcc: a.byAcc, L: a.L, type: a.type, skipped: a.skipped,
      colorOn: true, ref: null, mode: 'ungapped', filter: '', selected: new Set(), hiWidth: 0, scheme: null, custom: {}, consOn: false, consLevel: 50, colWidth: {}, _ver: 0 };
    m.scheme = schemeOf(m).key;
    indexNames(m);
    msas.set(id, m);
    // only one card open at a time
    document.querySelectorAll('aside details[open]').forEach(function (d) { d.removeAttribute('open'); });
    var box = $('msaContainer');
    if (!box) { msas.delete(id); return null; }
    makeCard(m, box);
    call(function () { updateSectionVisibilities(); });
    relayoutPanels();
    if (typeof setDrawScope === 'function') setDrawScope('all');
    if (root) drawTree();
    call(function () { updateMetadataLegend(); });
    call(function () { updateZoomBounds(); });
    refreshInfo(m);
    var tr = tipRows(m), inTree = tr.filter(function (t) { return t.row >= 0; }).length;
    setStatus('Alignment loaded: ' + a.ids.length + ' sequences × ' + a.L + ' columns' + (root ? ', ' + inTree + ' of ' + tr.length + ' tips have a sequence' : '') + (a.skipped.length ? ' (' + a.skipped.length + ' rows of the file skipped)' : ''));
    return m;
  }
  // ids follow the card order (1..n)
  function renumber() {
    var box = $('msaContainer');
    var cards = box ? Array.prototype.filter.call(box.children, function (c) { return c.classList.contains('msa-panel'); }) : [];
    var old = new Map(msas), next = new Map();
    cards.forEach(function (card, i) {
      var m = old.get(+card.getAttribute('data-msaid'));
      if (!m) return;
      var nid = i + 1;
      if (m.id !== nid) {
        var wasOpen = card.open;
        m.id = nid;
        fillCard(card, m);
        card.open = wasOpen;
      }
      next.set(nid, m);
    });
    msas.clear();
    next.forEach(function (v, k) { msas.set(k, v); });
  }
  function deleteMsaCard(id) {
    var m = msas.get(id), card = m && cardOf(m);
    if (!m) return;
    var index = Array.from(msas.keys()).sort(function (a, b) { return a - b; }).indexOf(id);
    if (card) card.remove();
    msas.delete(id);
    if (index >= 0 && radialMsaWidths.length > index) radialMsaWidths.splice(index, 1);
    renumber();
    hideTip();
    call(function () { updateSectionVisibilities(); });
    if (typeof setDrawScope === 'function') setDrawScope('all');
    updatePanelSystemAfterDeletion();
    call(function () { updateMetadataLegend(); });
    setStatus('Alignment removed');
  }
  function reorderFromCards() {
    var before = Array.from(msas.values());
    renumber();
    var after = Array.from(msas.values());
    // the circular ring widths follow their alignments
    var widths = before.map(function (m, i) { return radialMsaWidths[i]; });
    after.forEach(function (m, i) { radialMsaWidths[i] = widths[before.indexOf(m)]; });
    if (typeof setDrawScope === 'function') setDrawScope('all');
    if (root) drawTree();
    call(function () { updateMetadataLegend(); });
  }

  // ---------------------------------------------------------------- legend
  function fillLegend() {
    var box = $('msaLegendItems'), title = document.querySelector('#metadataLegend .msa-legend-title');
    if (!box) return;
    var esc = escapeHTML, html = '';
    var item = function (label, color) { return '<div class="legend-item"><div class="legend-color" style="background-color: ' + color + ';"></div><span>' + esc(label) + '</span></div>'; };
    var shown = Array.from(msas.values()).filter(function (m) { return m.hasMatchingData !== false; });
    shown.forEach(function (m) {
      var groups = colourGroups(m), coloured = m.colorOn || m.selected.size;
      if (shown.length > 1) html += '<div class="legend-subtitle">Alignment ' + m.id + '</div>';
      if (coloured) html += groups.filter(function (g) { return !g.grey; }).map(function (g) { return item(g.label, g.color); }).join('');
      if (!m.colorOn) html += item(m.selected.size ? 'Grey (columns not highlighted)' : 'Residues (colours off)', lutOf(m).greyCss);
      else if (m.consOn) html += item('Not the consensus (' + CONS_LEVELS.filter(function (x) { return x[0] === (m.consLevel || 50); })[0][1].toLowerCase() + ')', lutOf(m).greyCss);
    });
    box.innerHTML = html;
    if (title) title.style.display = html ? 'block' : 'none';
  }

  window.handleMsaFile = handleMsaFile;
  window.deleteMsaCard = deleteMsaCard;
  window.updateMsaOrder = function () { reorderFromCards(); };
  // every row of an alignment file as accession + sequence (also the rows that are skipped;
  // for the data editor), and the file's format
  function records(text) {
    var read = readRecords(text);
    return { format: read.format, rows: read.recs.filter(function (r) { return !r.header; }).map(function (r) { return [r.id, r.raw]; }) };
  }
  window.tmMsa = { drawRect: drawRect, drawRadial: drawRadial, reorderFromCards: reorderFromCards, fillLegend: fillLegend,
    parse: parseAlignment, records: records, vectorize: vectorize, layout: columnLayout, rowForName: rowForName, columnOfPosition: columnOfPosition, positionsOf: positionsOf,
    get: function (id) { return msas.get(id); },
    // where a cell is on screen (client coordinates; for tests)
    cellScreen: function (id, name, c) {
      var m = msas.get(id), g = m && m._geo;
      if (!g || !g.node.isConnected) return null;
      var leaf = g.leaves.filter(function (d) { return String(d.data.name) === String(name); })[0];
      if (!leaf) return null;
      var mid = (g.lay.starts[c - 1] + g.lay.starts[c]) / 2, x, y;
      if (g.kind === 'rect') { x = g.x0 + mid; y = leaf.x; }
      else { var r = g.r0 + mid; x = r * Math.sin(leaf.a); y = -r * Math.cos(leaf.a); }
      var t = g.node.getScreenCTM();
      var k = Math.hypot(t.a, t.b);
      return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f, w: (g.lay.starts[c] - g.lay.starts[c - 1]) * k, h: (g.boxH || 0) * k };
    } };

  // the "Alignment" button of the Add data menu
  var addBtn = $('addMsaOption');
  if (addBtn) addBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var sub = $('addDataframeSubcard'), main = $('addDataframe');
    if (sub) sub.style.display = 'none';
    if (main) main.classList.remove('active');
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fa,.fasta,.fas,.faa,.fna,.afa,.aln,.clustal,.sto,.stk,.stockholm,.phy,.phylip,.txt,.tsv,.csv';
    input.style.display = 'none';
    input.addEventListener('change', async function () {
      var file = input.files && input.files[0];
      if (file) { try { await window.handleMsaFile(file); } catch (e) { console.error(e); setStatus('Error loading the alignment'); } }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
})();
