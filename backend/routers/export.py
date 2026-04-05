"""Export routes (placeholder for client-side export coordination)."""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/export", tags=["export"])


class ExportPngRequest(BaseModel):
    board_id: str
    element_ids: Optional[list[str]] = None
    dpi: int = 150
    transparent: bool = False


@router.post("/png")
async def export_png(body: ExportPngRequest):
    """Placeholder for PNG export.

    Actual high-fidelity export is performed client-side using the DOM.
    This endpoint can be used to store export metadata or trigger
    client-side export via WebSocket in a future version.
    """
    return {
        "status": "use_client_export",
        "message": (
            "PNG export should be performed client-side using html2canvas or "
            "similar. The board can be loaded via GET /api/boards/{board_id} "
            "and rendered in a headless canvas at the requested DPI."
        ),
        "board_id": body.board_id,
        "element_ids": body.element_ids,
        "dpi": body.dpi,
        "transparent": body.transparent,
    }
