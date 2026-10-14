"""
bridge/routes_meta.py
Opt-in tournament metagame: archetypes and share per format, your record against
each, sample lists with their wildcard cost, and how your decks compare.
"""

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from bridge import meta
from bridge.arena_cards import arena_cards
from bridge.decks import local_time
from bridge.jobs import JobContext, start_job
from bridge.meta import FORMATS, MIN_MANUAL_AGE, meta_store
from bridge.state import state

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metagame")


def _require(fmt: str) -> str:
    if fmt not in FORMATS:
        raise HTTPException(404, f"No tournament data source covers {fmt}")
    return fmt


def _history():
    from bridge import routes_constructed
    return routes_constructed._constructed_history()


def record_format(r: Dict, deck: Optional[Dict]) -> Optional[str]:
    return meta.format_of((deck or {}).get("format", ""), r.get("eventId", ""))


def opponent_label(r: Dict, fmt: Optional[str]) -> str:
    """Today's metagame name for a past opponent, else the name saved with the game."""
    opp = r.get("opponent") or {}
    hit = meta_store.classify(fmt, {c["name"]: c["count"] for c in opp.get("cards", [])}, opp.get("colors", [])) if fmt else None
    return hit["name"] if hit else opp.get("archetypeName") or "Unknown"


def _played_formats() -> Counter:
    """Formats of decks you've played or edited in the last 30 days."""
    out: Counter = Counter()
    if not state.decks:
        return out
    cutoff = (datetime.now() - timedelta(days=30)).isoformat(timespec="seconds")
    for d in state.decks.visible():
        fmt = meta.format_of(d.get("format", ""))
        if fmt and max(local_time(d.get("lastPlayed", "")), local_time(d.get("lastUpdated", ""))) >= cutoff:
            out[fmt] += 1
    return out


def _job(fmt: str) -> Dict:
    def run(ctx: JobContext):
        data = meta_store.refresh(fmt, lambda m: ctx.progress(m))
        state.refresh_game = True
        return {"format": fmt, "archetypes": len(data.get("archetypes", []))}
    return start_job(f"meta:{fmt}", run)


def refresh_stale():
    """At startup: refresh the formats you play (or already have data for) once a day."""
    if not meta_store.enabled:
        return
    wanted = [f for f, _ in _played_formats().most_common()] + [f for f in FORMATS if meta_store.load(f)]
    stale = [f for f in dict.fromkeys(wanted) if meta_store.due(f)]
    if not stale:
        return

    def run(ctx: JobContext):
        for fmt in stale:
            try:
                meta_store.refresh(fmt, lambda m, f=fmt: ctx.progress(f"{f}: {m}"))
            except Exception as e:
                logger.warning("Metagame refresh for %s failed: %s", fmt, e)
        state.refresh_game = True
        return {"formats": stale}
    start_job("meta:auto", run)


@router.get("")
def overview():
    played = _played_formats()
    formats = []
    for fmt in FORMATS:
        data = meta_store.load(fmt)
        sources = meta_store.sources(fmt)
        formats.append({
            "format": fmt, "sources": sources, "available": any(sources.values()),
            "fetched": (data or {}).get("fetched", ""), "archetypes": len((data or {}).get("archetypes", [])),
            "stale": meta_store.stale(fmt), "played": played.get(fmt, 0),
        })
    suggested = next((f for f, _ in played.most_common() if any(meta_store.sources(f).values())), "Standard")
    return {
        "enabled": meta_store.enabled,
        "mtgtop8": bool(meta_store._setting("meta_mtgtop8", False)),
        "hasKey": bool(meta_store._setting("meta_spicerack_key", "")),
        "formats": formats,
        "suggested": suggested,
    }


def _costs(decks: List[Dict]) -> Dict[str, Dict]:
    lib = state.decks
    if not lib or not arena_cards.loaded:
        return {}
    out = {}
    for d in decks:
        try:
            deck, _ = lib.import_text(meta.deck_text(d), "check", save=False)
        except ValueError:
            continue
        check = lib.missing(deck)
        out[d["id"]] = {"wildcards": check["wildcards"], "affordable": check["affordable"], "missing": sum(c["missing"] for c in check["cards"])}
    return out


@router.get("/{fmt}")
def format_data(fmt: str):
    _require(fmt)
    if not meta_store.enabled:
        return {"format": fmt, "enabled": False, "archetypes": []}
    data = meta_store.load(fmt)
    job = _job(fmt) if meta_store.due(fmt) else None
    if not data:
        return {"format": fmt, "enabled": True, "archetypes": [], "job": job, "sources": {}}

    records, _, assigned = _history()
    tally: Dict[str, Dict] = defaultdict(lambda: {"wins": 0, "losses": 0, "games": 0})
    unmatched = {"wins": 0, "losses": 0, "games": 0}
    for r in records:
        deck = assigned.get(r["id"])
        if record_format(r, deck) != fmt:
            continue
        opp = r.get("opponent") or {}
        hit = meta_store.classify(fmt, {c["name"]: c["count"] for c in opp.get("cards", [])}, opp.get("colors", []))
        row = tally[hit["id"]] if hit else unmatched
        row["games"] += 1
        row["wins"] += r.get("result") == "win"
        row["losses"] += r.get("result") == "loss"

    archetypes = []
    for a in data["archetypes"]:
        costs = _costs(a.get("decks", []))
        archetypes.append({
            **{k: v for k, v in a.items() if k != "decks"},
            "decks": [{**d, "cost": costs.get(d["id"])} for d in a.get("decks", [])],
            "record": tally.get(a["id"], {"wins": 0, "losses": 0, "games": 0}),
        })
    return {
        "format": fmt, "enabled": True, "fetched": data.get("fetched", ""), "sources": data.get("sources", {}),
        "archetypes": archetypes, "unmatched": unmatched, "job": job,
    }


@router.post("/{fmt}/refresh")
def refresh(fmt: str):
    _require(fmt)
    if not meta_store.enabled:
        raise HTTPException(400, "Turn on online metagame data in Settings first.")
    if not any(meta_store.sources(fmt).values()):
        raise HTTPException(400, f"{fmt} is only covered by mtgtop8. Turn it on in Settings.")
    age = meta_store.age(fmt)
    if age is not None and age < MIN_MANUAL_AGE and not (meta_store.load(fmt) or {}).get("lastError"):
        raise HTTPException(429, "Updated less than an hour ago. Tournament results don't change faster than that.")
    return _job(fmt)


class ImportBody(BaseModel):
    deckId: str
    name: str = ""


@router.post("/{fmt}/import")
def import_list(fmt: str, body: ImportBody):
    from bridge import routes_constructed
    _require(fmt)
    data = meta_store.active(fmt)
    found = next(((a, d) for a in (data or {}).get("archetypes", []) for d in a.get("decks", []) if d["id"] == body.deckId), None)
    if not found:
        raise HTTPException(404, "That list is no longer in the cached metagame. Refresh and try again.")
    if not arena_cards.loaded:
        raise HTTPException(503, "Arena's card database isn't loaded. Check the MTGA data folder in Settings.")
    arch, d = found
    name = body.name.strip() or f"{arch['name']} ({d.get('player') or d['source']})"
    deck, unknown = routes_constructed._library().import_text(meta.deck_text(d), name[:80], fmt)
    return {**routes_constructed._detail(deck), "unknown": unknown}


@router.get("/compare/{deck_id}")
def compare(deck_id: str, archetype: str = ""):
    from bridge import routes_constructed
    d = routes_constructed._deck(deck_id)
    fmt = meta.format_of(d.get("format", ""))
    if not meta_store.enabled:
        return {"format": fmt, "enabled": False}
    result = meta_store.compare(fmt, routes_constructed._library().names(d.get("main", [])), archetype)
    return {"format": fmt, "enabled": True, "compare": result}
