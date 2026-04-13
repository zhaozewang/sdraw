"""Protocol and semantics tests for backend/services/kernel_runner.py.

Each test spawns a real subprocess, drives it via the JSON frame protocol,
and verifies the response. The runner's stdout must contain only well-formed
frames — if a test fails with a JSON parse error, a stray `print` is leaking
in kernel_runner.py.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest


RUNNER_PATH = (
    Path(__file__).resolve().parent.parent / "services" / "kernel_runner.py"
)


# ----- Frame helpers (mirror of kernel_runner._read_frame/_write_frame) -----


def _write_frame(proc: subprocess.Popen, obj: dict[str, Any]) -> None:
    payload = json.dumps(obj).encode("utf-8")
    assert proc.stdin is not None
    proc.stdin.write(f"{len(payload):08d}".encode("ascii"))
    proc.stdin.write(payload)
    proc.stdin.write(b"\n")
    proc.stdin.flush()


def _read_exact(stream, n: int) -> bytes:
    """Read exactly `n` bytes or raise. Unbuffered pipes (bufsize=0) are
    allowed to return short reads from `.read(n)`, so we must loop.
    Large multi-figure payloads exposed this — single `.read(length)`
    returned partway through the payload and the subsequent single-byte
    read consumed JSON bytes instead of the trailing newline.
    """
    chunks: list[bytes] = []
    remaining = n
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError(f"stream closed with {remaining} of {n} bytes remaining")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_frame(proc: subprocess.Popen) -> dict[str, Any]:
    assert proc.stdout is not None
    try:
        header = _read_exact(proc.stdout, 8)
    except EOFError as exc:
        # Pull stderr for diagnostics
        stderr = b""
        if proc.stderr is not None:
            try:
                stderr = proc.stderr.read() or b""
            except Exception:
                pass
        raise AssertionError(
            f"short header from runner: {exc}. "
            f"stderr: {stderr.decode('utf-8', 'replace')!r}"
        )
    length = int(header.decode("ascii"))
    payload = _read_exact(proc.stdout, length)
    nl = _read_exact(proc.stdout, 1)
    assert nl == b"\n", f"expected newline after frame, got {nl!r}"
    return json.loads(payload.decode("utf-8"))


# ----- Fixture --------------------------------------------------------------


@pytest.fixture()
def kernel():
    """Spawn a runner subprocess and guarantee cleanup."""
    proc = subprocess.Popen(
        [sys.executable, str(RUNNER_PATH)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    try:
        yield proc
    finally:
        if proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass


# ----- Tests ----------------------------------------------------------------


def test_ping(kernel):
    _write_frame(kernel, {"op": "ping"})
    resp = _read_frame(kernel)
    assert resp == {"ok": True, "pong": True}


def test_setup_and_plot_share_state(kernel):
    _write_frame(kernel, {"op": "exec_setup", "code": "x = 42"})
    resp = _read_frame(kernel)
    assert resp["ok"] is True, resp
    assert resp["error"] is None

    _write_frame(kernel, {"op": "exec_plot", "code": "print(x)"})
    resp = _read_frame(kernel)
    assert resp["ok"] is True, resp
    assert "42" in resp["stdout"]


def test_plot_isolation(kernel):
    """Plot A assigning x = 999 must not affect plot B or the setup ns."""
    _write_frame(kernel, {"op": "exec_setup", "code": "x = 1"})
    assert _read_frame(kernel)["ok"] is True

    _write_frame(kernel, {"op": "exec_plot", "code": "x = 999"})
    assert _read_frame(kernel)["ok"] is True

    _write_frame(kernel, {"op": "exec_plot", "code": "print(x)"})
    resp = _read_frame(kernel)
    assert resp["ok"] is True, resp
    assert resp["stdout"].strip() == "1", resp["stdout"]


def test_setup_error_surfaces(kernel):
    _write_frame(
        kernel,
        {"op": "exec_setup", "code": "raise RuntimeError('boom')"},
    )
    resp = _read_frame(kernel)
    assert resp["ok"] is False
    assert resp["error"] is not None
    assert "RuntimeError" in resp["error"]
    assert "boom" in resp["error"]


def test_reset_clears_state(kernel):
    _write_frame(kernel, {"op": "exec_setup", "code": "x = 1"})
    assert _read_frame(kernel)["ok"] is True

    _write_frame(kernel, {"op": "reset"})
    assert _read_frame(kernel) == {"ok": True, "reset": True}

    _write_frame(kernel, {"op": "exec_plot", "code": "print(x)"})
    resp = _read_frame(kernel)
    assert resp["ok"] is False
    assert "NameError" in (resp["error"] or "")


def test_matplotlib_capture(kernel):
    pytest.importorskip("matplotlib")
    _write_frame(kernel, {"op": "exec_setup", "code": "import matplotlib.pyplot as plt"})
    assert _read_frame(kernel)["ok"] is True

    _write_frame(
        kernel,
        {
            "op": "exec_plot",
            "code": "plt.plot([1, 2, 3])",
            "dpi": 72,
        },
    )
    resp = _read_frame(kernel)
    assert resp["ok"] is True, resp
    assert resp["image"] is not None
    # Sanity: base64 of a PNG is non-trivial
    assert len(resp["image"]) > 100


def test_setup_does_not_return_figure_but_clears_stray(kernel):
    """Setup ignores any figure output but clears it so it can't leak."""
    pytest.importorskip("matplotlib")
    _write_frame(
        kernel,
        {
            "op": "exec_setup",
            "code": (
                "import matplotlib.pyplot as plt\n"
                "plt.plot([1, 2, 3])\n"  # stray figure left over from setup
            ),
        },
    )
    resp = _read_frame(kernel)
    assert resp["ok"] is True, resp
    assert resp["image"] is None, "setup must not return figure output"

    # The next plot that doesn't draw should also get no figure —
    # proves the stray setup figure was closed, not inherited.
    _write_frame(kernel, {"op": "exec_plot", "code": "pass"})
    resp = _read_frame(kernel)
    assert resp["ok"] is True
    assert resp["image"] is None, (
        "stray figure from setup leaked into plot run"
    )


def test_unknown_op(kernel):
    _write_frame(kernel, {"op": "nonsense"})
    resp = _read_frame(kernel)
    assert resp["ok"] is False
    assert "unknown op" in (resp["error"] or "")


def test_shutdown(kernel):
    _write_frame(kernel, {"op": "shutdown"})
    resp = _read_frame(kernel)
    assert resp == {"ok": True, "shutdown": True}
    # Process should exit on its own.
    assert kernel.wait(timeout=5) == 0


def test_multi_matplotlib_figures(kernel):
    """A single plot cell producing N matplotlib figures must return all
    N in the response's `figures` list, in creation order."""
    pytest.importorskip("matplotlib")
    # Setup can be empty; the plot creates 3 figures
    _write_frame(kernel, {"op": "exec_setup", "code": "import matplotlib.pyplot as plt"})
    assert _read_frame(kernel)["ok"]

    _write_frame(
        kernel,
        {
            "op": "exec_plot",
            "code": (
                "import matplotlib.pyplot as plt\n"
                "for i in range(3):\n"
                "    plt.figure()\n"
                "    plt.plot([0, i+1, 2*(i+1)])\n"
                "    plt.title(f'fig {i}')\n"
            ),
            "dpi": 72,
        },
    )
    resp = _read_frame(kernel)
    assert resp["ok"], resp
    figures = resp["figures"]
    assert isinstance(figures, list)
    assert len(figures) == 3, f"expected 3 figures, got {len(figures)}"
    for f in figures:
        assert f["image"] is not None
        assert f["plotly_json"] is None
    # Backwards-compat aliases: top-level `image` = figures[0].image
    assert resp["image"] == figures[0]["image"]


def test_single_figure_backwards_compat(kernel):
    """Single-figure responses still populate top-level image/plotly_json
    AND figures[0], so callers on either code path keep working."""
    pytest.importorskip("matplotlib")
    _write_frame(
        kernel,
        {
            "op": "exec_plot",
            "code": "import matplotlib.pyplot as plt; plt.plot([1, 2, 3])",
            "dpi": 72,
        },
    )
    resp = _read_frame(kernel)
    assert resp["ok"], resp
    assert len(resp["figures"]) == 1
    assert resp["figures"][0]["image"] is not None
    assert resp["image"] == resp["figures"][0]["image"]


def test_no_figures_returns_empty_list(kernel):
    """A plot cell that doesn't produce any figures gets an empty list."""
    _write_frame(
        kernel,
        {"op": "exec_plot", "code": "x = 1 + 1"},
    )
    resp = _read_frame(kernel)
    assert resp["ok"], resp
    assert resp["figures"] == []
    assert resp["image"] is None
    assert resp["plotly_json"] is None


def test_user_stdout_does_not_corrupt_framing(kernel):
    """User print() output must be captured, not written to runner stdout."""
    _write_frame(
        kernel,
        {
            "op": "exec_setup",
            "code": "print('hello from setup')",
        },
    )
    resp = _read_frame(kernel)
    assert resp["ok"] is True, resp
    assert "hello from setup" in resp["stdout"]

    # Follow-up request must still parse as a clean frame (i.e. user output
    # didn't write anything onto the real stdout pipe).
    _write_frame(kernel, {"op": "ping"})
    assert _read_frame(kernel) == {"ok": True, "pong": True}
