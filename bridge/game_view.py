"""
bridge/game_view.py
Turns the tracked game into what the overlay shows: draw odds, the opponent's
colors and possible instant-speed plays, the board, and post-game reviews.
"""

import json
import logging
import os
import re
import threading
from collections import Counter
from datetime import datetime
from typing import Callable, Dict, List, Optional

from src import constants

from bridge.game import Game, GameTracker
from bridge.serialize import serialize_card

logger = logging.getLogger(__name__)

HISTORY_FILE = os.path.join(constants.BASE_DIR, "Games", "game_history.json")
HISTORY_LIMIT = 500
COLORS = "WUBRG"
BASIC_SUBTYPES = {"SubType_Plains": "W", "SubType_Island": "U", "SubType_Swamp": "B", "SubType_Mountain": "R", "SubType_Forest": "G"}
ADD_MANA = re.compile(r"[Aa]dd[^.]*")
SYMBOL = re.compile(r"\{([WUBRGC])\}")

Resolver = Callable[[int], Optional[Dict]]


def make_resolver(set_data) -> Resolver:
    cache: Dict[int, Optional[Dict]] = {}

    def resolve(grp_id: int) -> Optional[Dict]:
        if grp_id not in cache:
            found = set_data.get_data_by_id([grp_id]) if set_data else []
            card = found[0] if found else None
            cache[grp_id] = card if card and not str(card.get("name", "")).isdigit() else None
        return cache[grp_id]

    return resolve


def _name(resolve: Resolver, grp_id: int) -> str:
    card = resolve(grp_id)
    return card["name"] if card else f"Card #{grp_id}"


def _card(resolve: Resolver, grp_id: int, count: int = 1) -> Dict:
    card = resolve(grp_id)
    if not card:
        card = {"name": f"Card #{grp_id}", "types": [], "colors": [], "image": []}
    view = serialize_card({**card, "count": count})
    view["grpId"] = grp_id
    return view


def _is_land(obj: Dict) -> bool:
    return "CardType_Land" in obj.get("cardTypes", [])


def _land_colors(obj: Dict, card: Optional[Dict]) -> set:
    colors = {BASIC_SUBTYPES[s] for s in obj.get("subtypes", []) if s in BASIC_SUBTYPES}
    if not colors and card:
        for clause in ADD_MANA.findall(card.get("oracle_text", "") or ""):
            colors |= {c for c in SYMBOL.findall(clause) if c != "C"}
            if "any color" in clause:
                colors |= set(COLORS)
    return colors


def _hypergeom_any(copies: int, library: int, draws: int) -> float:
    """Chance of drawing at least one of `copies` in the next `draws` cards."""
    if library <= 0 or copies <= 0:
        return 0.0
    miss = 1.0
    for i in range(min(draws, library)):
        miss *= max(0, library - copies - i) / (library - i)
    return 1.0 - miss


def _side(game: Game, seat: int, resolve: Resolver) -> Dict:
    battlefield, lands, colors = [], [0, 0], set()
    for obj in game.cards_in(seat, "ZoneType_Battlefield"):
        grp = obj.get("grpId")
        if _is_land(obj):
            lands[1] += 1
            if not obj.get("isTapped"):
                lands[0] += 1
                colors |= _land_colors(obj, resolve(grp))
            continue
        if obj.get("type") not in ("GameObjectType_Card", "GameObjectType_Token"):
            continue
        view = _card(resolve, grp)
        view.update({
            "instanceId": obj["instanceId"],
            "power": (obj.get("power") or {}).get("value"),
            "toughness": (obj.get("toughness") or {}).get("value"),
            "tapped": bool(obj.get("isTapped")),
            "token": obj.get("type") == "GameObjectType_Token",
        })
        battlefield.append(view)
    return {
        "life": game.life_of(seat),
        "hand": game.zone_size(seat, "ZoneType_Hand"),
        "library": game.zone_size(seat, "ZoneType_Library"),
        "graveyard": game.zone_size(seat, "ZoneType_Graveyard"),
        "lands": {"untapped": lands[0], "total": lands[1], "colors": [c for c in COLORS if c in colors]},
        "battlefield": battlefield,
    }


def _opponent_profile(game: Game, resolve: Resolver) -> Dict:
    counts = Counter(game.opp_seen.values())
    pips = Counter()
    for grp, n in counts.items():
        card = resolve(grp)
        if card and "Land" not in card.get("types", []):
            for c in card.get("colors", []) or []:
                pips[c] += n
    colors = [c for c in COLORS if pips[c]]
    top = [c for c, _ in pips.most_common(2)]
    seen = sorted((_card(resolve, g, n) for g, n in counts.items()), key=lambda c: (c["cmc"], c["name"]))
    return {"colors": colors, "archetype": "".join(c for c in COLORS if c in top), "seen": seen}


def _tricks(set_data, colors: List[str], open_mana: int, land_colors: List[str], limit: int = 8) -> List[Dict]:
    """Instant-speed cards the opponent could cast right now, most-played first."""
    if open_mana <= 0 or not set_data:
        return []
    allowed = set(colors or land_colors or COLORS)
    castable = set(land_colors) if land_colors else allowed
    out, names = [], set()
    for card in (set_data.get_card_ratings() or {}).values():
        name = card.get("name", "")
        if name in names or str(name).isdigit():
            continue
        instant = "Instant" in card.get("types", []) or "Flash" in (card.get("keywords") or [])
        cmc = card.get("cmc", 0) or 0
        card_colors = set(card.get("colors", []) or [])
        if not instant or cmc <= 0 or cmc > open_mana or not card_colors <= allowed or not card_colors <= castable:
            continue
        names.add(name)
        stats = (card.get(constants.DATA_FIELD_DECK_COLORS) or {}).get(constants.FILTER_OPTION_ALL_DECKS, {})
        text = card.get("oracle_text", "") or ""
        tags = card.get("tags", []) or []
        if re.search(r"\bcounter target\b", text, re.I):
            kind = "counter"
        elif "removal" in tags:
            kind = "removal"
        elif "combat_trick" in tags or "protection" in tags:
            kind = "trick"
        elif "Creature" in card.get("types", []):
            kind = "flash creature"
        else:
            kind = "instant"
        view = serialize_card(card)
        view["trickKind"] = kind
        out.append((stats.get(constants.DATA_FIELD_GIH, 0) or 0, view))
    out.sort(key=lambda x: -x[0])
    return [v for _, v in out[:limit]]


def build_view(tracker: GameTracker, set_data) -> Optional[Dict]:
    game = tracker.game
    if not game:
        return None
    resolve = make_resolver(set_data)
    me, opp = game.seat, game.opponent
    library_size = game.zone_size(me, "ZoneType_Library")
    remaining = game.library_remaining()
    total_known = sum(remaining.values())
    denom = library_size or total_known
    cards, lands_left = [], 0
    for grp, n in remaining.items():
        view = _card(resolve, grp, n)
        view["nextDraw"] = n / denom if denom else 0
        if "Land" in view["types"]:
            lands_left += n
        cards.append(view)
    cards.sort(key=lambda c: (-c["count"], c["cmc"], c["name"]))

    opp_side = _side(game, opp, resolve)
    profile = _opponent_profile(game, resolve)
    turn = game.turn
    return {
        "matchId": game.match_id,
        "gameNumber": game.game_number,
        "eventId": game.event_id,
        "active": not game.over,
        "result": game.result,
        "turn": turn.get("turnNumber", 0),
        "phase": turn.get("phase", ""),
        "step": turn.get("step", ""),
        "myTurn": turn.get("activePlayer") == me,
        "onPlay": game.on_play,
        "me": _side(game, me, resolve),
        "opponent": {**opp_side, **profile},
        "tricks": _tricks(set_data, profile["colors"], opp_side["lands"]["untapped"], opp_side["lands"]["colors"]),
        "library": {
            "size": library_size,
            "tracked": bool(game.deck),
            "landNext": lands_left / denom if denom else 0,
            "landWithin2": _hypergeom_any(lands_left, denom, 2),
            "cards": cards,
        },
    }


# ---- post-game records ----------------------------------------------------

def build_record(game: Game, set_data) -> Dict:
    resolve = make_resolver(set_data)
    deck = Counter(game.deck)
    is_land = lambda g: bool((c := resolve(g)) and "Land" in c.get("types", []))
    seen = list(game.opening_hand or []) + game.drawn
    lands_seen = sum(1 for g in seen if is_land(g))
    early_turns = game.my_turns[:5]
    missed = [t for t in early_turns if t not in game.land_turns and t != game.turn.get("turnNumber")]
    land_pct = lands_seen / len(seen) if seen else 0
    if len(missed) >= 2 and land_pct < 0.38:
        verdict = "screw"
    elif land_pct >= 0.55 and len(seen) >= 12:
        verdict = "flood"
    else:
        verdict = "smooth"
    profile = _opponent_profile(game, resolve)
    return {
        "id": game.key,
        "matchId": game.match_id,
        "gameNumber": game.game_number,
        "eventId": game.event_id,
        "time": (datetime.fromtimestamp(game.updated_at) if game.updated_at else datetime.now()).isoformat(timespec="seconds"),
        "result": game.result,
        "onPlay": game.on_play,
        "mulligans": max(0, 7 - len(game.opening_hand)) if game.opening_hand else 0,
        "turns": game.turn.get("turnNumber", 0),
        "deck": [{"name": _name(resolve, g), "count": n} for g, n in deck.items()],
        "opponent": {
            "colors": profile["colors"],
            "archetype": profile["archetype"],
            "cards": [{"name": c["name"], "count": c["count"]} for c in profile["seen"]],
        },
        "mana": {"cardsSeen": len(seen), "landsSeen": lands_seen, "landPct": land_pct, "missedDrops": missed, "verdict": verdict},
        "life": [[t, *v] for t, v in sorted(game.life.items())],
        "timeline": [
            {"turn": e["turn"], "mine": e["mine"], "action": e["action"], "name": _name(resolve, e["grpId"])}
            for e in game.events
        ][-300:],
    }


_history_lock = threading.Lock()


def load_history(path: str = None) -> List[Dict]:
    path = path or HISTORY_FILE
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def append_history(record: Dict, path: str = None):
    path = path or HISTORY_FILE
    with _history_lock:
        history = [r for r in load_history(path) if r.get("id") != record["id"]]
        history.append(record)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(history[-HISTORY_LIMIT:], f)
        os.replace(tmp, path)


def _spells(cards: Dict[str, int]) -> Counter:
    return Counter({n: c for n, c in cards.items() if n not in constants.BASIC_LANDS})


def match_build(deck: List[Dict], variants: Dict[str, Dict[str, int]], threshold: float = 0.85) -> Optional[str]:
    """Name of the saved build this game's deck most resembles, if any is close enough."""
    played = _spells({d["name"]: d["count"] for d in deck})
    if not played:
        return None
    best, best_score = None, threshold
    for name, counts in variants.items():
        build = _spells(counts)
        if not build:
            continue
        overlap = sum((played & build).values())
        score = overlap / max(sum(played.values()), sum(build.values()))
        if score >= best_score:
            best, best_score = name, score
    return best
