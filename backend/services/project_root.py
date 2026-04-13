"""Resolve a Python project root from a file path.

When the user edits `my_project/plots/nice_figure.sdraw` and writes
`import my_project_utils` in their setup code, we want that import to
just work — even though the .sdraw file sits several directories below
the actual package root.

We mimic pytest's rootdir detection: walk upward from the starting
directory looking for markers that suggest "this is the top of a Python
project", and stop at the first match. If nothing is found we fall back
to the starting directory itself.
"""

from __future__ import annotations

from pathlib import Path

_ROOT_MARKERS = (
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    ".git",
)

# Don't climb past these; prevents /home/$USER or / from getting picked up
# when a stray marker exists at filesystem boundaries.
_MAX_DEPTH = 8


def find_project_root(start: str | Path) -> str:
    """Walk upward from `start` looking for a project-root marker.

    Returns the first ancestor directory containing any of `_ROOT_MARKERS`.
    If nothing is found within `_MAX_DEPTH` levels, returns `start` itself.

    `start` may be a file or directory. If it doesn't exist on disk, we
    still try to walk its logical path (useful when the frontend sends a
    cwd for a file that was just created).
    """
    p = Path(start).expanduser()
    if p.is_file():
        p = p.parent

    try:
        p = p.resolve()
    except OSError:
        pass

    current = p
    for _ in range(_MAX_DEPTH):
        if any((current / marker).exists() for marker in _ROOT_MARKERS):
            return str(current)
        if current.parent == current:
            break  # hit filesystem root
        current = current.parent

    return str(p)
