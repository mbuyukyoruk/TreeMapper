// Built-in speed test. Loaded only when the page URL contains ?bench
// (e.g. index.html?bench or index-pro.html?bench). Runs the same scripted
// actions on generated 3,000-tip test data and reports how long each takes
// until the screen has updated, so different pages/browsers can be compared.
(function () {
  'use strict';
  var TIPS = 3000;

  // ---------- deterministic test data (same every run) ----------
  function rng(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeData(n) {
    var r = rng(11), names = [], i;
    for (i = 0; i < n; i++) names.push('ACC' + String(i).padStart(5, '0') + '.1');
    var nodes = names.map(function (nm) { return nm + ':' + (0.01 + r() * 0.49).toFixed(4); });
    while (nodes.length > 1) {
      var a = nodes.splice(Math.floor(r() * nodes.length), 1)[0];
      var b = nodes.splice(Math.floor(r() * nodes.length), 1)[0];
      nodes.push('(' + a + ',' + b + ')' + (10 + Math.floor(r() * 91)) + ':' + (0.01 + r() * 0.29).toFixed(4));
    }
    var tree = nodes[0].replace(/:[\d.]+$/, '') + ';';
    var genes = ['dnaA', 'gyrB', 'recA', 'rpoB', 'cas1', 'cas2', 'cas9', 'tnpA', 'rplB', 'ftsZ'];
    var df = ['molecule\tgene\tstart\tend\torientation'], hm = ['molecule,GC,Length,Score'], ch = ['molecule,value'];
    names.forEach(function (nm) {
      var pos = Math.floor(r() * 500), k = 2 + Math.floor(r() * 5), pool = genes.slice();
      for (var j = 0; j < k; j++) {
        var g = pool.splice(Math.floor(r() * pool.length), 1)[0], len = 200 + Math.floor(r() * 1300);
        df.push([nm, g, pos, pos + len, r() < 0.5 ? 1 : -1].join('\t')); pos += len + 10 + Math.floor(r() * 290);
      }
      hm.push([nm, (30 + r() * 40).toFixed(2), 1000 + Math.floor(r() * 8000), r().toFixed(3)].join(','));
      ch.push([nm, (r() * 100).toFixed(2)].join(','));
    });
    return { tree: tree, df: df.join('\n'), hm: hm.join('\n'), ch: ch.join('\n') };
  }

  // ---------- timing helpers ----------
  function frame() { return new Promise(function (res) { requestAnimationFrame(function () { setTimeout(res, 0); }); }); }
  // wait until the page has produced 3 smooth frames in a row (all follow-up work done)
  function settled() {
    return new Promise(function (res) {
      var calm = 0, last = performance.now(), start = last;
      (function tick() {
        frame().then(function () {
          var now = performance.now();
          calm = now - last < 50 ? calm + 1 : 0; last = now;
          if (calm >= 3 || now - start > 60000) res(now - 3 * 16.7); else tick();
        });
      })();
    });
  }
  function timeIt(fn) {
    return frame().then(function () {
      var t0 = performance.now();
      return Promise.resolve(fn()).then(function () { return settled(); }).then(function (t1) { return Math.max(0, Math.round(t1 - t0)); });
    });
  }

  // ---------- UI ----------
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:200000;width:360px;max-height:80vh;overflow:auto;padding:14px 16px;' +
    'background:#fff;color:#1B1F24;border:1px solid #C3C9D1;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:13px/1.45 system-ui,-apple-system,sans-serif';
  box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Speed test</div>' +
    '<div id="benchInfo" style="color:#57606C;font-size:12px;margin-bottom:10px">Loads generated ' + TIPS.toLocaleString() + '-tip test data into this page and times common actions. Takes about a minute; please don’t touch the page while it runs.</div>' +
    '<button id="benchRun" type="button" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid #0B7A72;background:#0B7A72;color:#fff;font-weight:600;cursor:pointer">Run speed test</button> ' +
    '<button id="benchCopy" type="button" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid #C3C9D1;background:#fff;color:#1B1F24;cursor:pointer;display:none">Copy results</button>' +
    '<pre id="benchOut" style="margin:10px 0 0;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap"></pre>';
  document.body.appendChild(box);
  var out = box.querySelector('#benchOut'), runBtn = box.querySelector('#benchRun'), copyBtn = box.querySelector('#benchCopy');
  function line(s) { out.textContent += s + '\n'; }

  function click(id) { var el = document.getElementById(id); if (el) el.click(); }
  function setSelect(id, v) { var el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
  function typeSearch(text) {
    var el = document.getElementById('accessionSearch'); var p = Promise.resolve();
    text.split('').forEach(function (_, i) {
      p = p.then(function () { el.value = text.slice(0, i + 1); el.dispatchEvent(new Event('input', { bubbles: true })); return frame(); });
    });
    return p;
  }
  function load(handler, name, text) { return window[handler](new File([text], name)); }

  runBtn.addEventListener('click', function () {
    runBtn.disabled = true; out.textContent = '';
    var page = /index-pro/.test(location.pathname) ? 'new version (index-pro.html)' : 'classic (index.html)';
    line(page);
    line(navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''));
    line('window ' + innerWidth + '×' + innerHeight + ' @' + devicePixelRatio + 'x');
    line('');
    var origConfirm = window.confirm, origAlert = window.alert;
    window.confirm = function () { return true; }; window.alert = function () {};
    var d = makeData(TIPS), results = [], total = 0;
    var steps = [
      ['Load tree', function () { return load('handleTreeFile', 'bench_tree.nwk', d.tree); }],
      ['Load dataframe', function () { return load('handleMetaFile', 'bench_dataframe.tsv', d.df); }],
      ['Load heatmap', function () { return load('handleHeatmapFile', 'bench_heatmap.csv', d.hm); }],
      ['Load chart', function () { return load('handleChartFile', 'bench_chart.csv', d.ch); }],
      ['Label guides on', function () { click('labelGuides'); }],
      ['Label guides off', function () { click('labelGuides'); }],
      ['Edge style curved', function () { setSelect('edgeStyle', 'curve'); }],
      ['Edge style rectangular', function () { setSelect('edgeStyle', 'rect'); }],
      ['Fit to view', function () { click('fit'); }],
      ['Type search (7 keys)', function () { return typeSearch('ACC0001'); }],
      ['Clear search', function () { click('clearSearch'); }],
    ];
    var chain = Promise.resolve();
    steps.forEach(function (s) {
      chain = chain.then(function () { return timeIt(s[1]); }).then(function (ms) {
        results.push([s[0], ms]); total += ms;
        line((s[0] + ' ').padEnd(26, '.') + String(ms).padStart(6) + ' ms');
      });
    });
    chain.then(function () {
      line(''.padEnd(26, '-'));
      line('Total'.padEnd(26, ' ') + String(total).padStart(6) + ' ms');
    }).catch(function (e) { line('Error: ' + (e && e.message)); })
      .then(function () { window.confirm = origConfirm; window.alert = origAlert; runBtn.disabled = false; copyBtn.style.display = 'inline-block'; window.__benchResults = results; });
  });
  copyBtn.addEventListener('click', function () {
    var text = out.textContent;
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { copyBtn.textContent = 'Copied'; },
      function () { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); copyBtn.textContent = 'Copied'; } catch (e) {} ta.remove(); });
  });
})();
