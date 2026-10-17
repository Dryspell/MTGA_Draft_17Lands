"""
bridge/arena_cards.py
Every card Arena knows about, read from its local SQLite card database
(MTGA_Data/Downloads/Raw/Raw_CardDatabase_*.mtga). 17Lands datasets only cover
limited sets, so constructed games, decks and imports resolve through here.
"""

import glob
import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata
from typing import Dict, List, Optional

from src import constants

logger = logging.getLogger(__name__)

CACHE_VERSION = 3
CACHE_FILE = os.path.join(constants.TEMP_FOLDER, "arena_cards.json")
COLORS = {"1": "W", "2": "U", "3": "B", "4": "R", "5": "G"}
RARITY = {1: "basic", 2: "common", 3: "uncommon", 4: "rare", 5: "mythic"}
RARITY_ORDER = {"basic": 0, "common": 1, "uncommon": 2, "rare": 3, "mythic": 4}
CARD_TYPES = {"Artifact", "Battle", "Creature", "Enchantment", "Instant", "Kindred", "Land", "Planeswalker", "Sorcery"}
SUPERTYPES = {"Basic", "Legendary", "Snow", "World"}
BASIC_TYPES = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G"}
MANA_MARKUP = re.compile(r"\{o([^}]+)\}")

REMOVAL = re.compile(
    r"\b(destroy|exile)s? (up to (one|two) )?(target|each|all)\b(?! (card|spell))"
    r"|\bdeals? (\d+|X|that much) damage to (any target|target (creature|planeswalker)|each creature)"
    r"|\btarget creature (an opponent controls )?gets -\d+/-\d+|\bfights? (target|up to one)",
    re.I,
)
COUNTER = re.compile(r"\bcounter target\b", re.I)
RAMP = re.compile(r"\badd \{|search your library for (a|up to \w+) (basic )?land|create (a|two|three) treasure", re.I)
DRAW = re.compile(r"\bdraws? (a|two|three|\w+) cards?\b|\bdraw a card\b", re.I)
TRICK = re.compile(r"\btarget creature( you control)? gets \+|\bgains? (hexproof|indestructible|protection)", re.I)
TOKENS = re.compile(r"\bcreate (a|an|one|two|three|x|\d+) .*?token", re.I)
LIFEGAIN = re.compile(r"\byou gain \d+ life|\blifelink\b", re.I)
EVASION = {"Flying", "Menace", "Trample", "Unblockable"}


def _fold(name: str) -> str:
    """Lowercase without accents, so sites that drop them still match."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", name) if not unicodedata.combining(ch)).lower()


def _mana(text: str) -> str:
    return MANA_MARKUP.sub(lambda m: "{" + m.group(1) + "}", text or "")


def _cost(encoded: str):
    """'o1oUoU' -> ('{1}{U}{U}', 3); hybrid comes as 'o(W/U)'."""
    if not encoded:
        return "", 0
    parts = [p for p in re.sub(r"[()]", "", encoded).split("o") if p]
    cmc = sum(int(p) if p.isdigit() else (0 if p in ("X", "Y", "Z") else 1) for p in parts)
    return "".join(f"{{{p}}}" for p in parts), cmc


def _tags(types: List[str], text: str, keywords: List[str]) -> List[str]:
    tags = []
    if REMOVAL.search(text) or COUNTER.search(text):
        tags.append("removal")
    if "Land" not in types and RAMP.search(text):
        tags.append("fixing_ramp")
    if DRAW.search(text):
        tags.append("card_advantage")
    if ("Instant" in types or "Flash" in keywords) and TRICK.search(text):
        tags.append("combat_trick")
    if TOKENS.search(text):
        tags.append("token_maker")
    if LIFEGAIN.search(text):
        tags.append("lifegain")
    if "Creature" in types and EVASION & set(keywords):
        tags.append("evasion")
    return tags


def find_database(mtga_data: str) -> Optional[str]:
    if not mtga_data:
        return None
    found = glob.glob(os.path.join(mtga_data, constants.LOCAL_DOWNLOADS_DATA, constants.LOCAL_DATA_FILE_PREFIX_DATABASE + "*.mtga"))
    return max(found, key=os.path.getmtime) if found else None


def read_database(path: str) -> Dict[str, Dict]:
    """grpId (as str) -> card dict in the same shape the 17Lands datasets use."""
    conn = sqlite3.connect(path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM Cards")]
        abilities = {r[0]: r[1] for r in conn.execute("SELECT Id, TextId FROM Abilities")}
        loc_ids = set()
        for r in rows:
            loc_ids.update((r["TitleId"], r["TypeTextId"], r["SubtypeTextId"]))
            for pair in (r["AbilityIds"] or "").split(","):
                if ":" in pair:
                    loc_ids.add(int(pair.split(":")[1]))
        text: Dict[int, str] = {}
        for loc, fmt, value in conn.execute("SELECT LocId, Formatted, Loc FROM Localizations_enUS ORDER BY Formatted DESC"):
            if loc in loc_ids:
                text[loc] = value
    finally:
        conn.close()

    cards: Dict[str, Dict] = {}
    for r in rows:
        name = text.get(r["TitleId"], "")
        if not name:
            continue
        type_words = (text.get(r["TypeTextId"], "") or "").split()
        types = [t for t in type_words if t in CARD_TYPES]
        if "Creature" in types:
            types.remove("Creature")
            types.insert(0, "Creature")
        lines, keywords = [], []
        for pair in (r["AbilityIds"] or "").split(","):
            if ":" not in pair:
                continue
            line = _mana(text.get(int(pair.split(":")[1]), "") or "")
            if not line:
                continue
            lines.append(line)
            if " " not in line.strip() or line in ("First strike", "Double strike"):
                keywords.append(line.strip())
        subtypes = (text.get(r["SubtypeTextId"], "") or "").split()
        if "Land" in types and not any("Add {" in line for line in lines):
            # Basic land types carry an implicit "{T}: Add {X}." that the database leaves out.
            lines += [f"{{T}}: Add {{{BASIC_TYPES[s]}}}." for s in subtypes if s in BASIC_TYPES]
        mana_cost, cmc = _cost(r["OldSchoolManaText"])
        oracle = "\n".join(lines)
        grp = r["GrpId"]
        cards[str(grp)] = {
            "name": name,
            "cmc": cmc,
            "mana_cost": mana_cost,
            "types": types,
            "supertypes": [t for t in type_words if t in SUPERTYPES],
            "subtypes": subtypes,
            "colors": [COLORS[c] for c in (r["Colors"] or "").split(",") if c in COLORS],
            "rarity": RARITY.get(r["Rarity"], "common"),
            "set": r["DigitalReleaseSet"] or r["ExpansionCode"] or "",
            "collector": r["CollectorNumber"] or "",
            "oracle_text": oracle,
            "keywords": keywords,
            "tags": _tags(types, oracle, keywords),
            "power": r["Power"] or None,
            "toughness": r["Toughness"] or None,
            "token": bool(r["IsToken"]),
            "primary": bool(r["IsPrimaryCard"]),
            "linked": [int(x) for x in (r["LinkedFaceGrpIds"] or "").split(",") if x.isdigit()],
            "face": r["LinkedFaceType"],
            "image": [f"https://api.scryfall.com/cards/arena/{grp}?format=image&version=normal"],
        }
    # Linked faces pair an even face type (front / split parent) with odd ones
    # (adventure, MDFC back, transformed side, split halves); fronts carry their text.
    for card in cards.values():
        if card["linked"] and card["face"] % 2 == 0:
            for other in card["linked"]:
                back = cards.get(str(other))
                if back and back["face"] % 2 == 1 and back["oracle_text"]:
                    card["back_name"] = back["name"]
                    card["back_text"] = back["oracle_text"]
                    card["back_types"] = back["types"]
                    card["back_cmc"] = back["cmc"]
    return cards


class ArenaCards:
    """Lazily loaded, cached view of Arena's card database. Thread-safe reads."""

    def __init__(self):
        self.cards: Dict[str, Dict] = {}
        self.by_name: Dict[str, int] = {}
        self.rarity: Dict[str, str] = {}
        self.printings: Dict[str, set] = {}
        self.source: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return bool(self.cards)

    def load(self, mtga_data: str, cache_file: str = CACHE_FILE) -> bool:
        path = find_database(mtga_data)
        if not path:
            logger.warning("Arena card database not found under %s", mtga_data)
            return False
        stamp = f"{os.path.basename(path)}:{os.path.getsize(path)}:{CACHE_VERSION}"
        cards = None
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("stamp") == stamp:
                cards = cached["cards"]
        except (OSError, ValueError, KeyError):
            pass
        if cards is None:
            cards = read_database(path)
            try:
                os.makedirs(os.path.dirname(cache_file), exist_ok=True)
                tmp = cache_file + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump({"stamp": stamp, "cards": cards}, f)
                os.replace(tmp, cache_file)
            except OSError as e:
                logger.warning("Could not cache Arena cards: %s", e)
        self._index(cards)
        self.source = path
        logger.info("Loaded %d Arena cards from %s", len(cards), path)
        return True

    def _index(self, cards: Dict[str, Dict]):
        by_name: Dict[str, int] = {}
        rank: Dict[str, tuple] = {}
        rarity: Dict[str, str] = {}
        printings: Dict[str, set] = {}
        for key, c in cards.items():
            if c.get("token"):
                continue
            grp = int(key)
            printings.setdefault(c["name"], set()).add((c.get("set") or "").split("-")[0])
            if "Basic" in c.get("supertypes", []):
                c["rarity"] = "basic"
            regular = "-" not in c.get("set", "") and not c.get("set", "").startswith(("Y", "SPG", "SLD"))
            score = (c.get("face", 0) % 2 == 0, c.get("primary", False), regular, grp)
            lowest = rarity.get(c["name"])
            if c.get("primary") and (lowest is None or RARITY_ORDER[c["rarity"]] < RARITY_ORDER[lowest]):
                rarity[c["name"]] = c["rarity"]
            for name in {c["name"], c["name"].lower(), _fold(c["name"])}:
                if name not in rank or score > rank[name]:
                    rank[name], by_name[name] = score, grp
        with self._lock:
            self.cards, self.by_name, self.rarity, self.printings = cards, by_name, rarity, printings

    def craft_rarity(self, name: str) -> str:
        """Cheapest wildcard that crafts this card (lowest rarity it was printed at)."""
        return self.rarity.get(name) or (self.lookup(name) or {}).get("rarity", "common")

    def get(self, grp_id) -> Optional[Dict]:
        return self.cards.get(str(grp_id))

    def lookup(self, name: str) -> Optional[Dict]:
        """Card by name, in any capitalisation, with or without accents ('Kili' finds 'Kíli').
        Split, Room and Aftermath cards may be written 'A/B', 'A // B' or 'A /// B', and a lone
        half ('Unholy Annex') finds the whole card."""
        name = (name or "").strip()
        if not name:
            return None
        parts = [p for p in re.split(r"\s*/{1,3}\s*", name) if p]
        candidates = [name]
        if len(parts) > 1:
            candidates += [" // ".join(parts), " /// ".join(parts)]
        if parts:
            candidates.append(parts[0])
        for candidate in candidates:
            for key in (candidate, candidate.lower(), _fold(candidate)):
                grp = self.by_name.get(key)
                if grp is not None:
                    return self._whole(grp)
        return None

    def _whole(self, grp: int) -> Dict:
        card = self.cards[str(grp)]
        for parent in card.get("linked") or []:
            whole = self.cards.get(str(parent))
            if whole and whole["name"].startswith(card["name"] + " /"):
                return dict(whole, grpId=int(parent))
        return dict(card, grpId=grp)

    def digital_only(self, name: str) -> bool:
        """Only ever printed in Alchemy sets (YMID, YDSK...), which are all digital designs.
        Mixed sets like Alchemy Horizons also reprint paper cards, so they aren't counted."""
        sets = self.printings.get(name)
        return bool(sets) and all(s.startswith("Y") for s in sets)

    def names(self) -> List[str]:
        return sorted({c["name"] for c in self.cards.values() if not c.get("token") and c.get("primary")})


arena_cards = ArenaCards()
