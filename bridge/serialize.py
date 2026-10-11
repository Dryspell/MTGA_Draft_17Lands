"""
bridge/serialize.py
JSON views of engine objects. Cards carry their per-archetype stats so the UI
can render any column, archetype filter, or result format without a round trip.
"""

from typing import Dict, List, Optional

from src import constants

STAT_FIELDS = ("gihwr", "ohwr", "gpwr", "gnswr", "gdwr", "iwd", "alsa", "ata", "gih", "ngp", "ngoh", "ngd", "ngnd")


def deck_color_stats(card: Dict) -> Dict[str, Dict[str, float]]:
    out = {}
    for arch, raw in (card.get(constants.DATA_FIELD_DECK_COLORS) or {}).items():
        if not isinstance(raw, dict):
            continue
        stats = {}
        for f in STAT_FIELDS:
            try:
                v = float(raw.get(f, 0.0) or 0.0)
            except (TypeError, ValueError):
                continue
            if v:
                stats[f] = v
        if stats:
            out[arch] = stats
    return out


def serialize_recommendation(rec) -> Optional[Dict]:
    if rec is None:
        return None
    return {
        "score": rec.contextual_score,
        "baseWinRate": rec.base_win_rate,
        "zScore": rec.z_score,
        "castProbability": rec.cast_probability,
        "wheelChance": rec.wheel_chance,
        "reasoning": list(rec.reasoning),
        "isElite": rec.is_elite,
        "archetypeFit": rec.archetype_fit,
        "tags": list(rec.tags),
    }


def serialize_card(card: Dict, recommendation=None, tier_data=None) -> Dict:
    name = card.get(constants.DATA_FIELD_NAME, "Unknown")
    images = card.get(constants.DATA_SECTION_IMAGES) or []
    tiers = {}
    for key, tier in (tier_data or {}).items():
        rating = getattr(tier, "ratings", {}).get(name)
        tiers[key] = rating.rating.strip() if rating is not None else "NA"
    return {
        "name": name,
        "manaCost": card.get(constants.DATA_FIELD_MANA_COST, "") or "",
        "colors": list(card.get(constants.DATA_FIELD_COLORS, []) or []),
        "types": list(card.get(constants.DATA_FIELD_TYPES, []) or []),
        "subtypes": list(card.get("subtypes", []) or []),
        "rarity": card.get(constants.DATA_FIELD_RARITY, "") or "",
        "cmc": card.get(constants.DATA_FIELD_CMC, 0) or 0,
        "images": [i for i in images if isinstance(i, str) and i],
        "tags": list(card.get(constants.DATA_FIELD_TAGS, []) or []),
        "count": card.get(constants.DATA_FIELD_COUNT, 1) or 1,
        "returnableAt": list(card.get("returnable_at", []) or []),
        "deckColors": deck_color_stats(card),
        "tiers": tiers,
        "recommendation": serialize_recommendation(recommendation),
    }


def serialize_cards(cards: List[Dict], recs_by_name=None, tier_data=None) -> List[Dict]:
    recs_by_name = recs_by_name or {}
    return [serialize_card(c, recs_by_name.get(c.get("name")), tier_data) for c in cards]


def serialize_metrics(metrics) -> Dict[str, Dict[str, List[float]]]:
    """Mean/std per archetype and win-rate field, for Grade and Rating formats."""
    out = {}
    for arch in constants.DECK_COLORS:
        fields = {}
        for f in constants.WIN_RATE_OPTIONS:
            try:
                mean, std = metrics.get_metrics(arch, f)
            except Exception:
                continue
            if mean or std:
                fields[f] = [mean, std]
        if fields:
            out[arch] = fields
    return out


def tier_options(scanner) -> Dict[str, str]:
    try:
        event_set, _ = scanner.retrieve_current_limited_event()
        _, options = scanner.tier_list.retrieve_data(event_set)
        return {key: label for label, key in options.items()}
    except Exception:
        return {}
