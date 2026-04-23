---
name: frontend-cleanup-phase-4-welcome-screen-extract
description: "Phase 4 of frontend-architecture-cleanup: extract WelcomeScreen, FileBrowserDialog, NewBoardDialog, DeleteBoardDialog, BoardCard, and CreateBoardCard out of App.tsx into a new frontend/src/screens/ directory. Depends on: frontend-cleanup-phase-3-localstorage-accessors. Ships: App.tsx shrinks by ~800 LOC; screens/ gets a clean home-screen module tree."
argument-hint: /ship /frontend-cleanup-phase-4-welcome-screen-extract
user-invocable: true
---

# Phase 4: Extract the home screen from App.tsx

**Goal:** Close FS-007 by moving the WelcomeScreen and its six supporting components out of the 1,412-LOC `App.tsx` monolith into a new `frontend/src/screens/` directory. This is pure refactor - zero behavior change, zero new UI. After this phase, `App.tsx` owns only the app shell + the `Editor` component + `AppContent`; the home-screen tree is a separately-bundleable module.

**Depends on:** frontend-cleanup-phase-3-localstorage-accessors (WelcomeScreen uses `getRecentBoards` / `addRecentBoard` / `removeRecentBoard` from the typed localStorage util introduced there; sequencing Phase 4 after Phase 3 avoids having to edit the extracted module twice).

## Scope

### Touches (may modify)

New files:
- `frontend/src/screens/WelcomeScreen.tsx` (new) - the main welcome screen component currently at `App.tsx:537-827`. Imports its subcomponents from the sibling files below.
- `frontend/src/screens/dialogs/FileBrowserDialog.tsx` (new) - currently at `App.tsx:64-296` (approx). Extracted verbatim.
- `frontend/src/screens/dialogs/NewBoardDialog.tsx` (new) - currently at `App.tsx:298-419` (approx). Extracted verbatim.
- `frontend/src/screens/dialogs/DeleteBoardDialog.tsx` (new) - currently at `App.tsx:505-535` (approx). Extracted verbatim.
- `frontend/src/screens/components/BoardCard.tsx` (new) - currently at `App.tsx:421-482` (approx). Extracted verbatim.
- `frontend/src/screens/components/CreateBoardCard.tsx` (new) - currently at `App.tsx:484-503` (approx). Extracted verbatim.

Modified files:
- `frontend/src/App.tsx` - delete the six inlined components and add a single `import { WelcomeScreen } from '@/screens/WelcomeScreen'`. The second `FileBrowserDialog` call-site inside `AppContent` (visible at `App.tsx:1050` per grep - used by the open-board flow from within an already-open editor) continues to work because `FileBrowserDialog` is re-exported from its new location. The render at `App.tsx:1397` (`board ? <Editor /> : <WelcomeScreen />`) now uses the imported symbol. Expected net: App.tsx shrinks from 1,412 to approximately 600 LOC.

### Reads only (for context)
- `frontend/src/utils/localStorage.ts` (from Phase 3) - confirm the public API of `getRecentBoards / addRecentBoard / removeRecentBoard` so the extracted WelcomeScreen imports the right names.
- `frontend/src/api/client.ts` - confirm `api.listWorkspaceBoards`, `api.getRecentBoards` (if it exists), and related calls the dialogs make.
- `frontend/src/store/boardStore.ts` - confirm `newBoard`, `openBoard` action signatures used by WelcomeScreen.
- `frontend/src/store/uiStore.ts` - confirm theme accessors used by WelcomeScreen's dark/light toggle.
- `frontend/src/main.tsx` - no change; confirm it renders `<AppContent />` and not `<WelcomeScreen />` directly.
- `frontend/src/components/shared/` - confirm any shared UI primitives the extracted dialogs use.

### Out of scope
- Extracting `ExportDialog` (at `App.tsx:828-1262`, approximately 434 LOC) into `screens/` or anywhere else. Export is a separate concern and a separate finding; that extraction, if it happens, belongs in a future phase.
- Extracting `Editor` or `AppContent` out of `App.tsx`. They stay where they are.
- Extracting the file-open flow's `<FileBrowserDialog>` use-site at `App.tsx:1050` into a separate screen. It stays in App.tsx (just the import changes).
- Adding lazy/dynamic imports (`React.lazy` / `Suspense`) for the home screen. The module tree is reorganized but the bundle split is not changed in this phase; that is an optimization the next reviewer can decide based on measured bundle size.
- Adding tests for the extracted components. Component smoke tests are future FS-003 phase work.
- Renaming any component or changing any prop signature. Verbatim extraction only.

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
- Six new modules under `frontend/src/screens/` each export one named React component. No default exports (consistent with the existing codebase convention).
- `App.tsx` imports `WelcomeScreen` and (separately) `FileBrowserDialog` from their new locations. All six components retain identical props to their pre-phase inlined versions.
- The `RecentBoard` type (moved to `@/utils/localStorage` in Phase 3) is imported by `WelcomeScreen.tsx` from there, not re-declared.
- No other module imports any of the six extracted components today (confirmed by the review: these are only rendered from within App.tsx). Post-phase, only `App.tsx` and sibling screen files import them.

## Implementation Steps

1. Re-read `App.tsx` sections containing each of the six components to capture their **exact** current boundaries. Because line numbers may have shifted by Phase 3's `RECENT_KEY` deletion (removing ~23 lines from the top of App.tsx), re-locate each component by name (`function FileBrowserDialog`, `function NewBoardDialog`, etc.) not by absolute line number.
2. For each component in order (FileBrowserDialog, NewBoardDialog, BoardCard, CreateBoardCard, DeleteBoardDialog, WelcomeScreen):
   a. Create the target file under `frontend/src/screens/dialogs/` or `frontend/src/screens/components/` or `frontend/src/screens/` as listed above.
   b. Copy the component's function body verbatim, including type annotations and JSX.
   c. Add the minimum `import` lines the extracted module needs: React hooks, lucide icons, `useBoardStore` / `useUIStore` if referenced, `api` if referenced, `@/utils/localStorage` helpers for WelcomeScreen, types from `@/types/board` or `@/api/client`, and sibling-screen imports (e.g., WelcomeScreen imports the five subcomponents from its siblings).
   d. Export the component as a named export.
   e. Delete the inline definition from `App.tsx`.
3. In `App.tsx`, add `import { WelcomeScreen } from '@/screens/WelcomeScreen'` and `import { FileBrowserDialog } from '@/screens/dialogs/FileBrowserDialog'` (the second is needed only because of the use-site at approximately `:1050` within AppContent).
4. Run `cd frontend && npm run build`. Fix any missing-import errors. The build is the canonical verification that every symbol references resolves.
5. Run `cd frontend && npm run test`. Phase 1 + Phase 3 tests must continue passing unmodified. No new tests are added in this phase; the refactor is behavior-preserving.
6. Manual browser smoke checklist:
   - App opens to the WelcomeScreen by default (no board open in URL).
   - WelcomeScreen shows recent boards (from `getRecentBoards`).
   - Clicking "Create new" opens `NewBoardDialog`.
   - Clicking "Browse" opens `FileBrowserDialog`.
   - Clicking a board card opens the board (into `Editor`).
   - Clicking the delete icon on a board card opens `DeleteBoardDialog`; confirming removes the entry from recents.
   - Theme toggle still works on WelcomeScreen.
   - Opening a board from inside the Editor (via the menu's "open board" action) still uses `FileBrowserDialog` and works.
7. Confirm `App.tsx` no longer contains any of the six `function <ExtractedName>` declarations. Run `grep -n "^function \(FileBrowserDialog\|NewBoardDialog\|BoardCard\|CreateBoardCard\|DeleteBoardDialog\|WelcomeScreen\)" frontend/src/App.tsx` - expected output: empty.

## Feature Preservation (zero tolerance)

No feature in the `state.json` inventory has an `evidence_anchor` that points into the WelcomeScreen, its dialogs, or the home-screen flow. The welcome screen is mentioned descriptively in the review prose at FS-007 but is not enumerated as a row in `feature_inventory[]`. This phase therefore has no direct feature-preservation obligations against the inventory.

However, the following inventory feature has an anchor inside `App.tsx` (via its dependencies, not inlined into the extracted code): none. Re-scanning the inventory confirms no anchor lists `App.tsx` at all.

No feature preservation obligations against the inbound inventory - this phase touches only App.tsx home-screen regions that are not enumerated as inventory features.

Sanity assertions (not inventory-driven obligations, but enumerated for the record so any post-phase review can reconcile):
- `feat-fe-python-env-picker` - the PythonEnvPicker component lives at `frontend/src/components/PythonEnvPicker/PythonEnvPicker.tsx:1-343`. This phase does not touch it. The picker is rendered from inside WelcomeScreen or from the StatusBar depending on mode; after extraction, WelcomeScreen continues to render it unchanged.
- `feat-fe-websocket-file-watch`, `feat-fe-vscode-bridge`, and all other hook-based features are wired in `AppContent`, not WelcomeScreen; they are untouched.

If any inventory feature turns out to have an App.tsx anchor we missed when inventory was gathered, the rule is: STOP before deleting, restore the anchor's lines verbatim into the extracted module, update the feature inventory in the next `/architect-review --full` so the new path is recorded, and cite the change in the PR description.

## Test Impact (scope-aware attribution map)

### Must stay green - a failure here is UNINTENDED
- `frontend/src/store/boardStore.test.ts` (all Phase 1 tests) - this phase does not touch boardStore.
- `frontend/src/utils/localStorage.test.ts` (all Phase 3 tests) - this phase does not touch the util.

### Expected to change - a failure here is INTENDED
(none - no test covers any of the six extracted components.)

### New tests added by this phase
(none - this is a verbatim extraction. Adding component smoke tests here would scope-creep into FS-003's future phases.)

### Out-of-scope tests - a failure here is UNINTENDED (scope violation)
Any test outside `boardStore.test.ts` and `localStorage.test.ts` that fails during this phase is proof the phase touched code it was not supposed to. STOP and report as `OUT_OF_SCOPE_TEST_FAILURE`.

## Acceptance Criteria

- [ ] `frontend/src/screens/WelcomeScreen.tsx` exists and exports `WelcomeScreen`.
- [ ] `frontend/src/screens/dialogs/FileBrowserDialog.tsx`, `NewBoardDialog.tsx`, `DeleteBoardDialog.tsx` each exist and export their named component.
- [ ] `frontend/src/screens/components/BoardCard.tsx`, `CreateBoardCard.tsx` each exist and export their named component.
- [ ] `frontend/src/App.tsx` does not contain `function FileBrowserDialog`, `function NewBoardDialog`, `function BoardCard`, `function CreateBoardCard`, `function DeleteBoardDialog`, or `function WelcomeScreen` declarations. App.tsx LOC drops to approximately 600 (from 1,412).
- [ ] `cd frontend && npm run build` succeeds.
- [ ] `cd frontend && npm run test` - Phase 1 + Phase 3 tests pass unmodified.
- [ ] Manual browser smoke passes every step in Implementation Step 6.
- [ ] Every feature listed under Feature Preservation above is verifiable post-change via its updated anchors (trivially satisfied - no inventory feature overlaps; the sanity-asserted features are untouched).
- [ ] Every test in Test Impact -> "Must stay green" passes unmodified.
- [ ] Every test in Test Impact -> "Expected to change" has been updated. (Trivially satisfied: bucket is empty.)
- [ ] No test outside the Test Impact map fails.
- [ ] `/architect-review --scope frontend/src --full` after this phase produces zero `feature-regression` findings AND resolves FS-007.
- [ ] Build + lint pass.

## Test Plan

- **Unit:** none new. Phase 1 + Phase 3 tests remain green.
- **Integration:** N/A.
- **Manual / browser:** seven-step checklist in Implementation Step 6.
- **Eval:** N/A.

## Rollback

1. Revert the commit that introduced this phase.
2. `git checkout <prev-commit> -- frontend/src/App.tsx` to restore the inlined components.
3. `git rm -rf frontend/src/screens/` to delete the extracted tree.
4. Run `cd frontend && npm run build && npm run test`.
5. No data migration; no feature flag.

## Handoff to Next Phase

**Invariants this phase guarantees** (any follow-on cycles may rely on these):
- Home-screen concerns (WelcomeScreen + its dialogs/cards) live exclusively under `frontend/src/screens/`. A future bundle-split optimization can wrap `WelcomeScreen` with `React.lazy` at the single App.tsx use-site.
- `App.tsx` is the app shell + routing + `Editor` + `AppContent` only. The module is materially smaller and a next structural review can audit what remains with less noise.

**Invariants this phase does NOT guarantee** (later phases or cycles must handle):
- ExportDialog remains in App.tsx; a separate finding would be needed to extract it.
- The Editor component remains in App.tsx; moving it is not part of this plan.
- Bundle-split optimization via `React.lazy` - deliberately deferred. Measuring bundle size before/after this phase is optional.
- FS-002's `boardStore.ts` split and `Inspector.tsx` split - both blocked on the frontend-level CLAUDE.md/ADR (FS-001), which this plan also does not produce. That work belongs to a future cycle after the user authors the ADR.
