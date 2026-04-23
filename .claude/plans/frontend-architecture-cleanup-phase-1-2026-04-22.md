# Frontend architecture cleanup (phase 1 of FS-003 phased-refactor) — Architectural Plan — 2026-04-22

## Goal

Address the five in-scope findings from `docs/architecture-reviews/frontend-src/state.json` (commit `af652c0`): FS-003 (install vitest + RTL and seed tests for load-bearing pure functions), FS-005 (delete duplicate `DirEntry` interface), FS-006 (delete dead `captureCanvas.ts` renderer), FS-007 (extract `WelcomeScreen` and home-screen dialogs from `App.tsx`), FS-008 (centralize localStorage keys into typed accessors). The three ADR-blocked findings (FS-001 undocumented-intent, FS-002 monolithic core files, FS-004 `getState()` convention gap) are explicitly excluded from this cycle and require a user-authored `frontend/CLAUDE.md` before they can be planned.

This plan is itself the "phase 1" of FS-003's own phased-refactor per the review's handoff hint: installing the test framework and seeding it with four pure-function tests. Systematic coverage for the remaining 20 `test_coverage_gaps[]` features is out of scope and will be planned in a subsequent `/architect-plan` cycle once the framework exists.

## Scope Summary

Inbound review: `docs/architecture-reviews/frontend-src/state.json` · `scope: frontend/src` · `last_commit: af652c0` · 8 findings open · 23 features in inventory.

Findings addressed by this plan:

| id | kind | severity | phase |
|---|---|---|---|
| FS-003 | test-coverage-gap | high | phase 1 (seed only; not full closure) |
| FS-005 | dead-code | low | phase 2 |
| FS-006 | dead-code | medium | phase 2 |
| FS-007 | convention-gap | medium | phase 4 |
| FS-008 | convention-gap | low | phase 3 |

Findings explicitly NOT addressed by this plan:

| id | kind | severity | blocker |
|---|---|---|---|
| FS-001 | undocumented-intent | high | Requires user-authored `frontend/CLAUDE.md` |
| FS-002 | convention-gap | high | Blocked on FS-001 + module-budget ADR |
| FS-004 | convention-gap | medium | Blocked on FS-001 |

Feature-preservation obligations (computed from inventory overlap with phase `Touches`):

- Phase 1 overlaps the `boardStore.ts` anchor paths of 14 features (element-crud, history-undo, delta-save, external-conflict, plotcode-registry-migration, plot-render-hash, multi-figure-distribute, run-all, run-one, kernel-actions, auto-export, grouping-align-zorder, websocket-file-watch, python-env-picker). All 14 anchors are preserved at identical line numbers; only `export` keywords are added. The phase-skill enumerates each feature under "Feature Preservation (zero tolerance)".
- Phase 2 has zero inventory-feature overlap. No feature evidence anchor points into `captureCanvas.ts` or `types/board.ts`.
- Phase 3 overlaps `feat-fe-inspector-per-type` (Inspector.tsx) and `feat-fe-python-env-picker` (uiStore.ts persistence mechanism only, not the picker or action anchors). Both anchors preserved; the Inspector edit is outside the anchor's line range.
- Phase 4 has zero inventory-feature overlap. No feature evidence anchor points into App.tsx's home-screen regions.

Test coverage gap closure by this plan:
- `test_coverage_gaps[]` closed: `feat-fe-plot-render-hash`, `feat-fe-delta-save`, `feat-fe-plotcode-registry-migration` (3 of 23, via Phase 1's seed suite).
- Remaining 20 gaps are explicitly deferred to a future `/architect-plan` cycle per FS-003's own phased-refactor posture.

No inventory feature is being retired. No ADR is required.

## Phases

| # | Slug | Goal | Depends on | Touches |
|---|------|------|------------|---------|
| 1 | `frontend-cleanup-phase-1-vitest-bootstrap` | Install vitest + jsdom + RTL; wire `npm test`; export 3 module-local pure fns; add seed tests for `plotRenderHash`, `codeDigest`, `computeSaveHashes`, `migrateToPlotCodeRegistry`. | none | `frontend/package.json`, `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`, `frontend/src/store/boardStore.ts`, `frontend/src/store/boardStore.test.ts` |
| 2 | `frontend-cleanup-phase-2-dead-code` | Delete duplicate `DirEntry` interface; delete dead `captureCanvas.ts` (397 LOC). | phase 1 | `frontend/src/types/board.ts`, `frontend/src/utils/captureCanvas.ts` |
| 3 | `frontend-cleanup-phase-3-localstorage-accessors` | New `frontend/src/utils/localStorage.ts` with typed accessors; migrate 4 keys across 3 files; add localStorage unit tests. | phase 1 | `frontend/src/utils/localStorage.ts`, `frontend/src/utils/localStorage.test.ts`, `frontend/src/App.tsx`, `frontend/src/store/uiStore.ts`, `frontend/src/components/Inspector/Inspector.tsx` |
| 4 | `frontend-cleanup-phase-4-welcome-screen-extract` | Extract WelcomeScreen + 5 sibling components from App.tsx into `frontend/src/screens/`. | phase 3 | `frontend/src/App.tsx`, `frontend/src/screens/WelcomeScreen.tsx`, `frontend/src/screens/dialogs/FileBrowserDialog.tsx`, `frontend/src/screens/dialogs/NewBoardDialog.tsx`, `frontend/src/screens/dialogs/DeleteBoardDialog.tsx`, `frontend/src/screens/components/BoardCard.tsx`, `frontend/src/screens/components/CreateBoardCard.tsx` |

### Dependency graph

```
phase 1 ── phase 2
    └───── phase 3 ── phase 4
```

Phase 2 is independent of 3 and 4 once Phase 1 lands. The numeric order is the recommended ship order because Phase 2 is the shortest diff (2 file touches, one of them a deletion) and unblocks `/architect-review` closure of two low-medium findings fastest.

## Execution Order

Run these in order. Do not skip ahead — each phase assumes its predecessor shipped.

1. `/ship /frontend-cleanup-phase-1-vitest-bootstrap`
2. `/ship /frontend-cleanup-phase-2-dead-code`
3. `/ship /frontend-cleanup-phase-3-localstorage-accessors`
4. `/ship /frontend-cleanup-phase-4-welcome-screen-extract`

After each `/ship` completes and you have reviewed the diff, invoke the next. After phase 4 ships, run `/architect-review --scope frontend/src --full` to confirm zero `feature-regression` findings and resolution of FS-005, FS-006, FS-007, FS-008, and partial resolution of FS-003 (3 of 23 gap closures).

## Rollback Strategy (whole feature)

If the feature is abandoned mid-stream (for example, after phase 2 but before phase 3):
1. Each phase-skill ships a self-contained rollback section. Revert the phase commits in reverse order.
2. No phase introduces a database migration, a feature flag, or a persistent on-disk schema change, so there is no data to unwind. The four localStorage keys keep their existing shapes across the entire plan.
3. Phase 1's vitest install is trivially reverted by discarding `frontend/package.json` and `frontend/vitest.config.ts` changes and running `npm install` to re-pin the lockfile.
4. Phase 2's deletions are recovered from git history (`git checkout <sha> -- frontend/src/types/board.ts frontend/src/utils/captureCanvas.ts`).
5. Phase 3 and Phase 4 are pure refactors; reverting restores the pre-phase module tree with no functional effect.

## Notes

- Phase-skills live under `.claude/skills/frontend-cleanup-phase-{1,2,3,4}-*/`.
- After all four phases ship and `/architect-review` confirms closure, consider deleting the phase-skills per project hygiene (the board-kernel skill is the reference pattern to keep; these phase-skills are single-use).
- The next cycle's `/architect-plan` candidates, in priority order:
  1. User authors `frontend/CLAUDE.md` (closes FS-001; unblocks FS-002 and FS-004).
  2. `/architect-plan` FS-002 decomposition of `boardStore.ts` (approximately 5-7 phases per the review's proposed module budget).
  3. `/architect-plan` the remaining 20 `test_coverage_gaps[]` closures (FS-003 phase 2+).
  4. `/architect-plan` FS-004 (one-PR doc + audit of the 16 `getState()` call-sites).
- Known half-built work in the area: the dual-renderer cleanup user memory (`feedback_export_architecture.md`) is completed by this plan's Phase 2. After Phase 2 ships, the user memory can be retired or amended.
