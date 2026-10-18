// Tree model: Newick parsing and writing, and re-rooting.
// Pure functions on plain objects { name, length, label, bootstrap, supports, annot, children } -
// no page code, so it can be tested on its own (TreeMapper_tests/regress/treecore.js).
//
// Branch values. A node's `length` and support values describe the branch ABOVE the node
// (between the node and its parent): a support value belongs to the split that branch
// makes. Re-rooting reverses the branches on the path to the new root, so those values move
// with their branch to the node that is now below it. Tip and clade names stay with nodes.
(function (global) {
  'use strict';

  // values that describe the branch above a node
  var EDGE_KEYS = ['length', 'label', 'bootstrap', 'supports', 'annot', 'bs'];
  var SUPPORT_KEYS = ['label', 'bootstrap', 'supports', 'annot', 'bs'];
  var NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  var SUPPORT_RE = new RegExp('^' + NUM + '(?:/' + NUM + ')*$');   // 95  0.98  95/88  80.5/97/1

  // ------------------------------------------------------------------ parse
  // Reads the first tree of a Newick string. Handles quoted labels ('a b', 'it''s',
  // "x"), [comments] (ignored), [&key=value,...] annotations (MrBayes, BEAST) and
  // RAxML-style [95] branch support after a length. An internal label made of numbers
  // (95, 0.98, 95/88) is support; any other internal label is a clade name.
  function parse(text) {
    var s = String(text), i = 0, n = s.length;
    var root = {}, cur = root, stack = [];
    var afterClose = false;   // the next label belongs to the node just closed

    function readQuoted(q) {
      var out = '';
      i++;   // opening quote
      while (i < n) {
        var c = s[i];
        if (c === q) {
          if (s[i + 1] === q) { out += q; i += 2; continue; }   // '' inside quotes
          i++; return out;
        }
        out += c; i++;
      }
      return out;   // unclosed quote: rest of the text
    }
    function readComment() {
      var start = ++i, depth = 1;
      while (i < n && depth) { if (s[i] === '[') depth++; else if (s[i] === ']') depth--; i++; }
      return s.slice(start, depth ? n : i - 1);
    }
    function applyComment(node, body) {
      var t = body.trim();
      if (t[0] === '&') {
        // [&posterior=0.99,height_95%_HPD={1,2},!name="x"]
        var a = node.annot || {}, re = /([^=,{}]+)=(\{[^}]*\}|"[^"]*"|[^,]*)/g, m, any = false;
        while ((m = re.exec(t.slice(1)))) {
          var k = m[1].trim().replace(/^!/, ''), v = m[2].trim(), num = +v;
          if (k && v !== '' && v[0] !== '{' && isFinite(num)) { a[k] = num; any = true; }
        }
        if (any) node.annot = a;
      } else if (new RegExp('^' + NUM + '$').test(t) && node.label === undefined && node !== root) {
        // RAxML "branch labels" trees: A:0.12[95]
        setSupportLabel(node, t);
      }
    }
    function readLabel() {
      var start = i;
      while (i < n && '(),:;['.indexOf(s[i]) < 0) i++;
      return s.slice(start, i).trim();
    }
    function setLabel(node, raw, quoted) {
      if (raw === '') return;
      if (afterClose && !quoted && SUPPORT_RE.test(raw)) setSupportLabel(node, raw);
      else node.name = raw;
    }

    while (i < n) {
      var c = s[i];
      if (c === '(') {
        var kid = {};
        cur.children = [kid]; stack.push(cur); cur = kid; afterClose = false; i++;
      } else if (c === ',') {
        if (!stack.length) break;   // malformed: a comma outside any brackets
        var sib = {};
        stack[stack.length - 1].children.push(sib); cur = sib; afterClose = false; i++;
      } else if (c === ')') {
        if (!stack.length) break;
        cur = stack.pop(); afterClose = true; i++;
      } else if (c === ':') {
        i++;
        while (i < n && /\s/.test(s[i])) i++;
        var st = i;
        while (i < n && '(),:;['.indexOf(s[i]) < 0 && !/\s/.test(s[i])) i++;
        var len = parseFloat(s.slice(st, i));
        if (!isNaN(len)) cur.length = len;
      } else if (c === ';') {
        break;
      } else if (c === '[') {
        applyComment(cur, readComment());
      } else if (c === "'" || c === '"') {
        setLabel(cur, readQuoted(c), true);
      } else if (/\s/.test(c)) {
        i++;
      } else {
        setLabel(cur, readLabel(), false);
      }
    }
    return root;
  }
  function setSupportLabel(node, raw) {
    var vals = raw.split('/').map(Number);
    node.label = raw;
    node.supports = vals;
    node.bootstrap = vals[0];
  }

  // ------------------------------------------------------------------ write
  // names with Newick punctuation or spaces are written in quotes (standard Newick)
  function quoteName(name) {
    var t = String(name);
    return /[(),:;\[\]'"\s]/.test(t) ? "'" + t.replace(/'/g, "''") + "'" : t;
  }
  function annotText(a) {
    if (!a) return '';
    var ks = Object.keys(a); if (!ks.length) return '';
    return '[&' + ks.map(function (k) { return k + '=' + a[k]; }).join(',') + ']';
  }
  // Writes a tree back to Newick; parse(write(t)) gives the same tree.
  function write(t) {
    var out = [];
    (function w(x) {
      if (x.children && x.children.length) {
        out.push('(');
        for (var k = 0; k < x.children.length; k++) { if (k) out.push(','); w(x.children[k]); }
        out.push(')');
        if (x.label !== undefined) out.push(String(x.label));
        else if (x.name !== undefined && x.name !== '') out.push(quoteName(x.name));
      } else if (x.name !== undefined) out.push(quoteName(x.name));
      out.push(annotText(x.annot));
      if (Number.isFinite(x.length)) out.push(':' + x.length);
    })(t);
    return out.join('') + ';';
  }

  // ------------------------------------------------------------------ helpers
  function kids(x) { return x.children && x.children.length ? x.children : null; }
  function clone(t) {
    var c = {};
    for (var k in t) if (k !== 'children' && Object.prototype.hasOwnProperty.call(t, k)) c[k] = t[k];
    if (c.supports) c.supports = c.supports.slice();
    if (c.annot) c.annot = Object.assign({}, c.annot);
    if (kids(t)) c.children = t.children.map(clone);
    return c;
  }
  function takeEdge(x) {
    var e = {};
    EDGE_KEYS.forEach(function (k) { if (k in x) { e[k] = x[k]; delete x[k]; } });
    return e;
  }
  function putEdge(x, e) { EDGE_KEYS.forEach(function (k) { delete x[k]; if (e && k in e && e[k] !== undefined) x[k] = e[k]; }); }
  function hasSupport(x) { return SUPPORT_KEYS.some(function (k) { return x[k] !== undefined; }); }
  function copySupport(from, to) { SUPPORT_KEYS.forEach(function (k) { if (from[k] !== undefined) to[k] = from[k]; }); }
  function sumLen(a, b) { return (a === undefined && b === undefined) ? undefined : (a || 0) + (b || 0); }
  function tipNames(x, out) {
    out = out || [];
    if (kids(x)) x.children.forEach(function (c) { tipNames(c, out); });
    else out.push(String(x.name === undefined ? '' : x.name));
    return out;
  }
  function parentMap(t) {
    var m = new Map();
    (function w(x) { if (kids(x)) x.children.forEach(function (c) { m.set(c, x); w(c); }); })(t);
    return m;
  }

  // Drops a root that has only two branches (or one) by joining its branches into one,
  // giving the same tree without a root position. A tree that keeps two tips is left alone.
  function unroot(t) {
    for (;;) {
      var k = kids(t);
      if (!k) return t;
      if (k.length === 1) { var only = k[0]; takeEdge(only); t = only; continue; }
      if (k.length !== 2) return t;
      var a = k[0], b = k[1];
      var keep = kids(a) ? a : (kids(b) ? b : null);
      if (!keep) return t;   // two tips: nothing to join
      var other = keep === a ? b : a;
      // the two root branches are one branch of the unrooted tree: same split, lengths add.
      // Its support: the one value there is, or with two different values the lower one
      // (never overstates support, and does not depend on the drawing order)
      var len = sumLen(a.length, b.length);
      var from = joinedSupport(a, b);
      if (from && from !== other) { SUPPORT_KEYS.forEach(function (k) { delete other[k]; }); copySupport(from, other); }
      takeEdge(keep);
      if (len === undefined) delete other.length; else other.length = len;
      if (keep === a) keep.children.push(other); else keep.children.unshift(other);
      t = keep;
    }
  }

  // which of two root branches gives its support to the joined branch (null: neither has one)
  function joinedSupport(a, b) {
    var ha = hasSupport(a), hb = hasSupport(b);
    if (!ha || !hb) return ha ? a : (hb ? b : null);
    var va = Number.isFinite(a.bootstrap) ? a.bootstrap : Infinity, vb = Number.isFinite(b.bootstrap) ? b.bootstrap : Infinity;
    return vb < va ? b : a;
  }

  // Joins a node left with one branch into its parent's branch (lengths add).
  function suppressUnary(node, parent) {
    var k = kids(node);
    if (!k || k.length !== 1 || !parent) return;
    var child = k[0];
    child.length = sumLen(node.length, child.length);
    if (child.length === undefined) delete child.length;
    if (!hasSupport(child) && hasSupport(node)) copySupport(node, child);
    var idx = parent.children.indexOf(node);
    parent.children.splice(idx, 1, child);
  }

  // Finds the branch that separates the tips in `side` from all other tips.
  // Returns { node, flipped }: the branch above `node`; flipped when the tips below
  // `node` are the other tips (so positions measured from `side` must be reversed).
  function findBranch(t, side) {
    var want = new Set(side.map(String)), all = tipNames(t), total = all.length;
    if (!want.size || want.size >= total) return null;
    var found = null;
    (function w(x, isRoot) {
      if (found) return [0, 0];
      var cnt = 0, inside = 0;
      if (kids(x)) x.children.forEach(function (c) { var r = w(c, false); cnt += r[0]; inside += r[1]; });
      else { cnt = 1; inside = want.has(String(x.name === undefined ? '' : x.name)) ? 1 : 0; }
      if (!found && !isRoot) {
        if (cnt === want.size && inside === cnt) found = { node: x, flipped: false };
        else if (cnt === total - want.size && inside === 0) found = { node: x, flipped: true };
      }
      return [cnt, inside];
    })(t, true);
    return found;
  }

  // Moves the root so that `newRoot` (an existing node, or a new node placed on the
  // branch above `below`) is the root. Branch values on the reversed path move one step.
  function reversePath(t, start, firstEdge, par) {
    // start: the node that becomes a child of the new root; firstEdge: its branch to the root
    var cur = start, carry = firstEdge, p = par.get(cur);
    while (cur) {
      var saved = takeEdge(cur);
      putEdge(cur, carry);
      carry = saved;
      if (!p) break;
      p.children.splice(p.children.indexOf(cur), 1);
      if (!cur.children) cur.children = [];
      cur.children.push(p);
      var gp = par.get(p);
      cur = p; p = gp;
      if (cur === t) {
        // the old root: takes the branch it now hangs from; its own (root) values are dropped
        takeEdge(cur); putEdge(cur, carry);
        break;
      }
    }
    return cur;   // the old root
  }

  // Roots the tree on the branch that separates `side` from the other tips.
  // frac: where on that branch, measured from the `side` end (0.5 = middle).
  // Returns the new tree, or null when no branch separates exactly those tips.
  function rootOnBranch(t0, side, frac) {
    // frac is normally 0..1; with negative branch lengths the saved position can lie outside
    var f0 = Number.isFinite(frac) ? frac : 0.5;
    // already rooted on that branch: only move the root along it (keeps order and labels)
    var k0 = kids(t0);
    if (k0 && k0.length === 2) {
      var key = side.map(String).sort().join('\u0001');
      var at = k0.findIndex(function (c) { return tipNames(c).sort().join('\u0001') === key; });
      if (at >= 0) {
        var c0 = clone(t0), a = c0.children[at], o = c0.children[1 - at], tot = sumLen(a.length, o.length);
        if (tot !== undefined) { a.length = tot * f0; o.length = tot * (1 - f0); }
        return c0;
      }
    }
    var t = unroot(clone(t0));
    var b = findBranch(t, side);
    if (!b) return null;
    var f = f0;
    if (b.flipped) f = 1 - f;
    var u = b.node, par = parentMap(t), p = par.get(u);
    var L = u.length, uEdge = takeEdge(u);
    var R = { children: [] };
    // u keeps its support (the split is the same); its branch is cut at the root
    putEdge(u, uEdge);
    if (L === undefined) delete u.length; else u.length = L * f;
    p.children.splice(p.children.indexOf(u), 1);
    var pEdge = L === undefined ? {} : { length: L * (1 - f) };
    var oldRoot = p === t ? (function () { takeEdge(p); putEdge(p, pEdge); return p; })()
                          : reversePath(t, p, pEdge, par);
    R.children.push(u, p);
    // the old root may be left with one branch (only possible in two- or three-tip trees)
    var par2 = parentMap(R);
    if (oldRoot !== R) suppressUnary(oldRoot, par2.get(oldRoot));
    return R;
  }

  // Roots the tree AT an existing node whose sides (its branches plus the way back to
  // the old root) hold exactly the tip sets in `sides` (sessions saved before 2026-10).
  function rootAtNode(t0, sides) {
    var t = unroot(clone(t0));
    var want = sides.map(function (s) { return s.map(String).sort().join('\u0001'); }).sort().join('\u0002');
    var all = new Set(tipNames(t)), par = parentMap(t), found = null;
    (function w(x) {
      if (found || !kids(x)) return;
      var ks = x.children.map(function (c) { return tipNames(c).sort().join('\u0001'); });
      if (x !== t) {
        var below = new Set(tipNames(x));
        ks.push(Array.from(all).filter(function (n) { return !below.has(n); }).sort().join('\u0001'));
      }
      if (ks.sort().join('\u0002') === want) { found = x; return; }
      x.children.forEach(w);
    })(t);
    if (!found) return null;
    if (found === t) return t;
    var p = par.get(found), e = takeEdge(found);
    p.children.splice(p.children.indexOf(found), 1);
    var oldRoot = p === t ? (function () { takeEdge(p); putEdge(p, e); return p; })() : reversePath(t, p, e, par);
    found.children.push(p);
    var par2 = parentMap(found);
    suppressUnary(oldRoot, par2.get(oldRoot));
    return found;
  }

  // Midpoint rooting: the root goes halfway along the longest path between two tips.
  // Returns { side, frac, length } for rootOnBranch, or null when the tree has no
  // branch lengths (or fewer than two tips).
  function midpoint(t0) {
    var t = unroot(clone(t0));
    if (!kids(t)) return null;
    var par = parentMap(t);
    var len = function (x) { return Number.isFinite(x.length) ? x.length : 0; };
    // for every node: the farthest tip below it (distance, tip)
    var down = new Map(), best = { d: -Infinity, a: null, b: null, via: null };
    (function w(x) {
      if (!kids(x)) { down.set(x, { d: 0, tip: x }); return; }
      var top = [];
      x.children.forEach(function (c) {
        w(c);
        var r = down.get(c);
        top.push({ d: r.d + len(c), tip: r.tip });
      });
      top.sort(function (p, q) { return q.d - p.d; });
      down.set(x, top[0]);
      if (top.length >= 2 && top[0].d + top[1].d > best.d) best = { d: top[0].d + top[1].d, a: top[0].tip, b: top[1].tip, via: x };
    })(t);
    if (!best.a || !(best.d > 0)) return null;
    // walk from tip a (the farther side) towards the meeting node until half the length
    var half = best.d / 2, acc = 0, x = best.a;
    while (x !== best.via) {
      var l = len(x);
      if (acc + l >= half) {
        var f = l > 0 ? (half - acc) / l : 0;
        return { side: tipNames(x), frac: f, length: best.d, tips: [String(best.a.name), String(best.b.name)] };
      }
      acc += l; x = par.get(x);
    }
    return null;   // cannot happen: the longer half reaches the midpoint first
  }

  // Describes the current root position independently of node objects: the tips on
  // each side, and for a two-sided root where it sits on the joined branch.
  function rootSpec(t) {
    var k = kids(t);
    if (!k) return null;
    if (k.length === 2) {
      var la = k[0].length, lb = k[1].length, tot = (la || 0) + (lb || 0);
      return { side: tipNames(k[0]), frac: tot !== 0 ? (la || 0) / tot : 0.5 };
    }
    return { sides: k.map(function (c) { return tipNames(c); }) };
  }

  // A root with two branches that carry different support values: once the root is
  // moved those two branches are one, which can keep only one value (see unroot).
  // Returns { values: [first, second], kept } or null.
  function rootBranchConflict(t) {
    var k = kids(t);
    if (!k || k.length !== 2 || !(kids(k[0]) || kids(k[1]))) return null;
    var a = k[0].label, b = k[1].label;
    if (a === undefined || b === undefined || String(a) === String(b)) return null;
    return { values: [String(a), String(b)], kept: String(joinedSupport(k[0], k[1]).label) };
  }

  // Tip-to-tip path length (for checks)
  function distances(t, names) {
    var par = parentMap(t), byName = new Map();
    (function w(x) { if (kids(x)) x.children.forEach(w); else byName.set(String(x.name), x); })(t);
    function up(x) { var m = new Map(), d = 0; while (x) { m.set(x, d); d += Number.isFinite(x.length) ? x.length : 0; x = par.get(x); } return m; }
    return names.map(function (pair) {
      var a = byName.get(pair[0]), b = byName.get(pair[1]); if (!a || !b) return NaN;
      var ua = up(a), y = b, e = 0;
      while (!ua.has(y)) { e += Number.isFinite(y.length) ? y.length : 0; y = par.get(y); }
      return ua.get(y) + e;
    });
  }

  global.TreeCore = {
    parse: parse, write: write, clone: clone, unroot: unroot,
    rootOnBranch: rootOnBranch, rootAtNode: rootAtNode, midpoint: midpoint, rootSpec: rootSpec, rootBranchConflict: rootBranchConflict,
    tipNames: tipNames, distances: distances, findBranch: findBranch, EDGE_KEYS: EDGE_KEYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.TreeCore;
})(typeof window !== 'undefined' ? window : globalThis);
