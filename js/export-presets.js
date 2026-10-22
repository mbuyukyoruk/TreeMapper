// Export options (loaded after pro-ui.js): Export → Export options… opens a dialog with
//   - the format: SVG, PNG or PDF (the print dialog);
//   - a size: the drawing as it is, a journal single column (85 mm) or double column (174 mm),
//     A4 or Letter (the drawing fitted to the page), or a width in mm;
//   - for PNG the resolution in dpi (150 / 300 / 600);
//   - a crop: the whole drawing, or the rows of the selected tips only (a clade figure);
//   - the file name.
// SVG and PDF stay vector; text stays text (to outline it, use the drawing program's
// "expand"/"create outlines": the browser cannot outline fonts itself).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MM = 25.4, CSS_DPI = 96;
  var SIZES = [
    { id: 'drawing', label: 'Drawing size', hint: 'as on screen (1 px = 1 pt)' },
    { id: 'col1', label: 'Single column', hint: '85 mm wide', w: 85 },
    { id: 'col2', label: 'Double column', hint: '174 mm wide', w: 174 },
    { id: 'a4', label: 'A4', hint: 'fitted to 210 × 297 mm (10 mm margins)', w: 190, h: 277 },
    { id: 'letter', label: 'Letter', hint: 'fitted to 216 × 279 mm (10 mm margins)', w: 196, h: 259 },
    { id: 'custom', label: 'Custom width', hint: 'in mm' }
  ];
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function selectedTips() {
    var out = [];
    if (typeof highlightedAccessions !== 'undefined' && highlightedAccessions.size) highlightedAccessions.forEach(function (n) { out.push(String(n)); });
    return out;
  }

  // the export source, cropped and sized as asked: { src, width, height } in px of the viewBox,
  // plus the physical size in mm when a size was chosen
  function build(opts) {
    var out = window.buildExportSvgSource();
    var src = out.src, m = /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/.exec(src);
    var vb = m ? [+m[1], +m[2], +m[3], +m[4]] : [0, 0, out.width, out.height];
    if (opts.crop === 'selection' && typeof root !== 'undefined' && root && typeof geometry !== 'undefined' && geometry !== 'radial') {
      var names = new Set(selectedTips()), ys = [];
      root.leaves().forEach(function (l) { if (names.has(String(l.data.name)) && Number.isFinite(l.x)) ys.push(l.x); });
      if (ys.length) {
        // the rows' height: the gap between tips (or the bar height) around the first and last
        var all = root.leaves().map(function (l) { return l.x; }).filter(Number.isFinite).sort(function (a, b) { return a - b; });
        var gap = all.length > 1 ? (all[all.length - 1] - all[0]) / (all.length - 1) : 12;
        var y0 = Math.min.apply(null, ys) - gap * 0.6, y1 = Math.max.apply(null, ys) + gap * 0.6;
        // the drawing's own coordinates: the zoom transform is not part of the export
        y0 = Math.max(vb[1], y0); y1 = Math.min(vb[1] + vb[3], y1);
        if (y1 > y0) vb = [vb[0], y0, vb[2], y1 - y0];
      }
    }
    var size = SIZES.filter(function (s) { return s.id === opts.size; })[0] || SIZES[0];
    var wmm = null, hmm = null;
    if (size.id === 'custom') wmm = +opts.customMm || null;
    else if (size.w) wmm = size.w;
    if (wmm) {
      hmm = wmm * vb[3] / vb[2];
      if (size.h && hmm > size.h) { hmm = size.h; wmm = hmm * vb[2] / vb[3]; }
    }
    src = src.replace(/viewBox="[^"]*"/, 'viewBox="' + vb.map(function (v) { return +v.toFixed(2); }).join(' ') + '"');
    var wAttr = wmm ? wmm.toFixed(2) + 'mm' : String(+vb[2].toFixed(2)), hAttr = hmm ? hmm.toFixed(2) + 'mm' : String(+vb[3].toFixed(2));
    src = src.replace(/<svg([^>]*?) width="[^"]*"/, '<svg$1 width="' + wAttr + '"').replace(/<svg([^>]*?) height="[^"]*"/, '<svg$1 height="' + hAttr + '"');
    return { src: src, width: vb[2], height: vb[3], wmm: wmm, hmm: hmm };
  }
  function exportNow(opts) {
    var out; try { out = build(opts); } catch (e) { alert('Export failed: ' + e.message); return; }
    var base = (opts.name || 'tree').replace(/\.(svg|png|pdf)$/i, '') || 'tree';
    if (opts.format === 'svg') {
      download(new Blob([out.src], { type: 'image/svg+xml;charset=utf-8' }), base + '.svg');
      setStatus('Exported ' + base + '.svg' + (out.wmm ? ' (' + out.wmm.toFixed(0) + ' × ' + out.hmm.toFixed(0) + ' mm)' : ''));
      return;
    }
    if (opts.format === 'png') {
      var dpi = +opts.dpi || 300;
      var pxW = out.wmm ? out.wmm / MM * dpi : out.width * dpi / CSS_DPI, pxH = pxW * out.height / out.width;
      var maxSide = 16000, maxArea = 120e6, fit = Math.min(1, maxSide / pxW, maxSide / pxH, Math.sqrt(maxArea / (pxW * pxH)));
      if (fit < 1) setStatus('Very large image: made at ' + Math.round(dpi * fit) + ' dpi instead of ' + dpi);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(pxW * fit)); c.height = Math.max(1, Math.round(pxH * fit));
        var ctx = c.getContext('2d');
        ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? (getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#0F1419') : '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          if (!blob) { alert('PNG export failed (the image may be too large for this browser).'); return; }
          download(blob, base + '.png');
          setStatus('Exported ' + base + '.png (' + c.width + ' × ' + c.height + ' px, ' + Math.round(dpi * fit) + ' dpi)');
        }, 'image/png');
      };
      img.onerror = function () { alert('PNG export failed: the browser could not render the tree image.'); };
      // the raster is sized by the canvas; the SVG itself keeps its drawing-unit size for the browser
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.src.replace(/<svg([^>]*?) width="[^"]*"/, '<svg$1 width="' + out.width + '"').replace(/<svg([^>]*?) height="[^"]*"/, '<svg$1 height="' + out.height + '"'));
      return;
    }
    // pdf: the print dialog, one page the size asked (or the drawing's)
    var w = out.wmm ? out.wmm / MM : out.width / CSS_DPI, h = out.hmm ? out.hmm / MM : out.height / CSS_DPI, big = Math.max(w, h);
    if (big > 200) { w *= 200 / big; h *= 200 / big; }
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true'); frame.className = 'ep-print-frame';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    var doc = frame.contentDocument; doc.open();
    doc.write('<!doctype html><html><head><title>' + esc(base) + '</title><style>@page{size:' + w.toFixed(2) + 'in ' + h.toFixed(2) + 'in;margin:0}html,body{margin:0;padding:0}svg{display:block;width:100%;height:auto;page-break-inside:avoid}</style></head><body>' + out.src + '</body></html>');
    doc.close();
    setTimeout(function () { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { alert('Could not open the print dialog: ' + e.message); } setTimeout(function () { frame.remove(); }, 60000); }, 250);
    setStatus('Choose "Save as PDF" in the print dialog');
  }

  // ------------------------------------------------------------------ dialog
  var modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'pro-modal'; modal.id = 'proExportOptions'; modal.hidden = true;
    modal.innerHTML =
      '<div class="pro-modal-card ep-card" role="dialog" aria-modal="true" aria-labelledby="epTitle">' +
        '<div class="pro-panel-head"><span class="pro-panel-title" id="epTitle">Export options</span>' +
          '<button type="button" class="pro-icon-btn pro-icon-btn-sm" id="epClose" aria-label="Close"><svg class="pro-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="pro-modal-body ep-body">' +
          '<div class="ep-row"><span class="ep-label">Format</span><span class="pro-radio-seg" role="radiogroup" aria-label="Format">' +
            '<label><input type="radio" name="epFormat" value="svg" checked><span>SVG</span></label><label><input type="radio" name="epFormat" value="png"><span>PNG</span></label><label><input type="radio" name="epFormat" value="pdf"><span>PDF</span></label></span></div>' +
          '<div class="ep-row"><label class="ep-label" for="epSize">Size</label><select id="epSize" class="pro-select">' + SIZES.map(function (s) { return '<option value="' + s.id + '">' + s.label + ' — ' + s.hint + '</option>'; }).join('') + '</select></div>' +
          '<div class="ep-row" id="epCustomRow" hidden><label class="ep-label" for="epCustomMm">Width</label><span class="pro-num-wrap"><input type="number" id="epCustomMm" class="pro-num" min="20" max="1000" step="1" value="120"><span class="pro-unit">mm</span></span></div>' +
          '<div class="ep-row" id="epDpiRow" hidden><span class="ep-label">Resolution</span><span class="pro-radio-seg" role="radiogroup" aria-label="Resolution">' +
            '<label><input type="radio" name="epDpi" value="150"><span>150 dpi</span></label><label><input type="radio" name="epDpi" value="300" checked><span>300 dpi</span></label><label><input type="radio" name="epDpi" value="600"><span>600 dpi</span></label></span></div>' +
          '<div class="ep-row"><span class="ep-label">Crop</span><span class="pro-radio-seg" role="radiogroup" aria-label="Crop">' +
            '<label><input type="radio" name="epCrop" value="all" checked><span>Whole drawing</span></label><label><input type="radio" name="epCrop" value="selection" id="epCropSel"><span>Selected tips only</span></label></span></div>' +
          '<p class="ep-note" id="epCropNote"></p>' +
          '<div class="ep-row"><label class="ep-label" for="epName">File name</label><input type="text" id="epName" class="ep-name" value="tree" spellcheck="false"></div>' +
          '<p class="ep-note">SVG and PDF stay vector and their text stays editable text; to turn text into shapes use your drawing program (Illustrator: Type → Create Outlines; Inkscape: Path → Object to Path).</p>' +
          '<p class="ep-out" id="epOut"></p>' +
          '<div class="ep-actions"><button type="button" class="pro-btn" id="epCancel">Cancel</button><button type="button" class="pro-btn pro-btn-primary" id="epGo">Export</button></div>' +
        '</div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    $('epClose').addEventListener('click', close); $('epCancel').addEventListener('click', close);
    $('epGo').addEventListener('click', function () { var o = read(); close(); exportNow(o); });
    modal.addEventListener('change', refresh);
    modal.addEventListener('input', refresh);
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } if (e.key === 'Enter' && e.target.id === 'epName') { $('epGo').click(); } });
    return modal;
  }
  function read() {
    return { format: (modal.querySelector('input[name=epFormat]:checked') || {}).value || 'svg', size: $('epSize').value, customMm: +$('epCustomMm').value,
      dpi: +((modal.querySelector('input[name=epDpi]:checked') || {}).value || 300), crop: (modal.querySelector('input[name=epCrop]:checked') || {}).value || 'all', name: $('epName').value.trim() };
  }
  function refresh() {
    var o = read();
    $('epCustomRow').hidden = o.size !== 'custom';
    $('epDpiRow').hidden = o.format !== 'png';
    var n = selectedTips().length, sel = $('epCropSel');
    var radial = typeof geometry !== 'undefined' && geometry === 'radial';
    sel.disabled = !n || radial;
    if (sel.disabled && o.crop === 'selection') { modal.querySelector('input[name=epCrop][value=all]').checked = true; o.crop = 'all'; }
    $('epCropNote').textContent = radial ? 'Cropping to tips is for the rectangular layout.' : n ? n + ' tip' + (n === 1 ? '' : 's') + ' selected: the rows of these tips, across every panel.' : 'Select tips or a clade on the tree to crop to them.';
    // what comes out
    try {
      var out = build(o), txt;
      if (o.format === 'png') { var pw = out.wmm ? out.wmm / MM * o.dpi : out.width * o.dpi / CSS_DPI; txt = Math.round(pw) + ' × ' + Math.round(pw * out.height / out.width) + ' px at ' + o.dpi + ' dpi'; }
      else txt = out.wmm ? out.wmm.toFixed(0) + ' × ' + out.hmm.toFixed(0) + ' mm' : Math.round(out.width) + ' × ' + Math.round(out.height) + ' pt';
      $('epOut').textContent = 'Output: ' + txt + (o.crop === 'selection' ? ', cropped' : '');
    } catch (e) { $('epOut').textContent = ''; }
  }
  function open() { ensureModal(); modal.hidden = false; refresh(); $('epName').focus(); }
  function close() { if (modal) modal.hidden = true; }

  // the menu entry
  var menu = $('proExportMenu');
  if (menu && !menu.querySelector('[data-export="options"]')) {
    var sep = document.createElement('div'); sep.className = 'pro-menu-sep'; sep.setAttribute('role', 'separator');
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pro-menu-item'; b.setAttribute('role', 'menuitem'); b.setAttribute('data-export', 'options');
    b.innerHTML = '<span class="pro-menu-text"><b>Export options…</b><small>Journal column widths, A4 / Letter, dpi, crop to the selected tips</small></span>';
    menu.appendChild(sep); menu.appendChild(b);
    menu.addEventListener('click', function (e) { var t = e.target.closest('[data-export="options"]'); if (t) setTimeout(open, 0); });
  }
  window.tmExportPresets = { open: open, build: build, exportNow: exportNow, SIZES: SIZES };
})();
