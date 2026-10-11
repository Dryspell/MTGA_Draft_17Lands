"""
bridge/snapshot.py
Builds a JSON-serializable view of the current draft for the web overlay.
Mirrors the data assembled by AppController.refresh_ui_data.
"""

import os
import logging
from typing import Dict, List, Optional

from src import constants
from src.advisor.engine import DraftAdvisor
from src.card_logic import filter_options, get_deck_metrics, stack_cards
from src.signals import SignalCalculator

logger = logging.getLogger(__name__)

STAT_FIELDS = ("gihwr", "ohwr", "gpwr", "iwd", "alsa", "ata", "gih")


def grade_for(value: float, mean: float, std: float) -> Optional[str]:
    if not value or std <= 0:
        return None
    z = (value - mean) / std
    for grade, limit in constants.GRADE_DEVIATION_DICT.items():
        if z >= limit:
            return grade.strip()
    return "F"


def _stats(card: Dict, deck_color: str) -> Dict[str, float]:
    raw = card.get(constants.DATA_FIELD_DECK_COLORS, {}).get(deck_color, {})
    return {f: float(raw.get(f, 0.0) or 0.0) for f in STAT_FIELDS}


def serialize_card(card: Dict, filter_color: str, metrics, recommendation=None) -> Dict:
    all_stats = _stats(card, constants.FILTER_OPTION_ALL_DECKS)
    filter_stats = (
        _stats(card, filter_color)
        if filter_color != constants.FILTER_OPTION_ALL_DECKS
        else all_stats
    )
    mean, std = metrics.get_metrics(filter_color, constants.DATA_FIELD_GIHWR)
    all_mean, all_std = metrics.get_metrics(
        constants.FILTER_OPTION_ALL_DECKS, constants.DATA_FIELD_GIHWR
    )
    images = card.get(constants.DATA_SECTION_IMAGES) or []

    out = {
        "name": card.get(constants.DATA_FIELD_NAME, "Unknown"),
        "manaCost": card.get(constants.DATA_FIELD_MANA_COST, ""),
        "colors": list(card.get(constants.DATA_FIELD_COLORS, []) or []),
        "types": list(card.get(constants.DATA_FIELD_TYPES, []) or []),
        "rarity": card.get(constants.DATA_FIELD_RARITY, ""),
        "cmc": card.get(constants.DATA_FIELD_CMC, 0),
        "images": [i for i in images if isinstance(i, str)],
        "tags": list(card.get(constants.DATA_FIELD_TAGS, []) or []),
        "count": card.get(constants.DATA_FIELD_COUNT, 1),
        "returnableAt": list(card.get("returnable_at", []) or []),
        "stats": {"all": all_stats, "filter": filter_stats},
        "grade": grade_for(filter_stats["gihwr"], mean, std),
        "gradeAll": grade_for(all_stats["gihwr"], all_mean, all_std),
        "recommendation": None,
    }
    if recommendation is not None:
        out["recommendation"] = {
            "score": recommendation.contextual_score,
            "zScore": recommendation.z_score,
            "castProbability": recommendation.cast_probability,
            "wheelChance": recommendation.wheel_chance,
            "reasoning": list(recommendation.reasoning),
            "isElite": recommendation.is_elite,
            "archetypeFit": recommendation.archetype_fit,
            "tags": list(recommendation.tags),
        }
    return out


def build_snapshot(scanner, config, status: str = "") -> Dict:
    with scanner.lock:
        event_set, event_type = scanner.retrieve_current_limited_event()
        pack, pick = scanner.retrieve_current_pack_and_pick()
        metrics = scanner.retrieve_set_metrics()
        taken_cards = scanner.retrieve_taken_cards()
        pack_cards = scanner.retrieve_current_pack_cards()
        missing_cards = scanner.retrieve_current_missing_cards()
        history = list(scanner.retrieve_draft_history())
        draft_id = scanner.current_draft_id
        arena_file = scanner.arena_file

    signals = {c: 0.0 for c in constants.CARD_COLORS}
    sig_calc = SignalCalculator(metrics)
    for entry in history:
        if entry["Pack"] == 2:
            continue
        seen = scanner.set_data.get_data_by_id(entry["Cards"])
        for color, value in sig_calc.calculate_pack_signals(seen, entry["Pick"]).items():
            signals[color] += value

    recommendations = []
    try:
        advisor = DraftAdvisor(metrics, taken_cards, signals=signals)
        recommendations = advisor.evaluate_pack(pack_cards, pick, current_pack=pack)
    except Exception as e:
        logger.error(f"Advisor failed: {e}", exc_info=True)
    rec_by_name = {r.card_name: r for r in recommendations}

    filter_color = filter_options(
        taken_cards, config.settings.deck_filter, metrics, config
    )[0]

    def cards(lst: List[Dict]) -> List[Dict]:
        return [
            serialize_card(c, filter_color, metrics, rec_by_name.get(c.get("name")))
            for c in lst
        ]

    deck_metrics = get_deck_metrics(taken_cards)

    return {
        "status": status or (f"Pack {pack} Pick {pick}" if pack > 0 else "Waiting for draft..."),
        "event": {"set": event_set, "type": event_type},
        "draftId": draft_id,
        "pack": pack,
        "pick": pick,
        "isLiveLog": not os.path.basename(arena_file or "").startswith("DraftLog_"),
        "dataset": config.card_data.latest_dataset,
        "filter": filter_color,
        "packCards": cards(pack_cards),
        "missingCards": cards(missing_cards),
        "pool": cards(stack_cards(taken_cards)),
        "poolSize": len(taken_cards),
        "signals": signals,
        "curve": deck_metrics.distribution_all,
        "creatureCount": deck_metrics.creature_count,
        "noncreatureCount": deck_metrics.noncreature_count,
    }
