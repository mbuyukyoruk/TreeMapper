// Undo / redo for tree edits and colours (loaded after app.js).
//
// Covered: rotate, collapse/expand, cartoon, drop, isolate, colour clade,
// colour search matches, clade background highlight, the Reset-menu actions
// and edits in the "Colours & highlights" list. These all change the current
// tree in place, so a snapshot of every node's child lists plus the app's
// edit/colour records restores the exact earlier state.
//
// Re-rooting, re-applying the original root and loading a new tree build a
// new tree; the history stops there (undo past that point is not offered).
(function () {
  'use strict';
  var LIMIT = 40;
  var undoStack = [], redoStack = [];
  var listeners = [];

  // buttons whose click is an undoable edit (the label is shown as "Undo <label>")
  var ACTIONS = {
    rotateClade: 'rotate', collapseClade: 'collapse', cartoonClade: 'cartoon',
    applyCladeColor: 'clade colour', applyHighlightBackground: 'highlight', applyPathColor: 'match colour',
    dropNode: 'drop', isolateNodes: 'isolate', isolateLUCA: 'isolate',
    resetPathColors: 'reset branch colours', resetHighlights: 'reset highlights', clearAllColors: 'clear colours',
    resetRotations: 'undo rotations', resetCollapses: 'expand all', resetCartoons: 'undo cartoons',
    restoreDroppedNodes: 'restore dropped'
  };
  // actions that also untick Clade layer cards (their card state is restored too)
  var TOUCHES_CARDS = { resetPathColors: 1, clearAllColors: 1 };

  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isLayerKey(k) { return typeof k === 'string' && k.indexOf('clade_path_') === 0; }

  function collectNodes() {
    var out = [], seen = new Set(), stack = [root];
    droppedNodes.forEach(function (n) { stack.push(n); });
    while (stack.length) {
      var n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n); out.push(n);
      [n.children, n._children, n._originalChildren].forEach(function (c) { if (c) for (var i = 0; i < c.length; i++) stack.push(c[i]); });
    }
    return out;
  }

  function cardState() {
    var out = [];
    call(function () {
      clades.forEach(function (cd, id) {
        var master = document.getElementById('cladeToggle' + id);
        var box = document.getElementById('cladeData' + id);
        out.push({
          id: id, data: cd,
          vis: cd.valueVisibility ? new Map(cd.valueVisibility) : null,
          master: master ? master.checked : null,
          values: box ? Array.prototype.map.call(box.querySelectorAll('.clade-value-toggle'), function (c) { return [c, c.checked]; }) : []
        });
      });
    });
    return out;
  }

  function snapshot(label, id) {
    if (!root) return null;
    var nodes = collectNodes().map(function (n) {
      return {
        n: n,
        c: n.children ? n.children.slice() : n.children,
        cc: n._children ? n._children.slice() : n._children,
        oc: Object.prototype.hasOwnProperty.call(n, '_originalChildren') && n._originalChildren ? n._originalChildren.slice() : undefined,
        pc: n.permanentColors && n.permanentColors.size ? new Map(n.permanentColors) : null
      };
    });
    return {
      label: label, id: id, root: root, nodes: nodes,
      dropped: new Set(droppedNodes), collapsed: new Set(collapsedNodes), collapsedAcc: new Set(collapsedAccessions),
      cartooned: new Set(cartoonedNodes), rotations: new Map(nodeRotationCounts),
      cladeColors: new Map(cladeColors), cladeColorTs: new Map(cladeColorTs), bg: new Map(cladeBackgroundColors),
      pathLeafNames: window.pathLeafNames ? new Map(window.pathLeafNames) : null,
      pathCounter: pathCounter, colorActionCounter: colorActionCounter,
      cards: TOUCHES_CARDS[id] ? cardState() : null
    };
  }

  // ---- equality, to skip clicks that changed nothing (e.g. no selection)
  function sameArr(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sameMap(a, b) {
    if (a === b) return true;
    if (!a || !b) return !(a && a.size) && !(b && b.size);
    if (a.size !== b.size) return false;
    var same = true;
    a.forEach(function (v, k) {
      if (!same) return;
      if (!b.has(k)) { same = false; return; }
      var w = b.get(k);
      if (v === w) return;
      if (v && w && typeof v === 'object' && typeof w === 'object' && v.color === w.color && v.ts === w.ts) return;
      same = false;
    });
    return same;
  }
  function sameSet(a, b) {
    if (a.size !== b.size) return false;
    var same = true; a.forEach(function (v) { if (!b.has(v)) same = false; }); return same;
  }
  function sameState(a, b) {
    if (a.root !== b.root || a.nodes.length !== b.nodes.length) return false;
    var byNode = new Map(); b.nodes.forEach(function (r) { byNode.set(r.n, r); });
    for (var i = 0; i < a.nodes.length; i++) {
      var x = a.nodes[i], y = byNode.get(x.n);
      if (!y || !sameArr(x.c, y.c) || !sameArr(x.cc, y.cc) || !sameArr(x.oc, y.oc) || !sameMap(x.pc, y.pc)) return false;
    }
    return sameSet(a.dropped, b.dropped) && sameSet(a.collapsed, b.collapsed) && sameSet(a.cartooned, b.cartooned) &&
      sameMap(a.rotations, b.rotations) && sameMap(a.cladeColors, b.cladeColors) && sameMap(a.bg, b.bg);
  }

  function refill(target, source) {
    target.clear();
    if (target instanceof Map) source.forEach(function (v, k) { target.set(k, v); });
    else source.forEach(function (v) { target.add(v); });
  }

  function restore(s) {
    var keepLayer = !s.cards;   // keep the Clade layer colours as they are now unless the action changed the cards
    s.nodes.forEach(function (r) {
      var n = r.n;
      n.children = r.c ? r.c.slice() : r.c;
      n._children = r.cc ? r.cc.slice() : r.cc;
      if (r.oc !== undefined) n._originalChildren = r.oc.slice(); else delete n._originalChildren;
      var next = r.pc ? new Map(r.pc) : new Map();
      if (keepLayer) {
        next.forEach(function (v, k) { if (isLayerKey(k)) next.delete(k); });
        if (n.permanentColors) n.permanentColors.forEach(function (v, k) { if (isLayerKey(k)) next.set(k, v); });
      }
      if (next.size || n.permanentColors) n.permanentColors = next;
    });
    refill(droppedNodes, s.dropped);
    refill(collapsedNodes, s.collapsed);
    refill(collapsedAccessions, s.collapsedAcc);
    refill(cartoonedNodes, s.cartooned);
    refill(nodeRotationCounts, s.rotations);
    refill(cladeColors, s.cladeColors);
    refill(cladeColorTs, s.cladeColorTs);
    refill(cladeBackgroundColors, s.bg);
    if (s.pathLeafNames) {
      if (!window.pathLeafNames) window.pathLeafNames = new Map();
      var layer = [];
      if (keepLayer) window.pathLeafNames.forEach(function (v, k) { if (isLayerKey(k)) layer.push([k, v]); });
      window.pathLeafNames.clear();
      s.pathLeafNames.forEach(function (v, k) { if (!keepLayer || !isLayerKey(k)) window.pathLeafNames.set(k, v); });
      layer.forEach(function (e) { window.pathLeafNames.set(e[0], e[1]); });
    }
    // counters only move forward, so new colour keys never collide with restored ones
    pathCounter = Math.max(pathCounter, s.pathCounter);
    colorActionCounter = Math.max(colorActionCounter, s.colorActionCounter);
    if (s.cards) s.cards.forEach(function (c) {
      if (c.vis && c.data.valueVisibility) refill(c.data.valueVisibility, c.vis);
      var master = document.getElementById('cladeToggle' + c.id);
      if (master && c.master !== null) master.checked = c.master;
      c.values.forEach(function (e) { e[0].checked = e[1]; });
    });

    call(function () { highlightedClade = null; highlightedClades.clear(); });
    call(clearCladeSelection);
    call(resetFontTruncationCache);
    call(resetEventDelegation);
    [updateRestoreDroppedButtonVisibility, updateResetRotationsButtonVisibility, updateResetCollapsesButtonVisibility,
     updateResetCartoonsButtonVisibility, updateResetHighlightsButtonVisibility, updateColorPathCardVisibility,
     updateMetadataLegend].forEach(call);
    drawTree();
  }

  function valid(s) { return s && s.root === root && !!root; }
  function prune() {
    // a re-root or a new tree makes earlier snapshots unusable
    if (undoStack.length && !valid(undoStack[undoStack.length - 1])) undoStack.length = 0;
    if (redoStack.length && !valid(redoStack[redoStack.length - 1])) redoStack.length = 0;
  }
  function notify() { prune(); listeners.forEach(function (f) { call(f); }); }

  function push(before) {
    undoStack.push(before);
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack.length = 0;
    notify();
  }

  // begin(label, id) before changing anything; call the returned function
  // once the change is done (it records the step only if something changed)
  function begin(label, id) {
    var before = snapshot(label, id);
    return function () {
      if (!before) return;
      var after = snapshot(label, id);
      if (after && !sameState(before, after)) push(before);
    };
  }

  function undo() {
    prune();
    var s = undoStack.pop();
    if (!s) return false;
    redoStack.push(snapshot(s.label, s.id));
    restore(s);
    call(function () { setStatus('Undid ' + s.label); });
    notify();
    return true;
  }
  function redo() {
    prune();
    var s = redoStack.pop();
    if (!s) return false;
    undoStack.push(snapshot(s.label, s.id));
    restore(s);
    call(function () { setStatus('Redid ' + s.label); });
    notify();
    return true;
  }

  // record clicks on the app's edit buttons (capture phase: runs before the app's own handler)
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn || !ACTIONS[btn.id] || btn.disabled || !root) return;
    var done = begin(ACTIONS[btn.id], btn.id);
    // some actions redraw on a timer; check once they have finished
    setTimeout(done, 60);
  }, true);

  window.tmUndo = {
    undo: undo, redo: redo, begin: begin,
    canUndo: function () { prune(); return undoStack.length > 0; },
    canRedo: function () { prune(); return redoStack.length > 0; },
    undoLabel: function () { return undoStack.length ? undoStack[undoStack.length - 1].label : ''; },
    redoLabel: function () { return redoStack.length ? redoStack[redoStack.length - 1].label : ''; },
    onChange: function (f) { listeners.push(f); },
    refresh: notify
  };
})();
