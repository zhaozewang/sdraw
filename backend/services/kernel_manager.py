"""Per-board Python kernel pool.

Wraps `kernel_runner.py` subprocesses, one per open board. Provides a
serialized, async-friendly interface for the REST layer:

    await kernel_manager.exec_plot(board_id, plot_code, setup_code, ...)
    await kernel_manager.exec_setup(board_id, setup_code, ...)
    await kernel_manager.restart(board_id)
    await kernel_manager.shutdown(board_id)
    await kernel_manager.shutdown_all()
    kernel_manager.status(board_id) -> dict

Key semantics:

- **One kernel per board**, tracked in `_kernels[board_id]`.
- **Request serialization**: each kernel has its own `asyncio.Lock`.
  Multiple concurrent requests to the same board queue; different boards
  run concurrently.
- **Staleness**: `exec_plot` computes sha1 of the supplied `setup_code`.
  If it differs from `last_setup_hash`, the manager runs setup first,
  then the plot, inside the same lock acquisition. If setup fails, the
  plot is skipped and the response's `error` field is prefixed with
  "Setup failed:\\n".
- **Python env change**: if `exec_*` is called with a python_path that
  differs from the running kernel's, the kernel is killed and restarted
  with the new interpreter. Old state is lost.
- **Crash recovery**: if the child process has exited between requests,
  the next call auto-restarts it. The caller sees normal latency on the
  next run (plus a re-run of setup if needed).
- **Cancellation**: not supported as a soft interrupt in v1. Use
  `restart()` to kill the process; in-flight requests see a cancellation
  error.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections import deque
from typing import Any

from services.project_root import find_project_root
from services.python_env import resolve_python

logger = logging.getLogger(__name__)

_RUNNER_PATH = str(
    (__import__("pathlib").Path(__file__).resolve().parent / "kernel_runner.py")
)

_HEADER_LEN = 8
_STDERR_TAIL = 20  # keep last N lines per kernel for status reporting


def _hash_code(code: str) -> str:
    return hashlib.sha1(code.encode("utf-8")).hexdigest()


async def _read_frame(reader: asyncio.StreamReader) -> dict[str, Any]:
    header = await reader.readexactly(_HEADER_LEN)
    length = int(header.decode("ascii"))
    payload = await reader.readexactly(length)
    # Trailing newline (cosmetic); tolerate its absence on EOF.
    try:
        nl = await reader.readexactly(1)
        if nl != b"\n":
            raise ValueError(f"expected newline after frame, got {nl!r}")
    except asyncio.IncompleteReadError:
        pass
    return json.loads(payload.decode("utf-8"))


async def _write_frame(writer: asyncio.StreamWriter, obj: dict[str, Any]) -> None:
    payload = json.dumps(obj).encode("utf-8")
    writer.write(f"{len(payload):0{_HEADER_LEN}d}".encode("ascii"))
    writer.write(payload)
    writer.write(b"\n")
    await writer.drain()


class KernelProcess:
    """A single long-lived kernel subprocess bound to one board."""

    def __init__(
        self,
        board_id: str,
        python_path: str,
        cwd: str | None,
        project_root: str | None,
    ) -> None:
        self.board_id = board_id
        self.python_path = python_path    # resolved absolute path
        self.cwd = cwd                    # the board file's directory (or None)
        self.project_root = project_root  # nearest pyproject/setup/.git ancestor (or None)
        self.proc: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.last_setup_hash: str | None = None
        self.stderr_tail: deque[str] = deque(maxlen=_STDERR_TAIL)
        self._stderr_task: asyncio.Task[None] | None = None

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self) -> None:
        import os as _os
        logger.info(
            "kernel[%s]: starting (python=%s, cwd=%s, project_root=%s)",
            self.board_id, self.python_path, self.cwd, self.project_root,
        )
        env = {**_os.environ}
        if self.project_root:
            env["SDRAW_PROJECT_ROOT"] = self.project_root
        self.proc = await asyncio.create_subprocess_exec(
            self.python_path,
            _RUNNER_PATH,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.cwd,
            env=env,
        )
        self.last_setup_hash = None
        self.stderr_tail.clear()
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        assert self.proc is not None
        assert self.proc.stderr is not None
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    return
                self.stderr_tail.append(line.decode("utf-8", "replace").rstrip())
        except Exception:
            return

    async def request(self, msg: dict[str, Any], timeout: float) -> dict[str, Any]:
        """Send one frame, read one frame. Caller must hold self.lock."""
        if not self.alive:
            await self.start()
        assert self.proc is not None
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None

        try:
            await _write_frame(self.proc.stdin, msg)
            return await asyncio.wait_for(
                _read_frame(self.proc.stdout), timeout=timeout
            )
        except asyncio.TimeoutError:
            await self.kill()
            raise
        except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
            # Kernel died mid-request. Surface as a structured error;
            # next call will auto-restart.
            await self.kill()
            return {
                "ok": False,
                "stdout": "",
                "error": "kernel process died unexpectedly",
                "image": None,
                "plotly_json": None,
            }

    async def kill(self) -> None:
        if self.proc is None:
            return
        if self.proc.returncode is None:
            try:
                # Try graceful shutdown first
                if self.proc.stdin is not None and not self.proc.stdin.is_closing():
                    try:
                        await _write_frame(self.proc.stdin, {"op": "shutdown"})
                        self.proc.stdin.close()
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                try:
                    await asyncio.wait_for(self.proc.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    self.proc.kill()
                    await self.proc.wait()
            except Exception as exc:
                logger.warning("kernel[%s]: kill error: %s", self.board_id, exc)
        if self._stderr_task is not None:
            self._stderr_task.cancel()
            try:
                await self._stderr_task
            except (asyncio.CancelledError, Exception):
                pass
        self.proc = None
        self.last_setup_hash = None


class KernelManager:
    def __init__(self) -> None:
        self._kernels: dict[str, KernelProcess] = {}
        self._dict_lock = asyncio.Lock()

    async def _get_or_start(
        self,
        board_id: str,
        python_path: str | None,
        cwd: str | None,
    ) -> KernelProcess:
        resolved = resolve_python(python_path)
        # Kernel cwd = the board file's directory (traditional Python
        # "relative paths resolve against the file's location" behavior).
        # Project root = nearest ancestor with pyproject/setup/.git, added
        # to sys.path inside the runner so `import <package>` works even
        # when the package lives several directories above the .sdraw file.
        from pathlib import Path
        resolved_cwd = str(Path(cwd).expanduser().resolve()) if cwd else None
        resolved_root = find_project_root(cwd) if cwd else None
        async with self._dict_lock:
            existing = self._kernels.get(board_id)
            # Restart if missing, dead, python env changed, cwd changed,
            # or resolved project root changed.
            if (
                existing is None
                or not existing.alive
                or existing.python_path != resolved
                or existing.cwd != resolved_cwd
                or existing.project_root != resolved_root
            ):
                if existing is not None:
                    await existing.kill()
                kp = KernelProcess(board_id, resolved, resolved_cwd, resolved_root)
                await kp.start()
                self._kernels[board_id] = kp
                return kp
            return existing

    async def exec_setup(
        self,
        board_id: str,
        setup_code: str,
        python_path: str | None = None,
        dpi: int = 150,
        timeout: float = 120.0,
        cwd: str | None = None,
    ) -> dict[str, Any]:
        kp = await self._get_or_start(board_id, python_path, cwd)
        async with kp.lock:
            resp = await kp.request(
                {"op": "exec_setup", "code": setup_code, "dpi": dpi},
                timeout=timeout,
            )
            if resp.get("ok"):
                kp.last_setup_hash = _hash_code(setup_code)
            return resp

    async def exec_plot(
        self,
        board_id: str,
        plot_code: str,
        setup_code: str,
        python_path: str | None = None,
        dpi: int = 150,
        timeout: float = 30.0,
        setup_timeout: float = 120.0,
        cwd: str | None = None,
    ) -> dict[str, Any]:
        kp = await self._get_or_start(board_id, python_path, cwd)
        async with kp.lock:
            desired_hash = _hash_code(setup_code) if setup_code else None

            # Run setup if the code is non-empty AND we haven't run this
            # exact setup in this kernel yet.
            if setup_code and desired_hash != kp.last_setup_hash:
                setup_resp = await kp.request(
                    {"op": "exec_setup", "code": setup_code, "dpi": dpi},
                    timeout=setup_timeout,
                )
                if not setup_resp.get("ok"):
                    err = setup_resp.get("error") or "unknown error"
                    return {
                        "ok": False,
                        "stdout": setup_resp.get("stdout") or "",
                        "error": f"Setup failed:\n{err}",
                        "image": None,
                        "plotly_json": None,
                    }
                kp.last_setup_hash = desired_hash

            return await kp.request(
                {"op": "exec_plot", "code": plot_code, "dpi": dpi},
                timeout=timeout,
            )

    async def restart(self, board_id: str) -> None:
        async with self._dict_lock:
            kp = self._kernels.get(board_id)
            if kp is not None:
                await kp.kill()
                self._kernels.pop(board_id, None)

    async def shutdown(self, board_id: str) -> None:
        await self.restart(board_id)

    async def shutdown_all(self) -> None:
        async with self._dict_lock:
            kernels = list(self._kernels.values())
            self._kernels.clear()
        for kp in kernels:
            try:
                await kp.kill()
            except Exception as exc:
                logger.warning("kernel[%s]: shutdown error: %s", kp.board_id, exc)

    def status(self, board_id: str) -> dict[str, Any]:
        kp = self._kernels.get(board_id)
        if kp is None or not kp.alive:
            return {
                "running": False,
                "last_setup_hash": None,
                "python_path": None,
                "recent_stderr": [],
            }
        return {
            "running": True,
            "last_setup_hash": kp.last_setup_hash,
            "python_path": kp.python_path,
            "recent_stderr": list(kp.stderr_tail),
        }


kernel_manager = KernelManager()
