"""
bridge/server.py
Local HTTP/WebSocket API exposing the draft engine to the React overlay.
"""

import argparse
import asyncio
import logging
import queue
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.boot import load_data
from src.configuration import read_configuration
from src.ui.orchestrator import DraftOrchestrator

from bridge import routes_data, routes_decks, routes_draft
from bridge.jobs import list_jobs
from bridge.snapshot import build_snapshot
from bridge.state import state

logger = logging.getLogger(__name__)


async def refresh():
    snap = await asyncio.to_thread(build_snapshot, state.scanner, state.config, state.status)
    state.snapshot = snap
    await state.broadcast({"type": "snapshot", "snapshot": snap})


async def _boot(args):
    state.loop = asyncio.get_running_loop()
    state.config, _ = read_configuration()

    def progress(msg):
        asyncio.run_coroutine_threadsafe(state.set_status(msg), state.loop)

    data = await asyncio.to_thread(load_data, args, state.config, progress)
    state.scanner = data["scanner"]
    state.orchestrator = DraftOrchestrator(state.scanner, state.config, None)
    state.orchestrator.start()
    await state.set_status("Ready")
    await refresh()


async def _pump():
    """Forward orchestrator queue messages to connected overlays."""
    while True:
        await asyncio.sleep(0.1)
        if not state.ready:
            continue
        do_refresh = state.refresh_requested.is_set()
        state.refresh_requested.clear()
        while True:
            try:
                msg = state.orchestrator.update_queue.get_nowait()
            except queue.Empty:
                break
            if isinstance(msg, dict) and "status" in msg:
                await state.set_status(msg["status"])
            elif msg == "REFRESH":
                do_refresh = True
        if do_refresh:
            try:
                await refresh()
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

    app.include_router(routes_draft.router)
    app.include_router(routes_data.router)
    app.include_router(routes_decks.router)

    @app.get("/api/jobs")
    def jobs():
        return list_jobs()

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
