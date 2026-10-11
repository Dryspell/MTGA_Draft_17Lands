"""
bridge/server.py
Local HTTP/WebSocket API exposing the draft engine to the React overlay.
"""

import argparse
import asyncio
import logging
import queue
from contextlib import asynccontextmanager
from typing import Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.boot import load_data
from src.configuration import read_configuration, write_configuration
from src.ui.orchestrator import DraftOrchestrator
from bridge.snapshot import build_snapshot

logger = logging.getLogger(__name__)


class BridgeState:
    def __init__(self):
        self.config = None
        self.scanner = None
        self.orchestrator: Optional[DraftOrchestrator] = None
        self.status = "Starting..."
        self.snapshot: Optional[dict] = None
        self.clients: Set[WebSocket] = set()
        self.refresh_requested = asyncio.Event()

    @property
    def ready(self) -> bool:
        return self.orchestrator is not None

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.warning(f"Dropping overlay client: {e}")
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def set_status(self, status: str):
        self.status = status
        await self.broadcast({"type": "status", "status": status})

    async def refresh(self):
        snap = await asyncio.to_thread(build_snapshot, self.scanner, self.config)
        self.snapshot = snap
        await self.broadcast({"type": "snapshot", "snapshot": snap})


state = BridgeState()


async def _boot(args):
    loop = asyncio.get_running_loop()
    state.config, _ = read_configuration()

    def progress(msg):
        asyncio.run_coroutine_threadsafe(state.set_status(msg), loop)

    data = await asyncio.to_thread(load_data, args, state.config, progress)
    state.scanner = data["scanner"]
    state.orchestrator = DraftOrchestrator(state.scanner, state.config, None)
    state.orchestrator.start()
    await state.set_status("Ready")
    await state.refresh()


async def _pump():
    """Forward orchestrator queue messages to connected overlays."""
    while True:
        await asyncio.sleep(0.1)
        if not state.ready:
            continue
        refresh = state.refresh_requested.is_set()
        state.refresh_requested.clear()
        while True:
            try:
                msg = state.orchestrator.update_queue.get_nowait()
            except queue.Empty:
                break
            if isinstance(msg, dict) and "status" in msg:
                await state.set_status(msg["status"])
            elif msg == "REFRESH":
                refresh = True
        if refresh:
            try:
                await state.refresh()
            except Exception as e:
                logger.error(f"Snapshot failed: {e}", exc_info=True)


def create_app(args: argparse.Namespace) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        boot = asyncio.create_task(_boot(args))
        pump = asyncio.create_task(_pump())
        yield
        boot.cancel()
        pump.cancel()
        if state.orchestrator:
            state.orchestrator.stop()

    app = FastAPI(title="MTGA Draft Bridge", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/state")
    async def get_state():
        return {"status": state.status, "ready": state.ready, "snapshot": state.snapshot}

    @app.get("/api/filters")
    async def get_filters():
        if not state.ready:
            return {"current": None, "options": {}}
        from src import constants

        options = await asyncio.to_thread(
            state.scanner.retrieve_color_win_rate, constants.DECK_FILTER_FORMAT_NAMES
        )
        return {"current": state.config.settings.deck_filter, "options": options}

    class FilterBody(BaseModel):
        filter: str

    @app.post("/api/filter")
    async def set_filter(body: FilterBody):
        state.config.settings.deck_filter = body.filter
        write_configuration(state.config)
        state.refresh_requested.set()
        return {"ok": True}

    @app.post("/api/reload")
    async def reload():
        if not state.ready:
            return {"ok": False}
        scanner = state.scanner
        with scanner.lock:
            scanner.clear_draft(True)
            if getattr(scanner, "set_data", None):
                scanner.set_data.unknown_id_cache.clear()
        state.orchestrator.trigger_full_scan()
        return {"ok": True}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        state.clients.add(ws)
        await ws.send_json({"type": "status", "status": state.status})
        if state.snapshot:
            await ws.send_json({"type": "snapshot", "snapshot": state.snapshot})
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            state.clients.discard(ws)

    return app
