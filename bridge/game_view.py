"""
bridge/game_view.py
Turns the tracked game into what the overlay shows: draw odds, the opponent's
colors and possible instant-speed plays, the board, mulligan advice, and
post-game reviews. Limited games lean on 17Lands ratings; constructed games use
the opponent's revealed cards and what similar past opponents have shown.
"""

import json
import logging
import os
import re
import threading
from collections import Counter
from datetime import datetime
from math import comb
from typing import Callable, Dict, List, Optional

from src import constants

from bridge.arena_cards import arena_cards
from bridge.decks import is_limited_event, pick_guide
from bridge.game import Game, GameTracker
from bridge.serialize import serialize_card

logger = logging.getLogger(__name__)

HISTORY_FILE = os.path.join(constants.BASE_DIR, "Games", "game_history.json")
MATCHES_FILE = os.path.join(constants.BASE_DIR, "Games", "matches.json")
HISTORY_LIMIT = 500
COLORS = "WUBRG"
BASIC_SUBTYPES = {"SubType_Plains": "W", "SubType_Island": "U", "SubType_Swamp": "B", "SubType_Mountain": "R", "SubType_Forest": "G"}
BASIC_NAMES = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G"}
ADD_MANA = re.compile(r"[Aa]dd[^.]*")
SYMBOL = re.compile(r"\{([WUBRGC])\}")
GUILDS = {
    "W": "Mono-White", "U": "Mono-Blue", "B": "Mono-Black", "R": "Mono-Red", "G": "Mono-Green",
    "WU": "Azorius", "UB": "Dimir", "BR": "Rakdos", "RG": "Gruul", "WG": "Selesnya",
    "WB": "Orzhov", "UR": "Izzet", "BG": "Golgari", "WR": "Boros", "UG": "Simic",
    "WUB": "Esper", "UBR": "Grixis", "BRG": "Jund", "WRG": "Naya", "WUG": "Bant",
    "WBG": "Abzan", "WUR": "Jeskai", "UBG": "Sultai", "WBR": "Mardu", "URG": "Temur",
}

Resolver = Callable[[int], Optional[Dict]]


def make_resolver(set_data, cards=None) -> Resolver:
    """17Lands ratings first (they carry win rates), then Arena's own card database."""
    cards = cards if cards is not None else arena_cards
    ratings = (set_data.get_card_ratings() or {}) if set_data else {}
    cache: Dict[int, Optional[Dict]] = {}

    def resolve(grp_id: int) -> Optional[Dict]:
        if grp_id not in cache:
            card = ratings.get(str(grp_id))
            if not card or str(card.get("name", "")).isdigit():
                card = cards.get(grp_id)
            if not card and set_data and not cards.loaded:
                found = set_data.get_data_by_id([grp_id])
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


def merge_by_name(views: List[Dict]) -> List[Dict]:
    """Collapse rows for different printings (grpIds) of the same card."""
    by_name: Dict[str, Dict] = {}
    for view in views:
        if view["name"] in by_name:
            by_name[view["name"]]["count"] += view["count"]
        else:
            by_name[view["name"]] = view
    return list(by_name.values())


def _is_land(obj: Dict) -> bool:
    return "CardType_Land" in obj.get("cardTypes", [])


def _card_is_land(card: Optional[Dict]) -> bool:
    return bool(card and "Land" in card.get("types", []))


def _text_colors(card: Optional[Dict]) -> set:
    colors = set()
    for clause in ADD_MANA.findall((card or {}).get("oracle_text", "") or ""):
        colors |= {c for c in SYMBOL.findall(clause) if c != "C"}
        if "any color" in clause or "any one color" in clause:
            colors |= set(COLORS)
    return colors


def _land_colors(obj: Dict, card: Optional[Dict]) -> set:
    colors = {BASIC_SUBTYPES[s] for s in obj.get("subtypes", []) if s in BASIC_SUBTYPES}
    return colors or _text_colors(card)


def _card_land_colors(card: Optional[Dict]) -> set:
    colors = {BASIC_NAMES[s] for s in (card or {}).get("subtypes", []) or [] if s in BASIC_NAMES}
    if not colors and card and card.get("name") in BASIC_NAMES:
        colors = {BASIC_NAMES[card["name"]]}
    return colors or _text_colors(card)


def _hypergeom_any(copies: int, library: int, draws: int) -> float:
    """Chance of drawing at least one of `copies` in the next `draws` cards."""
    if library <= 0 or copies <= 0:
        return 0.0
    miss = 1.0
    for i in range(min(draws, library)):
        miss *= max(0, library - copies - i) / (library - i)
    return 1.0 - miss


def _hypergeom_at_least(need: int, copies: int, library: int, draws: int) -> float:
    """Chance of at least `need` of `copies` among `draws` cards from `library`."""
    if need <= 0:
        return 1.0
    draws = min(draws, library)
    if library <= 0 or copies < need or draws < need:
        return 0.0
    total = comb(library, draws)
    hit = sum(comb(copies, k) * comb(library - copies, draws - k) for k in range(need, min(copies, draws) + 1))
    return hit / total


def color_key(colors) -> str:
    return "".join(c for c in COLORS if c in set(colors))


def archetype_name(colors: List[str], cards: List[Dict]) -> str:
    """'Azorius Control', 'Mono-Red Aggro'... from colors and the cards seen so far."""
    key = color_key(colors)
    base = GUILDS.get(key) or (f"{len(key)}-Color" if key else "Colorless")
    spells = [c for c in cards if not _card_is_land(c)]
    copies = sum(c.get("count", 1) for c in spells)
    if copies < 4:
        return base
    creatures = sum(c.get("count", 1) for c in spells if "Creature" in c.get("types", []))
    interaction = sum(c.get("count", 1) for c in spells if "removal" in (c.get("tags") or []))
    ramp = sum(c.get("count", 1) for c in spells if "fixing_ramp" in (c.get("tags") or []))
    avg = sum((c.get("cmc", 0) or 0) * c.get("count", 1) for c in spells) / copies
    if (creatures / copies >= 0.6 and avg <= 2.6) or avg <= 1.9:
        return f"{base} Aggro"
    if creatures / copies <= 0.35 and interaction / copies >= 0.3 and avg >= 2.4:
        return f"{base} Control"
    if ramp >= 2 and avg >= 3:
        return f"{base} Ramp"
    return f"{base} Midrange"


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


def _opponent_profile(game: Game, resolve: Resolver, earlier: Optional[Counter] = None) -> Dict:
    """Colors and archetype from this game's revealed cards plus `earlier` games of the match;
    `seen` lists this game's cards only."""
    counts = Counter(game.opp_seen.values())
    known = counts | (earlier or Counter())
    pips = Counter()
    for grp, n in known.items():
        card = resolve(grp)
        if card and "Land" not in card.get("types", []):
            for c in card.get("colors", []) or []:
                pips[c] += n
    colors = [c for c in COLORS if pips[c]]
    top = [c for c, _ in pips.most_common(2)]
    seen = sorted(merge_by_name([_card(resolve, g, n) for g, n in counts.items()]), key=lambda c: (c["cmc"], c["name"]))
    raw = [dict(resolve(g) or {}, count=n) for g, n in known.items()]
    return {
        "colors": colors,
        "archetype": "".join(c for c in COLORS if c in top),
        "archetypeName": archetype_name(colors, raw),
        "seen": seen,
    }


def _trick_kind(card: Dict) -> str:
    text = (card.get("oracle_text", "") or "") + "\n" + (card.get("back_text", "") or "")
    tags = card.get("tags", []) or []
    if re.search(r"\bcounter target\b", text, re.I):
        return "counter"
    if "removal" in tags:
        return "removal"
    if "combat_trick" in tags or "protection" in tags:
        return "trick"
    if "Creature" in card.get("types", []) and "Flash" in (card.get("keywords") or []):
        return "flash creature"
    return "instant"


def _instant_cost(card: Dict) -> Optional[int]:
    """Cheapest mana value to cast it at instant speed (either face), or None."""
    costs = []
    if "Instant" in card.get("types", []) or "Flash" in (card.get("keywords") or []):
        costs.append(card.get("cmc", 0) or 0)
    if "Instant" in (card.get("back_types") or []):
        costs.append(card.get("back_cmc", card.get("cmc", 0)) or 0)
    return min(costs) if costs else None


def _fits(card: Dict, open_mana: int, allowed: set, castable: set) -> bool:
    cost = _instant_cost(card)
    colors = set(card.get("colors", []) or [])
    return cost is not None and 0 < cost <= open_mana and colors <= allowed and colors <= castable


def _tricks(set_data, colors: List[str], open_mana: int, land_colors: List[str], limit: int = 8) -> List[Dict]:
    """Limited: instant-speed cards in the set the opponent could cast now, most-played first."""
    if open_mana <= 0 or not set_data:
        return []
    allowed = set(colors or land_colors or COLORS)
    castable = set(land_colors) if land_colors else allowed
    out, names = [], set()
    for card in (set_data.get_card_ratings() or {}).values():
        name = card.get("name", "")
        if name in names or str(name).isdigit() or not _fits(card, open_mana, allowed, castable):
            continue
        names.add(name)
        stats = (card.get(constants.DATA_FIELD_DECK_COLORS) or {}).get(constants.FILTER_OPTION_ALL_DECKS, {})
        view = serialize_card(card)
        view["trickKind"] = _trick_kind(card)
        view["source"] = "set"
        out.append((stats.get(constants.DATA_FIELD_GIH, 0) or 0, view))
    out.sort(key=lambda x: -x[0])
    return [v for _, v in out[:limit]]


def _constructed_tricks(game: Game, resolve: Resolver, open_mana: int, land_colors: List[str], similar: Optional[Dict], limit: int = 8) -> List[Dict]:
    """Constructed: instant-speed cards the opponent has revealed this match, then
    ones that similar past opponents played."""
    if open_mana <= 0:
        return []
    allowed = set(COLORS)
    castable = set(land_colors) if land_colors else allowed
    out, names = [], set()
    seen = game.match_opp | Counter(game.opp_seen.values())
    for grp, n in sorted(seen.items(), key=lambda x: -x[1]):
        card = resolve(grp)
        if not card or card["name"] in names or not _fits(card, open_mana, allowed, castable):
            continue
        names.add(card["name"])
        view = _card(resolve, grp, n)
        view.update(trickKind=_trick_kind(card), source="revealed")
        out.append(view)
    for p in (similar or {}).get("cards", []):
        card = arena_cards.lookup(p["name"])
        if not card or card["name"] in names or not _fits(card, open_mana, allowed, castable):
            continue
        names.add(card["name"])
        view = serialize_card(dict(card, count=1))
        view.update(trickKind=_trick_kind(card), source="seen before", seenIn=p["games"])
        out.append(view)
    return out[:limit]


# ---- learning from past opponents ------------------------------------------------

_land_names: Dict[str, bool] = {}


def _is_land_name(name: str) -> bool:
    if name not in _land_names:
        _land_names[name] = name in BASIC_NAMES or _card_is_land(arena_cards.lookup(name))
    return _land_names[name]


def similar_opponents(seen_names: List[str], history: List[Dict], exclude_match: str = "") -> Optional[Dict]:
    """Past opponents whose revealed spells overlap these; what else they showed."""
    current = {n for n in seen_names if not _is_land_name(n)}
    if len(current) < 2:
        return None
    matches, freq, names = [], Counter(), Counter()
    for r in history:
        if r.get("matchId") == exclude_match or r.get("format") == "limited":
            continue
        theirs = {c["name"] for c in (r.get("opponent") or {}).get("cards", []) if not _is_land_name(c["name"])}
        overlap = len(current & theirs)
        if overlap >= 2 and overlap / len(current) >= 0.5:
            matches.append(r)
            freq.update(theirs - current)
            names[(r.get("opponent") or {}).get("archetypeName") or ""] += 1
    if not matches:
        return None
    return _similar_summary(matches, freq, names, "cards")


def opponents_by_colors(colors: List[str], seen_names: List[str], history: List[Dict], exclude_match: str = "") -> Optional[Dict]:
    """Fallback when no past opponent shares cards yet: past opponents on exactly these colors."""
    key = color_key(colors)
    if not key:
        return None
    current = {n for n in seen_names if not _is_land_name(n)}
    matches, freq, names = [], Counter(), Counter()
    for r in history:
        opp = r.get("opponent") or {}
        if r.get("matchId") == exclude_match or r.get("format") == "limited" or color_key(opp.get("colors", [])) != key:
            continue
        matches.append(r)
        freq.update({c["name"] for c in opp.get("cards", []) if not _is_land_name(c["name"])} - current)
        names[opp.get("archetypeName") or ""] += 1
    if not matches:
        return None
    return _similar_summary(matches, freq, names, "colors")


def _similar_summary(matches: List[Dict], freq: Counter, names: Counter, basis: str) -> Dict:
    wins = sum(1 for r in matches if r.get("result") == "win")
    losses = sum(1 for r in matches if r.get("result") == "loss")
    label = next((n for n, _ in names.most_common() if n), "")
    cards = []
    for name, k in freq.most_common(12):
        card = arena_cards.lookup(name)
        view = serialize_card(dict(card, count=1)) if card else {"name": name, "cmc": 0, "manaCost": "", "types": [], "colors": [], "images": []}
        view["games"] = k
        cards.append(view)
    return {"games": len(matches), "wins": wins, "losses": losses, "archetype": label, "basis": basis, "cards": cards}


def versus(name: str, history: List[Dict], exclude_match: str = "") -> Optional[Dict]:
    """Your past games against this exact opponent."""
    if not name:
        return None
    games = [r for r in history if (r.get("opponent") or {}).get("name") == name and r.get("matchId") != exclude_match]
    if not games:
        return None
    games.sort(key=lambda r: r.get("time", ""))
    shown = Counter(c["name"] for r in games for c in (r.get("opponent") or {}).get("cards", []) if not _is_land_name(c["name"]))
    return {
        "games": len(games),
        "wins": sum(1 for r in games if r.get("result") == "win"),
        "losses": sum(1 for r in games if r.get("result") == "loss"),
        "last": games[-1].get("time", ""),
        "archetypes": sorted({(r.get("opponent") or {}).get("archetypeName") or "" for r in games} - {""}),
        "cards": [n for n, _ in shown.most_common(10)],
    }


OUT_ROLES = (
    ("land", "Land", lambda c: "Land" in c["types"]),
    ("creature", "Creature", lambda c: "Creature" in c["types"]),
    ("removal", "Interaction", lambda c: "removal" in (c.get("tags") or [])),
    ("draw", "Card draw", lambda c: "card_advantage" in (c.get("tags") or [])),
)


def outs(cards: List[Dict], library: int) -> List[Dict]:
    """Chance to draw each kind of card within the next 1, 2 and 3 draws."""
    out = []
    for key, label, test in OUT_ROLES:
        copies = sum(c["count"] for c in cards if test(c))
        if copies:
            out.append({"key": key, "label": label, "copies": copies, "odds": [_hypergeom_any(copies, library, k) for k in (1, 2, 3)]})
    return out


def opponent_plays(game: Game, resolve: Resolver) -> List[Dict]:
    """What the opponent cast or played each turn, oldest first."""
    turns: Dict[int, List[Dict]] = {}
    for e in game.events:
        if e["mine"] or e["action"] not in ("cast", "played"):
            continue
        card = resolve(e["grpId"]) or {}
        turns.setdefault(e["turn"], []).append({
            "name": card.get("name") or f"Card #{e['grpId']}", "land": e["action"] == "played", "cmc": card.get("cmc", 0) or 0,
        })
    return [{"turn": t, "plays": p} for t, p in sorted(turns.items())]


# ---- mulligan ---------------------------------------------------------------------

def _mulligan(game: Game, resolve: Resolver) -> Optional[Dict]:
    if not game.deciding_mulligan or not game.deck:
        return None
    me = game.seat
    hand = [o.get("grpId") for o in game.cards_in(me, "ZoneType_Hand")]
    if not hand:
        return None
    on_play = game.on_play if game.on_play is not None else game.turn.get("activePlayer") == me
    cards = [resolve(g) or {} for g in hand]
    lands = [c for c in cards if _card_is_land(c)]
    spells = [c for c in cards if not _card_is_land(c)]
    produced = set().union(*(_card_land_colors(c) for c in lands)) if lands else set()

    library = game.library_remaining()
    lib_size = sum(library.values()) or game.zone_size(me, "ZoneType_Library")
    lib_lands = sum(n for g, n in library.items() if _card_is_land(resolve(g)))
    draws_t3 = 2 if on_play else 3

    pips = Counter()
    for g in game.deck:
        c = resolve(g)
        if c and not _card_is_land(c):
            for sym in re.findall(r"\{([WUBRG])\}", c.get("mana_cost", "") or ""):
                pips[sym] += 1
    total_pips = sum(pips.values()) or 1
    main_colors = [c for c in COLORS if pips[c] / total_pips >= 0.15]
    missing = [c for c in main_colors if c not in produced]

    def castable(c: Dict, mana: int) -> bool:
        need = set(re.findall(r"\{([WUBRG])\}", c.get("mana_cost", "") or ""))
        return (c.get("cmc", 0) or 0) <= mana and need <= produced

    early = [c for c in spells if castable(c, min(3, len(lands)))]
    p_land2 = _hypergeom_at_least(2 - len(lands), lib_lands, lib_size, draws_t3 - 1)
    p_land3 = _hypergeom_at_least(3 - len(lands), lib_lands, lib_size, draws_t3)
    p_land4 = _hypergeom_at_least(4 - len(lands), lib_lands, lib_size, draws_t3 + 1)

    reasons, n = [], len(hand)
    if len(lands) <= 1:
        verdict = "mulligan" if len(lands) == 0 or p_land3 < 0.35 else "risky"
        reasons.append(f"{len(lands)} land{'s' if len(lands) != 1 else ''}: {round(p_land3 * 100)}% to have 3 lands by turn 3")
    elif len(lands) >= n - 1:
        verdict = "mulligan"
        reasons.append(f"{len(lands)} lands and only {len(spells)} spell{'s' if len(spells) != 1 else ''}")
    elif len(lands) >= 5:
        verdict = "risky"
        reasons.append("Land-heavy: flood risk")
    else:
        verdict = "keep"
        reasons.append(f"{len(lands)} lands, {len(spells)} spells")
    if spells and not early and verdict == "keep":
        verdict = "risky"
        reasons.append("Nothing castable by turn 3 with these lands")
    elif early:
        reasons.append(f"{len(early)} spell{'s' if len(early) != 1 else ''} castable by turn 3")
    if missing:
        sources = sum(n for g, n in library.items() if _card_is_land(resolve(g)) and set(missing) & _card_land_colors(resolve(g)))
        p_fix = _hypergeom_any(sources, lib_size, draws_t3)
        reasons.append(f"No {'/'.join(missing)} source yet: {round(p_fix * 100)}% to draw one by turn 3")
        if verdict == "keep" and p_fix < 0.5 and len(early) <= 1:
            verdict = "risky"
    return {
        "verdict": verdict,
        "handSize": n,
        "mulligans": game.mulligans,
        "onPlay": on_play,
        "lands": len(lands),
        "spells": len(spells),
        "colors": [c for c in COLORS if c in produced],
        "missingColors": missing,
        "landBy2": p_land2,
        "landBy3": p_land3,
        "landBy4": p_land4,
        "reasons": reasons,
    }


# ---- live view --------------------------------------------------------------------

def game_format(game: Game) -> str:
    return "constructed" if game.event_id and not is_limited_event(game.event_id) else "limited"


def build_view(tracker: GameTracker, set_data, history: Optional[List[Dict]] = None, library=None) -> Optional[Dict]:
    game = tracker.game
    if not game:
        return None
    fmt = game_format(game)
    resolve = make_resolver(set_data if fmt == "limited" or not arena_cards.loaded else None)
    me, opp = game.seat, game.opponent
    library_size = game.zone_size(me, "ZoneType_Library")
    remaining = game.library_remaining()
    total_known = sum(remaining.values())
    denom = library_size or total_known
    cards = merge_by_name([_card(resolve, grp, n) for grp, n in remaining.items() if n > 0])
    lands_left = sum(c["count"] for c in cards if "Land" in c["types"])
    for view in cards:
        view["nextDraw"] = view["count"] / denom if denom else 0
    cards.sort(key=lambda c: (-c["count"], c["cmc"], c["name"]))

    opp_side = _side(game, opp, resolve)
    constructed = fmt == "constructed"
    profile = _opponent_profile(game, resolve, game.match_opp if constructed else None)
    history = history if history is not None else load_history_cached()
    similar, guide = None, None
    if constructed:
        seen_names = [c["name"] for c in profile["seen"]] + [_name(resolve, g) for g in game.match_opp]
        similar = similar_opponents(seen_names, history, game.match_id) or opponents_by_colors(profile["colors"], seen_names, history, game.match_id)
        tricks = _constructed_tricks(game, resolve, opp_side["lands"]["untapped"], opp_side["lands"]["colors"], similar)
        deck = library.decks.get(game.deck_id) if library and game.deck_id else None
        picked = pick_guide((deck or {}).get("guides") or {}, profile["archetypeName"])
        if picked:
            guide = {"key": picked[0], **picked[1]}
    else:
        tricks = _tricks(set_data, profile["colors"], opp_side["lands"]["untapped"], opp_side["lands"]["colors"])
    match_games = sorted(
        (r for r in history if r.get("matchId") == game.match_id and r.get("gameNumber") != game.game_number),
        key=lambda r: r.get("gameNumber", 1),
    )
    turn = game.turn
    return {
        "matchId": game.match_id,
        "gameNumber": game.game_number,
        "eventId": game.event_id,
        "format": fmt,
        "deck": {"id": game.deck_id, "name": game.deck_name},
        "match": {
            "wins": sum(1 for r in match_games if r.get("result") == "win"),
            "losses": sum(1 for r in match_games if r.get("result") == "loss"),
            "sideboard": sideboard_changes(game, resolve),
            "games": [{"gameNumber": r.get("gameNumber", 1), "result": r.get("result"), "onPlay": r.get("onPlay"), "turns": r.get("turns", 0)} for r in match_games],
            "sideboarding": tracker.sideboarding == game.match_id,
            "guide": guide,
        },
        "active": not game.over,
        "result": game.result,
        "turn": turn.get("turnNumber", 0),
        "phase": turn.get("phase", ""),
        "step": turn.get("step", ""),
        "myTurn": turn.get("activePlayer") == me,
        "onPlay": game.on_play,
        "me": _side(game, me, resolve),
        "opponent": {
            **opp_side, **profile, "name": game.opponent_name, "similar": similar,
            "plays": opponent_plays(game, resolve), "versus": versus(game.opponent_name, history, game.match_id),
        },
        "tricks": tricks,
        "mulligan": _mulligan(game, resolve),
        "library": {
            "size": library_size,
            "tracked": bool(game.deck),
            "landNext": lands_left / denom if denom else 0,
            "landWithin2": _hypergeom_any(lands_left, denom, 2),
            "outs": outs(cards, denom),
            "cards": cards,
        },
    }


def sideboard_changes(game: Game, resolve: Resolver) -> Dict[str, List[Dict]]:
    """Cards brought in / taken out relative to game 1 of this match."""
    if game.game_number <= 1 or not game.first_deck:
        return {"in": [], "out": []}
    now = Counter(_name(resolve, g) for g in game.deck)
    first = Counter(_name(resolve, g) for g in game.first_deck)
    as_rows = lambda c: [{"name": n, "count": k} for n, k in sorted(c.items())]
    return {"in": as_rows(now - first), "out": as_rows(first - now)}


# ---- post-game records ----------------------------------------------------

def build_record(game: Game, set_data) -> Dict:
    fmt = game_format(game)
    resolve = make_resolver(set_data if fmt == "limited" or not arena_cards.loaded else None)
    deck = Counter(game.deck)
    is_land = lambda g: _card_is_land(resolve(g))
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
    profile = _opponent_profile(game, resolve, game.match_opp if fmt == "constructed" else None)
    hand_mulls = max(0, 7 - len(game.opening_hand)) if game.opening_hand else 0
    return {
        "id": game.key,
        "matchId": game.match_id,
        "gameNumber": game.game_number,
        "eventId": game.event_id,
        "format": fmt,
        "deckId": game.deck_id,
        "deckName": game.deck_name,
        "time": (datetime.fromtimestamp(game.updated_at) if game.updated_at else datetime.now()).isoformat(timespec="seconds"),
        "result": game.result,
        "onPlay": game.on_play,
        "mulligans": max(game.mulligans, hand_mulls),
        "turns": game.turn.get("turnNumber", 0),
        "deck": [{"name": _name(resolve, g), "count": n} for g, n in deck.items()],
        "sideboard": sideboard_changes(game, resolve),
        "opponent": {
            "name": game.opponent_name,
            "colors": profile["colors"],
            "archetype": profile["archetype"],
            "archetypeName": profile["archetypeName"],
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
_history_cache: Dict[str, tuple] = {}


def load_history(path: str = None) -> List[Dict]:
    path = path or HISTORY_FILE
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def load_history_cached(path: str = None) -> List[Dict]:
    """History, re-read only when the file changes (the live view asks often)."""
    path = path or HISTORY_FILE
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        return []
    cached = _history_cache.get(path)
    if cached and cached[0] == stamp:
        return cached[1]
    history = load_history(path)
    _history_cache[path] = (stamp, history)
    return history


def append_history(record: Dict, path: str = None):
    path = path or HISTORY_FILE
    with _history_lock:
        history = [r for r in load_history(path) if r.get("id") != record["id"]]
        history.append(record)
        history.sort(key=lambda r: r.get("time", ""))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(history[-HISTORY_LIMIT:], f)
        os.replace(tmp, path)


def load_matches(path: str = None) -> Dict[str, Dict]:
    path = path or MATCHES_FILE
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def update_match(match_id: str, path: str = None, **fields):
    path = path or MATCHES_FILE
    with _history_lock:
        matches = load_matches(path)
        matches[match_id] = {**matches.get(match_id, {}), **{k: v for k, v in fields.items() if v is not None}}
        if len(matches) > HISTORY_LIMIT:
            for old in sorted(matches, key=lambda m: matches[m].get("time", ""))[: len(matches) - HISTORY_LIMIT]:
                del matches[old]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(matches, f)
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
