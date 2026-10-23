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
  The **«** button (or `[`) minimizes it to an icon rail: one tile per data
  layer (drag tiles to reorder layers, as with the cards; click one to open the
  panel with that card). The choice is remembered.
- **Canvas toolbar:** Rectangular/Circular, Fit, zoom, **Nodes** (shows the
  internal nodes so you can click a clade), **Reset** menu (restore dropped
  tips, undo rotations/collapses/cartoons, original root, colours,
  highlights), search (press `/`), legend panel toggle.
- **Search** (press `/`): type accessions, genes or any data value. Separate
  several terms with commas, spaces or new lines (paste a list); put a phrase
  that contains spaces in "double quotes". *Look in* (left of the box) limits
  the search to Accessions, Genes or a single data layer (Dataframe 1,
  Heatmap 1, ...). **ab** (right of the box) switches to *Exact match*: whole
  values only, ignoring case; an accession matches with or without its
  version (`ACC123` finds `ACC123.1`). Both choices are remembered and saved
  in sessions (a single-layer choice is kept in sessions only, and goes back
  to *All* if that layer is removed).
- **Canvas tools** (toolbar, as in Illustrator): **Select** (`V`, default) —
  drag on an empty part of the canvas to draw a rectangle; the tips inside it
  (their node or label) are selected, shown and used like search results
  (Copy, Drop, Isolate, Colour, Re-root). `⇧` adds, `⌥` removes, `Esc`
  cancels; a collapsed or cartooned clade counts as all its tips. **Pan**
  (`H`) — drag to move an expanded tree; with Select, hold `Space` or use the
  middle mouse button to pan. The wheel and trackpad scroll as before.
- **Selecting a clade** shows a floating toolbar at the bottom of the canvas
  with Rotate, Collapse, Cartoon, Colour, Highlight, Re-root and more.
- **Legend panel** on the right (can be hidden), **status bar** at the bottom.
- You can drop a Newick file onto the canvas to open it.
- **Sessions:** *Save session* (⌘S) writes a `.treemapper` file with the
  tree, every data file, each card's settings (visibility, colours, gene
  order), the display settings, the root, tree edits (rotations, collapses,
  cartoons, drops) and colours/highlights. *Open* (⌘O) or dropping the file
  on the canvas restores it exactly. The file is plain JSON and contains your
  data files, so share it only where the data may go.
- **Undo / redo** (toolbar arrows, ⌘Z / ⇧⌘Z) for rotate, collapse, cartoon,
  drop, isolate, colours, highlights, the Reset-menu actions and re-rooting
  (Re-root, Reset root, midpoint rooting). Opening or generating a new tree
  starts a fresh history.
- **Export** menu: SVG, PNG (2× or 4×, about 300 dpi) and PDF (vector, via
  the print dialog's "Save as PDF").
- **Tree files:** Newick and NEXUS (TRANSLATE tables are applied). Quoted
  names (`'Homo sapiens'`) and [comments] are understood.
- **Support values** (Style → *Support values*): an internal label made of
  numbers is the support of the branch above that node: `95`, `0.98`, or
  `95/88` (IQ-TREE SH-aLRT/UFBoot; *Data source* picks which number).
  RAxML `A:0.1[95]` labels and MrBayes/BEAST `[&prob=0.97]` annotations are
  read too. Any other internal label is a clade name. Nothing is ever made up:
  a tree without support values shows none. The scale is detected per tree
  (0–1, 0–100, or replicate counts such as 0–1000) and the range, symbol sizes
  (0% = minimum, 100% = maximum, as in the legend), colours and the percent
  text all work in percent of that scale.
- **Re-rooting** puts the root on the branch above the selected clade (or
  tip), halfway along it, so the clade becomes one side of the root. Every
  branch keeps its length and support value: on the path to the new root the
  branches are reversed and their values move with them, so distances between
  tips never change. A root with two branches is one branch of the unrooted
  tree; when those two branches had different support values the joined branch
  keeps the lower one (the Support values panel says so).
  **Midpoint rooting** puts the root halfway along the longest path between
  two tips, on the branch where that point falls; it does not depend on the
  previous root. **Reset root** gives back the file's tree exactly.
  (Sessions saved before October 2026 with the root at a node still open with
  that root.)
- **Expanded view:** scroll with the mouse wheel or trackpad (Shift for
  sideways, pinch or ⌘-scroll to zoom); the scale bar and data axes stay
  pinned at the top (or at the bottom, see below).
- **Axis titles (units):** a **+** centred on each axis (scale bar, dataframe
  and chart axes) adds a title; type it and press Enter (Esc cancels). Hover a
  title for its box and **−** to remove it; click it to edit. Titles stay with
  their layer when layers are reordered or resized, are exported, and are saved
  in sessions. Style → Appearance → *Axis title buttons* hides the + buttons.
- **Legend order:** the button next to *Legend* switches between **A–Z** (one
  sorted list per layer type, values of all layers merged) and **By layer**
  (each layer separately, in the order of the layers, with its own values in
  its own order and colours). Remembered, and saved in sessions.
- **Axes below the tree** (Style → Appearance): the scale bar, the dataframe
  and chart axes and the heatmap titles move under the last tip, like an
  x-axis (rectangular layout). Fit and exports include them; in the expanded
  view they stay pinned to the bottom of the canvas until you reach the end.
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
  tree-core.js             tree model: Newick parsing/writing, re-rooting, midpoint (no page code)
  app.js                   the application
  select-tool.js           Select / Pan tools and the drag-selection rectangle
  pro-ui.js                layout logic (panels, Reset/Export menus, colour pop-up, shortcuts, ...)
  undo.js                  undo / redo history
  session.js               save / open sessions (.treemapper files)
  drag-fastpath.js         splitter-drag flag helper (runs before app.js)
  bench.js                 built-in speed test (index.html?bench)
  debug-monitor.js         optional performance/click debugger (index.html?debug)
```

## How redrawing works

Most actions redraw the tree. The data layers (dataframe bars, heatmap cells,
chart bars, with their axes and titles) are by far the largest part of the
drawing, so each layer is kept between redraws unless something it depends on
changed: its own card, the tip order or positions, or the column sizes. Style
changes to the tree, colours, highlights, the theme and Fit therefore redraw
only the tree, and a change in one data card redraws only that layer. Exports
are unaffected (byte-identical to a full redraw).

## Large trees (fast prototype, branch `fast-prototype`)

From 3,000 tips (`window.TM_FAST_FROM`) the tree and its data layers are drawn
by `js/fast-draw.js` as a few hundred elements instead of one per branch, tip,
cell and bar: all branches of one colour and width are one path, all markers
of one look one path, all heatmap cells of one colour one path, all bars of one
gene one path (boxes, arrow heads, DNA lines), chart bars, dots, lines, box
plots and synteny links likewise; a column or ring where every value has its
own colour is painted into one picture. Hover, tooltips, the row band, clicks
(select a node, focus a gene) and the marquee work from coordinates: the row
from y (or the angle in the circular layout), the bar from x (or the radius).
The selection overlay, clade colours and marker colours redraw the few paths.
Labels are drawn only for the rows in view once a label is at least 3.5 px
tall on screen; a zoom or pan draws them again; the export draws every label.
A splitter drag shows live frames without a redraw: a column that only moves
is translated; a column whose width changes has its cells, bars and axis line
stretched to the new inner width (what a redraw gives), while its text, tick
marks, axis title and + button are moved, never scaled, and tick numbers that
would overlap are left out; an alignment column is drawn again at its new
width on every frame. The tree's branches and markers are painted into a
picture when the pointer nears a splitter (WebKit painted 5 frames a second
with 24,000 tips' branches as paths under a transform), so the frames are
cheap. While the pointer moves the stretched groups are approximate (the
tree's picture stretched, dots and arrow heads too); whenever it pauses, the
drawing is drawn for real at those widths and the drag goes on from there, and
the release draws everything for real. A tree without data moves its dashed
"add data" box with the panel. A ring drag in the circular layout paints the
rings. Everything stays SVG, so zoom,
export, sessions, undo and the comparison tree are unchanged. Below the
threshold the drawing is exactly as before. Test:
`PAGE=TreeMapper-fast node regress/fastmode.js` in `TreeMapper_tests`.

## Diagnostics

- `index.html?bench`: runs a built-in speed test on generated 3,000-tip data.
- `index.html?debug`: shows the green "CLICK DEBUG" performance monitor.
- `index.html?noreuse`: always redraws everything (for comparison).

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
5. **Faster search matching** (also used when loading clade data): the
   searchable text of every tip is collected and lower-cased once into an
   index, rebuilt only when the tree or a data layer changes.
6. **Clade Tools accent bar no longer repaints the page every frame** (classic
   layout): it slides a GPU layer instead of animating `background-position`.
   Idle CPU use on a large tree is about 5× lower.
7. **The tree SVG gets its own compositing layer** (`will-change: transform`).
   This removed ~1.2 s per repaint on large trees.
8. **Theme preference storage can't crash the app.** If the browser blocks
   `localStorage` (possible for local files), the app now still loads.
