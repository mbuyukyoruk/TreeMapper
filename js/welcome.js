// Welcome screen (loaded last). Shown over the whole window when no tree is open:
//   - the hero: what TreeMapper is and a launcher (drop or open a tree or session, generate a
//     tree, open from a URL, paste data), beside a dark stage showing the reverse transcriptase
//     example with its family legend;
//   - recent sessions (js/recent.js; kept in this browser only) beside the examples (saved
//     sessions in examples/<id>.js, loaded on demand; see examples/README.md), shown in frames;
//   - the layers you can add, with the app's own layer badges;
//   - a footer: privacy, shortcuts, problem reports.
// It goes as soon as a tree opens. The logo in the top bar brings it back ("Back to your tree"
// returns, as does Escape); "Go to the workspace" leaves it without opening anything.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ICON = function (d, size, sw) { return '<svg class="pro-ico" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var I = {
    logo: '<path d="M3 12h4M7 6v12M7 6h5M7 18h5M12 4v4M12 4h8M12 8h8M12 16h8"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 12h4a4 4 0 0 0 4-4V8a3 3 0 0 1 2.2-2.9"/><path d="M14 12h2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  var BADGE = { dataframe: 'DF', heatmap: 'HM', highlight: 'HL', clade: 'CL', chart: 'CH', msa: 'AL' };
  var badge = function (t) { return BADGE[t] ? '<span class="pro-card-badge pro-badge-' + t + '" aria-hidden="true">' + BADGE[t] + '</span>' : ''; };
  // the RT example's five large families, in its own colours (examples-build/palette_rt.py)
  var FAMILIES = [['UG/Abi', '#009E73', 593], ['Retron', '#E69F00', 203], ['Group II intron', '#D55E00', 111], ['CRISPR-associated RT', '#0072B2', 70], ['DGR', '#CC79A7', 38]];
  var EXAMPLES = [
    { id: 'rt-references', file: 'rt-references.treemapper', title: 'Bacterial reverse transcriptases', meta: ['1,077 RTs', 'Circular'], layers: ['dataframe', 'heatmap', 'clade', 'chart'], img: 'rt',
      text: 'Reference RTs from six published studies, coloured by family, with rings for the defense-associated RTs (DRT1–DRT11) and Abi RTs, source study, domain layout and length.' },
    { id: 'mock', file: 'mock.treemapper', title: 'Mock dataset', meta: ['120 tips', 'Rectangular'], layers: ['dataframe', 'heatmap', 'highlight', 'clade', 'chart'], img: 'mock', mock: true,
      text: 'Random sample data showing every layer type. To be replaced with your own example.' }
  ];
  var LAYERS = [
    ['dataframe', 'Dataframe', 'Gene neighbourhoods as arrows, aligned on a gene you choose'],
    ['heatmap', 'Heatmap', 'Categorical or numeric values for every tip'],
    ['highlight', 'Highlight', 'Shade tips by a category'],
    ['clade', 'Clade groups', 'Colour branches by group'],
    ['chart', 'Chart', 'Bar, line, dot or box plots'],
    ['msa', 'Alignment', 'Residue colours, consensus and reference positions']
  ];
  // a picture in its light and dark versions (img/welcome/<name>-light.jpg, -dark.jpg)
  var pic = function (name, cls) {
    return '<img class="' + cls + ' tw-light" src="img/welcome/' + name + '-light.jpg" alt="" decoding="async">' +
      '<img class="' + cls + ' tw-dark" src="img/welcome/' + name + '-dark.jpg" alt="" decoding="async">';
  };

  var el = document.createElement('section');
  el.className = 'tm-welcome'; el.id = 'tmWelcome'; el.setAttribute('aria-label', 'Welcome to TreeMapper'); el.hidden = true;
  el.innerHTML =
    '<header class="tw-top">' +
      '<div class="tw-brand"><span class="pro-logo">' + ICON(I.logo, 18, 2) + '</span><span class="tw-name">TreeMapper</span><span class="tw-ver" id="twVersion"></span></div>' +
      '<nav class="tw-top-actions" aria-label="Welcome">' +
        '<button type="button" class="tw-link" id="twBack" hidden>Back to your tree</button>' +
        '<button type="button" class="tw-link" id="twSkip">Go to the workspace</button>' +
        '<button type="button" class="pro-icon-btn" id="twTheme" aria-label="Switch between light and dark" title="Light or dark">' + ICON(I.moon, 17) + '</button>' +
      '</nav>' +
    '</header>' +

    '<div class="tw-hero">' +
      '<div class="tw-hero-text">' +
        '<h1 class="tw-title">Phylogenetic trees, <span>annotated with your data.</span></h1>' +
        '<p class="tw-lead">Open a Newick or NEXUS tree and map dataframes, heatmaps, highlights, clade groups, charts and sequence alignments onto it, in a rectangular or circular layout. Export publication-ready SVG. Everything runs in your browser.</p>' +
        '<div class="tw-launch">' +
          '<div class="tw-drop" id="twDrop">' +
            '<span class="tw-drop-icon">' + ICON(I.upload, 22) + '</span>' +
            '<span class="tw-drop-text"><b>Drop a tree or session to start</b><span>Newick, NEXUS or a saved .treemapper session</span></span>' +
            '<button type="button" class="pro-btn pro-btn-primary pro-btn-lg tw-open" id="twOpen">' + ICON(I.folder, 16) + 'Open file…</button>' +
          '</div>' +
          '<div class="tw-ways">' +
            '<button type="button" class="tw-way" id="twGenerate"><span class="tw-way-icon">' + ICON(I.branch, 17) + '</span><span><b>Generate a tree</b><span>from gene presence and absence</span></span></button>' +
            '<button type="button" class="tw-way" id="twUrl"><span class="tw-way-icon">' + ICON(I.link, 17) + '</span><span><b>Open from a URL</b><span>a tree or session on the web</span></span></button>' +
            '<button type="button" class="tw-way" id="twPaste"><span class="tw-way-icon">' + ICON(I.paste, 17) + '</span><span><b>Paste data</b><span>a tree, table or alignment</span></span></button>' +
          '</div>' +
        '</div>' +
        '<p class="tw-status" id="twStatus" role="status" aria-live="polite"></p>' +
      '</div>' +
      '<figure class="tw-stage">' +
        '<figcaption class="tw-stage-head"><span><b>Bacterial reverse transcriptases</b><span>1,077 reference RTs · circular layout · six published studies</span></span>' +
          '<button type="button" class="tw-stage-open" data-example="rt-references">Open ' + ICON(I.arrow, 14, 2) + '</button></figcaption>' +
        '<img class="tw-stage-img" src="img/welcome/rt-dark.png" alt="A circular tree of 1,077 reverse transcriptases, branches coloured by family, with rings for family, defense-associated RTs and Abi RTs, source study, domain layout and protein length" decoding="async">' +
        '<ul class="tw-legend" aria-label="RT families">' + FAMILIES.map(function (f) { return '<li><i style="background:' + f[1] + '"></i>' + f[0] + '<span>' + f[2] + '</span></li>'; }).join('') + '<li class="tw-legend-more">+ 8 smaller families</li></ul>' +
      '</figure>' +
    '</div>' +

    '<div class="tw-band">' +
      '<section class="tw-recent" aria-labelledby="twRecentTitle">' +
        '<div class="tw-band-head"><h2 class="tw-h2" id="twRecentTitle">Recent sessions</h2><button type="button" class="tw-link tw-small" id="twRecentClear" hidden>Clear</button></div>' +
        '<ul class="tw-recent-list" id="twRecentList"></ul>' +
        '<p class="tw-recent-empty" id="twRecentEmpty">' + ICON(I.clock, 18) + '<span>Sessions you open or save will appear here, kept in this browser only.</span></p>' +
      '</section>' +
      '<section class="tw-ex" aria-labelledby="twExTitle">' +
        '<div class="tw-band-head"><h2 class="tw-h2" id="twExTitle">Examples</h2></div>' +
        '<div class="tw-examples">' + EXAMPLES.map(function (x) {
          return '<button type="button" class="tw-example" data-example="' + x.id + '">' +
            '<span class="tw-win"><span class="tw-win-bar"><i></i><i></i><i></i><span>' + x.file + '</span></span>' +
              '<span class="tw-win-body tw-win-' + x.img + '">' + (x.img === 'rt' ? '<img src="img/welcome/rt-dark.png" alt="" decoding="async">' : pic('mock', 'tw-win-img')) + '</span></span>' +
            '<span class="tw-ex-body">' +
              '<span class="tw-ex-head"><span class="tw-ex-title">' + x.title + '</span>' + (x.mock ? '<span class="tw-chip">Mock data</span>' : '') + '</span>' +
              '<span class="tw-ex-meta">' + x.meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '<span class="tw-ex-badges">' + x.layers.map(badge).join('') + '</span></span>' +
              '<span class="tw-ex-text">' + x.text + '</span>' +
            '</span></button>';
        }).join('') + '</div>' +
      '</section>' +
    '</div>' +

    '<section class="tw-layers" aria-labelledby="twLayersTitle">' +
      '<h2 class="tw-h2" id="twLayersTitle">Layers you can add</h2>' +
      '<ul class="tw-layer-list">' + LAYERS.map(function (l) { return '<li>' + badge(l[0]) + '<span><b>' + l[1] + '</b><span>' + l[2] + '</span></span></li>'; }).join('') + '</ul>' +
    '</section>' +

    '<footer class="tw-foot">' +
      '<span class="tw-private">' + ICON(I.lock, 14) + 'Runs entirely in your browser. Files never leave your computer.</span>' +
      '<span class="tw-links"><button type="button" class="tw-link" id="twKeys">Keyboard shortcuts</button>' +
        '<button type="button" class="tw-link" id="twReport">Report a problem</button>' +
        '<span>Created by <a href="https://github.com/mbuyukyoruk" target="_blank" rel="noopener">Murat Buyukyoruk</a></span></span>' +
    '</footer>';
  document.body.appendChild(el);

  // ------------------------------------------------------------------ showing
  var skipped = false, home = false;
  function version() { var v = $('proVersion'); return v && v.textContent ? v.textContent : ''; }
  // the page's build stamp, so a new release loads its own examples rather than cached ones
  function stamp() { var sc = document.querySelector('script[src*="welcome.js"]'), m = sc && /[?&]v=(\d+)/.exec(sc.getAttribute('src') || ''); return m ? '?v=' + m[1] : ''; }
  function hasTree() { return document.body.classList.contains('pro-has-tree'); }
  function sync() {
    var show = home || (!hasTree() && !skipped);
    $('twBack').hidden = !hasTree(); $('twSkip').hidden = hasTree();
    $('twVersion').textContent = version();
    if (el.hidden === !show) return;
    el.hidden = !show;
    document.body.classList.toggle('tm-welcome-open', show);
    if (show) { el.scrollTop = 0; renderRecent(); setTimeout(function () { var b = $('twOpen'); if (b) b.focus({ preventScroll: true }); }, 0); }
  }
  function close() { home = false; skipped = true; sync(); }
  // a tree opened: the welcome goes; all trees closed again: it comes back
  var had = hasTree();
  new MutationObserver(function () {
    var now = hasTree();
    if (now && !had) { home = false; skipped = false; }
    if (!now && had) skipped = false;
    had = now; sync();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // the logo brings it back
  var brand = document.querySelector('.pro-topbar .pro-brand');
  if (brand) {
    brand.style.cursor = 'pointer'; brand.title = 'Home'; brand.setAttribute('role', 'button'); brand.tabIndex = 0;
    var goHome = function () { home = true; skipped = false; sync(); };
    brand.addEventListener('click', goHome);
    brand.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
  }
  $('twBack').addEventListener('click', close);
  $('twSkip').addEventListener('click', close);
  el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && hasTree()) { e.preventDefault(); close(); } });

  // ------------------------------------------------------------------ recent sessions
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 7) { var d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago'; }
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function renderRecent() {
    if (!window.tmRecent) return;
    tmRecent.list().then(function (list) {
      $('twRecentList').innerHTML = list.map(function (r) {
        var kinds = []; r.layers.forEach(function (t) { if (kinds.indexOf(t) < 0) kinds.push(t); });
        return '<li><button type="button" class="tw-recent-item" data-recent="' + esc(r.id) + '">' +
          '<span class="tw-recent-icon">' + ICON(I.file, 18) + '</span>' +
          '<span class="tw-recent-main"><b>' + esc(r.name) + '</b><span>' + (r.tips ? r.tips.toLocaleString() + ' tips · ' : '') + r.layers.length + ' layer' + (r.layers.length === 1 ? '' : 's') + ' · ' + (r.layout === 'radial' ? 'circular' : 'rectangular') + '</span></span>' +
          '<span class="tw-recent-side"><span class="tw-ex-badges">' + kinds.map(badge).join('') + '</span><span class="tw-recent-when">' + ago(r.when) + '</span></span>' +
          '</button><button type="button" class="tw-recent-x" data-forget="' + esc(r.id) + '" aria-label="Remove ' + esc(r.name) + ' from recent sessions" title="Remove from this list">' + ICON(I.x, 14, 2) + '</button></li>';
      }).join('');
      $('twRecentEmpty').hidden = list.length > 0;
      $('twRecentClear').hidden = list.length === 0;
    });
  }
  document.addEventListener('tm-recent-changed', function () { if (!el.hidden) renderRecent(); });
  $('twRecentClear').addEventListener('click', function () { if (window.tmRecent) tmRecent.clear(); });

  // ------------------------------------------------------------------ actions
  function say(t) { $('twStatus').textContent = t || ''; }
  function click(id) { var b = $(id); if (b) b.click(); }
  $('twOpen').addEventListener('click', function () { click('proEmptyOpen'); });
  $('twGenerate').addEventListener('click', function () { close(); click('proEmptyGenerate'); });
  $('twUrl').addEventListener('click', function () { click('proEmptyUrl'); });
  $('twPaste').addEventListener('click', function () { if (window.tmIntake && tmIntake.paste) tmIntake.paste(''); });
  $('twKeys').addEventListener('click', function () { click('proKeysBtn'); });
  $('twReport').addEventListener('click', function () { if (window.tmReport && tmReport.show) tmReport.show(); });
  $('twTheme').addEventListener('click', function () { click('themeToggle'); });
  if (!(window.tmReport && $('proReportBtn'))) $('twReport').remove();   // (no report service set up)
  if (!(window.tmIntake && tmIntake.paste)) $('twPaste').remove();

  var loading = false;
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('it could not be loaded')); }; document.head.appendChild(s); });
  }
  async function busy(label, fn) {
    if (loading) return;
    loading = true; el.classList.add('tw-busy'); say('Opening “' + label + '”…');
    try { await fn(); say(''); }
    catch (e) { say('Could not open “' + label + '”: ' + (e && e.message ? e.message : e)); }
    finally { loading = false; el.classList.remove('tw-busy'); }
  }
  function openExample(id) {
    var x = EXAMPLES.filter(function (e) { return e.id === id; })[0]; if (!x || !window.tmSession) return;
    return busy(x.title, async function () {
      if (!(window.TM_EXAMPLES && TM_EXAMPLES[id])) await loadScript('examples/' + id + '.js' + stamp());
      var s = window.TM_EXAMPLES && TM_EXAMPLES[id];
      if (!s) throw new Error('the example is missing');
      await tmSession.load(JSON.stringify(s), { example: id, name: x.file });
      if (typeof setStatus === 'function') setStatus('Example opened: ' + x.title + (x.mock ? ' (mock data)' : ''));
    });
  }
  el.addEventListener('click', function (e) {
    var f = e.target.closest('[data-forget]'); if (f) { if (window.tmRecent) tmRecent.remove(f.getAttribute('data-forget')); return; }
    var r = e.target.closest('[data-recent]'); if (r) { var name = r.querySelector('b').textContent; busy(name, function () { return tmRecent.open(r.getAttribute('data-recent')); }); return; }
    var b = e.target.closest('[data-example]'); if (b) openExample(b.getAttribute('data-example'));
  });

  // files dropped anywhere on the welcome: sessions open as sessions, the rest goes to the intake
  el.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); el.classList.add('tw-dragging'); } });
  el.addEventListener('dragleave', function (e) { if (!e.relatedTarget || !el.contains(e.relatedTarget)) el.classList.remove('tw-dragging'); });
  el.addEventListener('drop', function (e) {
    el.classList.remove('tw-dragging');
    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    if (!files.length) return;
    e.preventDefault();
    var session = window.tmSession && files.filter(function (f) { return tmSession.isSessionFile(f); })[0];
    if (session) tmSession.load(session);
    else if (window.tmIntake && tmIntake.files) tmIntake.files(files);
  });

  document.addEventListener('DOMContentLoaded', function () { $('twVersion').textContent = version(); });   // (the label is filled in then)
  window.tmWelcome = { show: function () { home = true; skipped = false; sync(); }, hide: close, open: openExample, examples: EXAMPLES.map(function (x) { return x.id; }) };
  sync();
})();
