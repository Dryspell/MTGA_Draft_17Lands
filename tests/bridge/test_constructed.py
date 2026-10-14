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
    monkeypatch.setattr(game_view, "arena_cards", FakeCards())
    history = [
        {"matchId": "a", "result": "win", "format": "constructed", "opponent": {"archetypeName": "Dimir Tempo", "cards": [
            {"name": "Opt", "count": 2}, {"name": "Brazen Borrower", "count": 1}, {"name": "Sheoldred", "count": 1}, {"name": "Island", "count": 3}]}},
        {"matchId": "b", "result": "loss", "format": "constructed", "opponent": {"archetypeName": "Mono-Red Aggro", "cards": [{"name": "Shock", "count": 4}]}},
    ]
    similar = game_view.similar_opponents(["Opt", "Brazen Borrower", "Island"], history)
    assert similar["games"] == 1 and similar["wins"] == 1 and similar["archetype"] == "Dimir Tempo" and similar["basis"] == "cards"
    assert [(c["name"], c["games"], c["cmc"]) for c in similar["cards"]] == [("Sheoldred", 1, 4)]
    assert game_view.opponents_by_colors(["R"], [], history) is None
    history[1]["opponent"]["colors"] = ["R"]
    by_colors = game_view.opponents_by_colors(["R"], [], history)
    assert by_colors["basis"] == "colors" and by_colors["losses"] == 1 and [c["name"] for c in by_colors["cards"]] == ["Shock"]


def _upsert(lib, last_updated, main, name):
    summary = {"DeckId": "d1", "Name": "Dimir Tempo", "Attributes": [{"name": "LastUpdated", "value": json.dumps(last_updated)}]}
    lib.handle("request", name, {"request": json.dumps({"Summary": summary, "Deck": {"MainDeck": main}, "EventName": "Ladder"})})


def test_deck_versions_ignore_stale_event_copies(tmp_path):
    lib = DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json"))
    a = [{"cardId": 1, "quantity": 20}, {"cardId": 2, "quantity": 4}]
    b = [{"cardId": 1, "quantity": 20}, {"cardId": 2, "quantity": 3}, {"cardId": 4, "quantity": 1}]
    c = [{"cardId": 1, "quantity": 24}]
    _upsert(lib, "2026-10-13T13:00:00-05:00", a, "DeckUpsertDeckV3")
    _upsert(lib, "2026-10-13T14:00:00-05:00", b, "DeckUpsertDeckV3")
    # The event still holds the list it was joined with.
    lib.handle("response", "EventGetCoursesV2", {"Courses": [{"InternalEventName": "Ladder", "CourseDeck": {"MainDeck": a},
               "CourseDeckSummary": {"DeckId": "d1", "Attributes": [{"name": "LastUpdated", "value": "2026-10-13T13:00:00-05:00"}]}}]})
    deck = lib.decks["d1"]
    assert {g: n for g, n in deck["main"]} == {1: 20, 2: 3, 4: 1}
    assert [v["at"][11:16] for v in deck["versions"]] == ["13:00", "14:00"]
    # A replayed older log adds history before, never replacing the current list.
    _upsert(lib, "2026-10-13T12:00:00-05:00", c, "DeckUpsertDeckV3")
    assert [v["at"][11:16] for v in deck["versions"]] == ["12:00", "13:00", "14:00"]
    assert {g: n for g, n in deck["main"]} == {1: 20, 2: 3, 4: 1}
    _upsert(lib, "2026-10-13T14:00:00-05:00", b, "EventSetDeckV3")
    assert len(deck["versions"]) == 3


def test_bo3_game_result_reads_the_latest_game():
    tracker = GameTracker()
    lost_g1 = {"scope": "MatchScope_Game", "result": "ResultType_WinLoss", "winningTeamId": 2}
    info = {"matchID": "m1", "gameNumber": 2, "stage": "GameStage_Play"}
    feed(tracker, gre(state("GameStateType_Full", gameInfo=info, players=[{"systemSeatNumber": 1, "teamId": 1}, {"systemSeatNumber": 2, "teamId": 2}])))
    feed(tracker, gre(state(gameInfo={**info, "stage": "GameStage_GameOver", "results": [
        lost_g1, {"scope": "MatchScope_Game", "result": "ResultType_WinLoss", "winningTeamId": 1}]})))
    assert tracker.game.result == "win"


def test_old_courses_dont_revive_deleted_decks(tmp_path):
    lib = DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json"))
    lib.handle("response", "EventGetCoursesV2", {"Courses": [{"InternalEventName": "Ladder", "CourseDeck": DECK, "CourseDeckSummary": SUMMARY}]})
    assert "d1" not in lib.decks
    _upsert(lib, "2026-10-13T13:00:00-05:00", DECK["MainDeck"], "DeckUpsertDeckV3")
    lib.decks["d1"]["deleted"] = True
    lib.handle("response", "EventGetCoursesV2", {"Courses": [{"InternalEventName": "Ladder", "CourseDeck": DECK, "CourseDeckSummary": SUMMARY}]})
    assert lib.decks["d1"]["deleted"] is True


def test_corrupt_deck_file_is_kept_not_overwritten(tmp_path):
    path = tmp_path / "decks.json"
    path.write_text('{"decks": {"d1": ', encoding="utf-8")
    lib = DeckLibrary(FakeCards(), path=str(path))
    assert not lib.decks and not lib.readonly
    assert [p.name for p in tmp_path.iterdir() if ".corrupt-" in p.name], "the broken file is copied aside first"
    _upsert(lib, "2026-10-13T13:00:00-05:00", DECK["MainDeck"], "DeckUpsertDeckV3")
    revision = lib.revision
    lib.save()
    assert lib.revision == revision + 1 and "d1" in json.loads(path.read_text(encoding="utf-8"))["decks"]


def test_lookup_handles_split_rooms_and_accents():
    lib = ArenaCards()
    lib._index({
        "1": {"name": "Unholy Annex // Ritual Chamber", "linked": ["2", "3"]},
        "2": {"name": "Unholy Annex", "linked": ["1"]},
        "3": {"name": "Ritual Chamber", "linked": ["1"]},
        "4": {"name": "Commit /// Memory"},
        "5": {"name": "Kíli the Resourceful"},
    })
    assert lib.lookup("Unholy Annex/Ritual Chamber")["grpId"] == 1
    assert lib.lookup("Unholy Annex")["grpId"] == 1
    assert lib.lookup("Commit // Memory")["grpId"] == 4
    assert lib.lookup("Kili the Resourceful")["grpId"] == 5


def test_renaming_a_plan_replaces_it(tmp_path):
    lib = DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json"))
    _upsert(lib, "2026-10-13T13:00:00-05:00", DECK["MainDeck"], "DeckUpsertDeckV3")
    lib.set_guide("d1", "Aggro", [], [], "old")
    lib.set_guide("d1", "Mono-Red Aggro", [], [], "renamed", previous="Aggro")
    lib.set_guide("d1", "mono-red aggro", [], [], "recased")
    assert {k: g["note"] for k, g in lib.decks["d1"]["guides"].items()} == {"mono-red aggro": "recased"}


def test_pick_guide_prefers_specific_plans():
    from bridge.decks import pick_guide
    guides = {"Aggro": {"in": []}, "Rakdos": {"in": []}, "Any opponent": {"in": []}}
    assert pick_guide(guides, "Rakdos Aggro")[0] == "Rakdos"
    assert pick_guide(guides, "Mono-Red Aggro")[0] == "Aggro"
    assert pick_guide(guides, "Azorius Control")[0] == "Any opponent"
    assert pick_guide({"Azorius Control": {}}, "azorius control")[0] == "Azorius Control"
    assert pick_guide({}, "Rakdos Aggro") is None


def test_sideboarding_step_shows_the_guide(tmp_path, monkeypatch):
    monkeypatch.setattr(game_view, "arena_cards", FakeCards())
    lib = DeckLibrary(FakeCards(), path=str(tmp_path / "decks.json"))
    _upsert(lib, "2026-10-13T13:00:00-05:00", DECK["MainDeck"], "DeckUpsertDeckV3")
    lib.set_guide("d1", "Any opponent", [{"name": "Sheoldred", "count": 1}], [{"name": "Opt", "count": 1}], "Bring in the big threat")
    tracker = GameTracker(on_new_game=lambda g: setattr(g, "deck_id", "d1"))
    room = {"matchGameRoomStateChangedEvent": {"gameRoomInfo": {"stateType": "MatchGameRoomStateType_Playing", "gameRoomConfig": {
        "matchId": "m1", "reservedPlayers": [{"systemSeatId": 1, "playerName": "Me", "eventId": "Traditional_Ladder"}]}}}}
    info = {"matchID": "m1", "gameNumber": 1, "stage": "GameStage_Play"}
    feed(tracker, json.dumps(room),
         gre({"type": "GREMessageType_ConnectResp", "connectResp": {"deckMessage": {"deckCards": [1, 2, 3], "sideboardCards": [4]}}}),
         gre(state("GameStateType_Full", gameInfo=info, players=[{"systemSeatNumber": 1}, {"systemSeatNumber": 2}])))
    assert tracker.sideboarding is None
    feed(tracker,
         gre(state(gameInfo={**info, "stage": "GameStage_GameOver", "results": [{"scope": "MatchScope_Game", "result": "ResultType_WinLoss", "winningTeamId": 2}]})),
         gre({"type": "GREMessageType_SubmitDeckReq", "submitDeckReq": {"deck": {"deckCards": [1, 2, 3], "sideboardCards": [4]}}}))
    assert tracker.sideboarding == "m1"
    view = game_view.build_view(tracker, None, history=[], library=lib)
    assert view["match"]["sideboarding"] is True and view["active"] is False
    assert view["match"]["guide"]["key"] == "Any opponent" and view["match"]["guide"]["note"] == "Bring in the big threat"
    feed(tracker, gre(state("GameStateType_Full", gameInfo={**info, "gameNumber": 2})))
    assert tracker.sideboarding is None
    view = game_view.build_view(tracker, None, history=[], library=lib)
    assert view["match"]["sideboarding"] is False and view["match"]["guide"]["key"] == "Any opponent"


def test_outs_by_role():
    cards = [{"name": "Island", "count": 10, "types": ["Land"]}, {"name": "Opt", "count": 4, "types": ["Instant"], "tags": ["card_advantage"]},
             {"name": "Sheoldred", "count": 6, "types": ["Creature"], "tags": []}]
    odds = {o["key"]: o for o in game_view.outs(cards, 20)}
    assert odds["land"]["copies"] == 10 and abs(odds["land"]["odds"][0] - 0.5) < 1e-9
    assert odds["draw"]["odds"][0] < odds["draw"]["odds"][1] < odds["draw"]["odds"][2] and "removal" not in odds


def test_simulator_uses_full_constructed_deck():
    from src.card_logic import simulate_deck

    deck = [
        {"name": "Island", "types": ["Land"], "colors": [], "count": 24, "oracle_text": "{T}: Add {U}."},
        {"name": "Opt", "types": ["Instant"], "colors": ["U"], "cmc": 1, "mana_cost": "{U}", "count": 36},
    ]
    stats = simulate_deck(deck, iterations=2000)
    assert stats and 0 <= stats["mulligans"] <= 100 and stats["screw_t3"] < 60
