import json

from bridge import game_view
from bridge.game import GameTracker

CARDS = {
    1: {"name": "Forest", "types": ["Land", "Basic"], "colors": ["G"], "cmc": 0},
    2: {"name": "Bear", "types": ["Creature"], "colors": ["G"], "cmc": 2},
    3: {"name": "Giant Growth", "types": ["Instant"], "colors": ["G"], "cmc": 1, "tags": ["combat_trick"]},
    50: {"name": "Shock", "types": ["Instant"], "colors": ["R"], "cmc": 1, "tags": ["removal"],
         "deck_colors": {"All Decks": {"gih": 900}}},
    51: {"name": "Goblin", "types": ["Creature"], "colors": ["R"], "cmc": 1},
    52: {"name": "Fireball", "types": ["Sorcery"], "colors": ["R"], "cmc": 1},
    53: {"name": "Lava Dart", "types": ["Instant"], "colors": ["R"], "cmc": 1, "deck_colors": {"All Decks": {"gih": 100}}},
    54: {"name": "Mountain", "types": ["Land", "Basic"], "colors": ["R"], "cmc": 0},
}


class FakeSet:
    def get_data_by_id(self, ids):
        return [CARDS[int(i)] for i in ids if int(i) in CARDS]

    def get_card_ratings(self):
        return {str(k): v for k, v in CARDS.items()}


def gre(*messages, seat=1):
    for m in messages:
        m.setdefault("systemSeatIds", [seat])
    return "[UnityCrossThreadLogger]" + json.dumps({"greToClientEvent": {"greToClientMessages": list(messages)}})


def card(iid, grp, owner, zone, **extra):
    types = ["CardType_Land"] if CARDS[grp]["types"][0] == "Land" else []
    subtypes = ["SubType_Mountain"] if grp == 54 else ["SubType_Forest"] if grp == 1 else []
    return {"instanceId": iid, "grpId": grp, "type": "GameObjectType_Card", "ownerSeatId": owner,
            "controllerSeatId": owner, "zoneId": zone, "cardTypes": types, "subtypes": subtypes, **extra}


def state(kind="GameStateType_Diff", **fields):
    return {"type": "GREMessageType_GameStateMessage", "gameStateMessage": {"type": kind, **fields}}


INFO = {"matchID": "m1", "gameNumber": 1, "stage": "GameStage_Play"}
PLAYERS = [{"systemSeatNumber": 1, "teamId": 1, "lifeTotal": 20}, {"systemSeatNumber": 2, "teamId": 2, "lifeTotal": 20}]


def zones(hand, library, battlefield, graveyard=()):
    return [
        {"zoneId": 31, "type": "ZoneType_Hand", "ownerSeatId": 1, "objectInstanceIds": list(hand)},
        {"zoneId": 32, "type": "ZoneType_Library", "ownerSeatId": 1, "objectInstanceIds": list(library)},
        {"zoneId": 35, "type": "ZoneType_Hand", "ownerSeatId": 2, "objectInstanceIds": [90, 91, 92]},
        {"zoneId": 36, "type": "ZoneType_Library", "ownerSeatId": 2, "objectInstanceIds": [93, 94]},
        {"zoneId": 28, "type": "ZoneType_Battlefield", "objectInstanceIds": list(battlefield)},
        {"zoneId": 33, "type": "ZoneType_Graveyard", "ownerSeatId": 2, "objectInstanceIds": list(graveyard)},
    ]


def play_game(tracker):
    deck = [1, 1, 1, 2, 2, 3]
    lines = [
        gre({"type": "GREMessageType_ConnectResp", "connectResp": {"deckMessage": {"deckCards": deck}}}),
        gre(state(
            "GameStateType_Full", gameInfo=INFO, players=PLAYERS,
            turnInfo={"turnNumber": 1, "activePlayer": 1, "phase": "Phase_Main1"},
            zones=zones(hand=[10, 11], library=[12, 13, 14, 15], battlefield=[20, 21, 22]),
            gameObjects=[card(10, 2, 1, 31), card(11, 1, 1, 31), card(20, 1, 1, 28), card(21, 54, 2, 28), card(22, 51, 2, 28, power={"value": 1})],
            annotations=[{"type": ["AnnotationType_ZoneTransfer"], "affectedIds": [20], "details": [{"key": "category", "valueString": ["PlayLand"]}]}],
        )),
        # Opponent's Goblin dies and changes id on its way to the graveyard.
        gre(state(
            turnInfo={"turnNumber": 2, "activePlayer": 2},
            players=[{"systemSeatNumber": 1, "lifeTotal": 17}],
            zones=zones(hand=[10, 11], library=[12, 13, 14, 15], battlefield=[20, 21], graveyard=[23]),
            gameObjects=[card(23, 51, 2, 33)],
            diffDeletedInstanceIds=[22],
            annotations=[
                {"type": ["AnnotationType_ObjectIdChanged"], "details": [{"key": "orig_id", "valueInt32": [22]}, {"key": "new_id", "valueInt32": [23]}]},
                {"type": ["AnnotationType_ZoneTransfer"], "affectedIds": [23], "details": [{"key": "category", "valueString": ["SBA_Damage"]}]},
            ],
        )),
    ]
    for line in lines:
        tracker.feed_line(line)


def test_tracks_library_board_and_opponent():
    tracker = GameTracker()
    play_game(tracker)
    game = tracker.game
    assert game.on_play is True
    # Two copies of Forest and one Bear are out of the library (hand + battlefield).
    assert dict(game.library_remaining()) == {1: 1, 2: 1, 3: 1}
    # The Goblin was seen once even though its instance id changed.
    assert sorted(game.opp_seen.values()) == [51, 54]

    view = game_view.build_view(tracker, FakeSet())
    assert view["active"] and view["turn"] == 2 and not view["myTurn"]
    assert view["me"]["life"] == 17 and view["me"]["lands"]["total"] == 1
    assert view["opponent"]["lands"] == {"untapped": 1, "total": 1, "colors": ["R"]}
    assert view["opponent"]["colors"] == ["R"]
    assert view["library"]["size"] == 4 and abs(view["library"]["landNext"] - 0.25) < 1e-9
    # Instants in red at one mana, most played first; sorceries excluded.
    assert [c["name"] for c in view["tricks"]] == ["Shock", "Lava Dart"]
    assert view["tricks"][0]["trickKind"] == "removal"


def test_game_over_records_review(tmp_path):
    records = []
    tracker = GameTracker(lambda g: records.append(game_view.build_record(g, FakeSet())))
    play_game(tracker)
    tracker.feed_line(gre(state(gameInfo={**INFO, "stage": "GameStage_GameOver", "results": [
        {"scope": "MatchScope_Game", "result": "ResultType_WinLoss", "winningTeamId": 1}]})))
    assert len(records) == 1
    record = records[0]
    assert record["result"] == "win" and record["onPlay"] is True and record["turns"] == 2
    assert {"turn": 1, "mine": True, "action": "played", "name": "Forest"} in record["timeline"]
    assert {"turn": 2, "mine": False, "action": "died", "name": "Goblin"} in record["timeline"]
    assert record["life"][-1] == [2, 17, 20]

    path = str(tmp_path / "history.json")
    game_view.append_history(record, path)
    game_view.append_history(record, path)
    assert len(game_view.load_history(path)) == 1


def test_poll_follows_file_and_rotation(tmp_path):
    log = tmp_path / "Player.log"
    log.write_text("", encoding="utf-8")
    tracker = GameTracker()
    lines = []
    play_game(type("Collector", (), {"feed_line": lambda self, line: lines.append(line)})())
    log.write_text(lines[0] + "\n" + lines[1] + "\n" + lines[2][:40], encoding="utf-8")
    assert tracker.poll(str(log)) and tracker.game.turn["turnNumber"] == 1
    with open(log, "a", encoding="utf-8") as f:
        f.write(lines[2][40:] + "\n")
    assert tracker.poll(str(log)) and tracker.game.turn["turnNumber"] == 2
    log.write_text("", encoding="utf-8")
    tracker.poll(str(log))
    assert tracker.game is None


def test_match_build_picks_closest_variant():
    deck = [{"name": "Bear", "count": 10}, {"name": "Giant Growth", "count": 13}, {"name": "Forest", "count": 17}]
    variants = {
        "Green": {"Bear": 10, "Giant Growth": 12, "Forest": 17},
        "Other": {"Bear": 2, "Shock": 21},
    }
    assert game_view.match_build(deck, variants) == "Green"
    assert game_view.match_build(deck, {"Other": variants["Other"]}) is None
