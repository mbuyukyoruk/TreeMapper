# PhyloTree + Metadata Viewer (TreeMapper)

A client-side tool to view a Newick phylogenetic tree with metadata tracks
(dataframes, heatmaps, highlights, clades, charts), clade tools, bootstrap
display and SVG export. Everything runs in the browser; no data is uploaded.

## How to run

Open `index.html` in a browser (double-click it). That's it: no server or
install needed, and it works offline (the only online resource is the Inter
web font; without internet the browser falls back to a system font).

Keep the folder structure intact: `index.html` loads the files in `css/` and `js/`.

## Folder layout

```
index.html                 page markup (sidebar, toolbar, canvas)
css/
  tailwind-subset.css      the few Tailwind CSS rules the app uses (5 KB)
  styles.css               all app styles
js/
  vendor/d3.v7.9.0.min.js  D3 library, bundled locally (pinned version)
  drag-fastpath.js         splitter-drag flag helper (runs before app.js)
  app.js                   the application
  debug-monitor.js         optional performance/click debugger (see below)
```

## Debug monitor

The green "CLICK DEBUG" panel is now off by default. To turn it on, open the
page with `?debug` at the end of the address, e.g. `.../index.html?debug`.

## Performance changes (behaviour unchanged)

Each change below was verified with an automated before/after comparison (the
SVG/DOM, computed styles, screenshots and exported SVG all match the original)
on a 120-tip and a 1500-tip tree.

1. **Debug monitor made opt-in.** It ran a frame-by-frame loop, logged every
   click into the page and wrapped `drawTree`, `refreshAll` and 24 other functions.
2. **Tailwind: 2.9 MB → 5 KB.** Only the rules actually used are kept.
3. **D3 bundled locally and pinned to 7.9.0.** The page previously loaded
   `d3@7` from a CDN: it did not work offline, and a future D3 release could
   change behaviour unexpectedly.
4. **`cssVar()` caches theme colours.** Each call used `getComputedStyle()`,
   forcing a full style recalculation of tens of thousands of SVG elements
   during every redraw. Values are re-read when the theme changes.
5. **Faster search matching** (also used when loading clade data): text is
   lower-cased once per value instead of once per search term.
6. **Clade Tools shimmer bar animates on the GPU** (`transform` instead of
   `background-position`). It looks the same but no longer repaints the page
   every frame.
7. **The tree SVG gets its own compositing layer** (`will-change: transform`).
   This removed ~1.2 s per repaint on large trees.
8. **Theme preference storage can't crash the app.** If the browser blocks
   `localStorage` (possible for local files), the app now still loads.
