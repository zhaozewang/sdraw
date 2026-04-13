---
name: board-kernel
description: Per-board persistent Python kernels for sdraw. A board-level "Python Setup" block runs once and its globals are visible (read-only) to every plot on that board, so loading a dataset or model happens once instead of per-plot. Shipped and in use — this doc is a reference, not a plan.
---

# Board Kernel — Shared Python state for plots on a board

## Status

**Shipped.** 22/22 backend tests green. Frontend + VS Code extension typecheck clean. Browser QA checklist at the bottom is the only still-open item.

## Why it exists

Before this feature, every `PlotNode` ran in a fresh subprocess via `backend/routers/plot.py::execute_plot` → `backend/services/plot_runner.py`. Any dataset load, model instantiation, or even `import numpy as np` repeated on every plot run. For scientific figure composition this is the biggest efficiency and UX complaint: you cannot load data once and view it five different ways without reloading it each time.

The fix is a **persistent per-board Python process** ("kernel") that holds one chunk of board-level setup code in its globals. Plot cells run in a namespace that reads those setup globals but does not pollute them, so plots stay order-independent.

## Architecture

```
┌─ Frontend (React) ─────────────────────────────────────────────┐
│  SetupEditor modal ──┐                                         │
│  PlotEditor modal ───┤── boardStore.runSetup()/executePlot() ──┼──→  REST
│  Toolbar button ─────┘      (all include boardId + cwd)        │
└────────────────────────────────────────────────────────────────┘
                                  │
┌─ Backend ───────────────────────▼──────────────────────────────┐
│  routers/plot.py — /api/plot/execute, /api/plot/kernel/*       │
│                         │                                      │
│                         ▼                                      │
│  services/kernel_manager.py  (module-level singleton)          │
│    dict[board_id → KernelProcess]                              │
│    serializes requests per-kernel via asyncio.Lock             │
│    resolves cwd → project root (pyproject/setup.py/.git)       │
│                         │                                      │
│                         ▼                                      │
│  services/kernel_runner.py  (long-lived child process)         │
│    reads length-prefixed JSON from stdin                       │
│    holds setup globals in `_setup_ns`                          │
│    runs plots in a derived namespace (no write-back)           │
│    writes length-prefixed JSON results to stdout               │
└────────────────────────────────────────────────────────────────┘
```

### Wire protocol (kernel_runner ↔ kernel_manager)

Length-prefixed JSON over the kernel process's stdin/stdout pipes:

```
stdin  : 8-byte ASCII-decimal length (zero-padded) + UTF-8 JSON bytes + '\n'
stdout : same framing
```

**Requests** (manager → runner):

```json
{"op": "ping"}
{"op": "exec_setup", "code": "...", "dpi": 150}
{"op": "exec_plot",  "code": "...", "dpi": 150}
{"op": "reset"}
{"op": "shutdown"}
```

**Responses** (runner → manager):

```json
{"ok": true,  "stdout": "...", "error": null, "image": "<b64|null>", "plotly_json": "<json|null>"}
{"ok": false, "stdout": "...", "error": "traceback...", "image": null, "plotly_json": null}
{"ok": true,  "pong": true}
{"ok": true,  "reset": true}
```

Length-prefixed (not newline-delimited) because user `print()` output can contain newlines and escaping them is messier than prefixing.

## Locked design decisions

These were debated and resolved; don't relitigate without a concrete reason.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Custom stdin/stdout JSON protocol**, not `jupyter_client`. | jupyter_client pulls in ZeroMQ + tornado + the full Jupyter protocol for features we don't need. `kernel_runner.py` stays ~200 LOC. |
| 2 | **Plot-to-plot isolation.** Each plot runs via `exec(plot_code, {**setup_globals, "__name__": "__main__", "__builtins__": __builtins__})`. Plot assignments do NOT leak into the kernel or between plots. Only the setup block writes to the shared namespace. | Scientific figures have no meaningful "cell order". Isolation prevents hidden dependencies and makes plots reproducible in any order. |
| 3 | **One setup block per board**, not multiple ordered cells. | Simpler schema, simpler UX. Users structure their setup with functions. |
| 4 | **Auto-run setup when stale.** Hash setup code (sha1); if hash ≠ last-run hash, the kernel runs setup transparently before the next plot. | Eliminates the Jupyter "forgot to re-run the cell above" footgun. |
| 5 | **Kernel dies when the board closes.** No idle timeouts. | Simple lifecycle. Boards are long-lived; users rarely open + abandon. |
| 6 | **Schema v2 with auto-migration.** Old boards load with an empty setup block injected. | Clean schema evolution; v1 files still load. |
| 7 | **Kernel state is never persisted** — only the setup *code* is saved in `.sdraw`. Reopen → kernel starts fresh → setup re-runs on first plot exec. | Keeps `.sdraw` diff-friendly and reproducible. Consistent with the existing split-blobs design. |
| 8 | **Plot output capture logic** stays identical to `plot_runner.py` (matplotlib Agg + plotly figure walk). | Reuses proven capture code. |
| 9 | **cwd = the .sdraw file's directory** (traditional Python "script runs from its own location"). Project root is passed separately via the `SDRAW_PROJECT_ROOT` env var and prepended to `sys.path` inside the runner. Both get added to `sys.path` — cwd first (higher precedence), project_root second. | Two unrelated user expectations both have to hold: (a) `open("sibling.csv")` should find files next to the .sdraw, (b) `import my_package` should resolve against the nearest ancestor with `pyproject.toml`. A single cwd can't satisfy both; split them. |

## Out of scope (deliberately NOT supported)

- Multiple ordered setup cells / notebook-like cell list
- Variable inspector / `dir()` sidebar
- `.ipynb` import/export
- SIGINT-based soft interrupt (cancel = kill + auto-restart)
- Idle timeout / LRU kernel eviction
- Pickling kernel state to disk
- Per-plot dependency tracking
- Shared kernels across boards
- ipywidgets / rich display hooks

## Where the code lives

### Backend

| File | Responsibility |
|---|---|
| `backend/models/board.py` | `BoardSetup` model; `Board.setup` field; `schema_version: 2`. |
| `backend/services/board_cache.py` | `migrate_board_schema()` — injects empty `setup` when loading v1 dicts. Never touches disk. |
| `backend/services/workspace.py::load_board` | Runs migration before `Board(**data)`. |
| `backend/routers/boards.py::open_board_from_file` | Runs migration on the raw dict returned to the frontend. |
| `backend/services/project_root.py` | `find_project_root(path)` walks up ≤ 8 levels looking for `pyproject.toml` / `setup.py` / `setup.cfg` / `requirements.txt` / `.git`. Falls back to the starting dir. |
| `backend/services/python_env.py` | `resolve_python(path)` — shared between the plot router and the kernel manager (extracted to break a circular import). |
| `backend/services/kernel_runner.py` | The long-lived child process itself. Frame I/O, setup/plot exec, matplotlib/plotly capture, `sys.path` insertion for cwd. |
| `backend/services/kernel_manager.py` | Per-board `KernelProcess` pool. `asyncio.Lock` per kernel. Auto-restart on env change, cwd change, crash. Staleness-based auto setup. Singleton instance: `kernel_manager`. |
| `backend/routers/plot.py` | `/api/plot/execute` dispatches to the kernel when `board_id` is set; `/api/plot/kernel/{execute,setup,restart,shutdown,status}`. |
| `backend/main.py` | Lifespan shutdown calls `kernel_manager.shutdown_all()`. |
| `backend/tests/test_kernel_runner.py` | 10 subprocess-level protocol tests. |
| `backend/tests/test_kernel_manager.py` | 12 manager-level tests incl. cwd/project-root resolution. |

### Frontend

| File | Responsibility |
|---|---|
| `frontend/src/types/board.ts` | `BoardSetup` interface, `DEFAULT_BOARD_SETUP`, `CURRENT_SCHEMA_VERSION`, `Board.setup`. |
| `frontend/src/store/boardStore.ts` | `setSetupCode` / `setSetupTimeout` / `runSetup` / `restartKernel`; `kernelStatus` field (in-memory only); `closeBoard` fires kernel shutdown. |
| `frontend/src/store/uiStore.ts` | `setupEditorOpen`, `openSetupEditor`, `closeSetupEditor`. |
| `frontend/src/api/client.ts` | `executePlot` takes an optional `kernel` options bag (boardId, setupCode, setupTimeout). `runSetup`, `restartKernel`, `shutdownKernel`, `kernelStatus`. |
| `frontend/src/components/shared/CodeMirrorEditor.tsx` | Reusable CodeMirror 6 wrapper — used by `SetupEditor` and by the PlotEditor's setup tab. Preserves both hard-won CodeMirror fixes (see gotchas). |
| `frontend/src/components/SetupEditor/SetupEditor.tsx` | Standalone modal for editing `board.setup.code` when no plot is open (Cmd+; / toolbar button). |
| `frontend/src/components/PlotEditor/PlotEditor.tsx` | Tabbed modal: **Plot code** (⌘1) / **Python Setup** (⌘2). Dedicated always-visible "Run Setup" toolbar button with status dot. "Setup failed" banner with tab-switch button. |
| `frontend/src/components/Toolbar/Toolbar.tsx` | Python Setup button (Terminal icon) with live kernel-status dot. |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | `Cmd+;` opens the standalone SetupEditor. |
| `frontend/src/App.tsx` | Mounts `<SetupEditor />`; `beforeunload` fires a `sendBeacon` to shut down the current board's kernel. |

### VS Code extension

- `vscode-sdraw/src/extension.ts::sdraw.newBoard` — inline JSON for new boards includes `schema_version: 2` and `setup: { code: "", timeout: 120 }`.

## Gotchas that will trip you up

Write these on your hand before editing anything in this area.

### CodeMirror 6 quirks (`CodeMirrorEditor.tsx` and the inline mount in `PlotEditor.tsx`)

1. **Keymap precedence.** `defaultKeymap` from `@codemirror/commands` binds `Mod-Enter` to `insertBlankLine`. Our run handler must be wrapped in `Prec.highest(keymap.of([...]))` to win, NOT just placed later in the extensions array. If Cmd+Enter starts inserting blank lines, this is the regression.
2. **Dark-mode highlight style.** `oneDark` bundles its own syntax highlighting. `syntaxHighlighting(defaultHighlightStyle)` must be added in light mode only — mixing them makes dark-mode token colors invisible because `defaultHighlightStyle` (earlier in the array) wins precedence over oneDark's colors.

Both bugs are covered by code comments at the fix sites. If the next refactor consolidates the two CodeMirror mounts (PlotEditor still has its own inline one; the extraction is deferred), these invariants must survive.

### kernel_runner discipline

1. **stdout is sacred.** The runner writes framed JSON to stdout; user `print()` output goes through a `StringIO` redirect and returns inside the response payload. If a test fails with `JSONDecodeError while reading stdout`, a stray `print` has leaked in `kernel_runner.py`. All runner-level diagnostics go to stderr.
2. **Setup ignores figures but closes them.** `_run_user_code(..., want_figure=False)` is used for `exec_setup` — it closes any stray matplotlib figures but does NOT return an image. Don't "fix" this by always returning figures; `test_setup_does_not_return_figure_but_clears_stray` asserts that a stray `plt.plot(...)` at the end of a setup block doesn't leak into the next plot run.
3. **Handler crashes don't kill the runner.** Any exception inside `_handle` is caught and returned as `ok: false`. Only frame-read failure / broken stdin exits the process.
4. **Two sys.path entries: cwd + project root.** `main()` prepends both `os.getcwd()` (the .sdraw file's directory, spawned that way by kernel_manager) and `os.environ["SDRAW_PROJECT_ROOT"]` (resolved ancestor with `pyproject.toml` etc.) to `sys.path` before the read loop. Precedence order is cwd first, project root second. Without the cwd entry, `import sibling` from a .py next to the .sdraw file fails (Python does not auto-add cwd for scripted invocations). Without the project_root entry, `import my_package` from the .sdraw file fails when the package lives several directories above it. Both are needed.

### kernel_manager discipline

1. **Test cleanup.** Every test that spawns a kernel subprocess MUST kill it in a `finally` clause. The `km` fixture in `test_kernel_manager.py` handles this via `shutdown_all`. A failing test that forgets to clean up will eventually exhaust PIDs in CI.
2. **Restart conditions.** `_get_or_start` replaces the kernel if any of: missing, dead, python path changed, OR cwd changed. If you add another mutable attribute, add it to the comparison too.
3. **`_kernel_response_to_execute_response`** is defined later in `plot.py` than `execute_plot` but referenced by name at call time. Python resolves at call time so this is fine, but if you reorganize the file keep them in module order.

### Process lifecycle

- **The legacy subprocess path still exists.** `/api/plot/execute` without `board_id` falls through to the old `plot_runner.py` path. Don't delete it — developer scripts, VS Code extension paths, and some tests rely on it. It does NOT do project-root resolution, so callers stuck on the legacy path lose that benefit.
- **Auto-migration never writes to disk.** `migrate_board_schema` rewrites the in-memory dict only. The user's next save persists the upgrade naturally. This is load-bearing: do not turn it into a side-effecting function.

## Runbook for common problems

### "API error 405: Method Not Allowed" from a kernel route

The running backend is stale — it started before the new routes existed. `main.py` mounts Starlette's `StaticFiles` as a catch-all for frontend assets, and `StaticFiles` responds to **any non-GET** request with 405 (not 404). So a POST to a non-existent `/api/plot/kernel/*` route looks like "method not allowed" even though the real cause is "route not registered on this backend".

**Diagnosis:**
```bash
curl -s http://127.0.0.1:8000/openapi.json | jq '.paths | keys[]' | grep kernel
```
If the route isn't in the OpenAPI spec, the backend is stale.

**Fix:**
```bash
lsof -i :8000            # find the backend pid
kill <pid>
cd backend && ./venv/bin/python main.py &
```
`run.sh` starts the backend without `--reload`, so it does NOT auto-pick-up source changes. Vite's dev server DOES, which is why frontend edits feel live but backend edits need a manual bounce.

### `ModuleNotFoundError` in setup code for a local package

Check, in order:
1. Does the .sdraw file have a `pyproject.toml` / `setup.py` / `setup.cfg` / `requirements.txt` / `.git` somewhere in its ancestors? `find_project_root` walks up ≤ 8 levels looking for these markers.
2. Is the import a sibling .py file next to the .sdraw (rather than a package)? That relies on cwd being in sys.path. Confirm via `km.status(board_id).cwd` — should be the .sdraw file's directory.
3. Is the backend running the current code? (Same stale-backend story as the 405 case — kill + restart via `run.sh` if `openapi.json` doesn't reflect the expected routes.)
4. Escape hatch: the user can always add `sys.path.insert(0, "/explicit/path")` to their setup block.

### Relative file paths (`open("foo.csv")`) resolve to the wrong directory

Kernel cwd is the **.sdraw file's directory**, not the project root. So `open("foo.csv")` in setup or plot code looks for `foo.csv` next to the .sdraw. If the file sits at the project root instead, either move the file or use an absolute path. Earlier Phase 7 shipped cwd = project_root, but that broke relative paths that had previously worked — the current design splits the two (`cwd` for files, `SDRAW_PROJECT_ROOT` for imports) so both behaviors hold simultaneously. See `test_relative_file_paths_resolve_against_board_dir` for the regression guard.

### Kernel seems to ignore setup changes

Hash-based staleness means setup only re-runs when the code *actually changed*. If setup is stuck, check:
- Did `boardStore.setSetupCode` fire? (It short-circuits when the value is unchanged — a failing input binding can look like "kernel is stale".)
- Is `last_setup_hash` in `km.status(board_id)` the hash of the code you think is running? A mismatch means a race or a stale kernel.
- "Restart kernel" always forces a fresh `last_setup_hash = None`, so the next run re-executes setup.

## Phase history

Kept as chronology, not instructions. All shipped 2026-04-13.

| # | Scope |
|---|---|
| 0 | Schema v2 + auto-migration (backend models, frontend types, board file load path, VS Code ext new-board). |
| 1 | `kernel_runner.py` + 10 protocol tests. Standalone, not wired up. |
| 2 | `kernel_manager.py` + `/api/plot/kernel/*` routes + FastAPI shutdown hook + 10 manager tests. Backend ready, frontend still on legacy path. |
| 3 | `/api/plot/execute` routes through the kernel when `board_id` is present. `executePlot` API client takes `kernel` options bag. `PlotEditor.handleRun` passes boardId/setupCode. Legacy subprocess path preserved as fallback. |
| 4 | `SetupEditor` standalone modal + `CodeMirrorEditor` shared component + toolbar button with status dot + Cmd+; shortcut + boardStore kernel actions. |
| 5 | Kernel shutdown on `closeBoard`; `beforeunload` `sendBeacon` safety net; "Setup failed:" banner in PlotEditor with "Open setup" button. |
| 6 | PlotEditor tabs: **Plot code** (⌘1) / **Python Setup** (⌘2). Renamed "Board Setup" → "Python Setup" in all user-facing strings (schema field stayed `setup`). Setup-failed banner's button switches tabs instead of stacking modals. |
| 7 | `find_project_root()` walks up from .sdraw dir to find `pyproject.toml` etc. Kernel subprocess spawns with `cwd = <board file's directory>`; `SDRAW_PROJECT_ROOT` env var carries the resolved project root; `kernel_runner` prepends **both** to `sys.path` (cwd first, project root second). Kernel restarts when either cwd OR project_root changes. Dedicated always-visible "Run Setup" button in the PlotEditor toolbar. Three regression tests: nested-board package imports, board-dir relative paths, and cwd-change restart. |

## Browser QA checklist (the one open item)

Still needs manual walk-through with `run.sh` up. Order matters — each step assumes the previous one passed.

- [ ] Create a new board. Setup button in the toolbar shows no dot (empty setup). Click it → empty SetupEditor opens.
- [ ] Type `import numpy as np; data = np.random.randn(1000)`. Cmd+Enter. Stdout pane empty; status dot turns green.
- [ ] Close setup. Create a plot element. Code: `import matplotlib.pyplot as plt; plt.hist(data, bins=50)`. Run. Histogram renders.
- [ ] Duplicate the plot. Change to `plt.plot(sorted(data))`. Run. **Noticeably faster** than the first plot (setup skipped).
- [ ] Reopen setup. Change to `data = np.random.randn(100)`. Run. Rerun the first plot → now shows 100 samples.
- [ ] Intentional error: change setup to `data = 1/0`. Run → red error banner.
- [ ] Try to run a plot now. Plot editor shows the "Setup failed" banner with an "Open setup" button that switches to the Setup tab.
- [ ] Fix setup. Re-run plot → works.
- [ ] Click "Restart kernel". Plot runs again; first run is slow (setup re-ran), second run is fast.
- [ ] Close the board. `ps aux | grep kernel_runner` → no stragglers.
- [ ] Open a second board in a new window. Both boards have independent kernels and independent state.
- [ ] Open an old v1 `.sdraw` file (schema_version: 1). Loads. Setup button is empty. Everything works.
- [ ] Change the Python env on a board → kernel restarts → old setup state is gone.
- [ ] Tabs inside PlotEditor: Cmd+1 and Cmd+2 switch. Dark mode: token colors visible in both editors. Cmd+Enter works in both.
- [ ] Open a .sdraw file nested deep inside a project with a `pyproject.toml`. Add `from <package> import something` to setup. Run setup → should succeed (validates `find_project_root`).

Tick items as they pass. When all 15 pass, this section becomes a regression checklist instead of a to-do list.
