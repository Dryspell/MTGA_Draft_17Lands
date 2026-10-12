"""
bridge/routes_decks.py
Deck Builder, Custom Deck, practice sealed and Sealed Studio routes.
Decks travel as [{name, count}] and are resolved against the active dataset.
"""

import copy
import os
import random
import re
import uuid
from typing import Dict, List, Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src import constants
from src.card_logic import copy_deck, get_strict_colors, is_castable
from src.configuration import write_configuration
from src.sealed_logic import SealedSession, generate_sealed_shells
from src.utils import normalize_color_string, read_local_manifest, retrieve_local_set_list, sanitize_card_name

from bridge.jobs import JobContext, start_job
from bridge.serialize import serialize_cards
from bridge.state import state

router = APIRouter(prefix="/api")

BASIC_COLOR = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G"}


class DeckEntry(BaseModel):
    name: str
    count: int = 1


class DeckBody(BaseModel):
    deck: List[DeckEntry] = []
    sideboard: List[DeckEntry] = []


def _basic(name: str, count: int) -> Dict:
    color = BASIC_COLOR.get(name, "")
    return {"name": name, "cmc": 0, "types": ["Land", "Basic"], "colors": [color] if color else [], "count": count}


def _resolve(entries: List[DeckEntry]) -> List[Dict]:
    merged: Dict[str, int] = {}
    for e in entries:
        if e.count > 0:
            merged[e.name] = merged.get(e.name, 0) + e.count
    by_name = {c["name"]: c for c in state.scanner.set_data.get_data_by_name(list(merged))}
    out = []
    for name, count in merged.items():
        if name in by_name:
            out.append(dict(copy.deepcopy(by_name[name]), count=count))
        elif name in constants.BASIC_LANDS:
            out.append(_basic(name, count))
    return out


def _is_land(c):
    return "Land" in c.get("types", [])


def _gihwr(c):
    return float(c.get("deck_colors", {}).get("All Decks", {}).get("gihwr", 0) or 0)


def _sort(cards):
    return sorted(cards, key=lambda x: (x.get("cmc", 0), x.get("name", "")))


def deck_advice(deck: List[Dict], sideboard: List[Dict], stats: Dict, note: Optional[str] = None) -> List[str]:
    advice = []
    if not stats:
        return advice
    if stats["cast_t2"] < 50:
        advice.append("Add more 2-drops to improve early board presence.")
    non_basics = [c for c in deck if _is_land(c) and "Basic" not in c.get("types", []) and c.get("name") not in constants.BASIC_LANDS]
    colorless = [c for c in non_basics if not c.get("colors")]
    if stats["color_screw_t3"] > 10.0:
        if colorless:
            advice.append(f"Color screw risk is elevated. Consider cutting a colorless utility land (like {colorless[0].get('name', '')}) for a basic land.")
        else:
            advice.append("High color screw risk. Consider cutting a splash card or adding more fixing.")
    is_18 = bool(note and "18 Lands" in note)
    is_16 = bool(note and "16 Lands" in note)
    if stats["screw_t3"] > 22.0 and not is_16:
        advice.append("Frequently missing land drops. Consider running an extra land.")
    if stats["flood_t5"] > 28.0 and not is_18:
        advice.append("High flood risk. Consider cutting a land or adding mana sinks.")
    if stats["removal_t4"] < 45:
        advice.append("Low early interaction. Prioritize cheap removal.")
    colors = {col for c in deck if not _is_land(c) for col in c.get("colors", [])}
    if len(colors) >= 3:
        advice.append("Mana Base: You are playing 3+ colors. This inherently increases your risk of color screw. Ensure you have at least 3-4 strong fixing sources.")
    if not note and (stats["cast_t2"] < 50 or stats["flood_t5"] > 25):
        expensive = [c for c in deck if int(c.get("cmc", 0)) >= 5 and not _is_land(c)]
        if expensive:
            spells = [c for c in deck if not _is_land(c)]
            strict = get_strict_colors(spells) if spells else ["W", "U", "B", "R", "G"]
            worst = min(expensive, key=_gihwr)
            cheap = [
                c for c in sideboard
                if int(c.get("cmc", 0)) <= 3 and not _is_land(c) and "Creature" in c.get("types", [])
                and is_castable(c, strict, strict=True)
            ]
            if cheap:
                best = max(cheap, key=_gihwr)
                advice.append(f"Swap: Cut [{worst['name']}] for [{best['name']}] to lower curve.")
    return advice


def _deck_view(deck, sideboard, stats=None, note=None, **extra):
    tiers = state.scanner.retrieve_tier_data()
    deck, sideboard = _sort(deck), _sort(sideboard)
    return {
        "deck": serialize_cards(deck, None, tiers),
        "sideboard": serialize_cards(sideboard, None, tiers),
        "stats": stats,
        "note": note,
        "advice": deck_advice(deck, sideboard, stats, note),
        **extra,
    }


def _archetype_key(colors):
    return (normalize_color_string("".join(colors)) if colors else "") or "All Decks"


# --- Deck Builder ------------------------------------------------------------------------


def _variant_view(label, data):
    return _deck_view(
        data.get("deck_cards", []), data.get("sideboard_cards", []),
        data.get("stats"), data.get("optimization_note"),
        label=label, colors=data.get("colors", []), archetype=_archetype_key(data.get("colors", [])),
        rating=data.get("rating"), record=data.get("record"), breakdown=data.get("breakdown", ""),
    )


@router.post("/deck/suggest")
def suggest(body: Optional[DeckBody] = None):
    state.require_ready()
    from src.card_logic import suggest_deck

    scanner = state.scanner
    pool = _resolve(body.deck) if body and body.deck else scanner.retrieve_taken_cards()
    spells = [c for c in pool if not _is_land(c)]
    if len(spells) < 22:
        raise HTTPException(400, f"Not enough spells drafted yet (Have {len(spells)}, Need 22).")
    metrics = scanner.retrieve_set_metrics()
    _, event_type = scanner.retrieve_current_limited_event()
    dataset = state.config.card_data.latest_dataset

    def run(ctx: JobContext):
        def cb(msg):
            if "status" in msg:
                ctx.progress(message=msg["status"])
            elif "variant_label" in msg:
                ctx.progress(variant=_variant_view(msg["variant_label"], msg["variant_data"]))

        results = suggest_deck(pool, metrics, state.config, event_type, cb, dataset)
        if not results:
            raise RuntimeError("Not enough on-color playables to form a 40-card deck (Need 22).")
        return {"variants": [_variant_view(label, data) for label, data in results.items()]}

    return start_job("deck-suggest", run)


# --- Custom Deck -------------------------------------------------------------------------


@router.post("/deck/analyze")
def analyze(body: DeckBody):
    state.require_ready()
    from src.card_logic import simulate_deck

    deck, sb = _resolve(body.deck), _resolve(body.sideboard)

    def run(ctx: JobContext):
        ctx.progress("Running 10,000 Monte Carlo Simulations...")
        stats = simulate_deck(deck, iterations=10000)
        if not stats:
            raise RuntimeError("Add cards to the deck first.")
        return _deck_view(deck, sb, stats)

    return start_job("deck-analyze", run, exclusive=False)


@router.post("/deck/auto-lands")
def auto_lands(body: DeckBody):
    state.require_ready()
    from src.advisor.mana_base import brute_force_mana_base
    from src.card_logic import simulate_deck

    deck, sb = _resolve(body.deck), _resolve(body.sideboard)

    def run(ctx: JobContext):
        ctx.progress("Simulating perfect mana base permutations...")
        spells = [c for c in deck if not _is_land(c)]
        non_basics = [c for c in deck if _is_land(c) and "Basic" not in c.get("types", []) and c.get("name") not in constants.BASIC_LANDS]
        if not spells:
            raise RuntimeError("Add spells to the deck first.")
        colors = get_strict_colors(spells) or ["W", "U", "B", "R", "G"]
        needed_lands = max(0, 40 - sum(c.get("count", 1) for c in spells))
        if sum(c.get("count", 1) for c in non_basics) > needed_lands:
            trimmed, remaining = [], needed_lands
            for card in sorted(non_basics, key=_gihwr, reverse=True):
                n = min(card.get("count", 1), remaining)
                if n > 0:
                    trimmed.append(dict(card, count=n))
                    remaining -= n
            non_basics = trimmed
        needed_basics = max(0, needed_lands - sum(c.get("count", 1) for c in non_basics))
        basics = brute_force_mana_base(spells, non_basics, colors, forced_count=needed_basics)
        new_deck = spells + non_basics
        for b in basics:
            existing = next((c for c in new_deck if c["name"] == b["name"]), None)
            if existing:
                existing["count"] += 1
            else:
                new_deck.append(dict(b))
        ctx.progress("Running 10,000 Monte Carlo Simulations...")
        return _deck_view(new_deck, sb, simulate_deck(new_deck, iterations=10000))

    return start_job("deck-auto-lands", run, exclusive=False)


@router.post("/deck/optimize")
def optimize(body: DeckBody):
    state.require_ready()
    from src.card_logic import optimize_deck

    deck, sb = _resolve(body.deck), _resolve(body.sideboard)
    total = sum(c.get("count", 1) for c in deck)
    if total != 40:
        raise HTTPException(400, f"Base deck must be exactly 40 cards to optimize (currently {total}).")

    def run(ctx: JobContext):
        ctx.progress("AI Auto-Optimizing: Simulating thousands of deck permutations...")
        spells = [c for c in deck if not _is_land(c)]
        colors = get_strict_colors(spells)
        arch = _archetype_key(colors[:2])
        final_deck, final_sb, stats, note = optimize_deck(deck, sb, arch, colors)
        if not final_deck:
            raise RuntimeError("Failed to optimize.")
        return _deck_view(final_deck, final_sb, stats, note)

    return start_job("deck-optimize", run, exclusive=False)


@router.post("/deck/export")
def export_deck(body: DeckBody):
    state.require_ready()
    return {"text": copy_deck(_resolve(body.deck), _resolve(body.sideboard))}


def parse_deck_text(text: str, deck_only: bool) -> List[Dict]:
    out, section = [], "deck"
    for line in text.split("\n"):
        line = line.strip()
        if line.lower() in ("deck", "sideboard", "commander", "companion"):
            section = line.lower()
            continue
        if not line or (deck_only and section != "deck"):
            continue
        m = re.match(r"^(\d+)\s+([^(]+)", line)
        if m:
            out.append({"name": m.group(2).strip(), "count": int(m.group(1))})
    return out


# --- Sealed --------------------------------------------------------------------------


def _session(session_id: str) -> SealedSession:
    entry = state.sealed_sessions.get(session_id)
    if not entry:
        raise HTTPException(404, "Sealed session not found")
    return entry["session"]


def _session_view(session_id: str, **extra):
    session = _session(session_id)
    main, side = session.get_active_deck_lists()
    for c in main:
        if c["name"] in BASIC_COLOR:
            c["colors"] = [BASIC_COLOR[c["name"]]]
    tiers = state.scanner.retrieve_tier_data()
    return {
        "id": session_id,
        "label": state.sealed_sessions[session_id]["label"],
        "variants": list(session.variants.keys()),
        "active": session.active_variant_name,
        "main": serialize_cards(_sort(main), None, tiers),
        "sideboard": serialize_cards(_sort(side), None, tiers),
        "poolSize": sum(session._pool_inventory.values()),
        **extra,
    }


def _open_session(session_id: str, raw_pool: List[Dict], metrics, label: str):
    entry = state.sealed_sessions.get(session_id)
    session = entry["session"] if entry else SealedSession.load_session(session_id, raw_pool)
    if not session:
        session = SealedSession(session_id)
    # Reloading keeps saved builds and picks up cards drafted since the last open.
    session.load_pool(raw_pool)
    _trim_to_pool(session)
    state.sealed_sessions[session_id] = {"session": session, "metrics": metrics, "label": label}
    return _session_view(session_id)


def _trim_to_pool(session: SealedSession):
    for variant in session.variants.values():
        for name, count in list(variant.main_deck_counts.items()):
            if name in constants.BASIC_LANDS:
                continue
            owned = session._pool_inventory.get(name, 0)
            if count > owned:
                variant.remove_card(name, count - owned)


@router.get("/sealed/sets")
def practice_sets():
    state.require_ready()
    set_list = state.scanner.set_list
    active = list(read_local_manifest().get("active_sets") or [])
    latest = getattr(set_list, "latest_set", "")
    if latest and latest not in active:
        active.append(latest)
    options = []
    for name, info in set_list.data.items():
        if not info.set_code:
            continue
        code = info.seventeenlands[0] if info.seventeenlands else info.set_code
        rank = active.index(code) if code in active else (active.index(info.set_code) if info.set_code in active else None)
        options.append({"code": code, "label": f"{name} ({code})", "active": rank is not None, "rank": rank if rank is not None else 999})
    options.sort(key=lambda o: (not o["active"], o["rank"], o["label"]))
    return options


class PracticeBody(BaseModel):
    code: str
    mode: str = "generate"
    text: str = ""


@router.post("/sealed/practice")
def practice(body: PracticeBody):
    state.require_ready()
    datasets, _ = retrieve_local_set_list(codes=[body.code])
    if not datasets:
        raise HTTPException(404, f"No downloaded dataset found for {body.code}. Download it from the Datasets tab first.")

    def priority(evt):
        return next((i for i, k in enumerate(("Sealed", "PremierDraft", "TradDraft"), 1) if k in evt), 4)

    datasets.sort(key=lambda d: priority(d[1]))
    path = datasets[0][6]
    scanner = state.scanner
    scanner.retrieve_set_data(path)
    state.config.card_data.latest_dataset = os.path.basename(path)
    write_configuration(state.config)
    state.request_refresh()
    dataset, metrics = scanner.set_data, scanner.retrieve_set_metrics()

    pool = []
    if body.mode == "import":
        for entry in parse_deck_text(body.text, deck_only=False):
            data = dataset.get_data_by_name([sanitize_card_name(entry["name"])])
            if data:
                pool.extend([data[0].copy()] * entry["count"])
        if not pool:
            raise HTTPException(400, "No valid MTGA format cards found in clipboard.")
    else:
        unique = {}
        for card in dataset.get_card_ratings().values():
            if card.get("name") and card["name"] not in unique:
                unique[card["name"]] = card
        by_rarity = {"common": [], "uncommon": [], "rare": []}
        for card in unique.values():
            if "Basic" in card.get("types", []) or card.get("name") in constants.BASIC_LANDS:
                continue
            rarity = str(card.get("rarity", "common")).lower()
            by_rarity["rare" if rarity in ("rare", "mythic") else rarity if rarity in by_rarity else "common"].append(card)
        if not all(by_rarity.values()):
            raise HTTPException(400, "Dataset is incomplete. Cannot generate pool.")
        for _ in range(6):
            pool.append(random.choice(by_rarity["rare"]))
            pool.extend(random.choices(by_rarity["uncommon"], k=3))
            pool.extend(random.choices(by_rarity["common"], k=10))

    return _open_session(f"practice_{uuid.uuid4().hex[:8]}", pool, metrics, f"Practice {body.code}")


@router.post("/sealed/live")
def live_sealed():
    state.require_ready()
    scanner = state.scanner
    pool = scanner.retrieve_taken_cards()
    if not pool:
        raise HTTPException(400, "No pool to build from yet.")
    session_id = scanner.current_draft_id or getattr(scanner, "current_transaction_id", "") or "local_sealed"
    event_set, event_type = scanner.retrieve_current_limited_event()
    return _open_session(session_id, pool, scanner.retrieve_set_metrics(), f"{event_set} {event_type}".strip())


@router.get("/sealed/{session_id}")
def get_sealed(session_id: str):
    return _session_view(session_id)


class SealedAction(BaseModel):
    op: str
    name: Optional[str] = None
    new_name: Optional[str] = None
    card: Optional[str] = None
    count: int = 1
    text: Optional[str] = None
    cards: Optional[List[DeckEntry]] = None


@router.post("/sealed/{session_id}/action")
def sealed_action(session_id: str, body: SealedAction):
    session = _session(session_id)
    warning = None
    op = body.op
    if op == "create":
        session.create_variant(body.name or f"Build {len(session.variants) + 1}")
    elif op == "copy":
        session.create_variant(body.name or f"{session.active_variant_name} Copy", copy_from=session.active_variant_name)
    elif op == "delete":
        session.delete_variant(body.name or session.active_variant_name)
    elif op == "rename":
        if not session.rename_variant(body.name or session.active_variant_name, body.new_name or ""):
            raise HTTPException(400, "A build with that name already exists.")
    elif op == "select":
        if body.name not in session.variants:
            raise HTTPException(404, "Unknown build")
        session.active_variant_name = body.name
    elif op == "main":
        if not session.move_to_main(body.card, body.count):
            warning = f"No more copies of {body.card} in your pool."
    elif op == "side":
        session.move_to_sideboard(body.card, body.count)
    elif op == "clear":
        session.variants[session.active_variant_name].main_deck_counts.clear()
    elif op == "auto-lands":
        from src.card_logic import calculate_dynamic_mana_base

        main, _ = session.get_active_deck_lists()
        for c in main:
            if c["name"] in constants.BASIC_LANDS:
                session.move_to_sideboard(c["name"], c.get("count", 1))
        main, _ = session.get_active_deck_lists()
        spells = [c for c in main if not _is_land(c)]
        lands = [c for c in main if _is_land(c)]
        if spells:
            colors = get_strict_colors(spells) or ["W", "U", "B", "R", "G"]
            needed = max(0, 40 - sum(c.get("count", 1) for c in spells) - sum(c.get("count", 1) for c in lands))
            for b in calculate_dynamic_mana_base(spells, lands, colors, forced_count=needed):
                session.move_to_main(b["name"], 1)
    elif op == "set":
        # Fill a build from a card list: a new build when a name is given, else the active one.
        if body.name:
            session.create_variant(body.name)
        session.variants[session.active_variant_name].main_deck_counts.clear()
        missing = [e.name for e in body.cards or [] if not session.move_to_main(e.name, e.count)]
        if missing:
            warning = "Skipped cards not in your pool: " + ", ".join(missing[:10])
    elif op == "import":
        cards = parse_deck_text(body.text or "", deck_only=True)
        if not cards:
            raise HTTPException(400, "No valid MTGA format cards found in clipboard.")
        session.create_variant("Imported Deck")
        session.variants[session.active_variant_name].main_deck_counts.clear()
        missing = [
            c["name"] for c in cards
            if not session.move_to_main(sanitize_card_name(c["name"]), c["count"])
            and not session.move_to_main(c["name"], c["count"])
        ]
        if missing:
            more = f" ...and {len(missing) - 10} more." if len(missing) > 10 else ""
            warning = "Skipped cards not in your pool (or over owned quantity): " + ", ".join(missing[:10]) + more
    else:
        raise HTTPException(400, f"Unknown op: {op}")
    session.save_session()
    return _session_view(session_id, warning=warning)


@router.post("/sealed/{session_id}/shells")
def sealed_shells(session_id: str):
    entry = state.sealed_sessions.get(session_id)
    if not entry:
        raise HTTPException(404, "Sealed session not found")

    def run(ctx: JobContext):
        ctx.progress("Generating deck shells...")
        generate_sealed_shells(entry["session"], entry["metrics"], state.scanner.retrieve_tier_data())
        entry["session"].save_session()
        return _session_view(session_id)

    return start_job("sealed-shells", run)


@router.post("/sealed/{session_id}/export")
def sealed_export(session_id: str, target: str = "mtga"):
    session = _session(session_id)
    main, side = session.get_active_deck_lists()
    text = copy_deck(main, side)
    if target != "sealeddeck":
        return {"text": text}
    try:
        r = requests.post("https://sealeddeck.tech/api/pools", json={"pool": text}, timeout=10)
        r.raise_for_status()
        url = r.json().get("url")
        if not url:
            raise ValueError("No URL returned")
        return {"text": text, "url": url}
    except Exception as e:
        return {"text": text, "url": None, "error": f"Could not reach sealeddeck.tech ({e}). The deck text was returned so you can paste it manually."}
