"""
bridge/decks.py
Constructed decks learned from Player.log. Arena logs deck names at login but
full lists only when a deck is saved, submitted to an event, or listed as an
event's current deck, so lists accumulate here over time.

Ownership is a lower bound: Arena won't let you enter an event with cards you
don't own, so every deck submitted to an event (or played in a game) proves you
own at least that many copies of each card.
"""

import hashlib
import json
import logging
import os
import re
import threading
import uuid
from collections import Counter
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from src import constants

from bridge.arena_cards import ArenaCards
from bridge.jsonfile import Unreadable, read_json, write_json

logger = logging.getLogger(__name__)

DECKS_FILE = os.path.join(constants.BASE_DIR, "Decks", "constructed.json")
LIMITED_EVENT = re.compile(r"Draft|Sealed|Cube|Jumpstart", re.I)
WILDCARD_KEYS = {"common": "WildCardCommons", "uncommon": "WildCardUnCommons", "rare": "WildCardRares", "mythic": "WildCardMythics"}
TRACKED_API = ("StartHook", "DeckGetDeckSummariesV3", "DeckUpsertDeckV3", "EventSetDeckV3", "EventGetCoursesV2", "DeckDeleteDeck")
MAX_VERSIONS = 40
SPEEDS = ("Aggro", "Midrange", "Control", "Ramp")
ANY_OPPONENT = "Any opponent"


def is_limited_event(event_id: str) -> bool:
    return bool(event_id and LIMITED_EVENT.search(event_id))


def names_key(names: Dict[str, int]) -> str:
    """Printing-independent identity of a card list."""
    text = "|".join(f"{n}x{name}" for name, n in sorted(names.items()) if n > 0)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def local_time(stamp: str) -> str:
    """ISO timestamp (Arena's carry a UTC offset) as naive local time, for ordering."""
    if not stamp:
        return ""
    try:
        t = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        try:
            t = datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", stamp).replace("Z", "+00:00"))
        except ValueError:
            return stamp
    if t.tzinfo:
        try:
            t = t.astimezone().replace(tzinfo=None)
        except (OSError, OverflowError, ValueError):
            t = t.replace(tzinfo=None)
    return t.isoformat(timespec="seconds")


def pick_guide(guides: Dict[str, Dict], *labels: str) -> Optional[Tuple[str, Dict]]:
    """The saved sideboard plan that best fits an opponent label like 'Rakdos Aggro':
    exact label, then its colors ('Rakdos'), then its speed ('Aggro'), then 'Any opponent'.
    With several labels (a metagame name, then the local guess), each tier tries them in order."""
    if not guides:
        return None
    exact, bases, speeds = [], [], []
    for label in labels:
        words = (label or "").split()
        speed = words[-1] if words and words[-1] in SPEEDS else ""
        exact.append(label)
        bases.append(" ".join(words[:-1]) if speed else " ".join(words))
        speeds.append(speed)
    lowered = {k.lower(): k for k in guides}
    for candidate in (*exact, *bases, *speeds, ANY_OPPONENT):
        key = lowered.get((candidate or "").lower())
        if candidate and key:
            return key, guides[key]
    return None


def _cards(raw) -> List[List[int]]:
    """Arena sends [{cardId, quantity}] (or a flat [id, qty, ...] in older logs)."""
    out: Counter = Counter()
    if not raw:
        return []
    if isinstance(raw[0], dict):
        for c in raw:
            grp, qty = c.get("cardId"), c.get("quantity", 1)
            if grp:
                out[int(grp)] += int(qty)
    else:
        for i in range(0, len(raw) - 1, 2):
            out[int(raw[i])] += int(raw[i + 1])
    return [[g, n] for g, n in out.items() if n > 0]


def _attr(summary: Dict, name: str) -> str:
    for a in summary.get("Attributes") or []:
        if a.get("name") == name:
            return str(a.get("value", "")).strip('"')
    return ""


class DeckLibrary:
    def __init__(self, cards: ArenaCards, path: str = DECKS_FILE):
        self.cards = cards
        self.path = path
        self.decks: Dict[str, Dict] = {}
        self.event_decks: Dict[str, str] = {}
        self.owned: Dict[str, int] = {}
        self.wildcards: Dict[str, int] = {}
        self.currency: Dict[str, int] = {}
        self.backfilled = ""
        self.dirty = False
        self.revision = 0
        self.readonly = False
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._load()

    # ---- persistence ------------------------------------------------------

    def _load(self):
        try:
            data = read_json(self.path, {}) or {}
        except Unreadable as e:
            # A locked file must not be overwritten with an empty library; a corrupt one was copied aside.
            self.readonly = not e.corrupt
            logger.error("Deck library not loaded: %s", e)
            return
        self.decks = data.get("decks", {})
        self.event_decks = data.get("eventDecks", {})
        self.owned = data.get("owned", {})
        self.wildcards = data.get("wildcards", {})
        self.currency = data.get("currency", {})
        self.backfilled = data.get("backfilled", "")
        for d in self.decks.values():
            if d.get("main") and not d.get("versions"):
                self._note_version(d, d.get("lastUpdated", ""))

    def save(self):
        """Write if anything changed. `revision` counts writes so the server can tell overlays."""
        with self._write_lock:
            with self._lock:
                if not self.dirty or self.readonly:
                    return
                data = {
                    "decks": self.decks, "eventDecks": self.event_decks, "owned": self.owned,
                    "wildcards": self.wildcards, "currency": self.currency, "backfilled": self.backfilled,
                }
                data = json.loads(json.dumps(data))
                self.dirty = False
            try:
                write_json(self.path, data)
            except OSError:
                self.dirty = True
                raise
            self.revision += 1

    # ---- log messages -----------------------------------------------------

    def handle(self, direction: str, name: str, payload: Dict):
        """direction is 'request' (==>) or 'response' (<==)."""
        try:
            with self._lock:
                self._handle(direction, name, payload)
        except Exception as e:
            logger.warning("Deck message %s skipped: %s", name, e)

    def _handle(self, direction: str, name: str, payload: Dict):
        if direction == "request":
            req = payload.get("request")
            if isinstance(req, str):
                try:
                    req = json.loads(req)
                except ValueError:
                    return
            if not isinstance(req, dict):
                return
            if name == "DeckUpsertDeckV3":
                summary = req.get("Summary") or {}
                if req.get("ActionType") == "Deleted":
                    self._delete(summary.get("DeckId"))
                else:
                    self._upsert(summary, req.get("Deck"))
            elif name == "EventSetDeckV3":
                summary, deck = req.get("Summary") or {}, req.get("Deck") or {}
                if is_limited_event(req.get("EventName", "")):
                    return
                self._upsert(summary, deck)
                self._event_deck(req.get("EventName"), summary.get("DeckId"))
                self.note_owned(_cards(deck.get("MainDeck")) + _cards(deck.get("Sideboard")))
            elif name.startswith("DeckDeleteDeck"):
                self._delete(req.get("DeckId"))
            return

        if name == "StartHook":
            self._summaries(payload.get("DeckSummaries") or [], complete=True)
            for deck_id, deck in (payload.get("Decks") or {}).items():
                if deck_id in self.decks:
                    self._set_lists(self.decks[deck_id], deck)
            inv = payload.get("InventoryInfo") or {}
            if inv:
                self.wildcards = {r: int(inv.get(k, 0) or 0) for r, k in WILDCARD_KEYS.items()}
                self.currency = {"gold": int(inv.get("Gold", 0) or 0), "gems": int(inv.get("Gems", 0) or 0)}
                self.dirty = True
        elif name == "DeckGetDeckSummariesV3":
            self._summaries(payload.get("Summaries") or [], complete=True)
        elif name == "EventGetCoursesV2":
            for course in payload.get("Courses") or []:
                event = course.get("InternalEventName", "")
                deck = course.get("CourseDeck") or {}
                summary = course.get("CourseDeckSummary") or {}
                if course.get("CardPool") or is_limited_event(event) or not deck.get("MainDeck"):
                    continue
                # Old courses keep copies of decks long since deleted in Arena; the login summary is authoritative.
                known = self.decks.get(summary.get("DeckId") or "")
                if not known or known.get("deleted"):
                    continue
                self._upsert(summary, deck, touch=False)
                self._event_deck(event, summary.get("DeckId"))
                self.note_owned(_cards(deck.get("MainDeck")) + _cards(deck.get("Sideboard")))

    def _summaries(self, summaries: List[Dict], complete: bool):
        present = set()
        for s in summaries:
            deck_id = s.get("DeckId") or s.get("DeckIdInternal")
            if not deck_id:
                continue
            present.add(deck_id)
            self._upsert(dict(s, DeckId=deck_id), None, touch=False)
        if complete and present:
            for deck_id, d in self.decks.items():
                if d.get("source") == "arena" and deck_id not in present and not d.get("deleted"):
                    d["deleted"] = True
                    self.dirty = True

    def _upsert(self, summary: Dict, deck: Optional[Dict], touch: bool = True):
        deck_id = summary.get("DeckId")
        if not deck_id:
            return
        d = self.decks.setdefault(deck_id, {"id": deck_id, "source": "arena", "main": [], "side": []})
        d["deleted"] = False
        if summary.get("Name"):
            d["name"] = self._clean_name(summary["Name"])
        fmt = _attr(summary, "Format")
        if fmt:
            d["format"] = fmt
        # LastUpdated changes only when the list is edited. An older one means an
        # event's copy from before an edit, or a replayed log: history, not the current list.
        incoming = _attr(summary, "LastUpdated")
        older = bool(d.get("main")) and bool(incoming) and local_time(incoming) < local_time(d.get("lastUpdated", ""))
        last_played = _attr(summary, "LastPlayed")
        if last_played and local_time(last_played) > local_time(d.get("lastPlayed", "")):
            d["lastPlayed"] = last_played
        if incoming and not older:
            d["lastUpdated"] = incoming
        if summary.get("DeckTileId"):
            d["tile"] = summary["DeckTileId"]
        if deck and older:
            self._note_version(d, incoming, _cards(deck.get("MainDeck")), _cards(deck.get("Sideboard")))
        elif deck:
            if touch and not incoming:
                d["lastUpdated"] = datetime.now().astimezone().isoformat(timespec="seconds")
            self._set_lists(d, deck)
        self.dirty = True

    @staticmethod
    def _clean_name(name: str) -> str:
        if name.startswith("?=?Loc/Decks/Precon/"):
            return "Precon " + name.rsplit("/", 1)[-1].replace("Precon_", "").replace("_", " ")
        return name

    def _set_lists(self, d: Dict, deck: Dict):
        d["main"] = _cards(deck.get("MainDeck"))
        d["side"] = _cards(deck.get("Sideboard"))
        d["commander"] = _cards(deck.get("CommandZone"))
        d["companions"] = _cards(deck.get("Companions"))
        self._note_version(d, d.get("lastUpdated", ""))

    # ---- versions ---------------------------------------------------------

    def names(self, rows: Iterable[Tuple[int, int]]) -> Counter:
        out: Counter = Counter()
        for grp, n in rows:
            card = self.cards.get(grp)
            out[card["name"] if card else f"#{grp}"] += n
        return out

    def _note_version(self, d: Dict, at: str, main: Optional[List] = None, side: Optional[List] = None):
        """Keep a snapshot, in time order, each time a deck's main list changes."""
        main = d.get("main") if main is None else main
        side = d.get("side", []) if side is None else side
        if not main:
            return
        key = names_key(self.names(main))
        versions = d.setdefault("versions", [])
        if versions and versions[-1]["key"] == key and (not at or local_time(at) >= local_time(versions[-1]["at"])):
            versions[-1]["side"] = side
            return
        if any(v["key"] == key and v["at"] == at for v in versions):
            return
        versions.append({"key": key, "at": at or datetime.now().astimezone().isoformat(timespec="seconds"), "main": main, "side": side})
        versions.sort(key=lambda v: local_time(v["at"]))
        # A list re-seen later than its first snapshot isn't a new version.
        collapsed = [v for i, v in enumerate(versions) if i == 0 or v["key"] != versions[i - 1]["key"]]
        d["versions"] = collapsed[-MAX_VERSIONS:]
        self.dirty = True

    # ---- sideboard guides -------------------------------------------------

    def set_guide(self, deck_id: str, key: str, ins: List[Dict], outs: List[Dict], note: str, previous: str = "") -> bool:
        """Save a plan. `previous` is the key it was saved under before, when renaming; a plan
        whose key differs only in case is replaced too, since matching ignores case."""
        with self._lock:
            d = self.decks.get(deck_id)
            if not d or not key:
                return False
            clean = lambda rows: [{"name": r["name"], "count": int(r["count"])} for r in rows if r.get("name") and int(r.get("count", 0)) > 0]
            guides = d.setdefault("guides", {})
            for old in [k for k in guides if k == previous or k.casefold() == key.casefold()]:
                del guides[old]
            guides[key] = {
                "in": clean(ins), "out": clean(outs), "note": note,
                "updated": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
            self.dirty = True
        self.save()
        return True

    def delete_guide(self, deck_id: str, key: str) -> bool:
        with self._lock:
            d = self.decks.get(deck_id)
            if not d or key not in d.get("guides", {}):
                return False
            del d["guides"][key]
            self.dirty = True
        self.save()
        return True

    def _delete(self, deck_id: Optional[str]):
        if deck_id and deck_id in self.decks:
            self.decks[deck_id]["deleted"] = True
            self.dirty = True

    def _event_deck(self, event: Optional[str], deck_id: Optional[str]):
        if event and deck_id and self.event_decks.get(event) != deck_id:
            self.event_decks[event] = deck_id
            self.dirty = True

    # ---- ownership --------------------------------------------------------

    def _name_counts(self, cards: Iterable[Tuple[int, int]]) -> Counter:
        out: Counter = Counter()
        for grp, n in cards:
            card = self.cards.get(grp)
            if card and "Basic" not in card.get("supertypes", []):
                out[card["name"]] += n
        return out

    def note_owned(self, cards: Iterable[Tuple[int, int]]):
        with self._lock:
            for name, n in self._name_counts(cards).items():
                if self.owned.get(name, 0) < min(n, 4):
                    self.owned[name] = min(n, 4)
                    self.dirty = True

    def note_played(self, deck: List[int]):
        self.note_owned(Counter(deck).items())

    # ---- identity ---------------------------------------------------------

    def identify(self, event_id: str, played: List[int]) -> Optional[Dict]:
        """The library deck a game was played with: the deck set for that event,
        else the deck whose non-basic cards overlap the played list the most."""
        played_names = self._name_counts(Counter(played).items())
        if not played_names:
            return None
        total = sum(played_names.values())

        def score(d: Dict) -> float:
            names = self._name_counts(d.get("main", []))
            if not names:
                return 0.0
            return sum((names & played_names).values()) / max(total, sum(names.values()))

        with self._lock:
            preferred = self.decks.get(self.event_decks.get(event_id, ""))
            if preferred and score(preferred) >= 0.6:
                return preferred
            best, best_score = None, 0.75
            for d in self.decks.values():
                s = score(d)
                if s > best_score:
                    best, best_score = d, s
            return best

    # ---- imports ----------------------------------------------------------

    def import_text(self, text: str, name: str = "", fmt: str = "", save: bool = True) -> Tuple[Dict, List[str]]:
        """Arena/MTGO deck text -> a deck (saved unless save=False). Returns it and unknown lines."""
        main, side, commander, companions, unknown = [], [], [], [], []
        section = main
        sections = {"deck": main, "main": main, "maindeck": main, "sideboard": side, "commander": commander, "companion": companions}
        for raw in text.splitlines():
            line = raw.strip()
            key = line.lower().rstrip(":")
            if key in sections:
                section = sections[key]
                continue
            if not line:
                if main and section is main:
                    section = side
                continue
            if key.startswith("about") or key.startswith("name "):
                if key.startswith("name "):
                    name = name or line[5:].strip()
                continue
            m = re.match(r"^(\d+)x?\s+(.+?)(?:\s+\(([A-Za-z0-9_-]+)\)(?:\s+(\S+))?)?\s*$", line)
            if not m:
                unknown.append(line)
                continue
            count, card_name = int(m.group(1)), m.group(2).strip()
            card = self.cards.lookup(card_name)
            if not card:
                unknown.append(line)
                continue
            section.append([card["grpId"], count])
        if not main:
            raise ValueError("No cards recognised in that list.")
        deck_id = f"import-{uuid.uuid4().hex[:10]}"
        merged = lambda rows: [[g, n] for g, n in sum((Counter({g: n}) for g, n in rows), Counter()).items()]
        deck = {
            "id": deck_id, "source": "import", "name": name or "Imported deck", "format": fmt,
            "main": merged(main), "side": merged(side), "commander": merged(commander), "companions": merged(companions),
            "lastUpdated": datetime.now().isoformat(timespec="seconds"), "deleted": False,
        }
        if not save:
            return deck, unknown
        with self._lock:
            self.decks[deck_id] = deck
            self.dirty = True
        self.save()
        return deck, unknown

    def remove(self, deck_id: str) -> bool:
        with self._lock:
            d = self.decks.get(deck_id)
            if not d or d.get("source") != "import":
                return False
            del self.decks[deck_id]
            self.dirty = True
        self.save()
        return True

    def rename(self, deck_id: str, name: str) -> bool:
        with self._lock:
            d = self.decks.get(deck_id)
            if not d or d.get("source") != "import":
                return False
            d["name"] = name
            self.dirty = True
        self.save()
        return True

    def export_text(self, deck: Dict) -> str:
        def lines(rows):
            out = []
            for grp, n in rows:
                card = self.cards.get(grp)
                if not card:
                    continue
                set_code = (card.get("set") or "").split("-")[0]
                suffix = f" ({set_code}) {card['collector']}" if set_code and card.get("collector") and deck.get("source") == "arena" else ""
                out.append(f"{n} {card['name']}{suffix}")
            return out

        parts = []
        if deck.get("commander"):
            parts += ["Commander", *lines(deck["commander"]), ""]
        if deck.get("companions"):
            parts += ["Companion", *lines(deck["companions"]), ""]
        parts += ["Deck", *lines(deck.get("main", []))]
        if deck.get("side"):
            parts += ["", "Sideboard", *lines(deck["side"])]
        return "\n".join(parts)

    def paper_list(self, deck: Dict, sideboard: bool = True, basics: bool = False) -> Dict:
        """The deck as a store shopping list: plain 'count name' lines, paper names, one entry
        per card. Rebalanced Alchemy cards become their originals; Arena-only cards are listed
        apart because no paper copy exists."""
        rows = list(deck.get("commander", [])) + list(deck.get("companions", [])) + list(deck.get("main", []))
        if sideboard:
            rows += list(deck.get("side", []))
        counts: Counter = Counter()
        digital: Counter = Counter()
        rebalanced, basic_count = set(), 0
        digital_only = getattr(self.cards, "digital_only", lambda name: False)
        for grp, n in rows:
            card = self.cards.get(grp)
            if not card:
                continue
            name = card["name"]
            if name.startswith("A-"):
                name = name[2:]
                rebalanced.add(name)
            if "Basic" in card.get("supertypes", []) and "Land" in card.get("types", []):
                basic_count += n
                if not basics:
                    continue
            if digital_only(card["name"]):
                digital[name] += n
                continue
            counts[name.replace(" /// ", " // ")] += n
        cards = [{"name": k, "count": v} for k, v in counts.items()]
        return {
            "cards": cards,
            "text": "\n".join(f"{c['count']} {c['name']}" for c in cards),
            "digital": [{"name": k, "count": v} for k, v in digital.items()],
            "rebalanced": sorted(rebalanced),
            "basics": basic_count,
        }

    # ---- collection -------------------------------------------------------

    def missing(self, deck: Dict) -> Dict:
        """Copies not proven owned, and the wildcards needed to craft them."""
        need = self._name_counts(deck.get("main", []) + deck.get("side", []) + deck.get("commander", []) + deck.get("companions", []))
        rows, cost = [], Counter()
        for name, n in sorted(need.items()):
            have = self.owned.get(name, 0)
            if n > have:
                rarity = self.cards.craft_rarity(name)
                rows.append({"name": name, "need": n, "owned": have, "missing": n - have, "rarity": rarity})
                if rarity in WILDCARD_KEYS:
                    cost[rarity] += n - have
        return {
            "cards": rows,
            "wildcards": {r: cost.get(r, 0) for r in WILDCARD_KEYS},
            "balance": dict(self.wildcards),
            "affordable": all(cost.get(r, 0) <= self.wildcards.get(r, 0) for r in WILDCARD_KEYS) if self.wildcards else None,
        }

    def visible(self) -> List[Dict]:
        with self._lock:
            return [dict(d) for d in self.decks.values() if not d.get("deleted")]
