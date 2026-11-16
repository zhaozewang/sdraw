# Editable HTML boards, version 1

This checkout is maintained independently as an RSI Console plugin. Existing
`.sdraw` and `.json` boards use their original JSON schema and migration pipeline.
New boards default to `.html`; the creation dialog also offers JSON and sdraw.

HTML is a standalone preview with an explicit editable canvas contract:

- `meta[name=sdraw-format]` is `1`.
- `script#sdraw-board[type=application/json]` holds board-level settings and code.
  It never executes. Source JSON escapes `<` so Python strings cannot terminate it.
- Each `article[data-sdraw-element]` holds one element's complete JSON metadata.
  Preserve stable element IDs and unknown fields.
- Inline `left`, `top`, `width`, `height` (px), `transform:rotate(...deg)`, and
  `z-index` are authoritative over metadata. Text font-size is also editable.
- `span[data-sdraw-text]` contains authoritative plain text; edit it directly.
- Other elements have an SVG preview generated from their metadata. Change shape,
  image, and plot semantics in the metadata or in the visual editor. Embedded SVG
  is a rendered preview, not a second authoritative shape representation.

This is not a general HTML/CSS importer. Unmarked HTML is rejected without writing
it. HTML content outside this contract is not retained on save. Legacy properties,
plot code sharing, grouping, crop and cached output fields survive conversion;
preview rendering inherits the existing server SVG renderer's limitations.
Opening and converting do not run Python. The normal editor still owns execution.

```sh
python scripts/board.py figure.sdraw --output figure.html
python scripts/board.py figure.html --output figure.json
python scripts/board.py figure.html
```

The CLI refuses to overwrite an existing output. The editor retains each opened
file's format on save and rename. A format conversion through the API is an open
followed by save to a different extension. Checkpoint files remain internal JSON.


## Published SVG source links

A vector SVG may carry `<metadata id="sdraw-source">` containing JSON with
`version: 1`, the adjacent source-board filename in `board`, and `board_id`.
Opening that SVG through `/api/boards/open` resolves and opens the original
board, returning its source path so edits save to the board rather than the SVG.
Only adjacent `.sdraw`, `.json`, `.html`, or `.htm` sources with a matching ID
are accepted. Arbitrary SVG import is not implemented; missing or invalid source
metadata produces an explicit error. Opening never executes plot code.

For editable report figures, set `autoExport.enabled`, `format: "svg"`,
`sizeMode`, `outputPath`, and `sourceBoard` on the source canvas. Use
`sizeMode: "fit"` to frame the content with the standard export margin, or
`"canvas"` to preserve the full canvas boundary. The
mounted editor uses vector server rendering for SVG autosave exports, preserving
text and shape elements and the source link. Raster export behavior is unchanged.

The report preview (`mode=figure`) exposes **Export framing** beside its save
controls: **Fit content**, **Full canvas**, and **Fixed size**. Fixed size exposes
width and height in export units; the existing DPI multiplier still applies.
All three options use the same `autoExport` settings as the full editor. Saving,
closing, or opening the full editor persists the selected mode and re-exports
the figure. This does not move elements or resize the editable canvas. The
selection is per board, not a document-wide or browser-only preference.


## Layout-only figure assets

An image element with `metadata.contentPolicy: "layout-only"` is an opaque
scientific panel. Its SVG is retained as one asset, not imported into editable
shapes. The inspector exposes position and proportional dimensions only. Single,
bulk and propagated group updates preserve its source, metadata and styles;
size edits preserve aspect ratio. Other elements remain editable normally.
This is an editor content policy, not filesystem access control. Numerical
changes belong in the plotting source and must regenerate the asset.

## Linked sub-canvases

An image can carry `metadata.subcanvasPath`, the source board path, while
`source.path` points to that board's auto-exported SVG. The parent treats the
preview as one layout object (`contentPolicy: layout-only`); its editable
components live in the child board. Full-editor double-click opens the child
in a separate browser tab. In `mode=figure`, nested navigation is disabled.
Child auto-export updates its SVG; the open parent watches that image and
refreshes/re-exports through the existing file watcher. No code is executed
when opening a sub-canvas. Numerical plots without subcanvasPath remain opaque.

## Rounded junctions

Insert → Lines → Rounded junction creates a connected four-port splitter.
It uses a rectangle element with `metadata.shape: "rounded-junction"`,
`metadata.junctionDirection` (`down`, `up`, `right`, or `left`), and
`style.borderRadius` in canvas units. Direction is the incoming-to-through
direction. The two side branches leave that stem with rounded bends; independent
crossing lines are not automatically joined. Radius is clamped to half the
smaller dimension. Arrow endpoints snap to the four edge midpoints.
The inspector controls direction, radius, stroke and size; fill is unused.
The canvas and vector export use the same geometry, preserved in HTML, JSON and
`.sdraw`. Older boards without this shape keep their original appearance.
