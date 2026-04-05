"""Board CRUD API routes."""

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
