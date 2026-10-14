"""
bridge/meta.py
Opt-in tournament metagame data: archetypes, meta share and sample lists from
Spicerack's public decklist API and (optionally) mtgtop8.com.

Nothing here touches the network unless the user turns it on in Settings.
Results are cached per format in Temp/meta and refreshed at most daily; live
games and stats only ever read the cache.
"""

import json
import logging
import math
import os
import re
import threading
import time
from collections import Counter
from datetime import datetime
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import requests

from src import constants

from bridge.arena_cards import arena_cards

logger = logging.getLogger(__name__)

META_DIR = os.path.join(constants.BASE_DIR, "Temp", "meta")
USER_AGENT = "MTGA-Draft-Overlay (+https://github.com/Dryspell/MTGA_Draft_17Lands)"
SPICERACK_URL = "https://api.spicerack.gg/api/export-decklists/"
MTGTOP8_URL = "https://mtgtop8.com"
MAX_AGE = 24 * 3600
MIN_MANUAL_AGE = 3600
COLORS = "WUBRG"

# Overlay format label -> (Spicerack event_format, mtgtop8 format code)
FORMATS: Dict[str, Tuple[Optional[str], Optional[str]]] = {
    "Standard": ("STANDARD", "ST"),
    "Pioneer": ("PIONEER", "PI"),
    "Explorer": ("EXPLORER", "EXP"),
    "Historic": ("HISTORIC", "HI"),
    "Timeless": ("TIMELESS", None),
    "Alchemy": (None, "ALCH"),
    "Gladiator": ("GLADIATOR", None),
    "Standard Brawl": ("STANDARD_BRAWL", None),
}
_ARENA_FORMATS = {
    "standard": "Standard", "explorer": "Explorer", "historic": "Historic", "timeless": "Timeless",
    "alchemy": "Alchemy", "pioneer": "Pioneer", "gladiator": "Gladiator", "standardbrawl": "Standard Brawl", "brawl": "Standard Brawl",
}
_STANDARD_EVENTS = {"ladder", "play", "traditional_ladder", "traditional_play", "constructed_bestof3", "constructed_bestof1"}


def format_of(deck_format: str = "", event_id: str = "") -> Optional[str]:
    """Arena deck format ('TraditionalStandard') or event name ('Historic_Ladder') -> a FORMATS key."""
    key = re.sub(r"[^a-z]", "", (deck_format or "").lower()).removeprefix("traditional")
    if key in _ARENA_FORMATS:
        return _ARENA_FORMATS[key]
    if key:
        return None
    ev = (event_id or "").lower()
    if "brawl" in ev:
        return None if "historic" in ev else "Standard Brawl"
    for label in ("Historic", "Explorer", "Alchemy", "Timeless", "Pioneer", "Gladiator"):
        if label.lower() in ev:
            return label
    if ev in _STANDARD_EVENTS or "standard" in ev:
        return "Standard"
    return None


def canonical(name: str) -> str:
    card = arena_cards.lookup(name) if arena_cards.loaded else None
    return card["name"] if card else name.strip()


def is_land(name: str) -> bool:
    card = arena_cards.lookup(name) if arena_cards.loaded else None
    if card:
        return "Land" in card.get("types", [])
    return name in ("Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes")


def parse_list(text: str) -> Tuple[List[Dict], List[Dict]]:
    """Plain deck text (MTGO, Arena, Moxfield exports) -> (main, side) as [{name, count}]."""
    main, side = Counter(), Counter()
    section = main
    for raw in (text or "").splitlines():
        line = raw.strip()
        low = line.lower().strip("~:# ")
        if not line:
            if main and section is main:
                section = side
            continue
        if low in ("sideboard", "side", "sb"):
            section = side
            continue
        if low in ("deck", "main", "maindeck", "mainboard", "commander", "commanders", "companion"):
            section = main
            continue
        target = section
        if low.startswith("sb:"):
            target, line = side, line[3:].strip()
        m = re.match(r"^(\d+)x?\s+(.+?)(?:\s+\([A-Za-z0-9_-]+\)(?:\s+\S+)?)?(?:\s+\*F\*)?\s*$", line)
        if m:
            target[canonical(m.group(2))] += int(m.group(1))
    rows = lambda c: [{"name": n, "count": k} for n, k in c.items() if k > 0]
    return rows(main), rows(side)


def deck_text(deck: Dict) -> str:
    lines = ["Deck", *(f"{c['count']} {c['name']}" for c in deck.get("main", []))]
    if deck.get("side"):
        lines += ["", "Sideboard", *(f"{c['count']} {c['name']}" for c in deck["side"])]
    return "\n".join(lines)


# ---- fetching -----------------------------------------------------------------------

class Fetcher:
    """Polite HTTP: one request at a time, spaced out, with an identifying user agent."""

    def __init__(self, delay: float = 1.0):
        self.delay = delay
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last = 0.0

    def get(self, url: str, timeout=20, **kwargs) -> requests.Response:
        wait = self._last + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            res = self.session.get(url, timeout=timeout, **kwargs)
        finally:
            self._last = time.monotonic()
        res.raise_for_status()
        return res

    def text(self, url: str, **kwargs) -> str:
        res = self.get(url, **kwargs)
        try:
            return res.content.decode("utf-8")
        except UnicodeDecodeError:
            return res.content.decode("latin-1")


_ARCH_LINK = re.compile(
    r"<a href=archetype\?a=(\d+)&meta=(\d+)&f=(\w+)>([^<]+)</a>.*?class=S14>\s*([\d.]+)\s*%", re.S)
_DECK_ROW = re.compile(
    r"<a href=/event\?e=(\d+)&d=(\d+)&f=\w+>([^<]+)</a></td>\s*"
    r"<td><a class=player[^>]*>([^<]*)</a></td>\s*"
    r"<td><a [^>]*>([^<]*)</a></td>\s*"
    r"<td[^>]*>.*?</td>\s*"
    r"<td>([^<]*)</td>\s*"
    r"<td>([^<]*)</td>", re.S)


def parse_mtgtop8_format(html: str) -> List[Dict]:
    """Archetypes on a format page: [{id, meta, name, share, style}], in page order."""
    out = []
    for block in re.split(r"class=meta_arch", html)[1:]:
        style_m = re.match(r"[^>]*>\s*([A-Za-z ]+?)\s+\d+\s*%", block)
        style = style_m.group(1).strip().title() if style_m else ""
        for m in _ARCH_LINK.finditer(block):
            out.append({"id": m.group(1), "meta": m.group(2), "name": m.group(4).strip(), "share": float(m.group(5)) / 100, "style": style})
    return out


def parse_mtgtop8_archetype(html: str) -> List[Dict]:
    """Deck rows on an archetype page, newest first."""
    rows = []
    for m in _DECK_ROW.finditer(html):
        rows.append({
            "event": m.group(1), "id": m.group(2), "name": m.group(3).strip(), "player": m.group(4).strip(),
            "eventName": m.group(5).strip(), "rank": m.group(6).strip(), "date": _dmy(m.group(7).strip()),
        })
    return rows


def _dmy(text: str) -> str:
    try:
        return datetime.strptime(text, "%d/%m/%y").date().isoformat()
    except ValueError:
        return text


def fetch_mtgtop8(code: str, fetch: Fetcher, progress: Callable[[str], None], top: int = 12, per: int = 4) -> List[Dict]:
    """Top archetypes for a format, each with a few recent lists."""
    archetypes = parse_mtgtop8_format(fetch.text(f"{MTGTOP8_URL}/format?f={code}"))
    archetypes = sorted(archetypes, key=lambda a: -a["share"])[:top]
    for i, arch in enumerate(archetypes):
        progress(f"mtgtop8: {arch['name']} ({i + 1}/{len(archetypes)})")
        arch["url"] = f"{MTGTOP8_URL}/archetype?a={arch['id']}&meta={arch['meta']}&f={code}"
        arch["decks"] = []
        try:
            rows = parse_mtgtop8_archetype(fetch.text(arch["url"]))
        except requests.RequestException as e:
            logger.warning("mtgtop8 archetype %s failed: %s", arch["name"], e)
            continue
        for row in rows[:per]:
            try:
                main, side = parse_list(fetch.text(f"{MTGTOP8_URL}/mtgo?d={row['id']}"))
            except requests.RequestException as e:
                logger.warning("mtgtop8 deck %s failed: %s", row["id"], e)
                continue
            if main:
                arch["decks"].append({
                    "id": f"mtgtop8:{row['id']}", "source": "mtgtop8", "player": row["player"], "event": row["eventName"],
                    "rank": row["rank"], "date": row["date"], "url": f"{MTGTOP8_URL}/event?e={row['event']}&d={row['id']}&f={code}",
                    "main": main, "side": side,
                })
    return archetypes


def fetch_spicerack(code: str, fetch: Fetcher, api_key: str = "", days: int = 14, limit: int = 400) -> List[Dict]:
    """Recent tournament decklists (no archetype labels) with their records."""
    headers = {"X-API-Key": api_key} if api_key else {}
    res = fetch.get(SPICERACK_URL, timeout=(10, 60), headers=headers,
                    params={"num_days": days, "event_format": code, "decklist_as_text": "true"})
    decks = []
    for t in res.json() or []:
        date = datetime.fromtimestamp(t["startDate"]).date().isoformat() if t.get("startDate") else ""
        for rank, s in enumerate(t.get("standings") or [], 1):
            main, side = parse_list(s.get("decklist_text") or "")
            if sum(c["count"] for c in main) < 40:
                continue
            decks.append({
                "id": f"spicerack:{t.get('TID')}:{rank}", "source": "spicerack", "player": s.get("name", ""),
                "event": t.get("tournamentName", ""), "rank": str(rank), "date": date, "url": s.get("decklist") or t.get("bracketUrl", ""),
                "wins": int(s.get("winsSwiss") or 0) + int(s.get("winsBracket") or 0),
                "losses": int(s.get("lossesSwiss") or 0) + int(s.get("lossesBracket") or 0),
                "main": main, "side": side,
            })
            if len(decks) >= limit:
                return decks
    return decks


# ---- archetypes ---------------------------------------------------------------------

def _spells(deck: Dict) -> Counter:
    return Counter({c["name"]: c["count"] for c in deck["main"] if not is_land(c["name"])})


def _cosine(a: Counter, b: Dict[str, float]) -> float:
    dot = sum(n * b.get(k, 0) for k, n in a.items())
    na = math.sqrt(sum(n * n for n in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _profile(decks: List[Dict]) -> List[Dict]:
    """Per card: share of lists playing it and average copies when played."""
    seen, copies = Counter(), Counter()
    for d in decks:
        for c in d["main"]:
            seen[c["name"]] += 1
            copies[c["name"]] += c["count"]
    n = len(decks) or 1
    rows = [{"name": k, "inclusion": seen[k] / n, "avg": copies[k] / seen[k], "land": is_land(k)} for k in seen]
    return sorted(rows, key=lambda r: (-r["inclusion"], -r["avg"], r["name"]))


def _expected(cards: List[Dict], spells_only: bool = True) -> Dict[str, float]:
    return {c["name"]: c["inclusion"] * c["avg"] for c in cards if not (spells_only and c["land"])}


def _colors(cards: List[Dict]) -> List[str]:
    weight = Counter()
    total = 0.0
    for c in cards:
        if c["land"]:
            continue
        card = arena_cards.lookup(c["name"]) if arena_cards.loaded else None
        w = c["inclusion"] * c["avg"]
        total += w
        for col in (card or {}).get("colors", []) or []:
            weight[col] += w
    return [c for c in COLORS if total and weight[c] / total >= 0.08]


def _name_for(cards: List[Dict], colors: List[str]) -> str:
    from bridge.game_view import archetype_name
    raw = []
    for c in cards:
        card = arena_cards.lookup(c["name"]) if arena_cards.loaded else None
        if card and c["inclusion"] >= 0.5:
            raw.append(dict(card, count=round(c["avg"])))
    return archetype_name(colors, raw)


def _finish(arch: Dict, decks: List[Dict]) -> Dict:
    cards = _profile(decks)
    played = [d for d in decks if d.get("wins") is not None and (d.get("wins", 0) + d.get("losses", 0))]
    wins = sum(d["wins"] for d in played)
    losses = sum(d["losses"] for d in played)
    decks = sorted(decks, key=lambda d: (d.get("date", ""), -(d.get("wins") or 0)), reverse=True)
    arch.update({
        "colors": arch.get("colors") or _colors(cards),
        "cards": cards[:60],
        "deckCount": len(decks),
        "winRate": wins / (wins + losses) if wins + losses else None,
        "matches": wins + losses,
        "decks": decks[:8],
    })
    return arch


def build_archetypes(top8: List[Dict], spice: List[Dict], threshold: float = 0.55) -> List[Dict]:
    """mtgtop8 archetypes as the backbone; Spicerack lists join the closest one, or
    cluster among themselves and get a name from their colors and play style."""
    archetypes: List[Dict] = []
    for a in top8:
        if not a.get("decks"):
            continue
        archetypes.append({"id": f"mtgtop8:{a['id']}", "name": a["name"], "style": a.get("style", ""), "share": a["share"],
                           "source": "mtgtop8", "url": a.get("url", ""), "decks": list(a["decks"])})
    centroids = [_expected(_profile(a["decks"])) for a in archetypes]

    clusters: List[Dict] = []
    for deck in spice:
        spells = _spells(deck)
        scores = [_cosine(spells, c) for c in centroids]
        best = max(range(len(scores)), key=scores.__getitem__) if scores else -1
        if best >= 0 and scores[best] >= threshold:
            archetypes[best]["decks"].append(deck)
            continue
        cscores = [_cosine(spells, c["centroid"]) for c in clusters]
        cbest = max(range(len(cscores)), key=cscores.__getitem__) if cscores else -1
        if cbest >= 0 and cscores[cbest] >= threshold:
            cl = clusters[cbest]
            cl["decks"].append(deck)
            cl["centroid"] = _expected(_profile(cl["decks"]))
        else:
            clusters.append({"decks": [deck], "centroid": dict(spells)})

    total_spice = len(spice) or 1
    keep_singletons = len(spice) < 30
    for a in archetypes:
        a["tournamentDecks"] = sum(1 for d in a["decks"] if d["source"] == "spicerack")
        _finish(a, a["decks"])

    taken = {a["name"] for a in archetypes}
    for cl in sorted(clusters, key=lambda c: -len(c["decks"])):
        if len(cl["decks"]) < 2 and not keep_singletons:
            continue
        cards = _profile(cl["decks"])
        colors = _colors(cards)
        name = _name_for(cards, colors)
        if name in taken:
            signature = next((c["name"] for c in cards if not c["land"]), "")
            name = f"{name} ({signature})" if signature else name
        n = 2
        base = name
        while name in taken:
            name, n = f"{base} {n}", n + 1
        taken.add(name)
        arch = {"id": f"spicerack:{name}", "name": name, "style": name.rsplit(" ", 1)[-1], "share": len(cl["decks"]) / total_spice,
                "source": "spicerack", "url": "", "colors": colors, "tournamentDecks": len(cl["decks"])}
        archetypes.append(_finish(arch, cl["decks"]))
    return sorted(archetypes, key=lambda a: (-a["share"], -a["deckCount"]))


# ---- store --------------------------------------------------------------------------

class MetaStore:
    def __init__(self, folder: str = META_DIR):
        self.folder = folder
        self.settings: Callable[[], Optional[object]] = lambda: None
        self._cache: Dict[str, Optional[Dict]] = {}
        self._failed: Dict[str, float] = {}
        self._lock = threading.Lock()

    # settings -------------------------------------------------------------

    def _setting(self, name: str, default=None):
        s = self.settings()
        return getattr(s, name, default) if s is not None else default

    @property
    def enabled(self) -> bool:
        return bool(self._setting("meta_enabled", False))

    def sources(self, fmt: str) -> Dict[str, bool]:
        spice, top8 = FORMATS.get(fmt, (None, None))
        return {"spicerack": bool(spice), "mtgtop8": bool(top8) and bool(self._setting("meta_mtgtop8", False))}

    # cache ----------------------------------------------------------------

    def _path(self, fmt: str) -> str:
        return os.path.join(self.folder, re.sub(r"[^A-Za-z]", "", fmt) + ".json")

    def load(self, fmt: Optional[str]) -> Optional[Dict]:
        if not fmt or fmt not in FORMATS:
            return None
        with self._lock:
            if fmt in self._cache:
                return self._cache[fmt]
        try:
            with open(self._path(fmt), "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = None
        with self._lock:
            self._cache[fmt] = data
        return data

    def save(self, fmt: str, data: Dict):
        os.makedirs(self.folder, exist_ok=True)
        tmp = self._path(fmt) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, self._path(fmt))
        with self._lock:
            self._cache[fmt] = data

    def age(self, fmt: str) -> Optional[float]:
        data = self.load(fmt)
        if not data or not data.get("fetchedAt"):
            return None
        return time.time() - data["fetchedAt"]

    def stale(self, fmt: str, max_age: float = MAX_AGE) -> bool:
        age = self.age(fmt)
        return age is None or age > max_age

    def active(self, fmt: Optional[str]) -> Optional[Dict]:
        """Cached data, only while the feature is on."""
        return self.load(fmt) if self.enabled else None

    # refresh --------------------------------------------------------------

    def refresh(self, fmt: str, progress: Callable[[str], None] = lambda m: None, fetch: Optional[Fetcher] = None) -> Dict:
        if fmt not in FORMATS:
            raise ValueError(f"No tournament data for {fmt}")
        fetch = fetch or Fetcher()
        spice_code, top8_code = FORMATS[fmt]
        use = self.sources(fmt)
        status: Dict[str, Dict] = {}
        top8: List[Dict] = []
        spice: List[Dict] = []
        if use["mtgtop8"]:
            progress("mtgtop8: reading the metagame")
            try:
                top8 = fetch_mtgtop8(top8_code, fetch, progress)
                status["mtgtop8"] = {"ok": True, "archetypes": len(top8), "decks": sum(len(a.get("decks", [])) for a in top8)}
            except Exception as e:
                logger.warning("mtgtop8 refresh failed: %s", e)
                status["mtgtop8"] = {"ok": False, "error": _reason(e)}
        if use["spicerack"]:
            progress("Spicerack: downloading recent tournament lists")
            try:
                spice = fetch_spicerack(spice_code, fetch, self._setting("meta_spicerack_key", "") or "")
                status["spicerack"] = {"ok": True, "decks": len(spice)}
            except Exception as e:
                logger.warning("Spicerack refresh failed: %s", e)
                status["spicerack"] = {"ok": False, "error": _reason(e)}
        previous = self.load(fmt)
        if not top8 and not spice:
            self._failed[fmt] = time.time()
            if previous:
                previous = dict(previous, sources=status, lastError=time.time())
                self.save(fmt, previous)
                return previous
            raise RuntimeError("; ".join(f"{k}: {v.get('error')}" for k, v in status.items()) or "No sources enabled for this format")
        progress("Grouping lists into archetypes")
        data = {
            "format": fmt, "fetchedAt": time.time(), "fetched": datetime.now().isoformat(timespec="seconds"),
            "sources": status, "archetypes": build_archetypes(top8, spice),
        }
        self.save(fmt, data)
        self._failed.pop(fmt, None)
        return data

    def due(self, fmt: str) -> bool:
        """Worth refreshing on its own: stale, covered by an enabled source, and not failing lately."""
        failed = self._failed.get(fmt, 0)
        return any(self.sources(fmt).values()) and self.stale(fmt) and time.time() - failed > MIN_MANUAL_AGE

    # matching -------------------------------------------------------------

    def classify(self, fmt: Optional[str], seen: Dict[str, int], colors: Iterable[str] = ()) -> Optional[Dict]:
        """The archetype an opponent's revealed cards point to, if they clearly point to one."""
        data = self.active(fmt)
        if not data:
            return None
        spells = {n for n, k in seen.items() if k > 0 and not is_land(n)}
        if len(spells) < 3:
            return None
        colors = set(colors)
        best, best_key = None, (0.0, 0.0)
        for a in data["archetypes"]:
            incl = {c["name"]: c["inclusion"] for c in a["cards"] if not c["land"]}
            matched = sorted(n for n in spells if incl.get(n, 0) >= 0.2)
            if len(matched) < max(3, math.ceil(0.5 * len(spells))):
                continue
            score = sum(incl.get(n, 0) for n in spells) / len(spells)
            if colors and not colors <= set(a.get("colors", [])):
                score *= 0.5
            key = (score, a["share"])
            if key > best_key:
                best, best_key = (a, matched), key
        if not best or best_key[0] < 0.5:
            return None
        a, matched = best
        return {"id": a["id"], "name": a["name"], "share": a["share"], "source": a["source"], "score": round(best_key[0], 3), "matched": matched}

    def rank(self, fmt: Optional[str], main: Dict[str, int]) -> List[Tuple[float, Dict]]:
        data = self.active(fmt)
        if not data:
            return []
        spells = Counter({n: k for n, k in main.items() if k > 0 and not is_land(n)})
        scored = [(_cosine(spells, _expected(a["cards"])), a) for a in data["archetypes"]]
        return sorted(scored, key=lambda s: -s[0])

    def compare(self, fmt: Optional[str], main: Dict[str, int], archetype_id: str = "") -> Optional[Dict]:
        """How a list differs from the closest (or chosen) archetype and its nearest stock list."""
        ranked = self.rank(fmt, main)
        if not ranked:
            return None
        chosen = next(((s, a) for s, a in ranked if a["id"] == archetype_id), ranked[0])
        similarity, a = chosen
        spells = Counter({n: k for n, k in main.items() if not is_land(n)})
        missing, extra = [], []
        by_name = {c["name"]: c for c in a["cards"]}
        for c in a["cards"]:
            typical = round(c["avg"])
            have = main.get(c["name"], 0)
            if c["inclusion"] >= 0.5 and have < typical:
                missing.append({"name": c["name"], "have": have, "typical": typical, "inclusion": c["inclusion"], "land": c["land"]})
        for name, n in sorted(spells.items()):
            incl = by_name.get(name, {}).get("inclusion", 0)
            if incl < 0.25:
                extra.append({"name": name, "count": n, "inclusion": incl})
        nearest = None
        if a.get("decks"):
            mine = Counter(main)
            best = max(a["decks"], key=lambda d: _cosine(Counter({c["name"]: c["count"] for c in d["main"]}), dict(mine)))
            theirs = Counter({c["name"]: c["count"] for c in best["main"]})
            rows = lambda c: [{"name": n, "count": k} for n, k in sorted(c.items()) if k > 0]
            nearest = {**_deck_meta(best), "add": rows(theirs - mine), "cut": rows(mine - theirs)}
        return {
            "format": fmt,
            "archetype": {k: a.get(k) for k in ("id", "name", "share", "source", "colors", "deckCount", "winRate", "url")},
            "similarity": round(similarity, 3),
            "options": [{"id": x["id"], "name": x["name"], "similarity": round(s, 3)} for s, x in ranked],
            "missing": missing,
            "extra": extra,
            "nearest": nearest,
        }

    def names(self, fmt: Optional[str]) -> List[str]:
        data = self.active(fmt)
        return [a["name"] for a in data["archetypes"]] if data else []


def _deck_meta(d: Dict) -> Dict:
    return {k: d.get(k) for k in ("id", "source", "player", "event", "rank", "date", "url", "wins", "losses")}


def _reason(e: Exception) -> str:
    if isinstance(e, requests.Timeout):
        return "timed out"
    if isinstance(e, requests.ConnectionError):
        return "couldn't connect"
    if isinstance(e, requests.HTTPError) and e.response is not None:
        code = e.response.status_code
        return "needs an API key" if code in (401, 403) else f"HTTP {code}"
    return str(e)[:200]


meta_store = MetaStore()
