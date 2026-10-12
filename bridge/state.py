"""
bridge/state.py
Process-wide state shared by the bridge's routes, pump, and jobs.
"""

import asyncio
import logging
from typing import Dict, Optional, Set

from fastapi import HTTPException, WebSocket

logger = logging.getLogger(__name__)


class BridgeState:
    def __init__(self):
        self.config = None
        self.scanner = None
        self.orchestrator = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.status = "Starting..."
        self.snapshot: Optional[dict] = None
        self.clients: Set[WebSocket] = set()
        self.refresh_requested = asyncio.Event()
        self.sealed_sessions: Dict[str, dict] = {}
        self.games = None
        self.game_view: Optional[dict] = None

    @property
    def ready(self) -> bool:
        return self.orchestrator is not None

    def require_ready(self):
        if not self.ready:
            raise HTTPException(503, "Engine is still starting")

    async def broadcast(self, message: dict):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.warning(f"Dropping overlay client: {e}")
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def broadcast_threadsafe(self, message: dict):
        if self.loop:
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)

    async def set_status(self, status: str):
        self.status = status
        await self.broadcast({"type": "status", "status": status})

    def request_refresh(self):
        """Safe from any thread: recompute and push a snapshot on the next pump tick."""
        if self.loop:
            self.loop.call_soon_threadsafe(self.refresh_requested.set)


state = BridgeState()
