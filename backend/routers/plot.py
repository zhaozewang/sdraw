"""Plot execution routes - run Python code and capture plot output."""

import asyncio
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from services.kernel_manager import kernel_manager
from services.python_env import resolve_python as _resolve_python

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plot", tags=["plot"])

# Path to the runner script (sibling of this file's parent)
_RUNNER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "services",
    "plot_runner.py",
)

# Track running subprocesses for cancellation
_running_procs: dict[str, subprocess.Popen] = {}


class ExecutePlotRequest(BaseModel):
    code: str
    timeout: int = 600  # seconds
    dpi: int = 150
    python_path: str | None = None  # None = use default
    execution_id: str | None = None  # for cancellation tracking
    cwd: str | None = None  # working directory for execution
    # Kernel path (Phase 3 wires this up; Phase 2 leaves it dormant):
    board_id: str | None = None
    setup_code: str | None = None
    setup_timeout: int = 120


class FigureCapture(BaseModel):
    """One captured figure from a plot cell. Multi-figure cells return a
    list of these; single-figure cells return a list of length 1. The
    top-level `image_base64` and `plotly_json` on ExecutePlotResponse alias
    the first entry for backwards compatibility."""
    image: str | None = None
    plotly_json: str | None = None


class ExecutePlotResponse(BaseModel):
    success: bool
    image_base64: str | None = None
    stdout: str | None = None
    error: str | None = None
    plotly_json: str | None = None  # interactive plotly figure spec
    # All captured figures, in order (matplotlib first, then plotly).
    # Single-figure cells have len(figures) == 1. Empty on error / no output.
    figures: list[FigureCapture] = []


class ValidateEnvRequest(BaseModel):
    python_path: str


class ValidateEnvResponse(BaseModel):
    valid: bool
    python: str | None = None
    version: str | None = None
    packages: list[str] = []  # available plot packages
    error: str | None = None
    is_default: bool = False


@router.post("/execute", response_model=ExecutePlotResponse)
async def execute_plot(body: ExecutePlotRequest):
    """Execute Python code and capture plot output.

    If `board_id` is set, dispatch through the per-board kernel (setup code
    runs automatically when stale). Otherwise fall back to the legacy
    subprocess-per-execute path.

    NOTE: the kernel path ignores `cwd` and `execution_id`. `cwd` matters
    less because imports resolve via sys.path; cancellation is handled by
    killing the kernel via /api/plot/kernel/restart.
    """
    if body.board_id:
        try:
            resp = await kernel_manager.exec_plot(
                board_id=body.board_id,
                plot_code=body.code,
                setup_code=body.setup_code or "",
                python_path=body.python_path,
                dpi=body.dpi,
                timeout=body.timeout,
                setup_timeout=body.setup_timeout,
                cwd=body.cwd,
            )
        except asyncio.TimeoutError:
            return ExecutePlotResponse(
                success=False,
                error=f"Execution timed out ({body.timeout}s limit).",
            )
        except FileNotFoundError as exc:
            return ExecutePlotResponse(success=False, error=str(exc))
        return _kernel_response_to_execute_response(resp)

    logger.info("execute_plot called with python_path=%r", body.python_path)
    try:
        python = _resolve_python(body.python_path)
        logger.info("Resolved python: %s", python)
    except FileNotFoundError as exc:
        return ExecutePlotResponse(success=False, error=str(exc))

    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, prefix="sdraw_plot_"
    )
    try:
        tmp.write(body.code)
        tmp.close()

        env = {
            **os.environ,
            "SDRAW_PLOT_DPI": str(body.dpi),
        }

        # Determine working directory for the subprocess
        cwd = body.cwd
        if cwd:
            cwd_path = Path(cwd).expanduser()
            if not cwd_path.is_dir():
                cwd = None  # fall back to default

        exec_id = body.execution_id

        def run():
            proc = subprocess.Popen(
                [python, _RUNNER_PATH, tmp.name],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                cwd=cwd,
            )
            if exec_id:
                _running_procs[exec_id] = proc
            try:
                stdout, stderr = proc.communicate(timeout=body.timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                raise
            finally:
                if exec_id:
                    _running_procs.pop(exec_id, None)

            class Result:
                pass
            r = Result()
            r.returncode = proc.returncode
            r.stdout = stdout
            r.stderr = stderr
            return r

        try:
            result = await asyncio.to_thread(run)
        except subprocess.TimeoutExpired:
            return ExecutePlotResponse(
                success=False,
                error=f"Execution timed out ({body.timeout}s limit).",
            )

        # Try to parse JSON from stdout (new format)
        import json as _json
        raw_output = result.stdout.strip()

        if raw_output:
            try:
                parsed = _json.loads(raw_output)
                image_b64 = parsed.get("image")
                stdout_text = parsed.get("stdout", "").strip() or None
                exec_error = parsed.get("error")
                plotly_json = parsed.get("plotly_json")

                # Legacy plot_runner.py produces a single figure; normalize
                # to the same figures[] shape the kernel path returns so the
                # frontend has one code path.
                legacy_figures = (
                    [FigureCapture(image=image_b64, plotly_json=plotly_json)]
                    if (image_b64 or plotly_json)
                    else []
                )

                if exec_error:
                    return ExecutePlotResponse(
                        success=False,
                        image_base64=image_b64,
                        stdout=stdout_text,
                        error=exec_error,
                        plotly_json=plotly_json,
                        figures=legacy_figures,
                    )

                return ExecutePlotResponse(
                    success=True,
                    image_base64=image_b64,
                    stdout=stdout_text,
                    plotly_json=plotly_json,
                    figures=legacy_figures,
                )
            except _json.JSONDecodeError:
                pass

        # Fallback: runner itself crashed (non-JSON output)
        if result.returncode != 0:
            error_msg = result.stderr.strip() or "Unknown error"
            return ExecutePlotResponse(success=False, error=error_msg)

        return ExecutePlotResponse(
            success=False,
            error="No output produced by the script.",
        )

    except Exception as exc:
        logger.error("Plot execution failed: %s", exc)
        return ExecutePlotResponse(success=False, error=str(exc))
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


class AbortRequest(BaseModel):
    execution_id: str


@router.post("/abort")
async def abort_execution(body: AbortRequest):
    """Kill a running plot execution by its execution_id."""
    proc = _running_procs.pop(body.execution_id, None)
    if proc is None:
        return {"aborted": False, "reason": "not_found"}
    try:
        proc.kill()
    except OSError:
        pass
    return {"aborted": True}


class DiscoveredEnv(BaseModel):
    name: str
    path: str  # path to the venv directory or python binary
    source: str  # "venv", "conda", "system", "pyenv"


@router.get("/discover-envs")
async def discover_envs(project_dir: str | None = None):
    """Scan for Python environments.

    Discovery methods:
    1. `conda info --envs` — most reliable for conda
    2. `pyenv versions` — most reliable for pyenv
    3. Search for pyvenv.cfg in the project directory only
    4. Common PATH pythons — system interpreters
    """

    def _scan():
        envs: list[dict] = []
        seen: set[str] = set()
        home = Path.home()
        is_win = sys.platform == "win32"
        bin_dir = "Scripts" if is_win else "bin"
        py_name = "python.exe" if is_win else "python"

        def _add(name: str, venv_path: str, source: str):
            rp = str(Path(venv_path).resolve())
            if rp in seen:
                return
            # Verify python actually exists
            pp = Path(rp)
            python = pp / bin_dir / py_name
            if not python.exists():
                python = pp / bin_dir / "python3"
            if not python.exists():
                # Maybe it's a direct python binary path
                if pp.is_file():
                    seen.add(rp)
                    envs.append({"name": name, "path": rp, "source": source})
                return
            seen.add(rp)
            envs.append({"name": name, "path": rp, "source": source})

        # 1. Conda: use `conda info --envs` (parses the actual output)
        try:
            result = subprocess.run(
                ["conda", "info", "--envs"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split()
                    if len(parts) >= 2:
                        env_path = parts[-1]
                        env_name = parts[0]
                        if Path(env_path).is_dir():
                            _add(env_name, env_path, "conda")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            for conda_root_name in [
                "anaconda3", "miniconda3", "miniforge3", "mambaforge",
            ]:
                envs_dir = home / conda_root_name / "envs"
                if envs_dir.is_dir():
                    for child in envs_dir.iterdir():
                        if child.is_dir():
                            _add(child.name, str(child), "conda")
                    base = home / conda_root_name
                    _add(f"{conda_root_name} (base)", str(base), "conda")

        # 2. Pyenv: use `pyenv versions --bare`
        try:
            result = subprocess.run(
                ["pyenv", "versions", "--bare"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                pyenv_root = home / ".pyenv" / "versions"
                pr = os.environ.get("PYENV_ROOT")
                if pr:
                    pyenv_root = Path(pr) / "versions"
                for line in result.stdout.splitlines():
                    ver = line.strip()
                    if ver:
                        ver_path = pyenv_root / ver
                        if ver_path.is_dir():
                            _add(f"pyenv {ver}", str(ver_path), "pyenv")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            for pyenv_root in [home / ".pyenv" / "versions"]:
                if pyenv_root.is_dir():
                    for child in pyenv_root.iterdir():
                        if child.is_dir() and not child.is_symlink():
                            _add(f"pyenv {child.name}", str(child), "pyenv")

        # 3. Find venvs only in the project directory (where .sdraw file lives)
        if project_dir:
            proj = Path(project_dir).resolve()
            if proj.is_dir():
                skip_dirs = {
                    ".cache", "node_modules", ".git", "__pycache__",
                    ".tox", ".nox", "site-packages",
                }

                def _walk_for_pyvenv(root: Path, max_depth: int):
                    if max_depth <= 0:
                        return
                    try:
                        for entry in root.iterdir():
                            if entry.name in skip_dirs:
                                continue
                            if entry.is_dir() and not entry.is_symlink():
                                cfg = entry / "pyvenv.cfg"
                                if cfg.is_file():
                                    name = (
                                        entry.parent.name
                                        if entry.name in ("venv", ".venv", "env", ".env")
                                        else entry.name
                                    )
                                    _add(name, str(entry), "venv")
                                else:
                                    _walk_for_pyvenv(entry, max_depth - 1)
                    except PermissionError:
                        pass

                _walk_for_pyvenv(proj, 3)

        # 4. System pythons from PATH
        path_dirs = os.environ.get("PATH", "").split(os.pathsep)
        for d in path_dirs:
            dp = Path(d)
            if not dp.is_dir():
                continue
            for name in ["python3", "python"]:
                binary = dp / name
                if binary.is_file() and str(binary.resolve()) not in seen:
                    seen.add(str(binary.resolve()))
                    try:
                        ver = subprocess.run(
                            [str(binary), "--version"],
                            capture_output=True, text=True, timeout=5,
                        )
                        ver_str = ver.stdout.strip().replace("Python ", "")
                    except Exception:
                        ver_str = ""
                    label = f"Python {ver_str}" if ver_str else name
                    envs.append({
                        "name": label,
                        "path": str(binary.resolve()),
                        "source": "system",
                    })

        # Sort: conda first, then venv, pyenv, system
        source_order = {"conda": 0, "venv": 1, "pyenv": 2, "system": 3}
        envs.sort(key=lambda e: (source_order.get(e["source"], 9), e["name"].lower()))
        return envs

    envs = await asyncio.to_thread(_scan)
    return {"environments": envs}


@router.get("/default-env", response_model=ValidateEnvResponse)
async def get_default_env():
    """Return info about the default (built-in) Python environment."""
    return await _check_python(sys.executable, is_default=True)


@router.post("/validate-env", response_model=ValidateEnvResponse)
async def validate_env(body: ValidateEnvRequest):
    """Validate a user-provided Python path and list available plot packages."""
    try:
        python = _resolve_python(body.python_path)
    except FileNotFoundError as exc:
        return ValidateEnvResponse(valid=False, error=str(exc))
    return await _check_python(python, is_default=False)


async def _check_python(python: str, is_default: bool) -> ValidateEnvResponse:
    """Check a Python interpreter: version and available plot packages."""
    check_script = (
        "import sys, json; pkgs = [];\n"
        "try:\n import matplotlib; pkgs.append('matplotlib ' + matplotlib.__version__)\n"
        "except: pass\n"
        "try:\n import plotly; pkgs.append('plotly ' + plotly.__version__)\n"
        "except: pass\n"
        "try:\n import numpy; pkgs.append('numpy ' + numpy.__version__)\n"
        "except: pass\n"
        "print(json.dumps({'version': sys.version.split()[0], 'packages': pkgs}))"
    )

    def run():
        return subprocess.run(
            [python, "-c", check_script],
            capture_output=True,
            text=True,
            timeout=10,
        )

    try:
        result = await asyncio.to_thread(run)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return ValidateEnvResponse(valid=False, error=str(exc))

    if result.returncode != 0:
        return ValidateEnvResponse(
            valid=False, error=result.stderr.strip() or "Failed to run Python"
        )

    try:
        import json
        info = json.loads(result.stdout.strip())
        return ValidateEnvResponse(
            valid=True,
            python=python,
            version=info["version"],
            packages=info["packages"],
            is_default=is_default,
        )
    except Exception:
        return ValidateEnvResponse(valid=False, error="Could not parse Python output")


# ---- Per-board kernel routes --------------------------------------------------


class KernelExecuteRequest(BaseModel):
    board_id: str
    plot_code: str
    setup_code: str = ""
    python_path: str | None = None
    dpi: int = 150
    timeout: int = 600
    setup_timeout: int = 120
    cwd: str | None = None


class KernelSetupRequest(BaseModel):
    board_id: str
    setup_code: str
    python_path: str | None = None
    dpi: int = 150
    timeout: int = 120
    cwd: str | None = None


class KernelLifecycleRequest(BaseModel):
    board_id: str


class KernelStatusResponse(BaseModel):
    running: bool
    last_setup_hash: str | None
    python_path: str | None
    recent_stderr: list[str]


def _kernel_response_to_execute_response(resp: dict) -> ExecutePlotResponse:
    raw_figures = resp.get("figures") or []
    figures = [
        FigureCapture(image=f.get("image"), plotly_json=f.get("plotly_json"))
        for f in raw_figures
    ]
    return ExecutePlotResponse(
        success=bool(resp.get("ok")),
        image_base64=resp.get("image"),
        stdout=(resp.get("stdout") or None),
        error=resp.get("error"),
        plotly_json=resp.get("plotly_json"),
        figures=figures,
    )


@router.post("/kernel/execute", response_model=ExecutePlotResponse)
async def kernel_execute(body: KernelExecuteRequest):
    """Run a plot cell inside the given board's kernel. Auto-runs setup
    if the setup hash has changed since the last successful run.
    """
    try:
        resp = await kernel_manager.exec_plot(
            board_id=body.board_id,
            plot_code=body.plot_code,
            setup_code=body.setup_code or "",
            python_path=body.python_path,
            dpi=body.dpi,
            timeout=body.timeout,
            setup_timeout=body.setup_timeout,
            cwd=body.cwd,
        )
    except asyncio.TimeoutError:
        return ExecutePlotResponse(
            success=False,
            error=f"Execution timed out ({body.timeout}s limit).",
        )
    except FileNotFoundError as exc:
        return ExecutePlotResponse(success=False, error=str(exc))
    return _kernel_response_to_execute_response(resp)


@router.post("/kernel/setup", response_model=ExecutePlotResponse)
async def kernel_setup(body: KernelSetupRequest):
    """Run setup code explicitly in the given board's kernel."""
    try:
        resp = await kernel_manager.exec_setup(
            board_id=body.board_id,
            setup_code=body.setup_code,
            python_path=body.python_path,
            dpi=body.dpi,
            timeout=body.timeout,
            cwd=body.cwd,
        )
    except asyncio.TimeoutError:
        return ExecutePlotResponse(
            success=False,
            error=f"Setup timed out ({body.timeout}s limit).",
        )
    except FileNotFoundError as exc:
        return ExecutePlotResponse(success=False, error=str(exc))
    return _kernel_response_to_execute_response(resp)


@router.post("/kernel/restart")
async def kernel_restart(body: KernelLifecycleRequest):
    await kernel_manager.restart(body.board_id)
    return {"restarted": True, "board_id": body.board_id}


class KernelReloadResponse(BaseModel):
    ok: bool
    reloaded: list[str]
    errors: list[dict]
    rebound: int
    kernel_running: bool


@router.post("/kernel/reload-modules", response_model=KernelReloadResponse)
async def kernel_reload_modules(body: KernelLifecycleRequest):
    """Force-reload project-local modules in the board's kernel and
    rebind references in the setup namespace and in every other
    project module. ``rebound`` is the count of names that pointed at
    an old object and were patched to point at the freshly-loaded one —
    the signal that `from X import Y` style bindings were successfully
    fixed up.

    Automatic reload also runs before every exec_plot; this endpoint is
    the manual override for when mtime-based detection misses an edit.
    """
    resp = await kernel_manager.reload_modules(body.board_id)
    return KernelReloadResponse(
        ok=bool(resp.get("ok")),
        reloaded=list(resp.get("reloaded") or []),
        errors=list(resp.get("errors") or []),
        rebound=int(resp.get("rebound", 0)),
        kernel_running=bool(resp.get("kernel_running", False)),
    )


@router.post("/kernel/shutdown")
async def kernel_shutdown(body: KernelLifecycleRequest):
    await kernel_manager.shutdown(body.board_id)
    return {"shutdown": True, "board_id": body.board_id}


@router.get("/kernel/status", response_model=KernelStatusResponse)
async def kernel_status(board_id: str):
    return KernelStatusResponse(**kernel_manager.status(board_id))
