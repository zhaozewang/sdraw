---
name: frontend-cleanup-phase-1-vitest-bootstrap
description: "Phase 1 of frontend-architecture-cleanup: install vitest + jsdom + @testing-library/react, wire an `npm test` script, and add seed unit tests for the four load-bearing pure functions in boardStore.ts (plotRenderHash, codeDigest, computeSaveHashes, migrateToPlotCodeRegistry). Depends on: none. Ships: test framework + seed tests; no product behavior change."
argument-hint: /ship /frontend-cleanup-phase-1-vitest-bootstrap
user-invocable: true
---

# Phase 1: Vitest bootstrap + seed tests for load-bearing pure functions

**Goal:** Install a frontend test framework and land the minimum-viable seed suite covering the four pure functions whose bugs would cascade across autosave, Run All, and the v1/v2 to v3 registry migration. This is Phase 1 of the FS-003 phased-refactor identified by `/architect-review --scope frontend/src` on commit af652c0.

**Depends on:** none

## Scope

### Touches (may modify)
- `frontend/package.json` - add devDependencies (`vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`), add `"test"` and `"test:watch"` scripts.
- `frontend/vitest.config.ts` (new file) - vitest config: `environment: 'jsdom'`, path alias `@` -> `src`, setupFiles -> `src/test/setup.ts`, include `src/**/*.{test,spec}.{ts,tsx}`.
- `frontend/src/test/setup.ts` (new file) - imports `@testing-library/jest-dom/vitest` and cleans up DOM between tests via `afterEach(cleanup)`.
- `frontend/src/store/boardStore.ts` - add `export` keyword to currently module-local `codeDigest`, `computeSaveHashes`, `migrateToPlotCodeRegistry`. `plotRenderHash` is already exported. NO other edits. NO behavior change. Function bodies, line ranges of body content, and the public state/action surface are untouched.
- `frontend/src/store/boardStore.test.ts` (new file) - unit tests for the four pure functions.

### Reads only (for context)
- `frontend/src/types/board.ts` - Board / BoardElement / PlotCodeEntry shape so tests can construct valid fixtures.
- `frontend/src/utils/helpers.ts` - if any hash helper (`fnv1a`) is shared from here.
- `frontend/vite.config.ts` (if present at `frontend/vite.config.ts`) - so vitest config uses the same alias resolver.
- `frontend/src/main.tsx` - ensure test setup does not collide with app bootstrap.

### Out of scope
- Component tests for React components (owned by a future FS-003 phase planned separately after this phase lands).
- Integration tests for `runAllPlots`, `distributePlotFigures`, or any action that touches React state (future FS-003 phase).
- Tests for `useAutoSave`, `useKeyboardShortcuts`, `useWebSocket`, `useVSCodeBridge` hooks (future FS-003 phase).
- Exporting any additional module-local helpers from `boardStore.ts` beyond the four named above.
- Refactoring / splitting `boardStore.ts` (owned by the later FS-002 plan, which is blocked on an ADR per review handoff hint).
- CI wiring (`.github/workflows/*`): test script exists; wiring to CI is a separate cleanup.

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
- `frontend/src/store/boardStore.ts` gains three new named exports: `codeDigest`, `computeSaveHashes`, `migrateToPlotCodeRegistry`. These are additive; no existing export is renamed, moved, or removed.
- `frontend/package.json` gains a `"test"` script. `npm run build` and `npm run dev` continue to behave identically.

## Implementation Steps

1. Add devDependencies to `frontend/package.json`: `vitest` (^2 or latest compatible with vite 6), `@vitest/ui`, `jsdom`, `@testing-library/react` (^16), `@testing-library/jest-dom` (^6), `@testing-library/user-event` (^14). Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
2. Run `npm install` in `frontend/` to materialize `node_modules` entries.
3. Create `frontend/vitest.config.ts` that re-uses `@vitejs/plugin-react`, sets `test.environment = 'jsdom'`, `test.globals = true`, `test.setupFiles = ['./src/test/setup.ts']`, and mirrors the `@` -> `./src` alias from the existing vite config (read it first to copy the exact resolver).
4. Create `frontend/src/test/setup.ts` with `import '@testing-library/jest-dom/vitest'` and an `afterEach(() => cleanup())` from `@testing-library/react`.
5. In `frontend/src/store/boardStore.ts`, add `export` to the declarations of `codeDigest` (currently function at `:72`), `computeSaveHashes` (`:85`), and `migrateToPlotCodeRegistry` (`:110`). Verify `plotRenderHash` (`:61`) already has `export`; leave untouched. Do not reorder, do not change bodies, do not rename.
6. Create `frontend/src/store/boardStore.test.ts` with four test groups:
   - `plotRenderHash`: (a) same inputs produce same hash (determinism), (b) swapping setup vs plot code changes the hash (order-sensitive), (c) empty strings do not throw.
   - `codeDigest`: (a) identical plotCodes in different insertion orders produce the same digest (sort-by-content invariant is the whole point), (b) changing `setup.code` changes the digest, (c) changing a plot's code changes the digest, (d) renaming a plotCodeId key without changing code does NOT change the digest (migration stability).
   - `computeSaveHashes`: (a) returned `elementHashes` has one entry per element id, (b) `boardFieldsHash` changes when `board.setup.code` changes, (c) `boardFieldsHash` is stable across calls when the board is unchanged, (d) `elementIds` set matches board element ids exactly.
   - `migrateToPlotCodeRegistry`: (a) v1 plot with `metadata.code` gets a `plotCodeId` and `plotCodes[id].code` matches, `metadata.code` is deleted; (b) v2 sibling with `metadata.sourceElementId` inherits the source's `plotCodeId` and `sourceElementId` is deleted; (c) orphan plot (no code, no source) gets a fresh empty `plotCodes` entry; (d) running the migrator twice on the same board is a no-op (idempotent); (e) `board.schema_version` is set to the current constant.
7. Run `cd frontend && npm run test` and confirm all tests pass. The test file must pass on first ship; a test that is authored to fail is a ship-blocker.
8. Run `cd frontend && npm run build` to confirm TypeScript compilation still succeeds (exports must not shadow existing symbols or conflict with `export function` declarations).

## Feature Preservation (zero tolerance)

Every feature whose `evidence_anchors` include `frontend/src/store/boardStore.ts` lives under this phase's Touches. Only `boardStore.ts` among them is modified, and the modification is purely additive (adding `export` keywords). No anchor moves; every feature below keeps its original `file:lines` pair resolvable after this phase ships.

- `feat-fe-element-crud` - Add/update/remove/duplicate element actions
  - Keep resolvable: `frontend/src/store/boardStore.ts:427-432` (store-action)
  - No anchor migration.
- `feat-fe-history-undo` - Undo/redo history stack
  - Keep resolvable: `frontend/src/store/boardStore.ts:403-404,457-459` (store-action)
  - No anchor migration.
- `feat-fe-delta-save` - Per-element delta save hashing
  - Keep resolvable: `frontend/src/store/boardStore.ts:85-98,338-343` (store-internal)
  - No anchor migration. Note: `computeSaveHashes` at line 85 gains the `export` keyword; the function body and the `:338-343` call-site are unchanged.
- `feat-fe-external-conflict` - External change modal + mtime conflict resolver
  - Keep resolvable: `frontend/src/store/boardStore.ts:309-315,347-348` (store)
  - Keep resolvable: `frontend/src/components/ExternalChangeModal.tsx:1-108` (not touched by this phase)
  - No anchor migration.
- `feat-fe-plotcode-registry-migration` - v1/v2 -> v3 client-side board schema migration
  - Keep resolvable: `frontend/src/store/boardStore.ts:110-166` (store-internal)
  - No anchor migration. `migrateToPlotCodeRegistry` at `:110` gains the `export` keyword; body unchanged.
- `feat-fe-plot-render-hash` - Per-plot render hash for stale-crop detection
  - Keep resolvable: `frontend/src/store/boardStore.ts:61-63` (store-export)
  - No anchor migration. Already exported.
- `feat-fe-multi-figure-distribute` - Distribute multi-figure plot output across sibling elements
  - Keep resolvable: `frontend/src/store/boardStore.ts:374-383` (store-action)
  - No anchor migration.
- `feat-fe-run-all` - Run all plots in z-order with progress
  - Keep resolvable: `frontend/src/store/boardStore.ts:388-399` (store-action)
  - No anchor migration.
- `feat-fe-run-one` - Single-cell plot run from PlotEditor
  - Keep resolvable: `frontend/src/store/boardStore.ts:400-401` (store-action)
  - No anchor migration.
- `feat-fe-kernel-actions` - runSetup/restartKernel/reloadKernelModules client wrappers
  - Keep resolvable: `frontend/src/store/boardStore.ts:351-361` (store-action)
  - Keep resolvable: `frontend/src/api/client.ts:299-337` (not touched by this phase)
  - No anchor migration.
- `feat-fe-auto-export` - Event-driven auto-export on save transition
  - Keep resolvable: `frontend/src/store/boardStore.ts:420` (store-action)
  - Keep resolvable: `frontend/src/hooks/useAutoSave.ts:56-75` (not touched by this phase)
  - No anchor migration.
- `feat-fe-grouping-align-zorder` - Group / align / distribute / z-order / lock / hidden
  - Keep resolvable: `frontend/src/store/boardStore.ts:439-454` (store-action)
  - No anchor migration.
- `feat-fe-websocket-file-watch` - WebSocket file-watch + imageVersions bump
  - Keep resolvable: `frontend/src/store/boardStore.ts:465-466` (store-action)
  - Keep resolvable: `frontend/src/hooks/useWebSocket.ts:1-121` (not touched by this phase)
  - No anchor migration.
- `feat-fe-python-env-picker` - Per-board and global Python env picker
  - Keep resolvable: `frontend/src/store/boardStore.ts:421` (store-action)
  - Keep resolvable: `frontend/src/components/PythonEnvPicker/PythonEnvPicker.tsx:1-343` (not touched by this phase)
  - No anchor migration.

Migration in this phase if any anchor changes: N/A - no anchors change. Adding `export` keyword adjusts character offset but does not shift any subsequent line number (function declaration stays on the same line).

## Test Impact (scope-aware attribution map)

All 14 belonging features have empty `test_anchors[]` in the inventory - every one was tagged `test_coverage_gap` by the review. That means "Must stay green" and "Expected to change" buckets are empty: there is no pre-existing test to preserve or update. This phase's role is to close `test_coverage_gap` for the four pure-function features that are within scope.

### Must stay green - a failure here is UNINTENDED
(none - the repo has zero pre-existing frontend tests per FS-003)

### Expected to change - a failure here is INTENDED
(none - no anchor moves, so no test needs updating)

### New tests added by this phase
- `frontend/src/store/boardStore.test.ts::plotRenderHash` - covers `feat-fe-plot-render-hash` - closes test_coverage_gap
- `frontend/src/store/boardStore.test.ts::codeDigest` - covers the digest used by `feat-fe-delta-save` and `feat-fe-plotcode-registry-migration` - closes gap for `feat-fe-delta-save` digest-stability invariant
- `frontend/src/store/boardStore.test.ts::computeSaveHashes` - covers `feat-fe-delta-save` - closes test_coverage_gap
- `frontend/src/store/boardStore.test.ts::migrateToPlotCodeRegistry` - covers `feat-fe-plotcode-registry-migration` - closes test_coverage_gap

### Out-of-scope tests - a failure here is UNINTENDED (scope violation)
Any test outside `frontend/src/store/boardStore.test.ts` that fails during this phase is proof that the phase touched code it was not supposed to. STOP and report as `OUT_OF_SCOPE_TEST_FAILURE`. Since the repo currently has zero tests, any existing test appearing during this phase is itself a scope violation.

Coverage gap closure accounting (for the next `/architect-review` to reconcile):
- `test_coverage_gaps[]` closed by this phase: `feat-fe-plot-render-hash`, `feat-fe-delta-save`, `feat-fe-plotcode-registry-migration` (3 of 23).
- Remaining 20 gaps are explicitly out of scope; the review's handoff hint treats FS-003 as its own phased-refactor and Phase 1 (this phase) is the seed; subsequent phases of FS-003 will be planned later once the framework is in place.

## Acceptance Criteria

- [ ] `cd frontend && npm install` completes cleanly; `package-lock.json` is updated.
- [ ] `cd frontend && npm run test` runs vitest, discovers `boardStore.test.ts`, and reports all tests passing.
- [ ] `cd frontend && npm run build` completes successfully (no TS errors from the added `export` keywords).
- [ ] `cd frontend && npm run dev` still starts (no vitest-config vs vite-config conflict).
- [ ] `boardStore.ts` compiles with `codeDigest`, `computeSaveHashes`, `migrateToPlotCodeRegistry` exported; no other edits in the file.
- [ ] Every feature listed under Feature Preservation above is verifiable post-change via its updated anchors (open each file at the cited line and confirm the named function/action is still there).
- [ ] Every test in Test Impact -> "Must stay green" passes unmodified. (Trivially satisfied: bucket is empty.)
- [ ] Every test in Test Impact -> "Expected to change" has been updated. (Trivially satisfied: bucket is empty.)
- [ ] No test outside the Test Impact map fails. (Repo starts with zero tests; any pre-existing failure is out-of-scope.)
- [ ] `/architect-review --scope frontend/src --full` after this phase produces zero `feature-regression` findings AND resolves at least `feat-fe-plot-render-hash`, `feat-fe-delta-save`, `feat-fe-plotcode-registry-migration` from `test_coverage_gaps[]`.
- [ ] `npm run build` (lint-equivalent in this repo) passes.

## Test Plan

- **Unit:** four test groups in `frontend/src/store/boardStore.test.ts` as enumerated in Implementation Step 6. Aim for 12-16 assertions total.
- **Integration:** none (deferred to a future FS-003 phase).
- **Manual / browser:** none needed - no product behavior changes. Smoke check: open a board, edit a plot, save, reload, confirm the board renders identically. This is a sanity gate, not a structured manual test.
- **Eval:** N/A.

## Rollback

1. Revert the commit that introduced this phase (`git revert <sha>` on the single-phase commit, or drop the phase branch).
2. Manually verify:
   - `frontend/package.json` no longer has the `"test"` script or vitest devDependencies.
   - `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`, `frontend/src/store/boardStore.test.ts` are gone.
   - `frontend/src/store/boardStore.ts` no longer exports `codeDigest`, `computeSaveHashes`, `migrateToPlotCodeRegistry` (they return to module-local).
3. Run `cd frontend && npm install` to re-pin `package-lock.json` without vitest.
4. No data migration to revert; no feature flag to flip.

## Handoff to Next Phase

**Invariants this phase guarantees** (phases 2, 3, 4 may rely on these):
- A working vitest + jsdom + RTL environment accessible via `npm test` from `frontend/`.
- `codeDigest`, `computeSaveHashes`, `migrateToPlotCodeRegistry`, `plotRenderHash` are importable from `@/store/boardStore` in test files. Phase 3 will re-use this to write localStorage-accessor tests; Phase 4 will not need these but will rely on the vitest environment existing if it adds component smoke tests.
- No product behavior changed.

**Invariants this phase does NOT guarantee** (later phases must handle):
- Systematic test coverage for the remaining 20 `test_coverage_gaps[]` features (owned by a later FS-003 phase planned separately).
- Any test for React components, hooks, or async actions (`runAllPlots`, `distributePlotFigures`, `saveBoard`, etc.).
- CI wiring to run `npm test` on PRs (separate cleanup, not tracked in this plan).
