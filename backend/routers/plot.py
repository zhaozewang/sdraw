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


def _resolve_python(python_path: str | None) -> str:
    """Resolve the Python executable to use.

    - None or empty or "default" → the backend's own interpreter (sys.executable)
    - A path to a venv directory → find the python inside it
    - A direct path to a python binary → use as-is

    NOTE: We do NOT resolve() symlinks because venv python binaries are
    typically symlinks to system python, but they still activate the venv's
    site-packages when invoked via the symlink path.
    """
    if not python_path or python_path == "default":
        return sys.executable

    p = Path(python_path).expanduser()

    # If user gave a venv directory, find the python inside
    if p.is_dir():
        # Unix: venv/bin/python, Windows: venv/Scripts/python.exe
        for candidate in [
            p / "bin" / "python3",
            p / "bin" / "python",
            p / "Scripts" / "python.exe",
            p / "Scripts" / "python3.exe",
        ]:
            if candidate.exists():
                return str(candidate)
        raise FileNotFoundError(f"No python found in venv: {p}")

    # Direct path to a binary (don't resolve symlinks!)
    if p.exists():
        return str(p)

    raise FileNotFoundError(f"Python not found: {p}")


class ExecutePlotRequest(BaseModel):
    code: str
    timeout: int = 30  # seconds
    dpi: int = 150
    python_path: str | None = None  # None = use default
    execution_id: str | None = None  # for cancellation tracking


class ExecutePlotResponse(BaseModel):
    success: bool
    image_base64: str | None = None
    stdout: str | None = None
    error: str | None = None


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
    """Execute Python code in a subprocess and capture plot output."""
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

        exec_id = body.execution_id

        def run():
            proc = subprocess.Popen(
                [python, _RUNNER_PATH, tmp.name],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
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

        if result.returncode != 0:
            error_msg = result.stderr.strip() or "Unknown error"
            return ExecutePlotResponse(success=False, error=error_msg)

        raw_output = result.stdout.strip()
        if not raw_output:
            return ExecutePlotResponse(
                success=False,
                error="No output produced by the script.",
            )

        # Parse JSON output from plot_runner
        import json as _json
        try:
            parsed = _json.loads(raw_output)
        except _json.JSONDecodeError:
            # Fallback: treat as raw base64 image (backward compat)
            return ExecutePlotResponse(success=True, image_base64=raw_output)

        image_b64 = parsed.get("image")
        stdout_text = parsed.get("stdout", "").strip() or None

        return ExecutePlotResponse(
            success=True,
            image_base64=image_b64,
            stdout=stdout_text,
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
