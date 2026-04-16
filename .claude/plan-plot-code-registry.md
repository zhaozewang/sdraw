# Plan: Plot code registry (decouple code from figure elements)

Deferred while we investigate the save-shows-wrong-plot bug. Pick back up
after that bug is fixed.

## Problem we're solving

Today, plot code lives on one element (`metadata.code` on the "source"
plot). Sibling figures reference that source via `metadata.sourceElementId`.
This asymmetry causes friction:

- Deleting the "source" figure orphans all siblings (code is gone).
- Users don't know which figure is the source, so deletion has unintuitive
  consequences.
- Figures aren't pure views — they double as code containers.

## Proposed model

A plot is conceptually **a code entry + a set of figure elements**.

- Add `board.plotCodes: Record<plotCodeId, { code, setupHashAtLastRun }>`.
- Each figure element gets `metadata.plotCodeId` (replaces
  `sourceElementId`) and keeps `metadata.figureIndex`.
- Remove `metadata.code` from elements — code lives only in the registry.

## UX flow that falls out

- **Delete one figure** → element removed. Code entry stays. Other figures
  keep their indices untouched.
- **Delete the last figure with that `plotCodeId`** → garbage-collect the
  registry entry. No orphan code on the board.
- **Run a code entry producing N figures** → update figure elements whose
  `figureIndex ∈ [0..N-1]` and which still exist. Only spawn new figure
  elements for indices that have no matching element (so a figure the user
  deleted doesn't resurrect).
- **Code edited since last run** → on the next run, wipe `plotCrop`,
  `renderedCodeHash`, and `lastOutput` for every figure with that
  `plotCodeId` before writing fresh outputs. Matches "intentional delete"
  intuition.
- **Double-click any figure** → same editor, same shared code entry.

## Migration (one-shot on board load)

For every plot element with `metadata.code`:
1. Create a `plotCodes[newId] = { code: el.metadata.code }` entry.
2. Set `el.metadata.plotCodeId = newId`; delete `el.metadata.code`.
3. For every element whose `metadata.sourceElementId === el.id`, set
   `metadata.plotCodeId = newId` and delete `sourceElementId`.

Bump `schema_version`. Keep a readback path for old files that haven't
been opened since the migration.

## Files that will touch

- `frontend/src/types/board.ts` — add `plotCodes` to Board, update schema
  version.
- `frontend/src/store/boardStore.ts` — migration in `openBoard` /
  `newBoard`; rewrite `distributePlotFigures` to key off `plotCodeId`; GC
  registry entries in `removeElements`.
- `frontend/src/components/PlotEditor/PlotEditor.tsx` — read/write code via
  registry (`board.plotCodes[el.metadata.plotCodeId].code`).
- Any element creation paths that seeded `metadata.code`.

## Open questions

- Do we show the code entry as a visible chip on the canvas, or keep it
  invisible? (Probably invisible — figures remain the only visible
  elements.)
- When the code produces MORE figures than elements exist, where do new
  figure elements land? (Today: row to the right of source. Proposal:
  row to the right of the highest-indexed existing element with that
  `plotCodeId`.)
- Undo semantics when deleting the last figure also deletes the code
  entry: the undo must restore both the element and the registry entry
  atomically. Use the existing history snapshot mechanism.
