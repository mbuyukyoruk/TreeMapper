// Recent sessions (loaded after session.js). Each session opened or saved is remembered in this
// browser only (IndexedDB), with its content, so the welcome screen can open it again:
// the 6 most recent, one entry per file name, sessions over 25 MB skipped. Examples are not
// remembered. Nothing is sent anywhere.
//   tmRecent.list()    -> Promise of [{ id, name, when, tips, layers: [type], layout, size }]
//   tmRecent.open(id)  -> opens that session
//   tmRecent.remove(id), tmRecent.clear()
// A change is announced as the document event tm-recent-changed.
(function () {
  'use strict';
  var DB = 'treemapper', STORE = 'recent', KEEP = 6, MAX = 25 * 1024 * 1024;
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('no IndexedDB')); return; }
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); };
      });
    });
  }
  function changed() { document.dispatchEvent(new CustomEvent('tm-recent-changed')); }
  function summary(text) {
    var s = null; try { s = JSON.parse(text); } catch (e) { return null; }
    if (!s || !s.tree) return null;
    var nwk = typeof s.tree.text === 'string' ? s.tree.text : '';
    // tips: the labels before a branch length or a delimiter, after "(" or ","
    var tips = 0; if (nwk) { var m = nwk.match(/[(,]\s*[^(),:;\s][^(),:;]*/g); tips = m ? m.length : 0; }
    return { tips: tips, layers: (s.layers || []).map(function (l) { return l.type; }), layout: (s.settings && s.settings.__layout) || 'rect' };
  }
  function remember(name, text) {
    if (!name || typeof text !== 'string' || text.length > MAX) return Promise.resolve();
    var sm = summary(text); if (!sm) return Promise.resolve();
    var entry = { id: name.toLowerCase(), name: name, when: Date.now(), tips: sm.tips, layers: sm.layers, layout: sm.layout, size: text.length, text: text };
    return tx('readwrite', function (st) { st.put(entry); })
      .then(function () { return all(); })
      .then(function (list) {
        var extra = list.slice(KEEP);
        if (!extra.length) return;
        return tx('readwrite', function (st) { extra.forEach(function (e) { st.delete(e.id); }); });
      })
      .then(changed).catch(function () {});
  }
  function all() {
    return tx('readonly', function (st) { return st.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return b.when - a.when; }); });
  }
  document.addEventListener('tm-session-opened', function (e) { var d = e.detail || {}; if (!d.example) remember(d.name, d.text); });
  document.addEventListener('tm-session-saved', function (e) { var d = e.detail || {}; remember(d.name, d.text); });

  window.tmRecent = {
    list: function () { return all().then(function (l) { return l.map(function (e) { var o = {}; for (var k in e) if (k !== 'text') o[k] = e[k]; return o; }); }).catch(function () { return []; }); },
    open: function (id) {
      return tx('readonly', function (st) { return st.get(id); }).then(function (e) {
        if (!e) throw new Error('it is no longer in this browser');
        return window.tmSession.load(e.text, { name: e.name });
      });
    },
    remove: function (id) { return tx('readwrite', function (st) { st.delete(id); }).then(changed); },
    clear: function () { return tx('readwrite', function (st) { st.clear(); }).then(changed); }
  };
})();
