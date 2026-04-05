"""sDraw backend - FastAPI application entry point."""

import asyncio
import json
import logging
import os

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from routers import boards, export, files
from services.watcher import FileWatcherService
from services.workspace import WorkspaceService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

WORKSPACE_PATH = os.environ.get("SDRAW_WORKSPACE", "../workspace")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    # Startup
    workspace = WorkspaceService(workspace_path=WORKSPACE_PATH)
    workspace.ensure_dirs()
    workspace.load_config()
    app.state.workspace = workspace

    watcher = FileWatcherService()
    await watcher.start()
    app.state.watcher = watcher

    # Auto-watch any roots saved in config
    for root in workspace.config.watched_roots:
        watcher.watch(root)

    logger.info("sDraw backend started (workspace: %s)", workspace.workspace_path)
    yield

    # Shutdown
    await watcher.stop()
    logger.info("sDraw backend stopped")


app = FastAPI(title="sDraw", version="0.1.0", lifespan=lifespan)

# CORS - allow all for local app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(boards.router)
app.include_router(files.router)
app.include_router(export.router)


@app.get("/api/health", tags=["health"])
async def health():
    """Health check endpoint."""
    return {"status": "ok", "app": "sDraw", "version": "0.1.0"}


@app.websocket("/ws/events")
async def websocket_events(ws: WebSocket):
    """WebSocket endpoint for real-time file change events.

    Clients can also send JSON messages to control watching:
      {"action": "watch", "path": "/some/dir"}
      {"action": "unwatch", "path": "/some/dir"}
    """
    await ws.accept()
    watcher: FileWatcherService = ws.app.state.watcher
    watcher.register_client(ws)
    logger.info("WebSocket client connected")

    try:
        while True:
            try:
                raw = await ws.receive_text()
            except WebSocketDisconnect:
                break

            # Handle client commands
            try:
                msg = json.loads(raw)
                action = msg.get("action")
                path = msg.get("path", "")

                if action == "watch" and path:
                    success = watcher.watch(path)
                    await ws.send_text(json.dumps({
                        "response": "watch",
                        "success": success,
                        "path": path,
                    }))
                elif action == "unwatch" and path:
                    success = watcher.unwatch(path)
                    await ws.send_text(json.dumps({
                        "response": "unwatch",
                        "success": success,
                        "path": path,
                    }))
                elif action == "ping":
                    await ws.send_text(json.dumps({"response": "pong"}))
                else:
                    await ws.send_text(json.dumps({
                        "response": "error",
                        "detail": "Unknown action",
                    }))
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({
                    "response": "error",
                    "detail": "Invalid JSON",
                }))

    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        watcher.unregister_client(ws)
        logger.info("WebSocket client disconnected")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["."],
    )
