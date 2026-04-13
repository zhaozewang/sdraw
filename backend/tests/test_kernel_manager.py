"""Tests for backend/services/kernel_manager.py.

Every test creates its own KernelManager instance and explicitly shuts it
down in a finally clause so failed tests never orphan kernel processes.
"""

from __future__ import annotations

import asyncio
import sys

import pytest

from services.kernel_manager import KernelManager, _hash_code


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture()
async def km():
    mgr = KernelManager()
    try:
        yield mgr
    finally:
        await mgr.shutdown_all()


pytestmark = pytest.mark.anyio


@pytest.mark.anyio
async def test_get_or_start_is_idempotent(km):
    await km._get_or_start("b1", None, None)
    kp1 = km._kernels["b1"]
    pid1 = kp1.proc.pid if kp1.proc else None
    await km._get_or_start("b1", None, None)
    kp2 = km._kernels["b1"]
    pid2 = kp2.proc.pid if kp2.proc else None
    assert kp1 is kp2
    assert pid1 == pid2


@pytest.mark.anyio
async def test_different_boards_get_different_kernels(km):
    r1 = await km.exec_plot("b1", "x = 1", "", python_path=None)
    r2 = await km.exec_plot("b2", "x = 2", "", python_path=None)
    assert r1["ok"] and r2["ok"]
    assert km._kernels["b1"].proc.pid != km._kernels["b2"].proc.pid


@pytest.mark.anyio
async def test_auto_rerun_setup_on_hash_change(km):
    # First plot with setup A
    r = await km.exec_plot(
        "b1",
        plot_code="print(x)",
        setup_code="x = 111",
    )
    assert r["ok"], r
    assert "111" in r["stdout"]
    hash_a = km._kernels["b1"].last_setup_hash
    assert hash_a == _hash_code("x = 111")

    # Second plot with SAME setup code — should NOT re-run setup
    # (we can only observe this indirectly: the hash stays stable)
    r = await km.exec_plot(
        "b1",
        plot_code="print(x * 2)",
        setup_code="x = 111",
    )
    assert r["ok"] and "222" in r["stdout"]
    assert km._kernels["b1"].last_setup_hash == hash_a

    # Third plot with NEW setup — triggers re-run, hash updates
    r = await km.exec_plot(
        "b1",
        plot_code="print(x)",
        setup_code="x = 999",
    )
    assert r["ok"] and "999" in r["stdout"]
    assert km._kernels["b1"].last_setup_hash == _hash_code("x = 999")


@pytest.mark.anyio
async def test_setup_failure_blocks_plot(km):
    r = await km.exec_plot(
        "b1",
        plot_code="print('should not run')",
        setup_code="raise RuntimeError('nope')",
    )
    assert r["ok"] is False
    assert r["error"] is not None
    assert r["error"].startswith("Setup failed:\n")
    assert "RuntimeError" in r["error"]
    assert "nope" in r["error"]
    assert "should not run" not in (r["stdout"] or "")


@pytest.mark.anyio
async def test_restart_clears_state(km):
    r = await km.exec_plot("b1", "pass", "x = 42")
    assert r["ok"]

    await km.restart("b1")
    assert "b1" not in km._kernels

    # Next plot with empty setup should see x undefined
    r = await km.exec_plot("b1", "print(x)", "")
    assert r["ok"] is False
    assert "NameError" in (r["error"] or "")


@pytest.mark.anyio
async def test_python_env_change_restarts_kernel(km):
    # Start on the current interpreter
    r = await km.exec_plot("b1", "pass", "x = 1", python_path=None)
    assert r["ok"]
    pid_first = km._kernels["b1"].proc.pid

    # Re-invoke with an explicit path to the SAME python; should not restart
    r = await km.exec_plot("b1", "pass", "x = 1", python_path=sys.executable)
    assert r["ok"]
    assert km._kernels["b1"].proc.pid == pid_first

    # Now invoke with a bogus path → FileNotFoundError (doesn't restart)
    with pytest.raises(FileNotFoundError):
        await km.exec_plot("b1", "pass", "x = 1", python_path="/nonexistent/python")
    # Original kernel still alive, unchanged
    assert km._kernels["b1"].proc.pid == pid_first


@pytest.mark.anyio
async def test_shutdown_all_kills_all_kernels(km):
    await km.exec_plot("b1", "pass", "")
    await km.exec_plot("b2", "pass", "")
    pid1 = km._kernels["b1"].proc.pid
    pid2 = km._kernels["b2"].proc.pid

    await km.shutdown_all()
    assert km._kernels == {}

    # Processes are actually dead (poll via /proc on linux)
    for pid in (pid1, pid2):
        try:
            import os
            os.kill(pid, 0)
            # If we get here the process is still alive — fail loudly
            raise AssertionError(f"process {pid} still alive after shutdown_all")
        except ProcessLookupError:
            pass  # expected


@pytest.mark.anyio
async def test_status_reports_running_and_hash(km):
    s = km.status("b1")
    assert s == {
        "running": False,
        "last_setup_hash": None,
        "python_path": None,
        "recent_stderr": [],
    }

    await km.exec_plot("b1", "pass", "x = 1")
    s = km.status("b1")
    assert s["running"] is True
    assert s["last_setup_hash"] == _hash_code("x = 1")
    assert s["python_path"] == sys.executable or s["python_path"].endswith("python")


@pytest.mark.anyio
async def test_plots_share_setup_state_within_board(km):
    """Sanity check that kernel_manager preserves the kernel_runner guarantee."""
    r = await km.exec_plot(
        "b1",
        plot_code="import numpy as np\nprint(data.sum())",
        setup_code="import numpy as np\ndata = np.arange(10)",
    )
    if r["error"] and "No module named 'numpy'" in r["error"]:
        pytest.skip("numpy not installed in test env")
    assert r["ok"], r
    assert "45" in r["stdout"]  # sum(0..9) = 45


@pytest.mark.anyio
async def test_project_root_import_works_from_nested_board(km, tmp_path):
    """Given a .sdraw file nested inside a Python project, `import <pkg>`
    from setup code must resolve against the project root (found by
    walking up for pyproject.toml), even though the kernel cwd is the
    board file's directory.
    """
    # Build a toy project:
    #   tmp/
    #   ├── pyproject.toml       (project root marker)
    #   ├── mypkg/
    #   │   └── __init__.py      (exports greet())
    #   └── plots/figures/
    #       └── figure.sdraw     (the "board file")
    (tmp_path / "pyproject.toml").write_text("[project]\nname = 'toy'\n")
    pkg = tmp_path / "mypkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("def greet():\n    return 'hello from mypkg'\n")
    board_dir = tmp_path / "plots" / "figures"
    board_dir.mkdir(parents=True)

    r = await km.exec_plot(
        "toy-board",
        plot_code="print(greet())",
        setup_code="from mypkg import greet",
        cwd=str(board_dir),  # deep inside the project
    )
    assert r["ok"], r
    assert "hello from mypkg" in (r["stdout"] or "")

    # cwd tracks the board file's directory; project_root tracks the pyproject ancestor.
    kp = km._kernels["toy-board"]
    assert kp.cwd == str(board_dir.resolve())
    assert kp.project_root == str(tmp_path.resolve())


@pytest.mark.anyio
async def test_relative_file_paths_resolve_against_board_dir(km, tmp_path):
    """A plot that opens a file with a relative path must find that
    file next to the .sdraw, not in the project root. This is the bug
    that originally motivated splitting cwd from project_root.
    """
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    board_dir = tmp_path / "nested" / "board"
    board_dir.mkdir(parents=True)
    # Put a data file next to the "board" but NOT at the project root.
    (board_dir / "local.txt").write_text("hello from next to the board")

    r = await km.exec_plot(
        "rel-board",
        plot_code=(
            "with open('local.txt') as f: print(f.read())"
        ),
        setup_code="",
        cwd=str(board_dir),
    )
    assert r["ok"], r
    assert "hello from next to the board" in (r["stdout"] or "")


@pytest.mark.anyio
async def test_cwd_change_restarts_kernel(km, tmp_path):
    """Opening a board from a different project root should replace
    the kernel, not silently reuse the old cwd."""
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "pyproject.toml").write_text("[project]\nname='a'\n")
    (tmp_path / "b").mkdir()
    (tmp_path / "b" / "pyproject.toml").write_text("[project]\nname='b'\n")

    await km.exec_plot("board", "pass", "", cwd=str(tmp_path / "a"))
    pid_a = km._kernels["board"].proc.pid
    cwd_a = km._kernels["board"].cwd

    await km.exec_plot("board", "pass", "", cwd=str(tmp_path / "b"))
    pid_b = km._kernels["board"].proc.pid
    cwd_b = km._kernels["board"].cwd

    assert pid_a != pid_b
    assert cwd_a != cwd_b


@pytest.mark.anyio
async def test_concurrent_requests_to_same_board_serialize(km):
    """Two concurrent exec_plot calls must produce deterministic results
    (via the per-kernel lock), not interleave their stdout."""
    await km.exec_plot("b1", "pass", "counter = 0")

    async def bump():
        return await km.exec_plot(
            "b1",
            plot_code="counter += 1\nprint(counter)",
            setup_code="counter = 0",
        )

    # NOTE: plots run in isolated namespaces so `counter += 1` won't persist.
    # This test just verifies no interleaving / corruption.
    results = await asyncio.gather(bump(), bump(), bump())
    for r in results:
        assert r["ok"], r
        assert r["stdout"].strip() == "1", (
            "expected plot isolation: each plot sees counter=0"
        )
