"""Board CRUD API routes."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from models.board import Board

router = APIRouter(prefix="/api/boards", tags=["boards"])


class CreateBoardRequest(BaseModel):
    name: str = "Untitled Board"


@router.get("/")
async def list_boards(request: Request):
    """Return summary list of all boards."""
    ws_service = request.app.state.workspace
    return ws_service.list_boards()


@router.post("/", status_code=201)
async def create_board(body: CreateBoardRequest, request: Request):
    """Create a new board with a generated UUID."""
    ws_service = request.app.state.workspace
    board = Board(name=body.name)
    saved = ws_service.save_board(board)
    return saved.model_dump()


@router.get("/{board_id}")
async def get_board(board_id: str, request: Request):
    """Get a single board by ID."""
    ws_service = request.app.state.workspace
    board = ws_service.load_board(board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return board.model_dump()


@router.put("/{board_id}")
async def update_board(board_id: str, board: Board, request: Request):
    """Update an existing board (full replacement)."""
    ws_service = request.app.state.workspace
    existing = ws_service.load_board(board_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Board not found")
    board.id = board_id  # Ensure ID consistency
    saved = ws_service.save_board(board)
    return saved.model_dump()


@router.delete("/{board_id}")
async def delete_board(board_id: str, request: Request):
    """Delete a board by ID."""
    ws_service = request.app.state.workspace
    deleted = ws_service.delete_board(board_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Board not found")
    return {"detail": "Board deleted", "id": board_id}


# ---- File-path-based operations (used by the frontend) ----

class SaveBoardToFileRequest(BaseModel):
    board: dict
    path: str


@router.post("/save")
async def save_board_to_file(body: SaveBoardToFileRequest):
    """Save a board to .sdraw file + centralized cache.

    .sdraw file (git-friendly): code, cropped PNGs, embedded images,
    crop rects, camera state, layout.

    Cache (~/.sdraw/cache/<board-id>/): plotlyJson, thumbnail —
    regenerable data that doesn't need to be in git.
    """
    from services.board_cache import save_cache, strip_cached_fields

    try:
        p = Path(body.path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)

        # Write cache (plotlyJson, thumbnail)
        save_cache(body.board)

        # Write clean .sdraw file (without cached fields)
        clean_board = strip_cached_fields(body.board)
        p.write_text(json.dumps(clean_board, indent=2))

        # Clean up legacy .blobs companion file if it exists
        legacy_blobs = p.parent / (p.name + ".blobs")
        if legacy_blobs.exists():
            try:
                legacy_blobs.unlink()
            except OSError:
                pass

        return {"path": str(p), "board": body.board}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class OpenBoardFromFileRequest(BaseModel):
    path: str


@router.post("/open")
async def open_board_from_file(body: OpenBoardFromFileRequest):
    """Load a board from .sdraw file, merging cached data if available."""
    from services.board_cache import merge_cache_into_board

    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    try:
        data = json.loads(p.read_text())
        # Merge cached data (plotlyJson, thumbnail) from ~/.sdraw/cache/
        data = merge_cache_into_board(data)
        return {"path": str(p), "board": data}
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class SummaryRequest(BaseModel):
    path: str


@router.post("/summary")
async def board_summary(body: SummaryRequest):
    """Return lightweight summary (thumbnail, element count) for a .sdraw file."""
    from services.board_cache import load_cache

    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    try:
        data = json.loads(p.read_text())
        elements = data.get("elements", [])
        image_count = sum(1 for e in elements if e.get("type") == "image")
        # Thumbnail may be in the cache
        thumbnail = data.get("thumbnail")
        if not thumbnail:
            board_id = data.get("id")
            if board_id:
                cache = load_cache(board_id)
                thumbnail = cache.get("thumbnail")
        return {
            "id": data.get("id", p.stem),
            "name": data.get("name", "Untitled"),
            "updated_at": data.get("updated_at", ""),
            "path": str(p),
            "element_count": len(elements),
            "image_count": image_count,
            "canvas": data.get("canvas", {}),
            "thumbnail": thumbnail,
        }
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class DeleteBoardFileRequest(BaseModel):
    path: str


@router.post("/delete-file")
async def delete_board_file(body: DeleteBoardFileRequest):
    """Delete a board JSON file by path."""
    p = Path(body.path).resolve()
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        p.unlink()
        return {"deleted": str(p)}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---- Checkpoint / crash-recovery ----

def _checkpoint_path(board_path: str) -> Path:
    """Return the hidden checkpoint file path for a given board file."""
    p = Path(board_path).resolve()
    return p.parent / f".{p.name}.checkpoint"


class CheckpointRequest(BaseModel):
    board: dict
    path: str  # path to the main board file


@router.post("/checkpoint/save")
async def save_checkpoint(body: CheckpointRequest):
    """Save a checkpoint (hidden file) for crash recovery. Includes full blob data."""
    cp = _checkpoint_path(body.path)
    try:
        cp.write_text(json.dumps(body.board))
        return {"path": str(cp)}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class CheckpointCheckRequest(BaseModel):
    path: str  # path to the main board file


@router.post("/checkpoint/check")
async def check_checkpoint(body: CheckpointCheckRequest):
    """Check if a checkpoint exists and is newer than the saved board file."""
    cp = _checkpoint_path(body.path)
    board_p = Path(body.path).resolve()
    if not cp.exists():
        return {"exists": False}
    try:
        cp_mtime = cp.stat().st_mtime
        board_mtime = board_p.stat().st_mtime if board_p.exists() else 0
        return {
            "exists": True,
            "newer": cp_mtime > board_mtime,
            "checkpoint_modified": cp_mtime,
            "board_modified": board_mtime,
        }
    except OSError:
        return {"exists": False}


@router.post("/checkpoint/load")
async def load_checkpoint(body: CheckpointCheckRequest):
    """Load board data from a checkpoint file."""
    cp = _checkpoint_path(body.path)
    if not cp.exists():
        raise HTTPException(status_code=404, detail="No checkpoint found")
    try:
        data = json.loads(cp.read_text())
        return {"path": body.path, "board": data}
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/checkpoint/delete")
async def delete_checkpoint(body: CheckpointCheckRequest):
    """Delete a checkpoint file."""
    cp = _checkpoint_path(body.path)
    if cp.exists():
        cp.unlink()
    return {"deleted": True}
