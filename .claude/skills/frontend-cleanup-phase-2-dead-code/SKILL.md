---
name: frontend-cleanup-phase-2-dead-code
description: "Phase 2 of frontend-architecture-cleanup: delete the duplicate DirEntry interface in types/board.ts (FS-005) and delete the unreachable captureCanvas.ts SVG renderer (FS-006). Depends on: frontend-cleanup-phase-1-vitest-bootstrap. Ships: two files touched, zero product behavior change, zero new dependencies."
argument-hint: /ship /frontend-cleanup-phase-2-dead-code
user-invocable: true
---

# Phase 2: Delete dead code (duplicate DirEntry + captureCanvas.ts)

**Goal:** Remove two pieces of verified dead code flagged by `/architect-review --scope frontend/src` on commit af652c0: the duplicate `DirEntry` interface declaration (FS-005, low) and the 397-LOC `captureCanvas.ts` renderer with zero inbound callers (FS-006, medium). Both are `effort: one-pr` per the review; grouped into this single phase because each is a trivial deletion, they share the "dead frontend code" topic, and splitting them into two phases would violate the "phase inflation" guardrail (a phase whose acceptance criterion is "file compiles" should be merged up).

**Depends on:** frontend-cleanup-phase-1-vitest-bootstrap

## Scope

### Touches (may modify)
- `frontend/src/types/board.ts` - delete the duplicate `DirEntry` declaration at lines 172-179. Keep the first declaration at lines 163-170.
- `frontend/src/utils/captureCanvas.ts` - delete the entire file. Its sole export `captureCanvasForExport` (at `:385`) has no callers; confirmed by the review's grep and by its own docstring at `:237` which states `captureOffscreen` is the primary path.

### Reads only (for context)
- `frontend/src/utils/captureOffscreen.ts` - confirm this is the live export path (anchors `:643, :865` for feat-fe-export-offscreen).
- `frontend/src/App.tsx:899-913` - the local variable named `captureCanvas` at line 899 is a function-scoped callback, NOT an import of `captureCanvas.ts`. Re-read this region to confirm the deletion does not break anything.
- `frontend/src/types/board.ts:1-162, :181-253` - to confirm nothing else references the soon-to-be-removed second declaration (TypeScript interface merging means both declarations produce the same exported type, so removal is safe).

### Out of scope
- Moving `captureCanvas.ts` to `docs/history/` as a reference. The file's logic has been entirely superseded by `captureOffscreen.ts` per user memory "dual-renderer approach is fundamentally broken; use same React components for export." Git history preserves the content for anyone who wants to read it.
- Any edits to `captureOffscreen.ts` or the export flow (`App.tsx:899` onwards). That is the live path and must keep working.
- Any other dead-code sweep (e.g., unused helpers in `helpers.ts`, unused types). Out of scope - only the two specific review findings.
- Refactoring `types/board.ts` into smaller files (not a review finding).

## Interface Changes

### API
None.

### Database
None.

### Events
None.

### Prompts
None.

### Frontend contracts
- `DirEntry` interface remains exported from `frontend/src/types/board.ts` (first declaration at `:163-170` is kept verbatim). All existing imports of `DirEntry` (App.tsx, helpers.ts, etc.) continue to resolve unchanged. TypeScript's interface-merging behavior previously made the duplicate a no-op; removing it has zero type-surface effect.
- `captureCanvas.ts` and its export `captureCanvasForExport` are removed. Zero files import either symbol (confirmed via `grep -r "captureCanvas\|captureCanvasForExport" frontend/src backend electron`). The only match outside the file itself is the local variable in `App.tsx:899`, which is named the same but is a function-scoped callback built on `captureOffscreen`, NOT an import.

## Implementation Steps

1. Re-verify zero callers of `captureCanvasForExport`: run `grep -rn "captureCanvasForExport" frontend/ backend/ electron/ vscode-sdraw/ scripts/ 2>/dev/null`. Expected output: exactly one line - the export declaration itself in `frontend/src/utils/captureCanvas.ts:385`. If ANY other match appears, STOP and report `UNEXPECTED_CALLER`; do not proceed.
2. Re-verify the `App.tsx:899` `captureCanvas` local variable is NOT an import: `grep -n "captureCanvas" frontend/src/App.tsx` must show no `import ... captureCanvas` or `from '@/utils/captureCanvas'`. If it does, STOP and report.
3. Delete `frontend/src/utils/captureCanvas.ts` entirely. This is a file deletion, not a content change.
4. In `frontend/src/types/board.ts`, delete lines 172-179 inclusive (the second `DirEntry` block plus its trailing blank line if any), leaving the first declaration at `:163-170` untouched. After deletion, the `FileEvent` interface that was at `:181` becomes the immediate next block after `DirEntry`.
5. Run `cd frontend && npm run build` to confirm TypeScript compilation still succeeds. The build proves every inbound `import type { DirEntry }` still resolves and no file was implicitly using the second declaration.
6. Run `cd frontend && npm run test` (from Phase 1) to confirm the seed suite still passes. No test should reference `captureCanvas.ts`; any failure indicates Phase 1 leaked a dependency into a test fixture.
7. Smoke check the export flow manually: open a board, trigger an export (PNG/JPG), confirm the rendered image matches the canvas exactly. This confirms `captureOffscreen.ts` is indeed the live path, which the review already verified but which is cheap to re-check.

## Feature Preservation (zero tolerance)

No feature in the inventory has an `evidence_anchor` that points into `frontend/src/utils/captureCanvas.ts` or into `frontend/src/types/board.ts`. The nearby feature `feat-fe-export-offscreen` anchors only `frontend/src/utils/captureOffscreen.ts:643, :865`, which this phase does NOT touch.

No feature preservation obligations - this phase touches only internal-only code verified dead by the inbound review (FS-005 + FS-006).

A sanity assertion (not a preservation obligation, but enumerated to be explicit): after this phase, the following feature anchor MUST still resolve and its behavior MUST be unchanged:
- `feat-fe-export-offscreen` - Off-screen html2canvas+SVG export
  - Keep resolvable: `frontend/src/utils/captureOffscreen.ts:643, :865` (util) - not touched
  - Manual smoke check in Implementation Step 7 verifies the export still works end-to-end.

## Test Impact (scope-aware attribution map)

No inventory feature belongs to this phase. All buckets are empty or minimal.

### Must stay green - a failure here is UNINTENDED
- `frontend/src/store/boardStore.test.ts` (the entire file from Phase 1) - none of its tests reference captureCanvas or DirEntry, so all must continue passing unmodified.

### Expected to change - a failure here is INTENDED
(none - no anchor moves)

### New tests added by this phase
(none - this phase deletes code; there is nothing new to cover. Adding a test asserting "captureCanvas.ts is absent" would be scope-inflation noise.)

### Out-of-scope tests - a failure here is UNINTENDED (scope violation)
Any test outside `frontend/src/store/boardStore.test.ts` that fails during this phase is proof that the phase touched code it was not supposed to. STOP and report as `OUT_OF_SCOPE_TEST_FAILURE`.

## Acceptance Criteria

- [ ] `frontend/src/utils/captureCanvas.ts` does not exist after this phase. `ls frontend/src/utils/` shows only `alignmentGuides.ts`, `captureOffscreen.ts`, `helpers.ts`, `snapToShape.ts`.
- [ ] `frontend/src/types/board.ts` contains exactly one `export interface DirEntry` declaration (at approximately `:163-170`, the second one at `:172-179` gone).
- [ ] `cd frontend && npm run build` succeeds (TypeScript resolves every `DirEntry` import and nothing imports a now-deleted symbol).
- [ ] `cd frontend && npm run test` - all Phase 1 tests still pass.
- [ ] Manual smoke: board export (PNG or JPG) produces the same output as before this phase. Compare visually; this is a spot-check, not a pixel-diff.
- [ ] Every feature listed under Feature Preservation above is verifiable post-change (trivially satisfied - none belong to this phase; the sanity-assert `feat-fe-export-offscreen` is confirmed by the manual smoke check).
- [ ] Every test in Test Impact -> "Must stay green" passes unmodified.
- [ ] Every test in Test Impact -> "Expected to change" has been updated. (Trivially satisfied: bucket is empty.)
- [ ] No test outside the Test Impact map fails. (No new tests; existing Phase 1 tests cover the entire suite.)
- [ ] `/architect-review --scope frontend/src --full` after this phase produces zero `feature-regression` findings AND resolves FS-005 and FS-006.
- [ ] Build + lint pass (`npm run build` is the equivalent in this repo; no separate lint script exists per `package.json`).

## Test Plan

- **Unit:** no new tests; Phase 1 suite must remain green.
- **Integration:** N/A.
- **Manual / browser:** one export smoke test (PNG export of a board with 2-3 elements including a plot).
- **Eval:** N/A.

## Rollback

1. Revert the commit that introduced this phase.
2. `git checkout <prev-commit> -- frontend/src/utils/captureCanvas.ts frontend/src/types/board.ts` to restore both files.
3. No data migration to revert; no npm script or dependency change; no feature flag.
4. Run `cd frontend && npm run build` to confirm the restore compiles.

## Handoff to Next Phase

**Invariants this phase guarantees** (phases 3 and 4 may rely on these):
- `captureCanvas.ts` no longer exists - downstream phases should not attempt to import it or reason about a dual-renderer architecture.
- `DirEntry` has exactly one declaration at `frontend/src/types/board.ts` - any phase that imports `DirEntry` resolves to the single canonical shape.
- The live export path is unambiguously `captureOffscreen.ts`; no future phase should revive a second renderer without an ADR (per the user memory `feedback_export_architecture.md`).

**Invariants this phase does NOT guarantee** (later phases must handle):
- No claim is made about the size or shape of `captureOffscreen.ts` - it is 879 LOC per review and remains a candidate for a future split if a module-budget ADR is drafted (FS-002 territory, not this plan).
- No claim is made about `helpers.ts`, `alignmentGuides.ts`, or `snapToShape.ts` dead-code status - not audited in this phase.
