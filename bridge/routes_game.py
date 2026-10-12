"""
bridge/routes_game.py
Live game view, saved game reviews, and win/loss records per deck build.
"""

from fastapi import APIRouter, HTTPException

from bridge import game_view
from bridge.state import state

router = APIRouter(prefix="/api")


@router.get("/game")
def current_game():
    return state.game_view


@router.get("/games")
def game_history():
    return list(reversed(game_view.load_history()))


@router.get("/games/records")
def build_records(session_id: str):
    entry = state.sealed_sessions.get(session_id)
    if not entry:
        raise HTTPException(404, "Unknown deck session")
    variants = {name: dict(v.main_deck_counts) for name, v in entry["session"].variants.items()}
    records = {name: {"wins": 0, "losses": 0} for name in variants}
    for game in game_view.load_history():
        build = game_view.match_build(game.get("deck", []), variants)
        if build and game.get("result") in ("win", "loss"):
            records[build]["wins" if game["result"] == "win" else "losses"] += 1
    return records
