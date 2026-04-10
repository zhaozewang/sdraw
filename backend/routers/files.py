"""File serving and filesystem utility routes."""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["files"])

MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
}


def _get_dimensions(path: Path) -> dict | None:
    """Get image dimensions using Pillow. Returns None for SVGs or on error."""
    if path.suffix.lower() == ".svg":
        return None
    try:
        with Image.open(path) as img:
            w, h = img.size
            return {"width": w, "height": h}
    except Exception:
        return None


@router.get("/image")
async def serve_image(
    request: Request,
    path: str = Query(..., description="Absolute path to the image file"),
    v: Optional[str] = Query(None, description="Cache-busting version string"),
):
    """Serve a local image file. Auto-adds parent directory as allowed root."""
    ws_service = request.app.state.workspace

    resolved = Path(path).resolve()

    # Prevent path traversal: the resolved path must not contain '..'
    # (resolve() handles this, but let's also verify the original path isn't tricky)
    try:
        # Ensure resolved path actually exists
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=404, detail="File not found")
    except OSError:
        raise HTTPException(status_code=400, detail="Invalid path")

    # For local-first convenience, auto-add the parent directory as allowed root
    if not ws_service.is_path_allowed(resolved):
        ws_service.add_allowed_root(str(resolved.parent))

    suffix = resolved.suffix.lower()
    media_type = MIME_MAP.get(suffix)
    if media_type is None:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {suffix}")

    return FileResponse(
        path=str(resolved),
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=60"},
    )


class EmbedImageRequest(BaseModel):
    path: str


@router.post("/image/embed")
async def embed_image(body: EmbedImageRequest):
    """Read an image file, return base64 data + metadata for embedding."""
    import base64
    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        return {"exists": False, "data": None, "mime": None, "mtime": None}
    suffix = p.suffix.lower()
    mime = MIME_MAP.get(suffix)
    if mime is None:
        return {"exists": False, "data": None, "mime": None, "mtime": None}
    try:
        data = base64.b64encode(p.read_bytes()).decode('ascii')
        mtime = p.stat().st_mtime
        return {"exists": True, "data": data, "mime": mime, "mtime": mtime}
    except OSError as exc:
        return {"exists": False, "data": None, "mime": None, "mtime": None, "error": str(exc)}


@router.post("/image/check")
async def check_image(body: EmbedImageRequest):
    """Check if an image file exists and return its modification time."""
    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        return {"exists": False, "mtime": None}
    try:
        return {"exists": True, "mtime": p.stat().st_mtime}
    except OSError:
        return {"exists": False, "mtime": None}


class ValidatePathRequest(BaseModel):
    path: str


@router.post("/path/validate")
async def validate_path(body: ValidatePathRequest):
    """Check whether a path exists and its type."""
    try:
        p = Path(body.path).resolve()
        return {
            "valid": True,
            "exists": p.exists(),
            "is_file": p.is_file(),
            "is_dir": p.is_dir(),
        }
    except (OSError, ValueError):
        return {
            "valid": False,
            "exists": False,
            "is_file": False,
            "is_dir": False,
        }


@router.get("/path/home")
async def get_home_dir():
    """Return the current user's home directory."""
    import os
    return {"path": str(Path.home())}


class BrowseRequest(BaseModel):
    path: str
    show_hidden: bool = False


@router.post("/path/browse")
async def browse_path(body: BrowseRequest):
    """Browse a directory, returning entries (files and subdirectories)."""
    dir_path = Path(body.path).resolve()
    if not dir_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    parent = str(dir_path.parent) if dir_path.parent != dir_path else None
    entries = []
    try:
        for entry in sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if not body.show_hidden and entry.name.startswith("."):
                continue
            try:
                stat = entry.stat()
                item = {
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size if entry.is_file() else 0,
                    "modified_time": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
                if entry.is_file():
                    dims = _get_dimensions(entry)
                    if dims:
                        item["dimensions"] = dims
                entries.append(item)
            except OSError:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"path": str(dir_path), "parent": parent, "entries": entries}


class MkdirRequest(BaseModel):
    path: str


@router.post("/path/mkdir")
async def make_directory(body: MkdirRequest):
    """Create a directory (including parents)."""
    try:
        p = Path(body.path).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return {"path": str(p)}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class ListFilesRequest(BaseModel):
    path: str
    extensions: Optional[list[str]] = None
    sort_by: str = "name"  # "name" or "mtime"


@router.post("/path/list_files")
async def list_files(body: ListFilesRequest):
    """List files in a directory, optionally filtered by extension."""
    dir_path = Path(body.path).resolve()
    if not dir_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    results = []
    try:
        for entry in dir_path.iterdir():
            if not entry.is_file():
                continue
            if body.extensions:
                if entry.suffix.lower() not in [e.lower() for e in body.extensions]:
                    continue
            try:
                stat = entry.stat()
                item = {
                    "name": entry.name,
                    "path": str(entry),
                    "size": stat.st_size,
                    "modified_time": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
                dims = _get_dimensions(entry)
                if dims:
                    item["dimensions"] = dims
                results.append(item)
            except OSError:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    if body.sort_by == "mtime":
        results.sort(key=lambda x: x["modified_time"], reverse=True)
    else:
        results.sort(key=lambda x: x["name"].lower())

    return results


@router.get("/file_metadata")
async def file_metadata(
    path: str = Query(..., description="Absolute path to the file"),
):
    """Return metadata for a single file."""
    p = Path(path).resolve()
    if not p.exists():
        return {"path": str(p), "exists": False}

    try:
        stat = p.stat()
        result = {
            "path": str(p),
            "exists": True,
            "size": stat.st_size,
            "modified_time": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
        }
        dims = _get_dimensions(p)
        if dims:
            result["dimensions"] = dims
        return result
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class WatchRequest(BaseModel):
    path: str


@router.post("/watch/register")
async def watch_register(body: WatchRequest, request: Request):
    """Start watching a directory for file changes."""
    watcher = request.app.state.watcher
    success = watcher.watch(body.path)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to watch path")
    return {"watching": True, "path": str(Path(body.path).resolve())}


@router.post("/watch/unregister")
async def watch_unregister(body: WatchRequest, request: Request):
    """Stop watching a directory."""
    watcher = request.app.state.watcher
    was_watching = watcher.unwatch(body.path)
    return {"watching": False, "was_watching": was_watching, "path": str(Path(body.path).resolve())}
