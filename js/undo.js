// Undo / redo for tree edits and colours (loaded after app.js).
//
// Covered: rotate, collapse/expand, cartoon, drop, isolate, colour clade,
// colour search matches, clade background highlight, the Reset-menu actions
// and edits in the "Colours & highlights" list. These all change the current
// tree in place, so a snapshot of every node's child lists plus the app's
// edit/colour records restores the exact earlier state.
//
// Re-rooting (button, Reset root, midpoint rooting) builds a new tree object;
// the earlier tree's nodes are kept in the snapshot, so undo switches back to
// them together with the rooting settings. Loading or generating a new tree
// clears the history.
(function () {
  'use strict';
  var LIMIT = 40;
  var undoStack = [], redoStack = [];
  var listeners = [];
  var suspended = false;   // while a session is being opened

  // buttons whose click is an undoable edit (the label is shown as "Undo <label>")
  var ACTIONS = {
    rotateClade: 'rotate', collapseClade: 'collapse', cartoonClade: 'cartoon',
    applyCladeColor: 'clade colour', applyHighlightBackground: 'highlight', applyPathColor: 'match colour',
    dropNode: 'drop', isolateNodes: 'isolate', isolateLUCA: 'isolate',
    resetPathColors: 'reset branch colours', resetHighlights: 'reset highlights', clearAllColors: 'clear colours',
    resetRotations: 'undo rotations', resetCollapses: 'expand all', resetCartoons: 'undo cartoons',
    restoreDroppedNodes: 'restore dropped'
  };
  // actions that replace the tree object (finished asynchronously)
  var REROOTS = { rerootTree: 're-root', resetRoot: 'reset root' };
  // actions that also untick Clade layer cards (their card state is restored too)
  var TOUCHES_CARDS = { resetPathColors: 1, clearAllColors: 1 };

  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function $(id) { return document.getElementById(id); }
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
        pc: n.permanentColors && n.permanentColors.size ? new Map(n.permanentColors) : null,
        dup: n._removedAsDuplicate
      };
    });
    return {
      label: label, id: id, root: root, nodes: nodes,
      dropped: new Set(droppedNodes), collapsed: new Set(collapsedNodes), collapsedAcc: new Set(collapsedAccessions),
      cartooned: new Set(cartoonedNodes), rotations: new Map(nodeRotationCounts),
      cladeColors: new Map(cladeColors), cladeColorTs: new Map(cladeColorTs), bg: new Map(cladeBackgroundColors),
      pathLeafNames: window.pathLeafNames ? new Map(window.pathLeafNames) : null,
      pathCounter: pathCounter, colorActionCounter: colorActionCounter,
      cards: TOUCHES_CARDS[id] ? cardState() : null,
      rooting: call(function () {
        return {
          newick: originalRootNewick, lastUser: lastKnownUserRoot, midpoint: wasMidpointActive,
          unique: uniqueBranchTips, uniqueChecked: ($('uniqueBranchTips') || {}).checked,
          enable: rootEnableEl ? rootEnableEl.checked : null, mode: rootModeEl ? rootModeEl.value : null,
          resetShown: resetRootBtn ? resetRootBtn.style.display : null
        };
      })
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
      if (!y || !sameArr(x.c, y.c) || !sameArr(x.cc, y.cc) || !sameArr(x.oc, y.oc) || !sameMap(x.pc, y.pc) || x.dup !== y.dup) return false;
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
    var keepLayer = !s.cards;
    if (s.root !== root) {
      // switch back to the other tree object (before/after a re-root)
      root = s.root;
      var r = s.rooting;
      if (r) call(function () {
        originalRootNewick = r.newick; lastKnownUserRoot = r.lastUser; wasMidpointActive = r.midpoint;
        uniqueBranchTips = r.unique;
        if ($('uniqueBranchTips')) $('uniqueBranchTips').checked = !!r.uniqueChecked;
        if (rootEnableEl && r.enable !== null) rootEnableEl.checked = r.enable;
        if (rootModeEl && r.mode !== null) { rootModeEl.value = r.mode; rootModeEl.disabled = rootEnableEl ? !rootEnableEl.checked : rootModeEl.disabled; }
        if (resetRootBtn && r.resetShown !== null) resetRootBtn.style.display = r.resetShown;
      });
    }   // keep the Clade layer colours as they are now unless the action changed the cards
    s.nodes.forEach(function (r) {
      var n = r.n;
      n.children = r.c ? r.c.slice() : r.c;
      n._children = r.cc ? r.cc.slice() : r.cc;
      if (r.oc !== undefined) n._originalChildren = r.oc.slice(); else delete n._originalChildren;
      if (r.dup === undefined) delete n._removedAsDuplicate; else n._removedAsDuplicate = r.dup;
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
    readRootUi();
  }

  function clearHistory() { undoStack.length = 0; redoStack.length = 0; }
  function prune() { if (!root) clearHistory(); }
  // a new tree (opened or generated) starts a fresh history
  ['resetAllFeaturesForNewTree', 'generateTreeFromGeneContent'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { clearHistory(); var out = orig.apply(this, arguments); setTimeout(notify, 0); return out; };
  });
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
    if (s.kind === 'ctl') {
      if (!applyCtl(s, true)) { notify(); return undo(); }   // its control is gone (card removed): skip the step
      redoStack.push(s);
    } else if (s.kind === 'data') {
      if (!applyData(s, true)) { notify(); return undo(); }
      redoStack.push(s);
    } else {
      redoStack.push(snapshot(s.label, s.id));
      restore(s);
    }
    call(function () { setStatus('Undid ' + s.label); });
    notify();
    return true;
  }
  function redo() {
    prune();
    var s = redoStack.pop();
    if (!s) return false;
    if (s.kind === 'ctl') {
      if (!applyCtl(s, false)) { notify(); return redo(); }
      undoStack.push(s);
    } else if (s.kind === 'data') {
      if (!applyData(s, false)) { notify(); return redo(); }
      undoStack.push(s);
    } else {
      undoStack.push(snapshot(s.label, s.id));
      restore(s);
    }
    call(function () { setStatus('Redid ' + s.label); });
    notify();
    return true;
  }

  // ---------------------------------------------------------- card and style settings
  // A change of a control in the side panel (layer cards, Style) is one step: the value
  // before is noted when the control is pressed or focused, the step recorded on its
  // change event. Undo writes the old value back and fires the control's events, so the
  // app applies it as if the user had set it. Quick repeated changes of one control (a
  // spinner, a slider) merge into one step; a step whose control has left the page is skipped.
  var prev = new Map(), applying = false, MERGE_MS = 1200;
  function readCtl(el) {
    if (el.tagName === 'BUTTON') return el.getAttribute('aria-pressed') === 'true';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value;
  }
  function writeCtl(el, v) {
    if (el.tagName === 'BUTTON') { if (readCtl(el) !== v) el.click(); return; }
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function controlOf(t) {
    if (!t || !t.closest) return null;
    var el = t.closest('input, select, textarea, button[aria-pressed]');
    if (!el) { var lab = t.closest('label'); if (lab) el = (lab.htmlFor && document.getElementById(lab.htmlFor)) || lab.querySelector('input, select, textarea'); }
    if (!el || !el.closest('.sidepanel') || el.disabled) return null;
    if (el.id === 'rootEnable' || el.id === 'rootMode') return null;   // re-rooting: recorded as a tree step above
    if (el.type === 'file' || el.type === 'search' || el.type === 'button' || el.type === 'submit' || el.classList.contains('pro-search') || el.closest('[data-session-skip], [data-no-undo]')) return null;
    if ((el.tagName === 'INPUT' && (el.type === 'text' || !el.type) || el.tagName === 'TEXTAREA') && !el.closest('.sidepanel details')) return null;   // free text outside cards (search boxes) is the browser's own undo
    return el;
  }
  function groupOf(el) { return (el.type === 'radio' && el.name) ? Array.prototype.slice.call(document.querySelectorAll('input[type="radio"][name="' + el.name + '"]')) : null; }
  function valueOf(el) { var g = groupOf(el); if (g) { var on = g.filter(function (r) { return r.checked; })[0]; return on ? on.value : null; } return readCtl(el); }
  function labelOf(el) {
    var t = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!t) { var lab = el.closest('label') || (el.id ? document.querySelector('label[for="' + el.id + '"]') : null); if (lab) t = (lab.querySelector('span') || lab).textContent; }
    if (!t) { var row = el.closest('.pro-row, .pro-field, .pro-list-row'); if (row) t = row.textContent; }
    t = String(t || el.id || el.name || 'setting').replace(/\s+/g, ' ').trim();
    if (t.length > 32) t = t.slice(0, 30) + '…';
    return t;
  }
  function keyOf(el) { return groupOf(el) ? 'radio:' + el.name : el; }
  // the last value seen of every control in the side panel (so a change made from a script
  // or the keyboard, with no press or focus first, still has its value before)
  var last = new Map();
  function remember(el) { last.set(keyOf(el), valueOf(el)); }
  function scan(n) { if (controlOf(n)) remember(n); if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll('input, select, textarea, button[aria-pressed]'), function (el) { if (controlOf(el)) remember(el); }); }
  var side = document.querySelector('.sidepanel');
  if (side) {
    scan(side);
    new MutationObserver(function (muts) { muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); }); }); }).observe(side, { childList: true, subtree: true });
  }
  function note(el) { if (!prev.has(el)) prev.set(el, { v: valueOf(el), t: Date.now() }); }
  ['pointerdown', 'focusin', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (suspended || applying) return; var el = controlOf(e.target); if (el) note(el); }, true);
  });
  document.addEventListener('input', function (e) { if (suspended || applying) return; var el = controlOf(e.target); if (el) note(el); }, true);   // a change made by script / a drag without pointerdown
  document.addEventListener('change', function (e) {
    var el = controlOf(e.target); if (!el) return;
    var key = keyOf(el), p = prev.get(el); prev.delete(el);
    var after = valueOf(el), before = p ? p.v : (last.has(key) ? last.get(key) : (el.type === 'checkbox' ? !el.checked : null));
    last.set(key, after);
    if (suspended || applying) return;
    if (before === null || before === after) return;
    var top = undoStack[undoStack.length - 1];
    if (top && top.kind === 'ctl' && top.key === key && Date.now() - top.at < MERGE_MS) { top.after = after; top.at = Date.now(); if (top.before === after) { undoStack.pop(); } notify(); return; }
    push({ kind: 'ctl', key: key, el: el, name: el.name, before: before, after: after, label: labelOf(el), at: Date.now() });
  });
  function applyCtl(s, back) {
    var el = s.el, v = back ? s.before : s.after;
    if (s.name && el.type === 'radio') {
      var r = document.querySelector('input[type="radio"][name="' + s.name + '"][value="' + String(v).replace(/"/g, '\\"') + '"]');
      if (!r || !r.isConnected) return false;
      applying = true; try { r.checked = true; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); } finally { applying = false; }
      return true;
    }
    if (!el || !el.isConnected) return false;
    applying = true; try { writeCtl(el, v); } finally { applying = false; }
    return true;
  }

  // re-rooting runs asynchronously: record it once the tree object has changed.
  // Only one is tracked at a time, so "enable rooting" + "midpoint" is one step.
  var pendingReroot = null;
  // rooting controls already show their new value when their change event
  // fires, so their previous values are tracked here
  var rootUi = { enable: null, mode: null };
  function readRootUi() { call(function () { rootUi = { enable: rootEnableEl ? rootEnableEl.checked : null, mode: rootModeEl ? rootModeEl.value : null }; }); }
  readRootUi();
  function beginReroot(label, id, fromControl) {
    if (pendingReroot) return;
    var before = snapshot(label, id);
    if (!before) return;
    if (fromControl && before.rooting) { before.rooting.enable = rootUi.enable; before.rooting.mode = rootUi.mode; }
    pendingReroot = before;
    var tries = 0;
    (function wait() {
      if (root && root !== before.root) { pendingReroot = null; if (!suspended) push(before); return; }
      if (++tries < 150) setTimeout(wait, 100);   // up to 15 s for very large trees
      else pendingReroot = null;
    })();
  }

  // record clicks on the app's edit buttons (capture phase: runs before the app's own handler)
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (suspended || !btn || btn.disabled || !root) return;
    if (REROOTS[btn.id]) { beginReroot(REROOTS[btn.id], btn.id); return; }
    if (!ACTIONS[btn.id]) return;
    var done = begin(ACTIONS[btn.id], btn.id);
    // some actions redraw on a timer; check once they have finished
    setTimeout(done, 60);
  }, true);
  // midpoint rooting on/off re-roots the tree too
  document.addEventListener('change', function (e) {
    var id = e.target && e.target.id;
    if (!suspended && (id === 'rootEnable' || id === 'rootMode') && root) beginReroot('rooting', id, true);
  }, true);
  document.addEventListener('change', function (e) {
    var id = e.target && e.target.id;
    if (id === 'rootEnable' || id === 'rootMode') setTimeout(readRootUi, 0);
  });

  // ---------------------------------------------------------- a layer's data replaced
  // A step holds the table before and after (feature-select.js: rows deleted); undo and redo
  // load the layer again through tmSession.replaceLayerData, which keeps the card's settings
  // and gives a new card (remembered for the next step). The reload is asynchronous.
  function pushData(step) {
    if (suspended || !step || !step.card) return;
    push({ kind: 'data', label: step.label || 'data change', card: step.card, before: step.before, after: step.after, at: Date.now() });
  }
  function applyData(s, back) {
    if (!s.card || !s.card.isConnected || !window.tmSession || typeof tmSession.replaceLayerData !== 'function') return false;
    var text = back ? s.before : s.after, card = s.card;
    applying = true;
    Promise.resolve(tmSession.replaceLayerData(card, text)).then(function (r) { if (r && r.ok && r.card) s.card = r.card; }).catch(function () {}).then(function () { applying = false; });
    return true;
  }

  // a layer reloaded with a new card (js/session.js replaceLayerData): its steps follow
  function cardReplaced(oldCard, newCard) {
    [undoStack, redoStack].forEach(function (st) { st.forEach(function (s) { if (s && s.kind === 'data' && s.card === oldCard) s.card = newCard; }); });
  }

  window.tmUndo = {
    undo: undo, redo: redo, begin: begin, pushData: pushData, cardReplaced: cardReplaced,
    canUndo: function () { prune(); return undoStack.length > 0; },
    canRedo: function () { prune(); return redoStack.length > 0; },
    undoLabel: function () { return undoStack.length ? undoStack[undoStack.length - 1].label : ''; },
    redoLabel: function () { return redoStack.length ? redoStack[redoStack.length - 1].label : ''; },
    onChange: function (f) { listeners.push(f); },
    suspend: function (on) { suspended = !!on; },
    clear: function () { clearHistory(); notify(); },
    refresh: notify
  };
})();
