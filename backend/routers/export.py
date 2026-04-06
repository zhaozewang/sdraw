"""Export routes for saving rendered images to disk."""

import base64
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/export", tags=["export"])


class SaveExportRequest(BaseModel):
    path: str
    data_url: str  # base64 data URL (data:image/png;base64,...)


@router.post("/save")
async def save_export(body: SaveExportRequest):
    """Save an exported image (base64 data URL) to a file on disk."""
    try:
        p = Path(body.path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)

        # Parse data URL
        if ',' in body.data_url:
            header, data = body.data_url.split(',', 1)
        else:
            data = body.data_url

        raw = base64.b64decode(data)
        p.write_bytes(raw)
        logger.info("Auto-export saved: %s (%d bytes)", p, len(raw))
        return {"path": str(p), "size": len(raw)}
    except Exception as exc:
        logger.error("Export save failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
