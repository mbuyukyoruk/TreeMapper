// Report a problem (loaded after session.js and intake.js). The status bar's "Report a
// problem" opens a dialog that gathers what a bug report needs: the app version, the
// browser, the page errors and the last status messages (both kept from page load on),
// the session (tree, data and settings; the data can be left out) and the drawing as SVG,
// with the user's description, and sends it to the author: a Cloudflare Worker
// (report-worker/) files it as an issue in a private GitHub repository, with the report
// file (.treemapper-report.json) stored beside it. Opening that file (Open, drop, From URL)
// restores the session it holds, so the problem can be seen. If sending fails the dialog
// offers the file to save instead. Without a REPORT_ENDPOINT the status bar has no button.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var FORMAT = 'treemapper-report', KEEP = 60;
  // where reports go: the deployed Worker's address (report-worker/README.md)
  var REPORT_ENDPOINT = '';
  var endpoint = function () { return window.TM_REPORT_ENDPOINT || REPORT_ENDPOINT; };
  var MAX_FILE_B64 = 11 * 1024 * 1024;   // (the Worker takes up to 12 MB of base64)
  var errors = [], actions = [], t0 = Date.now();
  function stamp() { return Math.round((Date.now() - t0) / 100) / 10; }   // seconds since load
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function keep(list, item) { list.push(item); if (list.length > KEEP) list.shift(); }
  window.addEventListener('error', function (e) {
    keep(errors, { t: stamp(), message: String(e.message || (e.error && e.error.message) || 'error'), where: (e.filename || '').split('/').pop() + (e.lineno ? ':' + e.lineno : ''), stack: e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 6).join('\n') : undefined });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; keep(errors, { t: stamp(), message: 'unhandled promise: ' + String(r && r.message || r), stack: r && r.stack ? String(r.stack).split('\n').slice(0, 6).join('\n') : undefined });
  });
  var origErr = console.error;
  console.error = function () { try { keep(errors, { t: stamp(), message: 'console.error: ' + Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' ').slice(0, 400) }); } catch (e) {} return origErr.apply(console, arguments); };
  // the status messages (what the app said it was doing)
  var origStatus = window.setStatus;
  if (typeof origStatus === 'function') window.setStatus = function (msg) { try { var m = String(msg || ''); if (m && m !== 'Ready' && (!actions.length || actions[actions.length - 1].m !== m)) keep(actions, { t: stamp(), m: m }); } catch (e) {} return origStatus.apply(this, arguments); };
  function version() { var sc = document.querySelector('script[src*="app.js"]'); var m = sc && /[?&]v=(\d+)/.exec(sc.getAttribute('src') || ''); return m ? m[1] : 'unknown'; }
  function layers() {
    var out = [];
    [['dataframe', 'dataframes'], ['heatmap', 'heatmaps'], ['highlight', 'highlights'], ['clade', 'clades'], ['chart', 'charts'], ['msa', 'msas']].forEach(function (p) {
      try { var m = (0, eval)('typeof ' + p[1] + ' !== "undefined" ? ' + p[1] + ' : null'); if (m && m.size) out.push(p[0] + ' × ' + m.size); } catch (e) {}   // the maps are script-level lets, not window properties
    });
    return out;
  }
  // the report: { format, savedAt, version, app, browser, description, errors, actions, session | settings, svg }
  function build(opts) {
    var r = { format: FORMAT, version: 1, savedAt: new Date().toISOString(), app: version(), description: opts.description || '' };
    r.browser = { userAgent: navigator.userAgent, language: navigator.language, viewport: [window.innerWidth, window.innerHeight], devicePixelRatio: window.devicePixelRatio, theme: document.documentElement.getAttribute('data-theme') || 'light', url: location.protocol === 'file:' ? 'a local copy (file)' : location.href.split('?')[0] };   // (not the path on the user's computer)
    r.tree = (typeof root !== 'undefined' && root) ? { tips: root.leaves().length, layers: layers() } : null;
    r.errors = errors.slice(); r.actions = actions.slice();
    if (window.tmSession && typeof root !== 'undefined' && root) {
      try {
        var s = tmSession.collect();
        if (opts.includeData) r.session = s;
        else { r.settings = s.settings; r.layersSummary = (s.layers || []).map(function (l) { return { type: l.type, name: l.name, controls: l.controls }; }); }
      } catch (e) { r.sessionError = String(e && e.message || e); }
    }
    if (opts.includeSvg && typeof buildExportSvgSource === 'function' && typeof root !== 'undefined' && root) {
      try { var src = buildExportSvgSource(); r.svg = src && src.src ? src.src : String(src || ''); } catch (e) { r.svgError = String(e && e.message || e); }
    }
    return r;
  }
  function download(text, name) {
    var blob = new Blob([text], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  // ------------------------------------------------------------------ dialog
  var modal = null;
  function ensure() {
    if (modal) return modal;
    modal = document.createElement('div'); modal.className = 'pro-modal'; modal.id = 'proReport'; modal.hidden = true;
    modal.innerHTML = '<div class="pro-modal-card rp-card" role="dialog" aria-modal="true" aria-labelledby="rpTitle">' +
      '<div class="pro-panel-head"><span class="pro-panel-title" id="rpTitle">Report a problem</span><button type="button" class="pro-icon-btn pro-icon-btn-sm" id="rpClose" aria-label="Close"><svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="pro-modal-body rp-body">' +
      '<p class="ds-muted rp-intro">Sends your description to the author with what is needed to look into the problem: the app version, your browser and any errors on this page. It goes to the author’s private GitHub repository, not to a public page.</p>' +
      '<label class="rp-field"><span class="pro-file-label">What happened, and what you expected</span><textarea id="rpText" class="pro-textarea rp-text" spellcheck="true" placeholder="What you did, what you saw, what you expected…"></textarea></label>' +
      '<div class="rp-summary" id="rpSummary"></div>' +
      '<label class="pro-row rp-opt"><span>Include my tree and data layers <span class="cm-opt">(needed to reproduce the problem; sent privately to the author. Leave off if the data is confidential: the settings are still sent)</span></span><input type="checkbox" id="rpData" class="pro-switch" checked data-session-skip></label>' +
      '<label class="pro-row rp-opt"><span>Include the drawing (SVG)</span><input type="checkbox" id="rpSvg" class="pro-switch" checked data-session-skip></label>' +
      '<input type="text" id="rpWebsite" class="rp-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +   // (people never see it: a form that fills it is a bot)
      '<div class="rp-status" id="rpStatus" role="status" aria-live="polite"></div>' +
      '<div class="cm-actions"><button type="button" class="pro-btn rp-save" id="rpSave" hidden>Save it as a file</button><button type="button" class="pro-btn" id="rpCancel">Cancel</button><button type="button" class="pro-btn pro-btn-primary" id="rpSend">Send report</button></div>' +
      '</div></div>';
    document.body.appendChild(modal);
    var close = function () { modal.hidden = true; };
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    $('rpClose').addEventListener('click', close); $('rpCancel').addEventListener('click', close);
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } });
    $('rpSave').addEventListener('click', function () {
      var r = build({ description: $('rpText').value.trim(), includeData: $('rpData').checked, includeSvg: $('rpSvg').checked });
      var name = 'treemapper-report-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.treemapper-report.json';
      download(JSON.stringify(r), name);
      close();
      setStatus('Report saved as ' + name);
    });
    $('rpSend').addEventListener('click', function () { send(); });
    return modal;
  }
  // ------------------------------------------------------------------ sending
  function say(text, kind) { var el = $('rpStatus'); el.textContent = text; el.className = 'rp-status' + (kind ? ' rp-' + kind : ''); }
  function base64Of(text) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var u = String(fr.result); res(u.slice(u.indexOf(',') + 1)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(new Blob([text], { type: 'application/json' }));
    });
  }
  var sending = false;
  async function send() {
    if (sending) return;
    var description = $('rpText').value.trim();
    if (description.length < 3) { say('Please describe what happened first.', 'err'); $('rpText').focus(); return; }
    sending = true;
    var btn = $('rpSend'); btn.disabled = true; $('rpCancel').disabled = true; $('rpSave').hidden = true;
    say('Sending…');
    var opts = { description: description, includeData: $('rpData').checked && !$('rpData').disabled, includeSvg: $('rpSvg').checked && !$('rpSvg').disabled };
    try {
      var r = build(opts), b64 = await base64Of(JSON.stringify(r)), note = '';
      if (b64.length > MAX_FILE_B64 && (opts.includeData || opts.includeSvg)) {
        // too large to send whole: the drawing left out first, then the data
        if (opts.includeSvg) { opts.includeSvg = false; r = build(opts); b64 = await base64Of(JSON.stringify(r)); note = ' (without the drawing: too large)'; }
        if (b64.length > MAX_FILE_B64) { opts.includeData = false; r = build(opts); b64 = await base64Of(JSON.stringify(r)); note = ' (without the tree and data: too large to send)'; }
      }
      var meta = { description: description, app: r.app, browser: r.browser, tree: r.tree,
        errors: r.errors.slice(-20).map(function (e) { return { t: e.t, message: String(e.message).slice(0, 500), where: e.where, stack: e.stack ? String(e.stack).slice(0, 800) : undefined }; }),
        actions: r.actions.slice(-20), hasData: !!r.session, hasSvg: !!r.svg, website: $('rpWebsite').value };
      var fd = new FormData();
      fd.append('meta', JSON.stringify(meta));
      fd.append('file', new Blob([b64], { type: 'text/plain' }), 'report.b64');
      var ctl = window.AbortController ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 60000) : 0;
      var res = await fetch(endpoint(), { method: 'POST', body: fd, signal: ctl ? ctl.signal : undefined });
      clearTimeout(timer);
      var j = null; try { j = await res.json(); } catch (e) {}
      if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || ('the service answered ' + res.status));
      say('Sent' + note + '. Thank you' + (j.number ? ': report #' + j.number : '') + '.', 'ok');
      $('rpText').value = '';
      btn.hidden = true; $('rpCancel').textContent = 'Close';
      setStatus('Report sent' + (j.number ? ' (#' + j.number + ')' : ''));
    } catch (e) {
      var why = e && e.name === 'AbortError' ? 'no answer from the report service' : (e && e.message ? e.message : String(e));
      if (/Failed to fetch|NetworkError|Load failed|network/i.test(why)) why = 'no connection to the report service';
      say('Could not send the report: ' + why + '. You can save it as a file instead.', 'err');
      $('rpSave').hidden = false;
    } finally {
      sending = false; btn.disabled = false; $('rpCancel').disabled = false;
    }
  }
  function summary() {
    var hasTree = typeof root !== 'undefined' && root, parts = [];
    parts.push('<b>App</b> version ' + esc(version()) + ' · ' + esc(navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)));
    parts.push('<b>Tree</b> ' + (hasTree ? root.leaves().length + ' tips' + (layers().length ? ' · ' + layers().join(', ') : ' · no data layers') : 'none loaded'));
    parts.push('<b>Errors since the page opened</b> ' + errors.length + (errors.length ? ': ' + esc(errors[errors.length - 1].message).slice(0, 120) : ''));
    parts.push('<b>Last status messages</b> ' + actions.length + (actions.length ? ': “' + esc(actions[actions.length - 1].m).slice(0, 100) + '”' : ''));
    return parts.map(function (p) { return '<div class="rp-line">' + p + '</div>'; }).join('');
  }
  function show() {
    ensure(); $('rpSummary').innerHTML = summary();
    var hasTree = typeof root !== 'undefined' && root;
    $('rpData').disabled = !hasTree; $('rpSvg').disabled = !hasTree;
    say(''); $('rpSave').hidden = true; $('rpSend').hidden = false; $('rpCancel').textContent = 'Cancel';
    modal.hidden = false; $('rpText').focus();
  }
  var foot = document.querySelector('.pro-statusbar'), keys = $('proKeysBtn');
  if (foot && endpoint()) {   // (no report service set up: no button)
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pro-status-link'; btn.id = 'proReportBtn'; btn.title = 'Send a problem report to the author'; btn.textContent = 'Report a problem';
    if (keys && keys.parentNode === foot) foot.insertBefore(btn, keys.nextSibling); else foot.appendChild(btn);
    btn.addEventListener('click', show);
  }
  // ------------------------------------------------- opening a report restores its session
  if (window.tmSession) {
    var origLoad = tmSession.load, origIs = tmSession.isSessionFile;
    tmSession.isSessionFile = function (f) { return origIs(f) || (!!f && /\.treemapper-report\.json$/i.test(f.name || '')); };
    tmSession.load = async function (fileOrText) {
      var text = typeof fileOrText === 'string' ? fileOrText : await (fileOrText && typeof fileOrText.text === 'function' ? fileOrText.text() : new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(fileOrText); }));
      var s = null; try { s = JSON.parse(text); } catch (e) {}
      if (s && s.format === FORMAT) {
        if (!s.session) { alert('This report holds no tree or data (they were left out when it was saved); only its settings and messages.'); setStatus('Report without data: ' + (s.description || '').slice(0, 80)); return; }
        setStatus('Opening the report’s session' + (s.description ? ': ' + s.description.slice(0, 80) : ''));
        return origLoad(JSON.stringify(s.session));
      }
      return origLoad(fileOrText);
    };
  }
  window.tmReport = { build: build, show: show, send: send, errors: function () { return errors.slice(); }, actions: function () { return actions.slice(); } };
})();
