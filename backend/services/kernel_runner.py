#!/usr/bin/env python3
"""Long-lived per-board Python kernel.

Spawned by `kernel_manager.py` as a child process. Reads length-prefixed
JSON commands from stdin and writes length-prefixed JSON responses to stdout.
The process holds one "setup namespace" (`_setup_ns`) across its lifetime;
plot executions run in a fresh namespace derived from (but not writing back
to) the setup namespace, so plots are isolated from each other but still
see shared setup state like loaded datasets or model instances.

Frame protocol (both directions):

    <8 ASCII digits, zero-padded, big-endian decimal length N><N UTF-8 bytes><newline>

Trailing newline is cosmetic (aids manual debugging); readers must still
consume exactly N bytes of payload.

Requests:
    {"op": "ping"}
    {"op": "exec_setup", "code": "...", "dpi": 150}
    {"op": "exec_plot",  "code": "...", "dpi": 150}
    {"op": "reset"}
    {"op": "shutdown"}

Responses:
    {"ok": true, "pong": true}                       (ping)
    {"ok": true, "reset": true}                      (reset)
    {"ok": true, "shutdown": true}                   (shutdown, then exit)
    {"ok": bool, "stdout": str, "error": str|None,
     "image": str|None, "plotly_json": str|None}    (exec_setup / exec_plot)

The runner itself writes nothing to stdout outside the frame protocol
(stray prints would corrupt the stream). User `print()` output from
user code is captured via a StringIO redirect and returned inside the
response payload. Runner-level diagnostics go to stderr.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import traceback
from typing import Any


# ----- Frame I/O ------------------------------------------------------------

_HEADER_LEN = 8


def _read_frame(stream: io.BufferedReader) -> dict[str, Any]:
    header = stream.read(_HEADER_LEN)
    if not header:
        raise EOFError("stdin closed")
    if len(header) < _HEADER_LEN:
        raise EOFError(f"short header: {len(header)} bytes")
    length = int(header.decode("ascii"))
    payload = stream.read(length)
    if len(payload) < length:
        raise EOFError(f"short payload: got {len(payload)} of {length} bytes")
    # Consume the trailing newline if present
    nl = stream.read(1)
    if nl and nl != b"\n":
        # Not a newline — put it back conceptually by failing loudly.
        # In practice this only happens if the sender is broken.
        raise ValueError(f"expected newline after frame, got {nl!r}")
    return json.loads(payload.decode("utf-8"))


def _write_frame(stream: io.BufferedWriter, obj: dict[str, Any]) -> None:
    payload = json.dumps(obj).encode("utf-8")
    stream.write(f"{len(payload):0{_HEADER_LEN}d}".encode("ascii"))
    stream.write(payload)
    stream.write(b"\n")
    stream.flush()


# ----- Matplotlib / plotly capture ------------------------------------------
#
# A single namespace walk produces figures in the order the user's code bound
# them, so `iso_fig, cbar_fig = make_figs()` puts iso at index 0 and cbar at
# index 1 regardless of whether one is matplotlib and the other is plotly.
# That ordering maps directly to the sdraw element `figureIndex` metadata.


def _render_matplotlib(fig, dpi: int) -> str | None:
    """Render a matplotlib Figure to base64 PNG, or None if rendering fails.

    `bbox_inches="tight"` is dropped on retry because some colorbar-only
    figures raise inside tight-layout computation but render fine without it.
    """
    import io as _io
    import base64 as _b64
    for kwargs in ({"bbox_inches": "tight"}, {}):
        try:
            buf = _io.BytesIO()
            fig.savefig(buf, format="png", dpi=dpi, **kwargs)
            return _b64.b64encode(buf.getvalue()).decode("ascii")
        except Exception:
            continue
    return None


def _render_plotly(fig) -> tuple[str | None, str | None]:
    """Render a plotly Figure to (plotly_json, image_b64 or None)."""
    try:
        plotly_json = fig.to_json()
    except Exception:
        plotly_json = None
    image_b64: str | None = None
    try:
        img_bytes = fig.to_image(format="png", scale=2)
        image_b64 = base64.b64encode(img_bytes).decode("ascii")
    except Exception:
        pass  # kaleido not installed; frontend renders the JSON spec
    return plotly_json, image_b64


def _capture_all_figures(
    ns: dict[str, Any],
    setup_obj_ids: set[int],
    dpi: int,
) -> list[dict[str, Any]]:
    """Capture figures CREATED BY THE PLOT CODE, in tuple-unpack order.

    `setup_obj_ids` is the set of id() values of everything in _setup_ns
    BEFORE this plot ran. Any figure whose id() is in this set came from
    setup (e.g. a template go.Figure) and is not a plot output, so we skip
    it. Without this filter, a template figure in setup would hijack
    `figureIndex=0` and the user's real figures would slide to 1, 2, etc.

    Returns `{"image": b64 | None, "plotly_json": json | None}` per figure.
    Pyplot's state is always cleared so it doesn't leak across runs.
    """
    out: list[dict[str, Any]] = []
    seen: set[int] = set()

    try:
        import plotly.graph_objects as go
        plotly_fig_cls: type | None = go.Figure
    except ImportError:
        plotly_fig_cls = None

    try:
        import matplotlib.figure as _mpl_figure
        import matplotlib.pyplot as plt
        mpl_fig_cls: type | None = _mpl_figure.Figure
    except ImportError:
        mpl_fig_cls = None
        plt = None  # type: ignore[assignment]

    # Pass 1: walk the user's namespace in insertion order. Skip anything
    # carried over from setup (id in setup_obj_ids) so template figures
    # can't take fig-index 0 from the user's real outputs.
    for val in ns.values():
        vid = id(val)
        if vid in seen or vid in setup_obj_ids:
            continue
        if plotly_fig_cls is not None and isinstance(val, plotly_fig_cls):
            seen.add(vid)
            plotly_json, image_b64 = _render_plotly(val)
            out.append({"image": image_b64, "plotly_json": plotly_json})
            continue
        if mpl_fig_cls is not None and isinstance(val, mpl_fig_cls):
            if not val.get_axes():
                continue
            seen.add(vid)
            image_b64 = _render_matplotlib(val, dpi)
            if image_b64 is None:
                continue
            out.append({"image": image_b64, "plotly_json": None})
            continue

    # Pass 2: pyplot-tracked matplotlib figures not bound to any name in ns
    # (e.g. `plt.figure(); plt.plot(...)` at module level). Append at the
    # end so named bindings keep their natural insertion order.
    if plt is not None:
        try:
            for num in plt.get_fignums():
                fig = plt.figure(num)
                fid = id(fig)
                if fid in seen or fid in setup_obj_ids:
                    continue
                if not fig.get_axes():
                    continue
                seen.add(fid)
                image_b64 = _render_matplotlib(fig, dpi)
                if image_b64 is None:
                    continue
                out.append({"image": image_b64, "plotly_json": None})
        finally:
            # Always clear pyplot state — this is the only place that drops
            # it between runs, so skipping would leak figures cross-run.
            plt.close("all")

    return out


# ----- Execution core -------------------------------------------------------


_setup_ns: dict[str, Any] = {}


def _fresh_setup_ns() -> dict[str, Any]:
    return {"__name__": "__main__", "__builtins__": __builtins__}


def _run_user_code(
    code: str,
    ns: dict[str, Any],
    dpi: int,
    tag: str,
    want_figure: bool,
) -> dict[str, Any]:
    """Execute `code` in namespace `ns`, capturing stdout and figure output.

    `want_figure=False` still closes any stray figures so they don't leak
    across runs (e.g. a stray plt.plot at the end of a setup block).
    """
    # Snapshot setup's object identities BEFORE running, so we can tell
    # setup-retained figures (templates, shared fig instances) apart from
    # figures the plot code produces. For plot runs this is ns itself,
    # which started as `{**_setup_ns, ...}` — so id() of every setup value
    # is represented once.
    setup_obj_ids: set[int] = (
        {id(v) for v in _setup_ns.values()} if want_figure else set()
    )

    # Defensive pyplot reset BEFORE the run — a setup run that left stray
    # figures (should not happen, but matplotlib is happy to keep them)
    # would otherwise be captured as phantom plot outputs.
    if want_figure:
        try:
            import matplotlib.pyplot as _plt_reset
            _plt_reset.close("all")
        except ImportError:
            pass

    captured = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured
    exec_error: str | None = None
    try:
        exec(compile(code, f"<{tag}>", "exec"), ns)
    except BaseException:
        exec_error = traceback.format_exc()
    finally:
        sys.stdout = old_stdout

    figures: list[dict[str, Any]] = []
    if want_figure:
        # A single walk of the user's namespace preserves tuple-unpack order
        # across figure types — critical for `a, b = make_figs()` where one
        # is plotly and one is matplotlib. Un-named pyplot figures append
        # after named ones.
        figures = _capture_all_figures(ns, setup_obj_ids, dpi)
    else:
        # Close any stray matplotlib figures so they don't leak into the
        # next plot run.
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except ImportError:
            pass

    # Backwards-compatible top-level `image` / `plotly_json` fields alias
    # the first captured figure, so any caller expecting the old single-figure
    # shape keeps working transparently.
    first = figures[0] if figures else {}
    return {
        "ok": exec_error is None,
        "stdout": captured.getvalue(),
        "error": exec_error,
        "image": first.get("image"),
        "plotly_json": first.get("plotly_json"),
        "figures": figures,
    }


def _handle(msg: dict[str, Any]) -> dict[str, Any]:
    global _setup_ns

    op = msg.get("op")

    if op == "ping":
        return {"ok": True, "pong": True}

    if op == "reset":
        _setup_ns = _fresh_setup_ns()
        _module_mtimes.clear()
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except ImportError:
            pass
        return {"ok": True, "reset": True}

    if op == "exec_setup":
        code = msg.get("code", "")
        dpi = int(msg.get("dpi", 150))
        # Run in the shared namespace so assignments persist.
        resp = _run_user_code(code, _setup_ns, dpi, tag="setup", want_figure=False)
        # Snapshot mtimes for every module setup just imported, as the
        # baseline for autoreload. A later edit between setup and the
        # first plot run would otherwise be primed at its already-edited
        # mtime, and the change would silently go unnoticed.
        #
        # We reset the cache first because setup may have rebuilt the
        # module graph (especially on re-run) — stale entries from a
        # previous setup shouldn't persist.
        _module_mtimes.clear()
        _prime_mtime_cache()
        return resp

    if op == "exec_plot":
        code = msg.get("code", "")
        dpi = int(msg.get("dpi", 150))
        # Auto-reload any project-local module whose source changed on
        # disk since we last saw it, and rebind setup_ns references. This
        # is the mechanism that makes "edit helper.py → re-run plot →
        # see new behavior" work without the user touching anything.
        # Cheap when nothing changed (one stat() per tracked module).
        ar = _auto_reload_stale()
        # Derive a fresh namespace so plot-local assignments do NOT leak
        # back into _setup_ns or into other plots.
        ns = {**_setup_ns, "__name__": "__main__", "__builtins__": __builtins__}
        resp = _run_user_code(code, ns, dpi, tag="plot", want_figure=True)
        # Surface the autoreload summary so the frontend can show a
        # "reloaded N module(s)" hint if it wants to. Non-empty only
        # when something actually changed.
        if ar["reloaded"] or ar["errors"]:
            resp["autoreload"] = ar
        return resp

    if op == "reload_modules":
        return _reload_project_modules()

    # Unknown op
    return {"ok": False, "stdout": "", "error": f"unknown op: {op!r}",
            "image": None, "plotly_json": None}


# ----- Module autoreload ----------------------------------------------------
#
# Architectural design:
#
#   1. Track mtimes of every project-local module in `_module_mtimes` so we
#      can detect which modules actually changed on disk — no point
#      reloading the 95% that didn't.
#
#   2. Before every plot exec we run a CHEAP stale-check (one stat() per
#      tracked module) and reload only the stale ones. This gives the
#      user Jupyter %autoreload-style "edit .py → re-run plot → see
#      changes" with zero clicks.
#
#   3. After reload, walk _setup_ns and every reloaded module's internal
#      namespace and REBIND references. Without this, `from foo import
#      bar` in setup leaves `bar` pointing at the old function even
#      after `foo` is reloaded — the single most common autoreload
#      failure mode. This step is what makes the feature actually work.
#
#   4. The explicit "Reload modules" button is now "force reload":
#      ignores mtimes, reloads everything project-local. Use when the
#      mtime heuristic fails (e.g., `touch -d` back-dated file, or a
#      module that was never imported during setup so we have no mtime
#      baseline for it).

# module_name -> mtime at last successful reload (or initial import).
_module_mtimes: dict[str, float] = {}


def _project_roots() -> list[str]:
    roots: list[str] = []
    cwd = os.getcwd()
    if cwd:
        roots.append(os.path.realpath(cwd))
    env_root = os.environ.get("SDRAW_PROJECT_ROOT")
    if env_root:
        roots.append(os.path.realpath(env_root))
    # Dedup while preserving order.
    return list(dict.fromkeys(roots))


def _is_project_module(mod: Any, roots: list[str]) -> bool:
    f = getattr(mod, "__file__", None)
    if not f or not isinstance(f, str):
        return False
    try:
        rp = os.path.realpath(f)
    except OSError:
        return False
    # Exclude third-party trees even when they happen to live under a
    # project root (some repos vendor deps into ./site-packages).
    parts = rp.split(os.sep)
    for excl in ("site-packages", "dist-packages", ".venv", "venv", "__pycache__"):
        if excl in parts:
            return False
    return any(rp == root or rp.startswith(root + os.sep) for root in roots)


def _module_source_mtime(mod: Any) -> float | None:
    f = getattr(mod, "__file__", None)
    if not f or not isinstance(f, str):
        return None
    try:
        return os.path.getmtime(f)
    except OSError:
        return None


def _project_module_names() -> list[str]:
    roots = _project_roots()
    if not roots:
        return []
    out: list[str] = []
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name == "__main__":
            continue
        if _is_project_module(mod, roots):
            out.append(name)
    return out


def _prime_mtime_cache() -> None:
    """Snapshot current mtimes for every project-local module in sys.modules.
    Called once per run before we start comparing, so brand-new imports
    don't look stale on the very next exec."""
    for name in _project_module_names():
        mod = sys.modules.get(name)
        if mod is None:
            continue
        mt = _module_source_mtime(mod)
        if mt is not None and name not in _module_mtimes:
            _module_mtimes[name] = mt


def _stale_project_modules() -> list[str]:
    """Modules whose on-disk source mtime is newer than our cache."""
    stale: list[str] = []
    for name in _project_module_names():
        mod = sys.modules.get(name)
        if mod is None:
            continue
        mt = _module_source_mtime(mod)
        if mt is None:
            continue
        cached = _module_mtimes.get(name)
        if cached is None or mt > cached:
            stale.append(name)
    return stale


def _reload_and_rebind(module_names: list[str]) -> dict[str, Any]:
    """Reload the given modules and rebind references in _setup_ns and in
    every other reloaded module so `from X import Y` names don't get
    left pointing at stale objects.

    Returns {reloaded, errors, rebound} — `rebound` counts how many names
    were updated across all namespaces we touched.
    """
    import importlib

    if not module_names:
        return {"reloaded": [], "errors": [], "rebound": 0}

    # 1. Snapshot pre-reload attributes per module: id(obj) → attr_name.
    #    This lets us tell "foo.bar" and "foo.baz" apart after reload —
    #    we look up each old object's attribute name, then fetch the
    #    same-named attribute from the reloaded module.
    pre_attrs: dict[str, dict[int, str]] = {}
    for name in module_names:
        mod = sys.modules.get(name)
        if mod is None:
            continue
        mapping: dict[int, str] = {}
        for attr in dir(mod):
            if attr.startswith("__"):
                continue
            try:
                val = getattr(mod, attr)
            except Exception:
                continue
            # Only remember one name per object-id — if two attrs alias the
            # same object (e.g. `foo = bar`), either name is fine.
            mapping.setdefault(id(val), attr)
        pre_attrs[name] = mapping

    # 2. Reload deepest-first (submodule leaves before their parents).
    ordered = sorted(module_names, key=lambda n: (-n.count("."), n))
    reloaded: list[str] = []
    errors: list[dict[str, str]] = []
    for name in ordered:
        mod = sys.modules.get(name)
        if mod is None:
            continue
        try:
            importlib.reload(mod)
            reloaded.append(name)
            new_mt = _module_source_mtime(mod)
            if new_mt is not None:
                _module_mtimes[name] = new_mt
        except Exception as exc:
            errors.append({"module": name, "error": f"{type(exc).__name__}: {exc}"})

    # 3. Build id_remap: {id(old_obj) → new_obj}. For each reloaded
    #    module, walk the old attribute names and fetch the NEW binding.
    #    This is the rebind map we apply to every referencing namespace.
    id_remap: dict[int, Any] = {}
    for name in reloaded:
        mod = sys.modules.get(name)
        if mod is None:
            continue
        for old_id, attr_name in pre_attrs.get(name, {}).items():
            try:
                new_val = getattr(mod, attr_name)
            except AttributeError:
                continue
            id_remap[old_id] = new_val

    # 4. Rebind references. Three target namespaces:
    #    (a) _setup_ns — the user's shared setup globals.
    #    (b) Every OTHER still-imported project module's own attributes
    #        (so A.from_B references update when B reloads).
    #    (c) NOT plot-execution namespaces — those are fresh every run.
    rebound = _rebind_namespace(_setup_ns, id_remap)
    reloaded_set = set(reloaded)
    for other in _project_module_names():
        if other in reloaded_set:
            continue
        mod = sys.modules.get(other)
        if mod is None:
            continue
        rebound += _rebind_namespace(mod.__dict__, id_remap)

    return {"reloaded": reloaded, "errors": errors, "rebound": rebound}


def _rebind_namespace(ns: dict[str, Any], id_remap: dict[int, Any]) -> int:
    """Replace any value in `ns` whose id() is in `id_remap` with the
    remapped object. Returns the count of rebindings applied."""
    count = 0
    for k in list(ns.keys()):
        try:
            v = ns[k]
        except Exception:
            continue
        replacement = id_remap.get(id(v))
        if replacement is not None and replacement is not v:
            ns[k] = replacement
            count += 1
    return count


def _auto_reload_stale() -> dict[str, Any]:
    """Reload project modules that changed on disk since we last saw
    them. Called before every exec_plot so users don't have to click
    anything. Cheap when nothing changed (stat() per module)."""
    _prime_mtime_cache()
    stale = _stale_project_modules()
    if not stale:
        return {"reloaded": [], "errors": [], "rebound": 0}
    return _reload_and_rebind(stale)


def _reload_project_modules() -> dict[str, Any]:
    """Force-reload every project-local module regardless of mtime.

    Exposed as the explicit "Reload modules" button for when the mtime
    heuristic fails (file back-dated via `touch -d`, module never
    imported during setup, etc.). Also clears `_module_mtimes` so the
    next auto-check starts from a clean slate.
    """
    names = _project_module_names()
    if not names:
        return {"ok": True, "reloaded": [], "errors": [], "rebound": 0}
    result = _reload_and_rebind(names)
    return {"ok": True, **result}


def main() -> int:
    # Make user code's "home directories" importable.
    #
    # 1. cwd is the .sdraw file's own directory — `import helpers` from a
    #    sibling `helpers.py` should just work. Python does NOT auto-add
    #    cwd to sys.path for scripted invocations (sys.path[0] is the
    #    script's own dir, i.e. backend/services/), so we do it here.
    # 2. SDRAW_PROJECT_ROOT is the nearest ancestor directory containing
    #    pyproject.toml / setup.py / .git (resolved in kernel_manager via
    #    find_project_root). Adding it lets `import my_package` work when
    #    the package lives several directories above the .sdraw file.
    #
    # Precedence: cwd first (closer to the file), project root second.
    cwd = os.getcwd()
    project_root = os.environ.get("SDRAW_PROJECT_ROOT")
    for path in filter(None, (project_root, cwd)):
        # Prepend, dedup.
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)

    # Force matplotlib into the Agg backend before any user imports so
    # plt.show() is a no-op and headless rendering works.
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        plt.show = lambda *a, **kw: None  # type: ignore[assignment]
    except ImportError:
        pass

    # Neutralize plotly's .show() entry points. In a headless subprocess
    # plotly.io.show will try to spin up a local HTTP server and launch a
    # browser, which either blocks or errors — neither is useful here
    # because figure capture is done by namespace inspection in
    # _capture_plotly_all. Users who copied `fig.show()` over from a
    # notebook just get a quiet no-op.
    try:
        import plotly.graph_objects as _go
        import plotly.io as _pio

        def _plotly_noop_show(*args, **kwargs):
            return None

        _go.Figure.show = _plotly_noop_show  # type: ignore[assignment]
        _pio.show = _plotly_noop_show  # type: ignore[assignment]
    except ImportError:
        pass

    global _setup_ns
    _setup_ns = _fresh_setup_ns()

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    while True:
        try:
            msg = _read_frame(stdin)
        except EOFError:
            return 0
        except Exception as exc:
            # Protocol-level error: report to stderr and exit.
            print(f"kernel_runner: frame read failed: {exc}", file=sys.stderr)
            return 1

        op = msg.get("op")
        if op == "shutdown":
            _write_frame(stdout, {"ok": True, "shutdown": True})
            return 0

        try:
            resp = _handle(msg)
        except Exception as exc:
            # Handler crashed — should never happen, but don't take down
            # the runner for a single bad request.
            resp = {
                "ok": False,
                "stdout": "",
                "error": f"kernel handler crashed: {exc}\n{traceback.format_exc()}",
                "image": None,
                "plotly_json": None,
            }
        _write_frame(stdout, resp)


if __name__ == "__main__":
    sys.exit(main())
