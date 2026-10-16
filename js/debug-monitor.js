// Optional performance/click debugger. Loaded only when the page URL
// contains ?debug (e.g. index.html?debug). Not used in normal operation.
// ═══════════════════════════════════════════════════════════
// DEBUG v2: Focus on mousedown freeze & main-thread blocking
// ═══════════════════════════════════════════════════════════
(function initClickDebugger() {
  const LOG_MAX = 120;
  const logs = [];
  let panel, logEl;

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'clickDebugPanel';
    panel.style.cssText = `
      position:fixed; bottom:8px; right:8px; width:520px; max-height:380px;
      overflow-y:auto; background:#111; color:#0f0; font:11px/1.4 monospace;
      padding:8px; border-radius:8px; z-index:99999; pointer-events:auto;
      box-shadow:0 0 12px rgba(0,255,0,.3); border:1px solid #0f0;
    `;
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px;">
      <b style="color:#0f0;">CLICK DEBUG v2</b>
      <span id="clickDebugClear" style="cursor:pointer;color:#f55;">[ clear ]</span>
    </div><pre id="clickDebugLog" style="margin:0;white-space:pre-wrap;word-break:break-all;"></pre>`;
    document.body.appendChild(panel);
    logEl = document.getElementById('clickDebugLog');
    document.getElementById('clickDebugClear').onclick = () => { logs.length = 0; logEl.textContent = ''; };
  }
  createPanel();

  function log(msg) {
    logs.push(msg);
    if (logs.length > LOG_MAX) logs.shift();
    logEl.textContent = logs.join('\n');
    panel.scrollTop = panel.scrollHeight;
  }

  function desc(el) {
    if (!el) return '(null)';
    let s = el.tagName || '??';
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + Array.from(el.classList).join('.');
    return s;
  }

  // ── 1. Heartbeat: detect ANY main-thread block ──
  let heartbeatLast = performance.now();
  const HEARTBEAT_THRESHOLD = 400; // ms — anything longer = jank
  function heartbeat() {
    const now = performance.now();
    const gap = now - heartbeatLast;
    if (gap > HEARTBEAT_THRESHOLD) {
      log(`⚠ MAIN THREAD BLOCKED for ${gap.toFixed(0)}ms  (${new Date().toLocaleTimeString()})`);
    }
    heartbeatLast = now;
    requestAnimationFrame(heartbeat);
  }
  requestAnimationFrame(heartbeat);

  // ── 2. Long Task observer (if supported) ──
  if (window.PerformanceObserver) {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          log(`⚠ LONG TASK: ${entry.duration.toFixed(0)}ms  name=${entry.name}`);
        }
      });
      obs.observe({ type: 'longtask', buffered: false });
    } catch(e) { log('(longtask observer not supported)'); }
  }

  // ── 3. Document-wide events — capture phase (covers SVG + toolbars + everything) ──
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evName => {
    document.addEventListener(evName, (e) => {
      // Skip events inside the debug panel itself
      if (e.target.closest && e.target.closest('#clickDebugPanel')) return;

      const t = performance.now().toFixed(0);
      log(`[${t}] ${evName}  target=${desc(e.target)}  btn=${e.button}`);

      // After mousedown, immediately check when main thread is free
      if (evName === 'mousedown') {
        const t0 = performance.now();
        setTimeout(() => {
          const dt = (performance.now() - t0).toFixed(0);
          log(`  ↳ mousedown→setTimeout(0) fired after ${dt}ms`);
        }, 0);
        requestAnimationFrame(() => {
          const dt = (performance.now() - t0).toFixed(0);
          log(`  ↳ mousedown→rAF fired after ${dt}ms`);
        });
      }

      // After click, check main thread
      if (evName === 'click') {
        const t0 = performance.now();
        setTimeout(() => {
          const dt = (performance.now() - t0).toFixed(0);
          log(`  ↳ click→setTimeout(0) fired after ${dt}ms`);
          log('');
        }, 0);
      }
    }, true);
  });

  const svgEl = document.getElementById('svg');

  // ── 4. Monkey-patch expensive functions ──
  const fnNames = [
    'drawTree','highlightClade','clearCladeSelection','updateHighlightVisuals',
    'updateSearchHighlights','updateCladeButtonStates','updateSplitterLineHeights',
    'updateMetaAddButtonY','updatePanelHeights','showTip','hideTip',
    'updateResetRotationsButtonVisibility','updateColorPathCardVisibility',
    'initializePanels','refreshAll','updatePositionsFast','onFitToViewRect',
    'scheduleResizeRedraw','anchorTopLeftPreserveScale','drawSplittersInSVG',
    'updateDisplay','updateMetadataLegend','resetFontTruncationCache',
    'centerRadial','computeRadialAnglesInPlace'
  ];

  fnNames.forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function() {
      const t0 = performance.now();
      const result = orig.apply(this, arguments);
      const dt = performance.now() - t0;
      if (dt > 0.3) {
        log(`  fn ${name}() ${dt.toFixed(1)}ms`);
      }
      return result;
    };
    Object.keys(orig).forEach(k => { window[name][k] = orig[k]; });
  });

  // ── 5. Monitor zoom transform changes ──
  const zoomG = document.getElementById('zoomable');
  if (zoomG) {
    const origSetAttr = zoomG.setAttribute.bind(zoomG);
    zoomG.setAttribute = function(n, v) {
      if (n === 'transform') {
        log(`  zoom transform changed`);
      }
      return origSetAttr(n, v);
    };
  }

  // ── 6. Count SVG elements (for context) ──
  if (svgEl) {
    const allEls = svgEl.querySelectorAll('*');
    log(`SVG has ${allEls.length} total elements`);
    const nodes = svgEl.querySelectorAll('g.node');
    log(`  ${nodes.length} node groups`);
    const paths = svgEl.querySelectorAll('.links path');
    log(`  ${paths.length} link paths`);
    const labels = svgEl.querySelectorAll('text.label');
    log(`  ${labels.length} labels`);
    log('');
    log('Heartbeat watching for >80ms main-thread blocks.');
    log('Click anywhere on the canvas and watch below.');
    log('');
  }
})();
