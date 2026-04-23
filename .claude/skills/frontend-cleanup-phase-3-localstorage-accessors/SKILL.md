---
name: frontend-cleanup-phase-3-localstorage-accessors
description: "Phase 3 of frontend-architecture-cleanup: create frontend/src/utils/localStorage.ts with typed accessors for the four scattered keys (sdraw_recent_boards, sdraw_theme, sdraw_python_env, sdraw_recent_colors) and migrate every call-site to use the new API. Depends on: frontend-cleanup-phase-1-vitest-bootstrap. Ships: one new module, four migrated files, unit tests covering parse-failure fallback."
argument-hint: /ship /frontend-cleanup-phase-3-localstorage-accessors
user-invocable: true
---

# Phase 3: Centralized typed localStorage accessors

**Goal:** Collapse four inline `localStorage.getItem/setItem` call-sites into a single typed module at `frontend/src/utils/localStorage.ts`, closing FS-008. Each key becomes a named getter/setter that (a) declares the key as a module-private constant, (b) runtime-validates parsed shape before returning it, (c) falls back to a safe default on parse failure or shape mismatch. This eliminates the typo-silence footgun called out in the review (parse succeeds but returns a non-array for `sdraw_recent_boards` -> undetected crash at later shape-use).

**Depends on:** frontend-cleanup-phase-1-vitest-bootstrap

## Scope

### Touches (may modify)
- `frontend/src/utils/localStorage.ts` (new file) - export typed accessors:
  - `RECENT_BOARDS`: `getRecentBoards(): RecentBoard[]`, `setRecentBoards(v: RecentBoard[]): void`, plus `addRecentBoard(name, path)` / `removeRecentBoard(path)` convenience wrappers that preserve existing App.tsx semantics (MRU + dedupe + 10-entry cap).
  - `THEME`: `getTheme(): ThemeMode`, `setTheme(v: ThemeMode): void`. `ThemeMode = 'light' | 'dark' | 'system'` imported from `@/store/uiStore` or re-declared here.
  - `PYTHON_ENV`: `getPythonEnv(): string | null`, `setPythonEnv(v: string | null): void`. Null clears the key.
  - `RECENT_COLORS`: `getRecentColors(): string[]`, `setRecentColors(v: string[]): void`, plus `addRecentColor(hex)` preserving the existing cap semantics (MAX_RECENT_COLORS from Inspector.tsx).
  - Every key as a module-private constant (`const RECENT_BOARDS_KEY = 'sdraw_recent_boards'` etc.) - not exported.
  - Every getter wraps access in `try/catch` and returns the safe default on any failure (parse throw, SSR no-window, or shape mismatch via `Array.isArray` / `typeof` guard).
- `frontend/src/utils/localStorage.test.ts` (new file) - unit tests for every accessor: round-trip, parse-error fallback, shape-mismatch fallback, null-clears-key for `setPythonEnv(null)`, MRU semantics of `addRecentBoard` (dedupe, ordering, cap).
- `frontend/src/App.tsx` - replace lines 38-58 (the `RECENT_KEY` constant + `getRecentBoards` / `addRecentBoard` / `removeRecentBoard` helpers) with `import { getRecentBoards, addRecentBoard, removeRecentBoard } from '@/utils/localStorage'`. Delete the now-redundant local helpers. Replace the three call-sites (`:541` `useState<RecentBoard[]>(getRecentBoards)`, plus any other usage of the local helpers - verify by grep). `RecentBoard` type either moves to `localStorage.ts` or stays in `App.tsx` and is imported by `localStorage.ts`; prefer moving it so `localStorage.ts` is self-contained.
- `frontend/src/store/uiStore.ts` - replace inline `localStorage.getItem('sdraw_theme')` / `setItem('sdraw_theme', theme)` (at lines 119, 135, 142) and inline `localStorage.getItem('sdraw_python_env')` / `setItem` / `removeItem` (at lines 176, 179, 180) with calls to `getTheme`, `setTheme`, `getPythonEnv`, `setPythonEnv` from the new util. Keep the `applyThemeToDOM` side-effect logic inside `uiStore.ts` - the util does storage only, not DOM.
- `frontend/src/components/Inspector/Inspector.tsx` - replace inline `RECENT_COLORS_KEY` constant (at line 342) plus its `getItem` (line 347) and `setItem` (line 357) with `getRecentColors` / `setRecentColors` (or `addRecentColor`) imports from the new util.

### Reads only (for context)
- `frontend/src/store/uiStore.ts:117-145, :170-185` - understand the `applyThemeToDOM` side effect and the OS-theme-change listener, so the util does not accidentally re-implement them.
- `frontend/src/components/Inspector/Inspector.tsx:340-365` - the exact semantics of `MAX_RECENT_COLORS` cap and how recent colors get prepended.
- `frontend/src/App.tsx:38-60` - the exact MRU + cap semantics for recent boards.

### Out of scope
- Adding new persisted state (e.g., UI widths, insert-panel tab). Only the four existing keys are migrated.
- A migration / versioning scheme for future schema changes. One-line note in the module header ("if a key's shape changes, bump the module-private key string and write a one-shot migrator") is sufficient; full schema-versioning is future work.
- Moving the `applyThemeToDOM` side effect into the util. DOM side effects stay in `uiStore.ts`.
- Adding IndexedDB / session-scoped fallback. `localStorage` remains the only backing store.
- Encrypting or obfuscating values (pythonEnv path is not sensitive).

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
- New module `@/utils/localStorage` with the exports enumerated above. Public to the whole frontend; treat as shared util.
- The four `localStorage` keys (`sdraw_recent_boards`, `sdraw_theme`, `sdraw_python_env`, `sdraw_recent_colors`) remain unchanged on disk - users who already have values persisted see them load transparently after this phase ships.
- `RecentBoard` type (previously declared in `App.tsx:32-36`) moves to `frontend/src/utils/localStorage.ts` and is re-exported. App.tsx imports it back.
- `ThemeMode` stays in `uiStore.ts`; `localStorage.ts` imports it from there to avoid circular ownership. If that creates an import cycle during build, lift `ThemeMode` into `types/board.ts` (or a new `types/ui.ts`) and both files import from there. Decide at implementation time based on compiler output.

## Implementation Steps

1. Create `frontend/src/utils/localStorage.ts` with:
   - Module-private key constants for all four keys.
   - `isBrowser()` guard (`typeof window !== 'undefined' && !!window.localStorage`) used by every getter/setter to avoid SSR/test-env crashes even though sdraw is client-only today.
   - `RecentBoard` interface (moved from App.tsx).
   - Shape guards: `isRecentBoard`, `isThemeMode`, `isStringArray` helpers that runtime-validate parsed JSON before returning it.
   - Getters: wrap `JSON.parse` in try/catch; on any throw OR on a shape-guard miss, return the declared default and leave the stored value alone (do not rewrite to defaults - that would mask bugs a user might want to debug by inspecting storage).
   - Setters: wrap `JSON.stringify` + `setItem` in try/catch; on quota-exceeded, log a `console.warn` and swallow (same behavior as existing inline code's `try {} catch {}`).
2. Create `frontend/src/utils/localStorage.test.ts` with test groups per accessor. Use `beforeEach(() => localStorage.clear())` in the jsdom env. Fifteen to twenty assertions covering round-trip, malformed-JSON fallback, shape-mismatch fallback, null-clears-key, and MRU semantics.
3. Migrate `frontend/src/App.tsx`:
   - Delete `RECENT_KEY`, `MAX_RECENT`, `RecentBoard` interface, `getRecentBoards`, `addRecentBoard`, `removeRecentBoard` (lines 32-60).
   - Add `import { getRecentBoards, addRecentBoard, removeRecentBoard, type RecentBoard } from '@/utils/localStorage'` near the existing imports block.
   - Verify via `grep -n "RECENT_KEY\|MAX_RECENT\b" frontend/src/App.tsx` that no stray references remain.
4. Migrate `frontend/src/store/uiStore.ts`:
   - Replace direct `localStorage.getItem('sdraw_theme')` at `:119` with `getTheme()`.
   - Replace direct `localStorage.setItem('sdraw_theme', theme)` at `:142` with `setTheme(theme)`.
   - Replace the OS-theme-change listener at `:135` (which reads the key directly) with a call to `getTheme()`.
   - Replace the `sdraw_python_env` triplet at `:176-180` with `getPythonEnv()` and `setPythonEnv(path)`.
   - Leave `applyThemeToDOM` and the matchMedia listener in place (side-effect logic).
5. Migrate `frontend/src/components/Inspector/Inspector.tsx`:
   - Delete `RECENT_COLORS_KEY` constant at `:342`.
   - Replace `getItem(RECENT_COLORS_KEY)` at `:347` with `getRecentColors()`.
   - Replace `setItem(RECENT_COLORS_KEY, JSON.stringify(colors.slice(0, MAX_RECENT_COLORS)))` at `:357` with `setRecentColors(colors.slice(0, MAX_RECENT_COLORS))` (or `addRecentColor(hex)` if semantics align; choose the simpler direct setter).
6. Run `cd frontend && npm run test`. The new localStorage.test.ts must pass; the Phase 1 boardStore.test.ts must continue passing unmodified.
7. Run `cd frontend && npm run build` to confirm TypeScript resolves all new imports.
8. Manual browser smoke check:
   - Theme toggle persists across page reload.
   - A recently-opened board appears in the Welcome screen list after reload.
   - Inspector's recent-color swatches persist.
   - Python env picker remembers the last-chosen env after reload.

## Feature Preservation (zero tolerance)

Two inventory features have `evidence_anchors` overlapping this phase's Touches:

- `feat-fe-inspector-per-type` - Per-element-type Inspector editors
  - Keep resolvable: `frontend/src/components/Inspector/Inspector.tsx:551,617-941` (component)
  - Migration in this phase if anchor changes: NONE. The recent-colors edit lives at line `:342`, outside the anchor's `:551` onward range. Line numbers of `:551` and `:617-941` may shift by a handful of lines (one deleted constant, one deleted inline helper block) but the anchor's **target content** (the `ElementInspector` function and its per-type branches) does not move logically. The reviewer must be able to re-pin the anchor to the new line numbers by searching for the same function name; this is the normal drift a `/architect-review` handles. Acceptable per the zero-tolerance rule because the feature's implementation is intact.

- `feat-fe-python-env-picker` - Per-board and global Python env picker
  - Keep resolvable: `frontend/src/store/boardStore.ts:421` (store-action) - NOT touched by this phase
  - Keep resolvable: `frontend/src/components/PythonEnvPicker/PythonEnvPicker.tsx:1-343` (component) - NOT touched by this phase
  - Migration in this phase if anchor changes: NONE. This phase touches `uiStore.ts` (how the env path is persisted) but NOT the store action or the picker component. The anchor points to the action + component, both unchanged. The persistence semantics (key name, value format) are preserved bit-for-bit; existing users' stored value loads identically.

No anchor requires a rename or move. The PR body MUST cite these two feature ids and confirm anchors still resolve.

## Test Impact (scope-aware attribution map)

### Must stay green - a failure here is UNINTENDED
- `frontend/src/store/boardStore.test.ts` (all four groups from Phase 1) - this phase does not touch `boardStore.ts`.

### Expected to change - a failure here is INTENDED
(none - no pre-existing test covers any of the four keys, so nothing needs updating.)

### New tests added by this phase
- `frontend/src/utils/localStorage.test.ts::getRecentBoards` - round-trip, parse-fail fallback, shape-mismatch fallback (`localStorage.setItem('sdraw_recent_boards', '{"not":"array"}')` -> returns `[]`, does not crash). Partially closes test_coverage_gap for `feat-fe-inspector-per-type`'s persistence sibling; primary value is regression protection against the FS-008 crash scenario.
- `frontend/src/utils/localStorage.test.ts::addRecentBoard` - dedupe on path, MRU ordering, 10-entry cap.
- `frontend/src/utils/localStorage.test.ts::removeRecentBoard` - removal by path.
- `frontend/src/utils/localStorage.test.ts::getTheme / setTheme` - round-trip for each of 'light' | 'dark' | 'system'; invalid stored value falls back to 'light'.
- `frontend/src/utils/localStorage.test.ts::getPythonEnv / setPythonEnv` - round-trip for path string; `setPythonEnv(null)` clears the key; reading an unset key returns null.
- `frontend/src/utils/localStorage.test.ts::getRecentColors / setRecentColors` - round-trip; shape-mismatch fallback returns `[]`.

### Out-of-scope tests - a failure here is UNINTENDED (scope violation)
Any test outside `boardStore.test.ts` and `localStorage.test.ts` that fails during this phase is proof the phase touched code it was not supposed to. STOP and report as `OUT_OF_SCOPE_TEST_FAILURE`.

## Acceptance Criteria

- [ ] `frontend/src/utils/localStorage.ts` exists and exports the full accessor API enumerated in Touches.
- [ ] `frontend/src/utils/localStorage.test.ts` passes under `npm run test`.
- [ ] `grep -rn "localStorage\." frontend/src --include='*.ts' --include='*.tsx'` returns matches ONLY from `frontend/src/utils/localStorage.ts` and `frontend/src/utils/localStorage.test.ts`. No other file accesses `localStorage` directly.
- [ ] `grep -rn "sdraw_recent_boards\|sdraw_theme\|sdraw_python_env\|sdraw_recent_colors" frontend/src --include='*.ts' --include='*.tsx'` returns matches ONLY from `frontend/src/utils/localStorage.ts` and `frontend/src/utils/localStorage.test.ts`.
- [ ] `cd frontend && npm run build` succeeds; no TS errors.
- [ ] `cd frontend && npm run test` - Phase 1 + new localStorage tests all pass.
- [ ] Manual smoke: theme toggle, recent-board entry, recent-color swatch, python-env path all persist across a page reload.
- [ ] Every feature listed under Feature Preservation above is verifiable post-change via its anchors (open the file at the cited line and confirm the named function/component is still there).
- [ ] Every test in Test Impact -> "Must stay green" passes unmodified.
- [ ] Every test in Test Impact -> "Expected to change" has been updated. (Trivially satisfied: bucket is empty.)
- [ ] No test outside the Test Impact map fails.
- [ ] `/architect-review --scope frontend/src --full` after this phase produces zero `feature-regression` findings AND resolves FS-008.
- [ ] Build + lint pass.

## Test Plan

- **Unit:** `frontend/src/utils/localStorage.test.ts` (15-20 assertions as enumerated).
- **Integration:** N/A.
- **Manual / browser:** four persistence smokes enumerated in Implementation Step 8.
- **Eval:** N/A.

## Rollback

1. Revert the commit that introduced this phase.
2. Restore `frontend/src/App.tsx`, `frontend/src/store/uiStore.ts`, `frontend/src/components/Inspector/Inspector.tsx` to their pre-phase content via `git checkout <prev-commit> -- <path>`.
3. Delete `frontend/src/utils/localStorage.ts` and `frontend/src/utils/localStorage.test.ts`.
4. No data migration: the on-disk `localStorage` keys and values are unchanged by this phase; users who wrote values during this phase retain them and the reverted inline code reads them identically.
5. Run `cd frontend && npm run build && npm run test`.

## Handoff to Next Phase

**Invariants this phase guarantees** (Phase 4 may rely on these):
- `getRecentBoards`, `addRecentBoard`, `removeRecentBoard`, `type RecentBoard` are importable from `@/utils/localStorage`. Phase 4 will extract `WelcomeScreen` out of `App.tsx`; the extracted module imports from `localStorage.ts` rather than redefining the persistence helpers.
- No file other than `@/utils/localStorage` accesses `localStorage` directly. A `/architect-review` pass after this phase can enforce this as a rule via grep.
- The on-disk shape of every key is unchanged; no migration needed for existing users.

**Invariants this phase does NOT guarantee** (later phases or cycles must handle):
- Schema-versioned migration for future shape changes (a one-shot migrator is possible but not wired).
- Full typed coverage of other side-effecting globals (e.g., `document.cookie`, `sessionStorage` - not in use today but not audited).
- Any UI/UX change; this phase is pure refactor.
