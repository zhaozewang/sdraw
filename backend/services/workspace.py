"""Workspace service for managing boards and file access."""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from models.board import Board, WorkspaceConfig

logger = logging.getLogger(__name__)


class WorkspaceService:
    """Manages the workspace directory, board persistence, and file access control."""

    def __init__(self, workspace_path: str = "../workspace") -> None:
        self.workspace_path = Path(workspace_path).resolve()
        self.boards_dir = self.workspace_path / "boards"
        self.cache_dir = self.workspace_path / "cache"
        self.exports_dir = self.workspace_path / "exports"
        self.config_path = self.workspace_path / "config.json"
        self.config = WorkspaceConfig()

    def ensure_dirs(self) -> None:
        """Create workspace subdirectories if they don't exist."""
        for d in (self.boards_dir, self.cache_dir, self.exports_dir):
            d.mkdir(parents=True, exist_ok=True)
        logger.info("Workspace directories ensured at %s", self.workspace_path)

    def load_config(self) -> WorkspaceConfig:
        """Load workspace config from disk, creating defaults if missing."""
        if self.config_path.exists():
            try:
                data = json.loads(self.config_path.read_text(encoding="utf-8"))
                self.config = WorkspaceConfig(**data)
            except (json.JSONDecodeError, Exception) as exc:
                logger.warning("Failed to load config, using defaults: %s", exc)
                self.config = WorkspaceConfig()
        else:
            self.config = WorkspaceConfig()
            self.save_config()
        return self.config

    def save_config(self) -> None:
        """Persist workspace config to disk."""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(
            json.dumps(self.config.model_dump(), indent=2),
            encoding="utf-8",
        )

    def list_boards(self) -> list[dict[str, Any]]:
        """Return summary info for every board in the workspace."""
        summaries: list[dict[str, Any]] = []
        if not self.boards_dir.exists():
            return summaries
        for p in sorted(self.boards_dir.glob("*.sdraw"), key=lambda f: f.stat().st_mtime, reverse=True):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                elements = data.get("elements", [])
                image_count = sum(1 for e in elements if e.get("type") == "image")
                summaries.append(
                    {
                        "id": data.get("id", p.stem),
                        "name": data.get("name", "Untitled"),
                        "updated_at": data.get("updated_at", ""),
                        "path": str(p),
                        "element_count": len(elements),
                        "image_count": image_count,
                        "canvas": data.get("canvas", {}),
                        "thumbnail": data.get("thumbnail"),
                    }
                )
            except (json.JSONDecodeError, Exception) as exc:
                logger.warning("Skipping invalid board file %s: %s", p, exc)
        return summaries

    def load_board(self, board_id: str) -> Board | None:
        """Load a single board by ID. Returns None if not found."""
        board_path = self.boards_dir / f"{board_id}.sdraw"
        if not board_path.exists():
            return None
        try:
            data = json.loads(board_path.read_text(encoding="utf-8"))
            return Board(**data)
        except (json.JSONDecodeError, Exception) as exc:
            logger.error("Failed to load board %s: %s", board_id, exc)
            return None

    def save_board(self, board: Board) -> Board:
        """Save a board to disk, updating the updated_at timestamp."""
        board.updated_at = datetime.now(timezone.utc).isoformat()
        board_path = self.boards_dir / f"{board.id}.sdraw"
        board_path.write_text(
            json.dumps(board.model_dump(), indent=2),
            encoding="utf-8",
        )
        # Track in recent boards
        if board.id in self.config.recent_boards:
            self.config.recent_boards.remove(board.id)
        self.config.recent_boards.insert(0, board.id)
        self.config.recent_boards = self.config.recent_boards[:20]
        self.save_config()
        return board

    def delete_board(self, board_id: str) -> bool:
        """Remove a board file. Returns True if deleted, False if not found."""
        board_path = self.boards_dir / f"{board_id}.sdraw"
        if not board_path.exists():
            return False
        board_path.unlink()
        if board_id in self.config.recent_boards:
            self.config.recent_boards.remove(board_id)
            self.save_config()
        return True

    def get_image_path(self, path: str) -> Path | None:
        """Validate and resolve an image path, checking it's within allowed roots.

        Returns the resolved Path or None if invalid / disallowed.
        """
        try:
            resolved = Path(path).resolve()
        except (ValueError, OSError):
            return None

        if not resolved.exists() or not resolved.is_file():
            return None

        # Check against allowed roots
        for root in self.config.allowed_roots:
            root_resolved = Path(root).resolve()
            try:
                resolved.relative_to(root_resolved)
                return resolved
            except ValueError:
                continue

        return None

    def is_path_allowed(self, path: Path) -> bool:
        """Check whether a resolved path falls under any allowed root."""
        resolved = path.resolve()
        for root in self.config.allowed_roots:
            root_resolved = Path(root).resolve()
            try:
                resolved.relative_to(root_resolved)
                return True
            except ValueError:
                continue
        return False

    def add_allowed_root(self, path: str) -> None:
        """Add a directory to the allowed roots list if not already present."""
        resolved = str(Path(path).resolve())
        if resolved not in self.config.allowed_roots:
            self.config.allowed_roots.append(resolved)
            self.save_config()
            logger.info("Added allowed root: %s", resolved)
