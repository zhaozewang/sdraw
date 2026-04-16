"""sDraw backend - FastAPI application entry point."""

import asyncio
import json
import logging
import os
import sys

# When running as a PyInstaller bundle, ensure the _internal dir is on sys.path
# so that routers/, services/, models/ packages can be imported.
if getattr(sys, 'frozen', False):
    _internal = os.path.join(os.path.dirname(sys.executable), '_internal')
    if _internal not in sys.path:
        sys.path.insert(0, _internal)

import gzip as gzip_mod
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send


class GzipRequestMiddleware:
    """Decompress gzip-encoded request bodies so clients can compress
    large JSON payloads (board saves, exports) before sending over slow
    links. Transparent to the ASGI app and Pydantic models downstream."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        if headers.get(b"content-encoding") != b"gzip":
            await self.app(scope, receive, send)
            return

        body_parts: list[bytes] = []
        while True:
            msg = await receive()
            body_parts.append(msg.get("body", b""))
            if not msg.get("more_body", False):
                break

        decompressed = gzip_mod.decompress(b"".join(body_parts))

        new_headers = [
            (k, v) for k, v in scope["headers"]
            if k not in (b"content-encoding", b"content-length")
        ]
        new_headers.append((b"content-length", str(len(decompressed)).encode()))
        scope = {**scope, "headers": new_headers}

        sent = False

        async def new_receive() -> dict:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": decompressed, "more_body": False}
            return {"type": "http.disconnect"}

        await self.app(scope, new_receive, send)

from routers import boards, export, files, plot
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
    from services.kernel_manager import kernel_manager
    await kernel_manager.shutdown_all()
    await watcher.stop()
    logger.info("sDraw backend stopped")


app = FastAPI(title="sDraw", version="0.1.0", lifespan=lifespan)

# Decompress gzip-encoded request bodies so clients can compress
# large payloads (board saves ~12 MB, exports) before sending.
app.add_middleware(GzipRequestMiddleware)

# Compress responses larger than ~1 KB.
app.add_middleware(GZipMiddleware, minimum_size=1024)

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
app.include_router(plot.router)


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


# Serve pre-built frontend in production / packaged mode
def _resolve_static_dir():
    """Find the frontend dist directory relative to the executable or source."""
    # PyInstaller sets _MEIPASS to the temp extraction dir
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        os.path.join(base, "frontend_dist"),                             # PyInstaller bundle
        os.path.join(os.path.dirname(sys.executable), "frontend_dist"),  # PyInstaller --onedir
        os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"),  # dev layout
        os.path.join(os.path.dirname(__file__), "frontend_dist"),        # co-located
    ]
    for c in candidates:
        real = os.path.realpath(c)
        if os.path.isdir(real) and os.path.isfile(os.path.join(real, "index.html")):
            return real
    return None


_static_dir = _resolve_static_dir()
if _static_dir:
    from fastapi.responses import FileResponse

    # Serve static assets (js, css, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(_static_dir, "assets")), name="static-assets")

    # Serve other static files at root (favicon, etc.)
    @app.get("/{full_path:path}", tags=["spa"])
    async def serve_spa(full_path: str):
        """SPA catch-all: serve the file if it exists, otherwise index.html."""
        file_path = os.path.join(_static_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_static_dir, "index.html"))

    logger.info("Serving frontend from %s", _static_dir)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("SDRAW_PORT", "8000"))
    is_frozen = getattr(sys, 'frozen', False)

    if is_frozen:
        # PyInstaller: pass the app object directly (module import doesn't work)
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=port,
        )
    else:
        # Dev: use string reference for auto-reload support
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=port,
            reload="--reload" in sys.argv,
            reload_dirs=["."] if "--reload" in sys.argv else None,
        )
