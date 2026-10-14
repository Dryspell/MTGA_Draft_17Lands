"""
bridge/routes_constructed.py
Constructed decks (learned from the log or imported), collection checks,
simulations, and match statistics.
"""

from collections import Counter, defaultdict
from typing import Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from bridge import game_view, meta, routes_meta
from bridge.arena_cards import arena_cards
from bridge.decks import ANY_OPPONENT, is_limited_event, local_time, names_key
from bridge.serialize import serialize_card
from bridge.state import state

router = APIRouter(prefix="/api")

COLORS = "WUBRG"


def _library():
    if not state.decks:
        raise HTTPException(503, "Engine is still starting")
    return state.decks


def _rows(rows: List[List[int]]) -> List[Dict]:
    out = []
    for grp, n in rows:
        card = arena_cards.get(grp)
        if not card:
            out.append({"name": f"Card #{grp}", "grpId": grp, "count": n, "types": [], "colors": [], "manaCost": "", "cmc": 0,
                        "images": [], "tags": [], "subtypes": [], "rarity": "", "returnableAt": [], "deckColors": {}, "tiers": {}, "recommendation": None})
            continue
        view = serialize_card(dict(card, count=n))
        view.update(grpId=grp, text=card.get("oracle_text", ""), keywords=card.get("keywords", []))
        out.append(view)
    return sorted(game_view.merge_by_name(out), key=lambda c: ("Land" in c["types"], c["cmc"], c["name"]))


def _engine_cards(rows: List[List[int]]) -> List[Dict]:
    """Card dicts in the shape the simulator and advisor expect."""
    out = []
    for grp, n in rows:
        card = arena_cards.get(grp)
        if card:
            out.append(dict(card, count=n))
    return out


def _colors(rows: List[List[int]]) -> List[str]:
    found = set()
    for grp, _ in rows:
        card = arena_cards.get(grp)
        if card and "Land" not in card.get("types", []):
            found.update(card.get("colors", []))
    return [c for c in COLORS if c in found]


def _is_constructed(r: Dict) -> bool:
    fmt = r.get("format")
    return fmt == "constructed" if fmt else bool(r.get("eventId")) and not is_limited_event(r["eventId"])


def _spell_names(rows) -> Counter:
    out: Counter = Counter()
    for name, n in rows:
        if not game_view._is_land_name(name):
            out[name] += n
    return out


def _assign_decks(records: List[Dict], decks: List[Dict]) -> Dict[str, Optional[Dict]]:
    """record id -> library deck. Older records predate deck tagging, so match them by list."""
    by_id = {d["id"]: d for d in decks}
    lists = []
    for d in decks:
        names = Counter()
        for grp, n in d.get("main", []):
            card = arena_cards.get(grp)
            if card:
                names[card["name"]] += n
        spells = _spell_names(names.items())
        if spells:
            lists.append((d, spells))
    out = {}
    for r in records:
        if r.get("deckId") in by_id:
            out[r["id"]] = by_id[r["deckId"]]
            continue
        played = _spell_names((c["name"], c["count"]) for c in r.get("deck", []))
        best, best_score = None, 0.75
        if played:
            total = sum(played.values())
            for d, spells in lists:
                score = sum((spells & played).values()) / max(total, sum(spells.values()))
                if score > best_score:
                    best, best_score = d, score
        out[r["id"]] = best
    return out


def _constructed_history():
    records = [r for r in game_view.load_history_cached() if _is_constructed(r)]
    decks = _library().visible()
    return records, decks, _assign_decks(records, decks)


def _wl(records: List[Dict]) -> Dict:
    return {
        "wins": sum(1 for r in records if r.get("result") == "win"),
        "losses": sum(1 for r in records if r.get("result") == "loss"),
        "games": len(records),
    }


def _summary(d: Dict, records: List[Dict]) -> Dict:
    main = d.get("main", [])
    tile = arena_cards.get(d.get("tile")) if d.get("tile") else None
    return {
        "id": d["id"],
        "name": d.get("name") or "Untitled deck",
        "format": d.get("format", ""),
        "source": d.get("source", "arena"),
        "known": bool(main),
        "count": sum(n for _, n in main),
        "colors": _colors(main),
        "lastPlayed": d.get("lastPlayed", ""),
        "lastUpdated": d.get("lastUpdated", ""),
        "tileImage": (tile or {}).get("image", [None])[0],
        "record": _wl(records),
    }


@router.get("/constructed/decks")
def list_decks():
    lib = _library()
    records, decks, assigned = _constructed_history()
    per_deck = defaultdict(list)
    for r in records:
        d = assigned.get(r["id"])
        if d:
            per_deck[d["id"]].append(r)
    out = [_summary(d, per_deck.get(d["id"], [])) for d in decks]
    out.sort(key=lambda s: max(s["lastPlayed"], s["lastUpdated"]), reverse=True)
    return {
        "decks": out,
        "wildcards": lib.wildcards,
        "currency": lib.currency,
        "cardsLoaded": arena_cards.loaded,
        "ownedKnown": len(lib.owned),
    }


def _deck(deck_id: str) -> Dict:
    lib = _library()
    d = lib.decks.get(deck_id)
    if not d or d.get("deleted"):
        raise HTTPException(404, "Unknown deck")
    return d


def _breakdown(records: List[Dict], formats: Callable[[Dict], Optional[str]] = lambda r: None) -> Dict:
    by_event = defaultdict(list)
    by_opp = defaultdict(list)
    for r in records:
        by_event[r.get("eventId", "")].append(r)
        by_opp[routes_meta.opponent_label(r, formats(r))].append(r)
    return {
        "overall": _wl(records),
        "onPlay": _wl([r for r in records if r.get("onPlay") is True]),
        "onDraw": _wl([r for r in records if r.get("onPlay") is False]),
        "byEvent": sorted(({"key": k, **_wl(v)} for k, v in by_event.items()), key=lambda x: -x["games"]),
        "byOpponent": sorted(({"key": k, **_wl(v)} for k, v in by_opp.items()), key=lambda x: -x["games"]),
        "mulliganRate": (sum(1 for r in records if r.get("mulligans")) / len(records)) if records else 0,
    }


def _name_rows(c: Counter) -> List[Dict]:
    return [{"name": n, "count": k} for n, k in sorted(c.items()) if k > 0]


def _record_names(r: Dict) -> Counter:
    out: Counter = Counter()
    for c in r.get("deck", []):
        out[c["name"]] += c["count"]
    return out


def _versions(d: Dict, records: List[Dict]) -> List[Dict]:
    """Each list the deck has had, newest first, with what changed and how it did.
    Game 1 records match a version exactly; sideboarded games go by time."""
    lib = _library()
    versions = d.get("versions") or []
    if not versions:
        return []
    by_key = {v["key"]: i for i, v in enumerate(versions)}
    times = [local_time(v["at"]) for v in versions]
    buckets = defaultdict(list)
    for r in records:
        idx = by_key.get(names_key(_record_names(r))) if r.get("gameNumber", 1) == 1 else None
        if idx is None:
            t = r.get("time", "")
            idx = max((i for i, at in enumerate(times) if at and at <= t), default=0)
        buckets[idx].append(r)
    out, prev = [], None
    for i, v in enumerate(versions):
        names = lib.names(v["main"])
        out.append({
            "key": v["key"], "at": v["at"], "count": sum(names.values()), "current": i == len(versions) - 1,
            "added": _name_rows(names - prev) if prev is not None else [],
            "removed": _name_rows(prev - names) if prev is not None else [],
            "record": _wl(buckets.get(i, [])),
        })
        prev = names
    return out[::-1]


def _sideboard_history(records: List[Dict]) -> List[Dict]:
    """How you actually sideboarded with this deck, per opponent archetype (latest plan first)."""
    by_match = defaultdict(list)
    for r in records:
        by_match[r.get("matchId") or r["id"]].append(r)
    plans: Dict[str, Dict] = {}
    for games in by_match.values():
        games.sort(key=lambda r: r.get("gameNumber", 1))
        opp = next(((g.get("opponent") or {}).get("archetypeName") for g in games if (g.get("opponent") or {}).get("archetypeName")), "") or "Unknown"
        for g in games[1:]:
            sb = g.get("sideboard") or {}
            if not (sb.get("in") or sb.get("out")):
                continue
            entry = plans.setdefault(opp, {"key": opp, "in": sb.get("in", []), "out": sb.get("out", []), "games": 0, "wins": 0, "losses": 0, "time": ""})
            if g.get("time", "") > entry["time"]:
                entry.update({"in": sb.get("in", []), "out": sb.get("out", []), "time": g.get("time", "")})
            entry["games"] += 1
            entry["wins"] += g.get("result") == "win"
            entry["losses"] += g.get("result") == "loss"
    return sorted(plans.values(), key=lambda p: p["time"], reverse=True)


def _guides(d: Dict) -> List[Dict]:
    return [{"key": k, **g} for k, g in sorted((d.get("guides") or {}).items(), key=lambda kv: (kv[0] == ANY_OPPONENT, kv[0]))]


def _detail(d: Dict) -> Dict:
    lib = _library()
    records, decks, assigned = _constructed_history()
    mine = [r for r in records if (assigned.get(r["id"]) or {}).get("id") == d["id"]]
    fmt = meta.format_of(d.get("format", ""))
    return {
        "versions": _versions(d, mine),
        "guides": _guides(d),
        "sideboardHistory": _sideboard_history(mine),
        "metaFormat": fmt or "",
        "metaArchetypes": meta.meta_store.names(fmt),
        **_summary(d, mine),
        "main": _rows(d.get("main", [])),
        "side": _rows(d.get("side", [])),
        "commander": _rows(d.get("commander", [])),
        "companions": _rows(d.get("companions", [])),
        "collection": lib.missing(d),
        "text": lib.export_text(d),
        "stats": _breakdown(mine, lambda r: routes_meta.record_format(r, d)),
        "recent": [
            {"id": r["id"], "time": r.get("time"), "result": r.get("result"), "eventId": r.get("eventId"), "onPlay": r.get("onPlay"),
             "opponent": routes_meta.opponent_label(r, routes_meta.record_format(r, d)), "colors": (r.get("opponent") or {}).get("colors", [])}
            for r in sorted(mine, key=lambda r: r.get("time", ""), reverse=True)[:15]
        ],
    }


@router.get("/constructed/decks/{deck_id}")
def get_deck(deck_id: str):
    return _detail(_deck(deck_id))


class ImportBody(BaseModel):
    text: str
    name: str = ""
    format: str = ""


@router.post("/constructed/import")
def import_deck(body: ImportBody):
    if not arena_cards.loaded:
        raise HTTPException(503, "Arena's card database isn't loaded. Check the MTGA data folder in Settings.")
    try:
        deck, unknown = _library().import_text(body.text, body.name.strip(), body.format)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {**_detail(deck), "unknown": unknown}


@router.post("/constructed/check")
def check_list(body: ImportBody):
    """Collection check for a pasted list without saving it."""
    if not arena_cards.loaded:
        raise HTTPException(503, "Arena's card database isn't loaded. Check the MTGA data folder in Settings.")
    lib = _library()
    try:
        deck, unknown = lib.import_text(body.text, "check", save=False)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {**lib.missing(deck), "unknown": unknown}


class RenameBody(BaseModel):
    name: str


@router.patch("/constructed/decks/{deck_id}")
def rename_deck(deck_id: str, body: RenameBody):
    if not _library().rename(deck_id, body.name.strip() or "Imported deck"):
        raise HTTPException(400, "Only imported decks can be renamed here; rename Arena decks in Arena.")
    return _detail(_deck(deck_id))


@router.delete("/constructed/decks/{deck_id}")
def delete_deck(deck_id: str):
    if not _library().remove(deck_id):
        raise HTTPException(400, "Only imported decks can be deleted here.")
    return {"ok": True}


class GuideRow(BaseModel):
    name: str
    count: int


class GuideBody(BaseModel):
    key: str
    ins: List[GuideRow] = []
    outs: List[GuideRow] = []
    note: str = ""


@router.put("/constructed/decks/{deck_id}/guides")
def save_guide(deck_id: str, body: GuideBody):
    _deck(deck_id)
    key = body.key.strip()[:80]
    if not key:
        raise HTTPException(400, "Pick which opponents this plan is for.")
    _library().set_guide(deck_id, key, [r.model_dump() for r in body.ins], [r.model_dump() for r in body.outs], body.note[:2000])
    state.refresh_game = True
    return _detail(_deck(deck_id))


@router.delete("/constructed/decks/{deck_id}/guides/{key}")
def delete_guide(deck_id: str, key: str):
    _deck(deck_id)
    _library().delete_guide(deck_id, key)
    state.refresh_game = True
    return _detail(_deck(deck_id))


@router.post("/constructed/decks/{deck_id}/analyze")
def analyze_deck(deck_id: str):
    from src.card_logic import simulate_deck
    from bridge.routes_decks import deck_advice

    d = _deck(deck_id)
    cards = _engine_cards(d.get("main", []))
    if sum(c["count"] for c in cards) < 40:
        raise HTTPException(400, "The simulator needs at least 40 known cards in the main deck.")
    stats = simulate_deck(cards, iterations=10000)
    return {"stats": stats, "advice": deck_advice(cards, _engine_cards(d.get("side", [])), stats) if stats else []}


@router.get("/constructed/stats")
def constructed_stats():
    records, decks, assigned = _constructed_history()
    by_deck = defaultdict(list)
    for r in records:
        d = assigned.get(r["id"])
        key = d["id"] if d else f"name:{r.get('deckName') or 'Unknown deck'}"
        by_deck[key].append(r)
    names = {d["id"]: d.get("name", "") for d in decks}
    deck_rows = []
    for key, rs in by_deck.items():
        row = {"key": key, "name": names.get(key) or key.removeprefix("name:"), **_wl(rs),
               "onPlay": _wl([r for r in rs if r.get("onPlay") is True]), "onDraw": _wl([r for r in rs if r.get("onPlay") is False])}
        deck_rows.append(row)
    deck_rows.sort(key=lambda x: -x["games"])
    colors = defaultdict(list)
    for r in records:
        colors[game_view.color_key((r.get("opponent") or {}).get("colors", [])) or "?"].append(r)
    return {
        **_breakdown(records, lambda r: routes_meta.record_format(r, assigned.get(r["id"]))),
        "byDeck": deck_rows,
        "byOpponentColors": sorted(({"key": k, **_wl(v)} for k, v in colors.items()), key=lambda x: -x["games"]),
    }


@router.get("/matches")
def matches(limit: int = 100):
    history = game_view.load_history_cached()
    meta = game_view.load_matches()
    groups: Dict[str, List[Dict]] = defaultdict(list)
    for r in history:
        groups[r.get("matchId") or r["id"]].append(r)
    out = []
    for match_id, games in groups.items():
        games.sort(key=lambda r: r.get("gameNumber", 1))
        info = meta.get(match_id, {})
        wins = sum(1 for g in games if g.get("result") == "win")
        losses = sum(1 for g in games if g.get("result") == "loss")
        result = info.get("result") or ("win" if wins > losses else "loss" if losses > wins else "draw")
        opp = games[-1].get("opponent") or {}
        out.append({
            "matchId": match_id,
            "eventId": games[0].get("eventId", ""),
            "format": "constructed" if _is_constructed(games[0]) else "limited",
            "time": games[0].get("time", ""),
            "result": result,
            "wins": wins,
            "losses": losses,
            "deckName": next((g.get("deckName") for g in games if g.get("deckName")), ""),
            "opponent": {"name": opp.get("name", ""), "archetypeName": opp.get("archetypeName", ""), "colors": opp.get("colors", [])},
            "note": info.get("note", ""),
            "games": [
                {"id": g["id"], "gameNumber": g.get("gameNumber", 1), "result": g.get("result"), "onPlay": g.get("onPlay"),
                 "turns": g.get("turns", 0), "mulligans": g.get("mulligans", 0), "sideboard": g.get("sideboard") or {"in": [], "out": []}}
                for g in games
            ],
        })
    out.sort(key=lambda m: m["time"], reverse=True)
    return out[:limit]


class NoteBody(BaseModel):
    note: str


@router.put("/matches/{match_id}/note")
def set_note(match_id: str, body: NoteBody):
    game_view.update_match(match_id, note=body.note[:2000])
    return {"ok": True}
