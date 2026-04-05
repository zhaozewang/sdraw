"""File watcher service using watchdog with debounced WebSocket broadcasting."""

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".bmp", ".tiff",
})

DEBOUNCE_SECONDS = 0.5


class _ImageEventHandler(FileSystemEventHandler):
    """Filters filesystem events to image files and pushes them to an async queue."""

    def __init__(self, event_queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
        super().__init__()
        self._queue = event_queue
        self._loop = loop

    def _handle(self, event: FileSystemEvent, event_type: str) -> None:
        if event.is_directory:
            return
        src = Path(event.src_path)
        if src.suffix.lower() not in IMAGE_EXTENSIONS:
            return
        try:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, (event_type, str(src)))
        except Exception:
            pass  # loop may be closed during shutdown

    def on_created(self, event: FileSystemEvent) -> None:
        self._handle(event, "file_created")

    def on_modified(self, event: FileSystemEvent) -> None:
        self._handle(event, "file_changed")

    def on_deleted(self, event: FileSystemEvent) -> None:
        self._handle(event, "file_deleted")

    def on_moved(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        dest = Path(event.dest_path)
        if dest.suffix.lower() in IMAGE_EXTENSIONS:
            try:
                self._loop.call_soon_threadsafe(
                    self._queue.put_nowait, ("file_created", str(dest))
                )
            except Exception:
                pass
        src = Path(event.src_path)
        if src.suffix.lower() in IMAGE_EXTENSIONS:
            try:
                self._loop.call_soon_threadsafe(
                    self._queue.put_nowait, ("file_deleted", str(src))
                )
            except Exception:
                pass


class FileWatcherService:
    """Manages watchdog observers and broadcasts debounced events over WebSocket."""

    def __init__(self) -> None:
        self._observers: dict[str, Observer] = {}
        self._clients: set[Any] = set()
        self._event_queue: asyncio.Queue | None = None
        self._debounce_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        """Initialize the async event loop reference and start the debounce consumer."""
        self._loop = asyncio.get_running_loop()
        self._event_queue = asyncio.Queue()
        self._debounce_task = asyncio.create_task(self._debounce_loop())

    async def stop(self) -> None:
        """Stop all observers and the debounce task."""
        for path in list(self._observers):
            self.unwatch(path)
        if self._debounce_task:
            self._debounce_task.cancel()
            try:
                await self._debounce_task
            except asyncio.CancelledError:
                pass

    def watch(self, path: str) -> bool:
        """Start watching a directory for image file changes. Returns True on success."""
        resolved = str(Path(path).resolve())
        if resolved in self._observers:
            logger.info("Already watching: %s", resolved)
            return True
        if not Path(resolved).is_dir():
            logger.warning("Cannot watch non-directory: %s", resolved)
            return False
        if self._loop is None or self._event_queue is None:
            logger.error("Watcher service not started")
            return False
        try:
            handler = _ImageEventHandler(self._event_queue, self._loop)
            observer = Observer()
            observer.schedule(handler, resolved, recursive=True)
            observer.daemon = True
            observer.start()
            self._observers[resolved] = observer
            logger.info("Started watching: %s", resolved)
            return True
        except Exception as exc:
            logger.error("Failed to watch %s: %s", resolved, exc)
            return False

    def unwatch(self, path: str) -> bool:
        """Stop watching a directory. Returns True if it was being watched."""
        resolved = str(Path(path).resolve())
        observer = self._observers.pop(resolved, None)
        if observer is None:
            return False
        try:
            observer.stop()
            observer.join(timeout=2)
        except Exception as exc:
            logger.warning("Error stopping observer for %s: %s", resolved, exc)
        logger.info("Stopped watching: %s", resolved)
        return True

    def register_client(self, ws: Any) -> None:
        self._clients.add(ws)
        logger.info("WebSocket client registered (total: %d)", len(self._clients))

    def unregister_client(self, ws: Any) -> None:
        self._clients.discard(ws)
        logger.info("WebSocket client unregistered (total: %d)", len(self._clients))

    async def _debounce_loop(self) -> None:
        """Consume events from the queue, debounce, and broadcast."""
        assert self._event_queue is not None
        pending: dict[str, tuple[str, str]] = {}  # path -> (event_type, path)

        while True:
            try:
                # Wait for the first event
                event_type, file_path = await self._event_queue.get()
                pending[file_path] = (event_type, file_path)

                # Collect more events during the debounce window
                deadline = asyncio.get_running_loop().time() + DEBOUNCE_SECONDS
                while True:
                    remaining = deadline - asyncio.get_running_loop().time()
                    if remaining <= 0:
                        break
                    try:
                        event_type, file_path = await asyncio.wait_for(
                            self._event_queue.get(), timeout=remaining
                        )
                        pending[file_path] = (event_type, file_path)
                        # Reset deadline on new event
                        deadline = asyncio.get_running_loop().time() + DEBOUNCE_SECONDS
                    except asyncio.TimeoutError:
                        break

                # Dispatch all pending events
                events_to_send = list(pending.values())
                pending.clear()

                for evt_type, evt_path in events_to_send:
                    await self._broadcast_event(evt_type, evt_path)

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("Error in debounce loop: %s", exc)
                await asyncio.sleep(0.1)

    async def _broadcast_event(self, event_type: str, file_path: str) -> None:
        """Send a file event to all connected WebSocket clients."""
        p = Path(file_path)
        payload: dict[str, Any] = {
            "event_type": event_type,
            "path": str(p),
        }

        # Try to compute relative path from any watched root
        for root in self._observers:
            try:
                rel = p.relative_to(root)
                payload["relative_path"] = str(rel)
                break
            except ValueError:
                continue
        else:
            payload["relative_path"] = p.name

        # File metadata (may not exist for deletes)
        if p.exists():
            try:
                stat = p.stat()
                payload["modified_time"] = datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat()
                payload["size"] = stat.st_size
            except OSError:
                payload["modified_time"] = None
                payload["size"] = None
        else:
            payload["modified_time"] = None
            payload["size"] = None

        message = json.dumps(payload)
        dead_clients: list[Any] = []

        for ws in list(self._clients):
            try:
                await ws.send_text(message)
            except Exception:
                dead_clients.append(ws)

        for ws in dead_clients:
            self._clients.discard(ws)
