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
# Adapted from backend/services/plot_runner.py. Kept inline (not imported)
# because plot_runner lives in a separate process lifetime and we don't want
# its module-level import side effects running here.


def _capture_matplotlib_all(dpi: int) -> list[dict[str, Any]]:
    """Capture EVERY open matplotlib figure as a PNG base64, in creation order.

    Returns a list of `{"image": b64, "plotly_json": None}` dicts. Empty if
    matplotlib isn't installed or no figures have any axes. All figures are
    closed at the end so they don't leak into the next run.
    """
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []
    out: list[dict[str, Any]] = []
    try:
        for num in plt.get_fignums():
            fig = plt.figure(num)
            if not fig.get_axes():
                continue
            buf = io.BytesIO()
            try:
                fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
            except Exception:
                continue
            out.append({
                "image": base64.b64encode(buf.getvalue()).decode("ascii"),
                "plotly_json": None,
            })
    finally:
        plt.close("all")
    return out


def _capture_plotly_all(ns: dict[str, Any]) -> list[dict[str, Any]]:
    """Capture EVERY plotly Figure instance in the namespace, in insertion order.

    Returns `{"image": b64 or None, "plotly_json": json}` per figure. The
    image is None if kaleido isn't installed; the frontend renders from
    plotly_json directly in that case.
    """
    try:
        import plotly.graph_objects as go
    except ImportError:
        return []
    out: list[dict[str, Any]] = []
    seen: set[int] = set()  # dedup by id() in case the same fig is bound twice
    for val in ns.values():
        if not isinstance(val, go.Figure):
            continue
        if id(val) in seen:
            continue
        seen.add(id(val))
        try:
            plotly_json = val.to_json()
        except Exception:
            plotly_json = None
        image_b64: str | None = None
        try:
            img_bytes = val.to_image(format="png", scale=2)
            image_b64 = base64.b64encode(img_bytes).decode("ascii")
        except Exception:
            pass  # kaleido not installed; frontend renders the JSON spec
        out.append({"image": image_b64, "plotly_json": plotly_json})
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
        # Matplotlib figures come out in creation order; plotly figures come
        # out in namespace-insertion order. Matplotlib first matches user
        # intuition ("the figure I saw first is on the left").
        figures = _capture_matplotlib_all(dpi) + _capture_plotly_all(ns)
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
        return _run_user_code(code, _setup_ns, dpi, tag="setup", want_figure=False)

    if op == "exec_plot":
        code = msg.get("code", "")
        dpi = int(msg.get("dpi", 150))
        # Derive a fresh namespace so plot-local assignments do NOT leak
        # back into _setup_ns or into other plots.
        ns = {**_setup_ns, "__name__": "__main__", "__builtins__": __builtins__}
        return _run_user_code(code, ns, dpi, tag="plot", want_figure=True)

    # Unknown op
    return {"ok": False, "stdout": "", "error": f"unknown op: {op!r}",
            "image": None, "plotly_json": None}


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
