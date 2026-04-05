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
    """Save a board JSON to an arbitrary file path."""
    try:
        p = Path(body.path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(body.board, indent=2))
        return {"path": str(p), "board": body.board}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class OpenBoardFromFileRequest(BaseModel):
    path: str


@router.post("/open")
async def open_board_from_file(body: OpenBoardFromFileRequest):
    """Load a board JSON from a file path."""
    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    try:
        data = json.loads(p.read_text())
        return {"path": str(p), "board": data}
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
