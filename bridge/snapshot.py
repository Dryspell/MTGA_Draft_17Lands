"""
bridge/snapshot.py
Builds a JSON-serializable view of the current draft for the web overlay.
Mirrors the data assembled by AppController.refresh_ui_data and DashboardFrame.
"""

import os
import re
import logging
from typing import Dict, List

from src import constants
from src.advisor.engine import DraftAdvisor
from src.card_logic import filter_options, get_deck_metrics, stack_cards
from src.signals import SignalCalculator
from src.utils import retrieve_local_set_list

from bridge.recap import build_recap
from bridge.serialize import serialize_cards, serialize_metrics, tier_options

logger = logging.getLogger(__name__)

HUMAN_DRAFTS = {
    constants.LIMITED_TYPE_STRING_DRAFT_PREMIER,
    constants.LIMITED_TYPE_STRING_DRAFT_TRAD,
    constants.LIMITED_TYPE_STRING_DRAFT_PICK_TWO,
    constants.LIMITED_TYPE_STRING_DRAFT_PICK_TWO_TRAD,
}
BOT_DRAFTS = {
    constants.LIMITED_TYPE_STRING_DRAFT_QUICK,
    constants.LIMITED_TYPE_STRING_DRAFT_PICK_TWO_QUICK,
    constants.LIMITED_TYPE_STRING_DRAFT_BOT,
}
PIE_TYPES = ("Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Enchantment", "Artifact", "Land")


def _expected_total(history: List[Dict]) -> int:
    max_pack_size = 0
    for entry in history:
        max_pack_size = max(max_pack_size, entry.get("Pick", 1) + len(entry.get("Cards", [])) - 1)
    if max_pack_size >= 15:
        return max_pack_size * 3
    if max_pack_size == 13:
        return 39
    return 42


def _type_counts(cards: List[Dict]) -> Dict[str, int]:
    counts = {t: 0 for t in PIE_TYPES}
    for card in cards:
        types = card.get("types", [])
        if "Basic" in types or card.get("name") in constants.BASIC_LANDS:
            continue
        for t in PIE_TYPES:
            if t in types:
                counts[t] += card.get("count", 1)
                break
    return counts


def _normalize_code(code) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(code).upper())


def data_sources(scanner, event_set: str) -> Dict:
    """Local datasets for the detected set, keyed event -> group -> filename (top bar menus)."""
    set_name = event_set
    if scanner.set_list and scanner.set_list.data:
        for name, info in scanner.set_list.data.items():
            if info.set_code == event_set:
                set_name = name
                break
    events: Dict[str, Dict[str, str]] = {}
    if event_set:
        files, _ = retrieve_local_set_list()
        for f in files:
            file_set, f_event, f_group, _, _, _, f_path, _ = f
            if _normalize_code(file_set) == _normalize_code(event_set):
                events.setdefault(f_event, {})[f_group] = os.path.basename(f_path)
    return {"setCode": event_set, "setName": set_name, "events": events}


def has_datasets() -> bool:
    if not os.path.exists(constants.SETS_FOLDER):
        return False
    return any(f.endswith(constants.SET_FILE_SUFFIX) for f in os.listdir(constants.SETS_FOLDER))


def build_snapshot(scanner, config, status: str = "") -> Dict:
    with scanner.lock:
        event_set, event_type = scanner.retrieve_current_limited_event()
        pack, pick = scanner.retrieve_current_pack_and_pick()
        metrics = scanner.retrieve_set_metrics()
        tier_data = scanner.retrieve_tier_data()
        taken_cards = scanner.retrieve_taken_cards()
        pack_cards = scanner.retrieve_current_pack_cards()
        missing_cards = scanner.retrieve_current_missing_cards()
        picked_cards = scanner.retrieve_current_picked_cards()
        history = list(scanner.retrieve_draft_history())
        draft_id = scanner.current_draft_id
        start_time = scanner.draft_start_time
        event_string = scanner.event_string
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

    filter_color = filter_options(taken_cards, config.settings.deck_filter, metrics, config)[0]
    try:
        filters = scanner.retrieve_color_win_rate(config.settings.filter_format)
    except Exception:
        filters = {}

    stacked_pool = stack_cards(taken_cards)
    deck_metrics = get_deck_metrics(taken_cards)
    taken_count = len(taken_cards)
    is_sealed = "Sealed" in (event_type or "")
    draft_complete = (
        (event_type in HUMAN_DRAFTS or event_type in BOT_DRAFTS) and taken_count >= _expected_total(history)
    ) or (is_sealed and taken_count >= 40)

    return {
        "status": status or (f"Pack {pack} Pick {pick}" if pack > 0 else "Waiting for draft..."),
        "event": {"set": event_set, "type": event_type, "label": event_string},
        "draftId": draft_id,
        "startTime": str(start_time or ""),
        "pack": pack,
        "pick": pick,
        "logFile": os.path.basename(arena_file or ""),
        "isLiveLog": not os.path.basename(arena_file or "").startswith("DraftLog_"),
        "dataset": config.card_data.latest_dataset,
        "hasDatasets": has_datasets(),
        "sources": data_sources(scanner, event_set),
        "filter": filter_color,
        "filterOptions": filters,
        "metrics": serialize_metrics(metrics),
        "tierOptions": tier_options(scanner),
        "packCards": serialize_cards(pack_cards, rec_by_name, tier_data),
        "missingCards": serialize_cards(missing_cards, None, tier_data),
        "pickedNames": [c.get("name") for c in picked_cards],
        "pool": serialize_cards(stacked_pool, None, tier_data),
        "poolSize": taken_count,
        "signals": signals,
        "curve": deck_metrics.distribution_all,
        "creatureCount": deck_metrics.creature_count,
        "noncreatureCount": deck_metrics.noncreature_count,
        "typeCounts": _type_counts(stacked_pool),
        "isSealed": is_sealed,
        "draftComplete": draft_complete,
        "recap": build_recap(taken_cards, metrics) if draft_complete else None,
    }
