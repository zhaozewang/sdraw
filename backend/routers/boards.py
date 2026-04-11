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


def _blobs_path(board_path: Path) -> Path:
    """Return the .sdraw.blobs companion file path."""
    return board_path.parent / (board_path.name + ".blobs")


# Fields to strip from the .sdraw file and store in .blobs
_ELEMENT_BLOB_KEYS = {"lastOutput", "plotlyJson"}
_SOURCE_BLOB_KEYS = {"embeddedData", "embeddedMime", "lastModified"}
_BOARD_BLOB_KEYS = {"thumbnail", "pythonEnvPath"}


def _split_blobs(board: dict) -> tuple[dict, dict]:
    """Split a board into a clean version (for git) and a blob store.
    Returns (clean_board, blobs_dict).
    """
    blobs: dict = {}

    # Board-level blobs
    board_blobs = {}
    for key in _BOARD_BLOB_KEYS:
        if key in board and board[key]:
            board_blobs[key] = board[key]
    if board_blobs:
        blobs["__board__"] = board_blobs

    # Element blobs
    clean_elements = []
    for el in board.get("elements", []):
        el_blobs: dict = {}
        clean_el = {**el}

        # Metadata blobs (lastOutput, plotlyJson)
        if "metadata" in el and el["metadata"]:
            clean_meta = {**el["metadata"]}
            for key in _ELEMENT_BLOB_KEYS:
                if key in clean_meta and clean_meta[key]:
                    el_blobs[key] = clean_meta[key]
                    clean_meta[key] = None
            clean_el["metadata"] = clean_meta

        # Source blobs (embeddedData)
        if "source" in el and el["source"]:
            clean_source = {**el["source"]}
            for key in _SOURCE_BLOB_KEYS:
                if key in clean_source and clean_source[key]:
                    if "source" not in el_blobs:
                        el_blobs["source"] = {}
                    el_blobs["source"][key] = clean_source[key]
                    clean_source.pop(key, None)
            clean_el["source"] = clean_source

        if el_blobs:
            blobs[el["id"]] = el_blobs
        clean_elements.append(clean_el)

    clean_board = {**board, "elements": clean_elements}
    for key in _BOARD_BLOB_KEYS:
        clean_board.pop(key, None)

    return clean_board, blobs


def _merge_blobs(board: dict, blobs: dict) -> dict:
    """Merge blob data back into a board."""
    if not blobs:
        return board

    # Board-level blobs
    board_blobs = blobs.get("__board__", {})
    merged = {**board, **board_blobs}

    # Element blobs
    merged_elements = []
    for el in board.get("elements", []):
        el_blobs = blobs.get(el.get("id", ""), {})
        if not el_blobs:
            merged_elements.append(el)
            continue

        merged_el = {**el}

        # Metadata blobs
        if "metadata" in el:
            merged_meta = {**el["metadata"]}
            for key in _ELEMENT_BLOB_KEYS:
                if key in el_blobs:
                    merged_meta[key] = el_blobs[key]
            merged_el["metadata"] = merged_meta

        # Source blobs
        if "source" in el and "source" in el_blobs:
            merged_el["source"] = {**el["source"], **el_blobs["source"]}

        merged_elements.append(merged_el)

    merged["elements"] = merged_elements
    return merged


@router.post("/save")
async def save_board_to_file(body: SaveBoardToFileRequest):
    """Save a board JSON to an arbitrary file path.
    Splits heavy blob data into a companion .blobs file (gitignored).
    The .sdraw file stays lightweight and git-friendly.
    """
    try:
        p = Path(body.path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)

        clean_board, blobs = _split_blobs(body.board)

        # Write clean .sdraw file (git-friendly)
        p.write_text(json.dumps(clean_board, indent=2))

        # Write .blobs companion file (gitignored)
        bp = _blobs_path(p)
        if blobs:
            bp.write_text(json.dumps(blobs))
        elif bp.exists():
            bp.unlink()  # remove empty blobs file

        return {"path": str(p), "board": body.board}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class OpenBoardFromFileRequest(BaseModel):
    path: str


@router.post("/open")
async def open_board_from_file(body: OpenBoardFromFileRequest):
    """Load a board JSON from a file path, merging blob data if available."""
    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    try:
        data = json.loads(p.read_text())
        # Merge blobs from companion file
        bp = _blobs_path(p)
        if bp.exists():
            try:
                blobs = json.loads(bp.read_text())
                data = _merge_blobs(data, blobs)
            except (json.JSONDecodeError, OSError):
                pass  # blob file corrupt — use board without blobs
        return {"path": str(p), "board": data}
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class SummaryRequest(BaseModel):
    path: str


@router.post("/summary")
async def board_summary(body: SummaryRequest):
    """Return lightweight summary (thumbnail, element count) for a .sdraw file."""
    p = Path(body.path).resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    try:
        data = json.loads(p.read_text())
        elements = data.get("elements", [])
        image_count = sum(1 for e in elements if e.get("type") == "image")
        # Thumbnail may be in the blobs file
        thumbnail = data.get("thumbnail")
        if not thumbnail:
            bp = _blobs_path(p)
            if bp.exists():
                try:
                    blobs = json.loads(bp.read_text())
                    thumbnail = blobs.get("__board__", {}).get("thumbnail")
                except (json.JSONDecodeError, OSError):
                    pass
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
