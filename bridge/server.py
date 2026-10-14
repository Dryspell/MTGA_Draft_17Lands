"""
bridge/server.py
Local HTTP/WebSocket API exposing the draft engine to the React overlay.
"""

import argparse
import asyncio
import logging
import os
import queue
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.boot import load_data
from src.configuration import read_configuration
from src.ui.orchestrator import DraftOrchestrator

from bridge import game_view, routes_constructed, routes_data, routes_decks, routes_draft, routes_game
from bridge.arena_cards import arena_cards
from bridge.decks import TRACKED_API, DeckLibrary
from bridge.game import GameTracker
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
    await asyncio.to_thread(_load_cards)
    state.decks = DeckLibrary(arena_cards)
    # Older log first, so its deck lists never overwrite newer ones.
    await asyncio.to_thread(_backfill_previous_log)
    state.games = _tracker()
    await state.set_status("Ready")
    await refresh()


def _load_cards():
    try:
        arena_cards.load(state.config.settings.database_location)
    except Exception as e:
        logger.error(f"Arena card database unavailable: {e}", exc_info=True)


def _tracker(**callbacks) -> GameTracker:
    return GameTracker(
        callbacks.get("on_game_over", _record_game),
        on_api=state.decks.handle,
        api_names=TRACKED_API,
        on_new_game=callbacks.get("on_new_game", _tag_game),
        on_match_over=_record_match,
    )


def _tag_game(game):
    if game_view.game_format(game) != "constructed":
        return
    deck = state.decks.identify(game.event_id, game.deck)
    if deck:
        game.deck_id, game.deck_name = deck["id"], deck.get("name", "")
    state.decks.note_played(game.deck)


def _record_game(game):
    game_view.append_history(game_view.build_record(game, state.scanner.set_data))


def _record_match(match_id, result, event_id, stamp):
    when = datetime.fromtimestamp(stamp).isoformat(timespec="seconds") if stamp else None
    game_view.update_match(match_id, result=result, eventId=event_id, time=when)


def _backfill_previous_log():
    """Learn decks and games from Player-prev.log once per rotation."""
    current = state.scanner.arena_file if state.scanner else None
    if not current:
        return
    prev = os.path.join(os.path.dirname(current), "Player-prev.log")
    if not os.path.exists(prev):
        return
    stamp = f"{os.path.getsize(prev)}:{int(os.path.getmtime(prev))}"
    if state.decks.backfilled == stamp:
        return
    try:
        _tracker().poll(prev)
    except Exception as e:
        logger.error(f"Reading Player-prev.log failed: {e}", exc_info=True)
    state.decks.backfilled = stamp
    state.decks.dirty = True
    state.decks.save()


async def _poll_game():
    if not state.games:
        return
    changed = await asyncio.to_thread(state.games.poll, state.scanner.arena_file)
    if state.decks.dirty:
        await asyncio.to_thread(state.decks.save)
        state.decks_version += 1
        await state.broadcast({"type": "decks", "version": state.decks_version})
    if changed:
        state.game_view = await asyncio.to_thread(game_view.build_view, state.games, state.scanner.set_data)
        await state.broadcast({"type": "game", "game": state.game_view})


async def _pump():
    """Forward orchestrator queue messages to connected overlays."""
    tick = 0
    while True:
        await asyncio.sleep(0.1)
        if not state.ready:
            continue
        tick += 1
        if tick % 5 == 0:
            try:
                await _poll_game()
            except Exception as e:
                logger.error(f"Game tracking failed: {e}", exc_info=True)
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
                # The orchestrator loads datasets synchronously before queueing
                # REFRESH, so a pending "Loading..." status is now stale.
                if state.status.startswith("Loading"):
                    await state.set_status("Ready")
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
    app.include_router(routes_game.router)
    app.include_router(routes_constructed.router)

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
        if state.game_view:
            await ws.send_json({"type": "game", "game": state.game_view})
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            state.clients.discard(ws)

    return app
