"""Python interpreter resolution shared between the plot router and the
kernel manager. Extracted so both can import without circular dependencies.
"""

from __future__ import annotations

import sys
from pathlib import Path


def resolve_python(python_path: str | None) -> str:
    """Resolve a user-facing python path into a concrete interpreter.

    - None / "" / "default"     → the backend's own interpreter (sys.executable)
    - path to a venv directory  → the python inside it
    - direct path to a binary   → used as-is

    We deliberately do NOT follow symlinks: venv pythons are typically
    symlinks into the system interpreter, but invoking them through the
    symlink path is what activates the venv's site-packages.
    """
    if not python_path or python_path == "default":
        return sys.executable

    p = Path(python_path).expanduser()

    if p.is_dir():
        for candidate in [
            p / "bin" / "python3",
            p / "bin" / "python",
            p / "Scripts" / "python.exe",
            p / "Scripts" / "python3.exe",
        ]:
            if candidate.exists():
                return str(candidate)
        raise FileNotFoundError(f"No python found in venv: {p}")

    if p.exists():
        return str(p)

    raise FileNotFoundError(f"Python not found: {p}")
