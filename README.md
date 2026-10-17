# PhyloTree + Metadata Viewer (TreeMapper)

A client-side tool to view a Newick phylogenetic tree with metadata tracks
(dataframes, heatmaps, highlights, clades, charts), clade tools, bootstrap
display and SVG export. Everything runs in the browser; no data is uploaded.

## How to run

There are two versions of the interface. Both use the same features and the
same application code (`js/app.js`); only the layout and look differ:

- **`index-pro.html`**: the new application-style interface (full-window
  workspace, top bar, Layers/Style side panel, legend panel, status bar).
- **`index.html`**: the classic interface, unchanged.

Open either file in a browser (double-click it). No server or install is
needed, and both work offline (only the web fonts come from the internet;
without it the browser uses a system font).

Keep the folder structure intact: the pages load the files in `css/` and `js/`.

The classic version as it was before the new interface was added is also
saved in git as the tag `v1-classic-ui`.

## New interface (index-pro.html) at a glance

- **Top bar:** Open tree (loads as soon as you pick a file), Generate tree,
  Add data, Export SVG, light/dark theme.
- **Left panel:** *Layers* (your data cards) and *Style* (all display settings).
- **Canvas toolbar:** Rectangular/Circular, Fit, zoom, **Nodes** (shows the
  internal nodes so you can click a clade), search, legend panel toggle.
- **Selecting a clade** shows a floating toolbar at the bottom of the canvas
  with Rotate, Collapse, Cartoon, Colour, Highlight, Re-root and more.
- **Legend panel** on the right (can be hidden), **status bar** at the bottom.
- You can drop a Newick file onto the canvas to open it.

## Folder layout

```
index.html                 classic interface
index-pro.html             new application-style interface
css/
  tailwind-subset.css      the few Tailwind CSS rules the app uses (5 KB)
  styles.css               app styles (both versions)
  pro.css                  styles for the new interface (index-pro.html only)
js/
  vendor/d3.v7.9.0.min.js  D3 library, bundled locally (pinned version)
  app.js                   the application (both versions)
  drag-fastpath.js         splitter-drag flag helper (runs before app.js)
  pro-ui.js                layout logic for the new interface (index-pro.html only)
  shimmer.js               Clade Tools accent bar animation (classic version)
  debug-monitor.js         optional performance/click debugger (see below)
```

## Debug monitor

The green "CLICK DEBUG" panel is now off by default. To turn it on, open the
page with `?debug` at the end of the address, e.g. `.../index.html?debug`
(or `.../index-pro.html?debug`).

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
6. **Clade Tools accent bar no longer repaints the page every frame.** It moves
   the same way as before and, as before, pauses while the app is busy, but it
   now slides a GPU layer (`js/shimmer.js`) instead of animating
   `background-position`. Idle CPU use on a large tree is about 5× lower.
7. **The tree SVG gets its own compositing layer** (`will-change: transform`).
   This removed ~1.2 s per repaint on large trees.
8. **Theme preference storage can't crash the app.** If the browser blocks
   `localStorage` (possible for local files), the app now still loads.
