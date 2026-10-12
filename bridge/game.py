"""
bridge/game.py
Follows Arena's Game Rules Engine messages in Player.log and keeps a model of the
game being played: zones, objects, life totals, and what each player has shown.
Requires "Detailed Logs (Plugin Support)" in Arena, the same setting drafts need.
"""

import json
import logging
import os
from collections import Counter
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

PUBLIC_ZONES = {"ZoneType_Battlefield", "ZoneType_Graveyard", "ZoneType_Exile", "ZoneType_Stack"}
OUT_OF_LIBRARY = PUBLIC_ZONES | {"ZoneType_Hand"}
TIMELINE_ACTIONS = {
    "CastSpell": "cast", "PlayLand": "played", "Countered": "countered",
    "Destroy": "destroyed", "SBA_Damage": "died", "SBA_Deathtouch": "died", "Sacrifice": "sacrificed",
    "Exile": "exiled", "Discard": "discarded", "Return": "returned",
}
MARKERS = ("greToClientEvent", "matchGameRoomStateChangedEvent")


def _detail(annotation: Dict, key: str):
    for d in annotation.get("details", []):
        if d.get("key") == key:
            values = d.get("valueInt32") or d.get("valueString") or []
            return values[0] if values else None
    return None


class Game:
    """State of a single game within a match."""

    def __init__(self, match_id: str, game_number: int, seat: int, event_id: str, deck: List[int]):
        self.match_id = match_id
        self.game_number = game_number
        self.seat = seat
        self.event_id = event_id
        self.deck = list(deck)
        self.objects: Dict[int, Dict] = {}
        self.zones: Dict[int, Dict] = {}
        self.players: Dict[int, Dict] = {}
        self.turn: Dict = {}
        self.info: Dict = {}
        self.alias: Dict[int, int] = {}
        self.opp_seen: Dict[int, int] = {}
        self.events: List[Dict] = []
        self.drawn: List[int] = []
        self.opening_hand: Optional[List[int]] = None
        self.my_turns: List[int] = []
        self.land_turns: set = set()
        self.life: Dict[int, List[int]] = {}
        self.on_play: Optional[bool] = None
        self.result: Optional[str] = None
        self.updated_at: Optional[float] = None

    @property
    def key(self) -> str:
        return f"{self.match_id}:{self.game_number}"

    @property
    def opponent(self) -> int:
        others = [s for s in self.players if s != self.seat]
        return others[0] if others else (2 if self.seat == 1 else 1)

    @property
    def over(self) -> bool:
        return self.result is not None

    def canonical(self, instance_id: int) -> int:
        seen = set()
        while instance_id in self.alias and instance_id not in seen:
            seen.add(instance_id)
            instance_id = self.alias[instance_id]
        return instance_id

    def zone_of(self, seat: int, zone_type: str) -> Dict:
        for z in self.zones.values():
            if z.get("type") == zone_type and z.get("ownerSeatId") == seat:
                return z
        return {}

    def cards_in(self, seat: int, zone_type: str) -> List[Dict]:
        """Objects in a zone belonging to a seat. Battlefield, stack and exile are shared
        zones, so ownership comes from each object (controller on the battlefield)."""
        out = []
        for z in self.zones.values():
            if z.get("type") != zone_type:
                continue
            for i in z.get("objectInstanceIds", []):
                obj = self.objects.get(i)
                if not obj:
                    continue
                who = obj.get("controllerSeatId", obj.get("ownerSeatId")) if zone_type == "ZoneType_Battlefield" else obj.get("ownerSeatId")
                if who == seat:
                    out.append(obj)
        return out

    def zone_size(self, seat: int, zone_type: str) -> int:
        return len(self.zone_of(seat, zone_type).get("objectInstanceIds", []))

    def life_of(self, seat: int) -> int:
        return self.players.get(seat, {}).get("lifeTotal", 20)

    def library_remaining(self) -> Counter:
        """Deck list minus own cards known to be outside the library."""
        remaining = Counter(self.deck)
        for z in self.zones.values():
            if z.get("type") not in OUT_OF_LIBRARY:
                continue
            for i in z.get("objectInstanceIds", []):
                obj = self.objects.get(i)
                if not obj or obj.get("type") != "GameObjectType_Card" or obj.get("ownerSeatId") != self.seat:
                    continue
                grp = obj.get("grpId")
                if remaining.get(grp, 0) <= 0:
                    grp = obj.get("othersideGrpId", grp)
                if remaining.get(grp, 0) > 0:
                    remaining[grp] -= 1
        return +remaining

    # ---- message handling -------------------------------------------------

    def apply(self, gs: Dict):
        if gs.get("type") == "GameStateType_Full":
            self.objects.clear()
            self.zones.clear()
        for z in gs.get("zones", []):
            self.zones[z["zoneId"]] = z
        for o in gs.get("gameObjects", []):
            self.objects[o["instanceId"]] = o
        for i in gs.get("diffDeletedInstanceIds", []):
            self.objects.pop(i, None)
        for p in gs.get("players", []):
            seat = p.get("systemSeatNumber")
            if seat is not None:
                self.players[seat] = {**self.players.get(seat, {}), **p}
        if gs.get("turnInfo"):
            info = gs["turnInfo"]
            if "phase" in info and "step" not in info:
                self.turn.pop("step", None)
            self.turn.update(info)
        if gs.get("gameInfo"):
            self.info.update(gs["gameInfo"])

        turn = self.turn.get("turnNumber", 0)
        active = self.turn.get("activePlayer")
        if turn >= 1 and active is not None:
            if self.on_play is None:
                self.on_play = active == self.seat
            if active == self.seat and turn not in self.my_turns:
                self.my_turns.append(turn)
            if self.opening_hand is None:
                self.opening_hand = [o.get("grpId") for o in self.cards_in(self.seat, "ZoneType_Hand")]
        if turn >= 1 and self.players:
            self.life[turn] = [self.life_of(self.seat), self.life_of(self.opponent)]

        for a in gs.get("annotations", []):
            types = a.get("type", [])
            if "AnnotationType_ObjectIdChanged" in types:
                orig, new = _detail(a, "orig_id"), _detail(a, "new_id")
                if orig is not None and new is not None:
                    self.alias[new] = orig
            elif "AnnotationType_ZoneTransfer" in types:
                self._zone_transfer(a, turn, active)

        self._note_opponent_cards()

        if self.info.get("stage") == "GameStage_GameOver" and self.result is None:
            self.result = self._result()

    def _zone_transfer(self, a: Dict, turn: int, active: Optional[int]):
        category = _detail(a, "category")
        for i in a.get("affectedIds", []):
            obj = self.objects.get(i)
            if not obj or obj.get("type") != "GameObjectType_Card":
                continue
            owner = obj.get("ownerSeatId")
            mine = owner == self.seat
            if category == "Draw" and mine:
                self.drawn.append(obj.get("grpId"))
            if category == "PlayLand" and mine:
                self.land_turns.add(turn)
            action = TIMELINE_ACTIONS.get(category)
            if action:
                self.events.append({"turn": turn, "mine": mine, "action": action, "grpId": obj.get("grpId")})

    def _note_opponent_cards(self):
        opp = self.opponent
        for z in self.zones.values():
            if z.get("type") not in PUBLIC_ZONES:
                continue
            for i in z.get("objectInstanceIds", []):
                obj = self.objects.get(i)
                if obj and obj.get("ownerSeatId") == opp and obj.get("type") == "GameObjectType_Card" and obj.get("grpId"):
                    self.opp_seen[self.canonical(i)] = obj["grpId"]

    def _result(self) -> str:
        my_team = self.players.get(self.seat, {}).get("teamId", self.seat)
        for r in self.info.get("results", []):
            if r.get("scope") == "MatchScope_Game":
                if r.get("result") == "ResultType_Draw":
                    return "draw"
                return "win" if r.get("winningTeamId") == my_team else "loss"
        return "loss"


class GameTracker:
    """Tails Player.log for game messages. Not thread-safe; drive it from one place."""

    def __init__(self, on_game_over: Callable[[Game], None] = lambda g: None):
        self.on_game_over = on_game_over
        self.path: Optional[str] = None
        self.offset = 0
        self.version = 0
        self.seat: Optional[int] = None
        self.event_id = ""
        self.match_id: Optional[str] = None
        self.deck: List[int] = []
        self.game: Optional[Game] = None
        self.timestamp: Optional[float] = None

    def poll(self, path: Optional[str]) -> bool:
        """Read new log lines; returns True if the game model changed."""
        if not path or not os.path.exists(path):
            return False
        size = os.path.getsize(path)
        if path != self.path or size < self.offset:
            self.__init__(self.on_game_over)
            self.path = path
        if size == self.offset:
            return False
        with open(path, "rb") as f:
            f.seek(self.offset)
            chunk = f.read()
        end = chunk.rfind(b"\n")
        if end < 0:
            return False
        self.offset += end + 1
        before = self.version
        for raw in chunk[: end + 1].split(b"\n"):
            if b"greToClientEvent" in raw or b"matchGameRoomStateChangedEvent" in raw:
                self.feed_line(raw.decode("utf-8", errors="replace"))
        return self.version != before

    def feed_line(self, line: str):
        start = line.find("{")
        if start < 0 or not any(m in line for m in MARKERS):
            return
        try:
            data = json.loads(line[start:])
        except ValueError:
            return
        if "matchGameRoomStateChangedEvent" in data:
            self._room(data["matchGameRoomStateChangedEvent"].get("gameRoomInfo", {}))
        elif "greToClientEvent" in data:
            try:
                self.timestamp = int(data.get("timestamp")) / 1000
            except (TypeError, ValueError):
                self.timestamp = None
            for msg in data["greToClientEvent"].get("greToClientMessages", []):
                self._gre(msg)

    def _room(self, info: Dict):
        config = info.get("gameRoomConfig", {})
        match_id = config.get("matchId") or (info.get("finalMatchResult") or {}).get("matchId")
        if match_id and match_id != self.match_id and info.get("stateType") == "MatchGameRoomStateType_Playing":
            # The deck arrives in ConnectResp, which can precede this event, so keep it.
            self.match_id = match_id
            self.game = None
            self.version += 1
        for p in config.get("reservedPlayers", []):
            if p.get("eventId"):
                self.event_id = p["eventId"]

    def _gre(self, msg: Dict):
        kind = msg.get("type")
        seats = msg.get("systemSeatIds") or []
        if seats:
            self.seat = seats[0]
        if kind == "GREMessageType_ConnectResp":
            self.deck = list((msg.get("connectResp", {}).get("deckMessage") or {}).get("deckCards", []))
        elif kind == "GREMessageType_SubmitDeckReq":
            deck = (msg.get("submitDeckReq", {}).get("deck") or {}).get("deckCards")
            if deck:
                self.deck = list(deck)
        elif kind in ("GREMessageType_GameStateMessage", "GREMessageType_QueuedGameStateMessage"):
            gs = msg.get("gameStateMessage") or {}
            info = gs.get("gameInfo") or {}
            match_id = info.get("matchID") or self.match_id
            number = info.get("gameNumber")
            if number and (not self.game or self.game.match_id != match_id or self.game.game_number != number):
                self.match_id = match_id
                self.game = Game(match_id, number, self.seat or 1, self.event_id, self.deck)
            if not self.game:
                return
            was_over = self.game.over
            self.game.apply(gs)
            self.game.updated_at = self.timestamp
            self.version += 1
            if self.game.over and not was_over:
                try:
                    self.on_game_over(self.game)
                except Exception as e:
                    logger.error(f"Recording game failed: {e}", exc_info=True)
