import json
import sqlite3

from bridge import game_view
from bridge.arena_cards import ArenaCards, read_database
from bridge.decks import TRACKED_API, DeckLibrary, is_limited_event
from bridge.game import GameTracker

from tests.bridge.test_game import gre, state

CARDS = {
    1: {"name": "Island", "types": ["Land"], "supertypes": ["Basic"], "subtypes": ["Island"], "colors": [], "cmc": 0, "rarity": "basic"},
    2: {"name": "Opt", "types": ["Instant"], "colors": ["U"], "cmc": 1, "mana_cost": "{U}", "rarity": "common"},
    3: {"name": "Brazen Borrower", "types": ["Creature"], "colors": ["U"], "cmc": 3, "mana_cost": "{1}{U}{U}", "rarity": "mythic",
        "keywords": ["Flash", "Flying"], "back_types": ["Instant"], "back_cmc": 2},
    4: {"name": "Sheoldred", "types": ["Creature"], "colors": ["B"], "cmc": 4, "mana_cost": "{2}{B}{B}", "rarity": "mythic"},
    5: {"name": "Swamp", "types": ["Land"], "supertypes": ["Basic"], "subtypes": ["Swamp"], "colors": [], "cmc": 0, "rarity": "basic"},
}


class FakeCards:
    loaded = True

    def get(self, grp):
        card = CARDS.get(int(grp)) if grp is not None else None
        return dict(card, image=[]) if card else None

    def lookup(self, name):
        for grp, c in CARDS.items():
            if c["name"].lower() == name.strip().lower():
                return dict(c, grpId=grp, image=[])
        return None

    def craft_rarity(self, name):
        return (self.lookup(name) or {}).get("rarity", "common")


def api_request(name, request):
    return "[UnityCrossThreadLogger]==> " + name + " " + json.dumps({"id": "x", "request": json.dumps(request)})


SUMMARY = {"DeckId": "d1", "Name": "Dimir Tempo", "Attributes": [{"name": "Format", "value": "Standard"}]}
DECK = {"MainDeck": [{"cardId": 1, "quantity": 20}, {"cardId": 2, "quantity": 4}, {"cardId": 3, "quantity": 3}, {"cardId": 4, "quantity": 2}], "Sideboard": []}


def feed(tracker, *lines):
    for line in lines:
        tracker.feed_raw(line.encode())


def test_read_database_builds_cards(tmp_path):
    db = tmp_path / "Raw_CardDatabase_test.mtga"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE Cards(GrpId INT, TitleId INT, TypeTextId INT, SubtypeTextId INT, Rarity INT, ExpansionCode TEXT,
            DigitalReleaseSet TEXT, CollectorNumber TEXT, IsToken INT, IsPrimaryCard INT, OldSchoolManaText TEXT,
            LinkedFaceType INT, LinkedFaceGrpIds TEXT, Colors TEXT, Power TEXT, Toughness TEXT, AbilityIds TEXT);
        CREATE TABLE Abilities(Id INT, TextId INT);
        CREATE TABLE Localizations_enUS(LocId INT, Formatted INT, Loc TEXT);
        INSERT INTO Cards VALUES (10, 100, 101, 102, 5, 'ELD', '', '39', 0, 1, 'o1oUoU', 8, '11', '2', '3', '1', '7:200,8:201');
        INSERT INTO Cards VALUES (11, 103, 104, 0, 5, 'ELD', '', '39', 0, 0, 'o1oU', 7, '10', '2', '', '', '9:202');
        INSERT INTO Localizations_enUS VALUES (100, 1, 'Brazen Borrower'), (101, 1, 'Creature'), (102, 1, 'Faerie Rogue'),
            (103, 1, 'Petty Theft'), (104, 1, 'Instant'), (200, 1, 'Flash'), (201, 1, 'Flying'),
            (202, 1, 'Return target nonland permanent an opponent controls to its owner''s hand. {oT}');
    """)
    conn.commit()
    conn.close()
    cards = read_database(str(db))
    front = cards["10"]
    assert front["name"] == "Brazen Borrower" and front["mana_cost"] == "{1}{U}{U}" and front["cmc"] == 3
    assert front["keywords"] == ["Flash", "Flying"] and front["subtypes"] == ["Faerie", "Rogue"]
    assert front["back_types"] == ["Instant"] and front["back_cmc"] == 2 and "{T}" in front["back_text"]
    lib = ArenaCards()
    lib._index(cards)
    assert lib.lookup("brazen borrower")["grpId"] == 10
    assert lib.lookup("Brazen Borrower // Petty Theft")["grpId"] == 10


def test_library_learns_decks_ownership_and_event(tmp_path):
    lib = DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json"))
    tracker = GameTracker(on_api=lib.handle, api_names=TRACKED_API)
    start_hook = {"InventoryInfo": {"WildCardCommons": 10, "WildCardUnCommons": 5, "WildCardRares": 1, "WildCardMythics": 0, "Gold": 100},
                  "DeckSummaries": [{"DeckIdInternal": "d1", "Name": "Dimir Tempo", "Attributes": []}, {"DeckIdInternal": "d2", "Name": "Empty", "Attributes": []}]}
    feed(tracker, "<== StartHook(abc)", json.dumps(start_hook), api_request("EventSetDeckV3", {"EventName": "Ladder", "Summary": SUMMARY, "Deck": DECK}))
    assert lib.wildcards == {"common": 10, "uncommon": 5, "rare": 1, "mythic": 0}
    deck = lib.decks["d1"]
    assert deck["name"] == "Dimir Tempo" and deck["format"] == "Standard" and sum(n for _, n in deck["main"]) == 29
    assert lib.event_decks == {"Ladder": "d1"}
    assert lib.owned == {"Opt": 4, "Brazen Borrower": 3, "Sheoldred": 2}
    assert lib.identify("Ladder", [2, 2, 2, 2, 3, 3, 3, 4, 4, 1])["id"] == "d1"
    lib.save()
    assert DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json")).event_decks == {"Ladder": "d1"}

    imported, unknown = lib.import_text("Deck\n4 Opt (XLN) 65\n4 Sheoldred\n4 Brazen Borrower\n16 Island\n\nSideboard\n1 Mystery Card\n", "Test")
    assert unknown == ["1 Mystery Card"]
    missing = lib.missing(imported)
    assert {r["name"]: r["missing"] for r in missing["cards"]} == {"Brazen Borrower": 1, "Sheoldred": 2}
    assert missing["wildcards"]["mythic"] == 3 and missing["affordable"] is False
    assert "4 Opt" in lib.export_text(imported) and "Island" in lib.export_text(imported)


def test_limited_events_are_skipped(tmp_path):
    lib = DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json"))
    lib.handle("request", "EventSetDeckV3", {"request": json.dumps({"EventName": "PremierDraft_FDN_20250101", "Summary": SUMMARY, "Deck": DECK})})
    assert not lib.decks and is_limited_event("QuickDraft_FDN") and not is_limited_event("Ladder")


def test_bo3_sideboard_and_match_result():
    matches = []
    tracker = GameTracker(on_match_over=lambda m, r, e, t: matches.append((m, r, e)))
    room = {"matchGameRoomStateChangedEvent": {"gameRoomInfo": {"stateType": "MatchGameRoomStateType_Playing", "gameRoomConfig": {
        "matchId": "m1", "reservedPlayers": [{"systemSeatId": 1, "playerName": "Me", "eventId": "Traditional_Ladder"},
                                             {"systemSeatId": 2, "playerName": "Rival", "eventId": "Traditional_Ladder"}]}}}}
    feed(tracker, json.dumps(room),
         gre({"type": "GREMessageType_ConnectResp", "connectResp": {"deckMessage": {"deckCards": [2, 2, 3], "sideboardCards": [4]}}}),
         gre(state("GameStateType_Full", gameInfo={"matchID": "m1", "gameNumber": 1}, players=[{"systemSeatNumber": 1}, {"systemSeatNumber": 2}])))
    assert tracker.game.opponent_name == "Rival" and tracker.game.sideboard == [4]
    feed(tracker, "[UnityCrossThreadLogger]10/13/2026: abc to Match: ClientToGremessage", "{",
         '  "payload": {"type": "ClientMessageType_SubmitDeckResp", "submitDeckResp": {"deck": {"deckCards": [2, 2, 4], "sideboardCards": [3]}}}', "}",
         gre(state("GameStateType_Full", gameInfo={"matchID": "m1", "gameNumber": 2})))
    game = tracker.game
    assert game.game_number == 2 and game.deck == [2, 2, 4] and game.first_deck == [2, 2, 3]
    resolve = game_view.make_resolver(None, FakeCards())
    assert game_view.sideboard_changes(game, resolve) == {"in": [{"name": "Sheoldred", "count": 1}], "out": [{"name": "Brazen Borrower", "count": 1}]}
    final = {"matchGameRoomStateChangedEvent": {"gameRoomInfo": {"stateType": "MatchGameRoomStateType_MatchCompleted", "finalMatchResult": {
        "matchId": "m1", "resultList": [{"scope": "MatchScope_Match", "result": "ResultType_WinLoss", "winningTeamId": 1}]}}}}
    feed(tracker, json.dumps(final), json.dumps(final))
    assert matches == [("m1", "win", "Traditional_Ladder")]


def test_mulligan_advice_and_constructed_tricks(monkeypatch):
    monkeypatch.setattr(game_view, "arena_cards", FakeCards())
    tracker = GameTracker()
    hand = [{"instanceId": i, "grpId": g, "type": "GameObjectType_Card", "ownerSeatId": 1, "zoneId": 31} for i, g in ((1, 2), (2, 3), (3, 4), (4, 4), (5, 3), (6, 2), (7, 2))]
    feed(tracker,
         gre({"type": "GREMessageType_ConnectResp", "connectResp": {"deckMessage": {"deckCards": [1] * 24 + [2] * 12 + [3] * 12 + [4] * 12}}}),
         gre(state("GameStateType_Full", gameInfo={"matchID": "m2", "gameNumber": 1}, turnInfo={"activePlayer": 1},
                   players=[{"systemSeatNumber": 1, "pendingMessageType": "ClientMessageType_MulliganResp"}, {"systemSeatNumber": 2}],
                   zones=[{"zoneId": 31, "type": "ZoneType_Hand", "ownerSeatId": 1, "objectInstanceIds": [1, 2, 3, 4, 5, 6, 7]}],
                   gameObjects=hand)))
    tracker.game.event_id = "Ladder"
    view = game_view.build_view(tracker, None, history=[])
    assert view["format"] == "constructed"
    mull = view["mulligan"]
    assert mull["verdict"] == "mulligan" and mull["lands"] == 0 and mull["onPlay"] is True

    # The opponent revealed Brazen Borrower; with two open Islands its adventure fits.
    tracker.game.deciding_mulligan = False
    tracker.game.opp_seen = {50: 3}  # instance id -> grpId
    tracker.game.objects.update({
        60: {"instanceId": 60, "grpId": 1, "type": "GameObjectType_Card", "ownerSeatId": 2, "controllerSeatId": 2, "cardTypes": ["CardType_Land"], "subtypes": ["SubType_Island"]},
        61: {"instanceId": 61, "grpId": 1, "type": "GameObjectType_Card", "ownerSeatId": 2, "controllerSeatId": 2, "cardTypes": ["CardType_Land"], "subtypes": ["SubType_Island"]},
    })
    tracker.game.zones[28] = {"zoneId": 28, "type": "ZoneType_Battlefield", "objectInstanceIds": [60, 61]}
    view = game_view.build_view(tracker, None, history=[])
    assert [(c["name"], c["source"]) for c in view["tricks"]] == [("Brazen Borrower", "revealed")]
    assert view["mulligan"] is None


def test_similar_opponents_predicts_cards(monkeypatch):
    monkeypatch.setattr(game_view, "_is_land_name", lambda n: n in ("Island", "Swamp"))
    history = [
        {"matchId": "a", "result": "win", "format": "constructed", "opponent": {"archetypeName": "Dimir Tempo", "cards": [
            {"name": "Opt", "count": 2}, {"name": "Brazen Borrower", "count": 1}, {"name": "Sheoldred", "count": 1}, {"name": "Island", "count": 3}]}},
        {"matchId": "b", "result": "loss", "format": "constructed", "opponent": {"archetypeName": "Mono-Red Aggro", "cards": [{"name": "Shock", "count": 4}]}},
    ]
    similar = game_view.similar_opponents(["Opt", "Brazen Borrower", "Island"], history)
    assert similar["games"] == 1 and similar["wins"] == 1 and similar["archetype"] == "Dimir Tempo"
    assert similar["cards"] == [{"name": "Sheoldred", "games": 1}]


def test_simulator_uses_full_constructed_deck():
    from src.card_logic import simulate_deck

    deck = [
        {"name": "Island", "types": ["Land"], "colors": [], "count": 24, "oracle_text": "{T}: Add {U}."},
        {"name": "Opt", "types": ["Instant"], "colors": ["U"], "cmc": 1, "mana_cost": "{U}", "count": 36},
    ]
    stats = simulate_deck(deck, iterations=2000)
    assert stats and 0 <= stats["mulligans"] <= 100 and stats["screw_t3"] < 60
