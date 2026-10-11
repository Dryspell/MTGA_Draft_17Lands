"""
bridge/recap.py
Post-draft recap figures. Mirrors DraftRecapScreen.update_summary.
"""

from typing import Dict, List

from src import constants
from src.card_logic import identify_top_pairs
from src.utils import normalize_color_string

GRADE_MAP = [
    (90, "S (God Tier)"),
    (85, "A (Amazing)"),
    (80, "B+ (Great)"),
    (75, "B (Good)"),
    (70, "C (Average)"),
    (60, "D (Below Average)"),
]


def _all_decks(card: Dict, field: str) -> float:
    try:
        return float(card.get("deck_colors", {}).get("All Decks", {}).get(field, 0.0) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _is_basic(card: Dict) -> bool:
    return "Basic" in card.get("types", []) or card.get("name") in constants.BASIC_LANDS


def build_recap(taken_cards: List[Dict], metrics) -> Dict:
    valid = [c for c in taken_cards if not _is_basic(c)]
    if len(taken_cards) < 40 or not valid:
        return {}

    def gihwr(c):
        return _all_decks(c, "gihwr")

    def entry(c):
        return {"name": c.get("name", "Unknown"), "gihwr": gihwr(c)}

    valid.sort(key=gihwr, reverse=True)
    top_23 = valid[:23]
    avg = sum(gihwr(c) for c in top_23) / len(top_23)

    mean, std = metrics.get_metrics("All Decks", "gihwr") if metrics else (54.5, 3.5)
    mean = mean if mean > 0 else 54.5
    std = std if std > 0 else 3.5
    power = max(0.0, min(100.0, 75.0 + ((avg - mean) / std) * 12.0))
    grade = next((g for threshold, g in GRADE_MAP if power >= threshold), "F (Trainwreck)")

    archetypes = []
    for pair in identify_top_pairs(taken_cards, metrics):
        lane = normalize_color_string("".join(pair))
        wr, _ = metrics.get_metrics(lane, "gihwr") if metrics else (0, 0)
        archetypes.append({"key": lane, "name": constants.COLOR_NAMES_DICT.get(lane, lane), "gihwr": wr})
    archetypes.sort(key=lambda a: a["gihwr"], reverse=True)

    total = len(taken_cards)
    per_pack = 15 if total >= 45 else (14 if total >= 42 else (total // 3 if total >= 3 else 14))
    steals, reaches = [], []
    for i, c in enumerate(taken_cards):
        if _is_basic(c):
            continue
        pack, pick = (i // per_pack) + 1, (i % per_pack) + 1
        wr, alsa, ata = gihwr(c), _all_decks(c, "alsa"), _all_decks(c, "ata")
        if alsa > 0 and pick > alsa + 1.5 and wr >= 55.0:
            steals.append({"name": c.get("name"), "pack": pack, "pick": pick, "value": alsa, "delta": pick - alsa})
        if ata > 0 and ata > pick + 1.5 and wr < 54.0:
            reaches.append({"name": c.get("name"), "pack": pack, "pick": pick, "value": ata, "delta": ata - pick})
    steals.sort(key=lambda s: s["delta"], reverse=True)
    reaches.sort(key=lambda s: s["delta"], reverse=True)

    tribes, roles, lands = {}, {}, []
    for c in taken_cards:
        if _is_basic(c):
            continue
        if "Land" in c.get("types", []):
            lands.append(c)
        if "Creature" in c.get("types", []):
            for s in c.get("subtypes", []):
                tribes[s] = tribes.get(s, 0) + 1
        for t in c.get("tags", []):
            roles[t] = roles.get(t, 0) + 1

    staples = [c for c in valid if str(c.get("rarity", "")).lower() in ("common", "uncommon") and gihwr(c) >= 57.0]
    rares = [c for c in valid if str(c.get("rarity", "")).lower() in ("rare", "mythic")]
    lands.sort(key=gihwr, reverse=True)

    type_counts = {t: 0 for t in ("Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Enchantment", "Artifact", "Land")}
    for c in valid:
        for t in type_counts:
            if t in c.get("types", []):
                type_counts[t] += 1

    return {
        "poolPower": power,
        "grade": grade,
        "top23Avg": avg,
        "formatAvg": mean,
        "archetypes": archetypes[:3],
        "bestCards": [entry(c) for c in top_23[:6]],
        "steals": steals[:6],
        "reaches": reaches[:6],
        "tribes": [{"name": t, "count": n} for t, n in sorted(tribes.items(), key=lambda x: -x[1])[:6] if n >= 3],
        "roles": [{"tag": t, "count": n} for t, n in sorted(roles.items(), key=lambda x: -x[1])[:6]],
        "staples": [entry(c) for c in sorted(staples, key=gihwr, reverse=True)[:6]],
        "lands": [entry(c) for c in lands[:6]],
        "rares": [entry(c) for c in sorted(rares, key=gihwr, reverse=True)[:10]],
        "typeCounts": type_counts,
    }
