// Data from URLs (loaded after intake.js). "From URL…" in the Add data menu fetches a
// tree, a session, an alignment or a table and hands it to the intake (sniffed, asked
// about when ambiguous); the URL is remembered, so a session can save it as a link
// instead of a copy (session.js) and fetch it again when opened. The page also opens
// what its address names: index.html?session=<url>, or ?tree=<url>&data=<url>&data=<url>.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function nameOf(url) {
    try { var u = new URL(url, location.href); var seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); return seg || u.hostname || 'data'; } catch (e) { return 'data'; }
  }
  function explain(e) {
    var m = e && e.message ? e.message : String(e);
    if (/Failed to fetch|NetworkError|Load failed|TypeError/.test(m)) return 'the server did not answer, or does not allow this page to read it (CORS)';
    return m;
  }
  // fetches the URL and loads it; resolves to the kind loaded, or null
  async function open(url) {
    url = String(url || '').trim(); if (!url) return null;
    setStatus('Fetching ' + url + '…');
    var text;
    try { text = await tmSession.fetchText(url); }
    catch (e) { setStatus('Could not fetch ' + url + ': ' + explain(e)); return null; }
    var name = nameOf(url);
    if (window.tmSession && (/\.treemapper(-report\.json)?$/i.test(name) || /"format"\s*:\s*"treemapper-(session|report)"/.test(text.slice(0, 400)))) { await tmSession.load(text); return 'session'; }
    try { return await tmIntake.text(text, name, 'From URL: ' + url, url); }
    catch (e) { console.error(e); setStatus('Could not load ' + name + ': ' + e.message); return null; }
  }
  // ------------------------------------------------------------------ dialog
  var modal = null;
  function ensure() {
    if (modal) return modal;
    modal = document.createElement('div'); modal.className = 'pro-modal'; modal.id = 'proLinks'; modal.hidden = true;
    modal.innerHTML = '<div class="pro-modal-card lk-card" role="dialog" aria-modal="true" aria-labelledby="lkTitle">' +
      '<div class="pro-panel-head"><span class="pro-panel-title" id="lkTitle">From URL</span><button type="button" class="pro-icon-btn pro-icon-btn-sm" id="lkClose" aria-label="Close"><svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="pro-modal-body lk-body">' +
      '<p class="ds-muted">A tree, a session, an alignment or a table on the web (the server must allow this page to read it). The address is remembered: a session can save it as a link instead of a copy.</p>' +
      '<input type="url" id="lkUrl" class="pro-input lk-url" placeholder="https://…/tree.nwk" spellcheck="false" autocomplete="off">' +
      '<p class="cm-error" id="lkError" hidden></p>' +
      '<div class="cm-actions"><button type="button" class="pro-btn" id="lkCancel">Cancel</button><button type="button" class="pro-btn pro-btn-primary" id="lkFetch">Fetch</button></div>' +
      '</div></div>';
    document.body.appendChild(modal);
    var close = function () { modal.hidden = true; };
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    $('lkClose').addEventListener('click', close); $('lkCancel').addEventListener('click', close);
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } if (e.key === 'Enter' && e.target.id === 'lkUrl') { e.preventDefault(); $('lkFetch').click(); } });
    $('lkFetch').addEventListener('click', async function () {
      var url = $('lkUrl').value.trim(), err = $('lkError');
      if (!/^https?:\/\//i.test(url)) { err.textContent = 'Enter a web address starting with http:// or https://'; err.hidden = false; return; }
      err.hidden = true; $('lkFetch').disabled = true;
      close();
      await open(url);
      $('lkFetch').disabled = false;
    });
    return modal;
  }
  function show(url) { ensure(); $('lkUrl').value = url || ''; $('lkError').hidden = true; modal.hidden = false; $('lkUrl').focus(); }
  var sub = $('addDataframeSubcard');
  if (sub) {
    var sec = document.createElement('div'); sec.className = 'add-dataframe-section';
    sec.innerHTML = '<button id="addUrlOption" class="clade-toolbar-btn" title="Fetch a tree, a session, an alignment or a table from a web address"><span>From URL…</span></button>';
    (sub.querySelector('.clade-color-card-content') || sub).appendChild(sec);
    $('addUrlOption').addEventListener('click', function (ev) {
      ev.stopPropagation();
      sub.style.display = 'none'; var main = $('addDataframe'); if (main) main.classList.remove('active');
      show('');
    });
  }
  if ($('proEmptyUrl')) $('proEmptyUrl').addEventListener('click', function () { show(''); });
  // ------------------------------------------------------------------ the page address
  async function fromAddress() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var session = q.get('session'), tree = q.get('tree'), data = q.getAll('data');
    if (session) { await open(session); return; }
    if (tree) {
      var k = await open(tree);
      if (k !== 'tree') return;
      for (var i = 0; i < data.length; i++) await open(data[i]);
    }
  }
  if (document.readyState === 'complete') setTimeout(fromAddress, 0);
  else window.addEventListener('load', function () { setTimeout(fromAddress, 0); });
  window.tmLinks = { open: open, show: show, nameOf: nameOf };
})();
