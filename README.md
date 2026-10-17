# PhyloTree + Metadata Viewer (TreeMapper)

A client-side tool to view a Newick phylogenetic tree with metadata tracks
(dataframes, heatmaps, highlights, clades, charts), clade tools, bootstrap
display and SVG export. Everything runs in the browser; no data is uploaded.

## How to run

Open `index.html` in a browser (double-click it), or use the hosted copy at
https://mbuyukyoruk.github.io/TreeMapper/. No server or install is needed and
it works offline (only the web fonts come from the internet; without it the
browser uses a system font). Keep the folder structure intact: the page loads
the files in `css/` and `js/`.

The earlier classic-layout interface is kept in git history under the tag
`v1-classic-ui`.

## At a glance

- **Top bar:** Open tree (loads as soon as you pick a file), Generate tree,
  Add data, Export SVG, light/dark theme.
- **Left panel:** *Layers* (your data cards, plus a *Colours & highlights* list
  of every colour you applied, each recolourable and removable) and *Style*
  (all display settings).
- **Canvas toolbar:** Rectangular/Circular, Fit, zoom, **Nodes** (shows the
  internal nodes so you can click a clade), **Reset** menu (restore dropped
  tips, undo rotations/collapses/cartoons, original root, colours,
  highlights), search (press `/`), legend panel toggle.
- **Selecting a clade** shows a floating toolbar at the bottom of the canvas
  with Rotate, Collapse, Cartoon, Colour, Highlight, Re-root and more.
- **Legend panel** on the right (can be hidden), **status bar** at the bottom.
- You can drop a Newick file onto the canvas to open it.
- **Undo / redo** (toolbar arrows, ⌘Z / ⇧⌘Z) for rotate, collapse, cartoon,
  drop, isolate, colours, highlights, the Reset-menu actions and re-rooting
  (Re-root, Reset root, midpoint rooting). Opening or generating a new tree
  starts a fresh history.
- **Export** menu: SVG, PNG (2× or 4×, about 300 dpi) and PDF (vector, via
  the print dialog's "Save as PDF").
- **Tree files:** Newick and NEXUS (TRANSLATE tables are applied).
- **Expanded view:** scroll with the mouse wheel or trackpad (Shift for
  sideways, pinch or ⌘-scroll to zoom); the scale bar and data axes stay
  pinned at the top.
- **Keyboard shortcuts:** press `?` (or *Shortcuts* in the status bar).
- **Display settings are remembered** in the browser (Style tab → *Restore
  default display settings* to reset). Tree-specific settings such as
  rooting, expansion and data columns are not remembered.

## Folder layout

```
index.html                 the application page
css/
  tailwind.css             the few Tailwind CSS rules the app uses
  styles.css               base app styles
  pro.css                  layout and visual design
js/
  vendor/d3.v7.9.0.min.js  D3 library, bundled locally (pinned version)
  app.js                   the application
  pro-ui.js                layout logic (panels, Reset/Export menus, colour pop-up, shortcuts, ...)
  undo.js                  undo / redo history
  drag-fastpath.js         splitter-drag flag helper (runs before app.js)
  bench.js                 built-in speed test (index.html?bench)
  debug-monitor.js         optional performance/click debugger (index.html?debug)
```

## Diagnostics

- `index.html?bench`: runs a built-in speed test on generated 3,000-tip data.
- `index.html?debug`: shows the green "CLICK DEBUG" performance monitor.

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
6. **Clade Tools accent bar no longer repaints the page every frame** (classic
   layout): it slides a GPU layer instead of animating `background-position`.
   Idle CPU use on a large tree is about 5× lower.
7. **The tree SVG gets its own compositing layer** (`will-change: transform`).
   This removed ~1.2 s per repaint on large trees.
8. **Theme preference storage can't crash the app.** If the browser blocks
   `localStorage` (possible for local files), the app now still loads.
