import time
from types import SimpleNamespace

from bridge import meta
from bridge.decks import pick_guide

FORMAT_PAGE = """
<div class=meta_arch align=center style="margin:10px;">AGGRO 55%</div>
  <div style="display:inline-block;width:48%;" class=hover_tr><div style="display:flex;">
    <div align=center style="width:100%;">
      <div class=S14><a href=archetype?a=770&meta=50&f=ST>Dimir Aggro</a></div>
      <div><div style="display:inline-block;width:48%;" class=S14>11 %</div></div>
  </div></div>
<div class=meta_arch align=center style="margin:10px;">CONTROL 30%</div>
  <div style="display:inline-block;width:48%;" class=hover_tr><div style="display:flex;">
    <div align=center style="width:100%;">
      <div class=S14><a href=archetype?a=12&meta=50&f=ST>UW Control</a></div>
      <div><div style="display:inline-block;width:48%;" class=S14>13 %</div></div>
  </div></div>
"""

ARCHETYPE_PAGE = """
<tr class=hover_tr>
  <td><input type=checkbox name=deck_check[1] value=1 checked><input type=hidden name=deck_ref[1] value=899173></td>
  <td><a href=/event?e=92057&d=899173&f=ST>Dimir Aggro</a></td>
  <td><a class=player href=/search?player=Oss-28>Oss-28</a></td>
  <td><a href=/event?e=92057&f=ST>MTGO League</a></td>
  <td class=O16><img src=/graph/star.png></td>
  <td>1</td>
  <td>11/10/26</td>
</tr>
"""

LANDS = {"Island", "Swamp", "Plains", "Watery Grave"}


def _deck(cards, lands=("Island", 24), **extra):
    return {"id": extra.pop("id", "x"), "source": extra.pop("source", "spicerack"),
            "main": [{"name": n, "count": c} for n, c in cards] + [{"name": lands[0], "count": lands[1]}], "side": [], **extra}


def test_parse_mtgtop8_pages_and_lists():
    archs = meta.parse_mtgtop8_format(FORMAT_PAGE)
    assert [(a["id"], a["name"], a["share"], a["style"]) for a in archs] == [("770", "Dimir Aggro", 0.11, "Aggro"), ("12", "UW Control", 0.13, "Control")]
    rows = meta.parse_mtgtop8_archetype(ARCHETYPE_PAGE)
    assert rows == [{"event": "92057", "id": "899173", "name": "Dimir Aggro", "player": "Oss-28", "eventName": "MTGO League", "rank": "1", "date": "2026-10-11"}]
    main, side = meta.parse_list("4 Opt\n2 Kaito (DSK) 12\n\nSideboard\n3 Duress\nSB: 1 Negate")
    assert main == [{"name": "Opt", "count": 4}, {"name": "Kaito", "count": 2}]
    assert side == [{"name": "Duress", "count": 3}, {"name": "Negate", "count": 1}]


def test_format_of_maps_decks_and_events():
    assert meta.format_of("TraditionalStandard") == "Standard"
    assert meta.format_of("Explorer") == "Explorer"
    assert meta.format_of("HistoricBrawl") is None
    assert meta.format_of("", "Historic_Ladder") == "Historic"
    assert meta.format_of("", "Ladder") == "Standard"
    assert meta.format_of("", "QuickDraft_FDN") is None


def test_archetypes_classify_and_compare(tmp_path, monkeypatch):
    monkeypatch.setattr(meta, "is_land", lambda n: n in LANDS)
    dimir = [("Kaito", 4), ("Dream Beavers", 4), ("Spyglass Siren", 4), ("Bitter Triumph", 2)]
    control = [("Day of Judgment", 4), ("Stock Up", 4), ("No More Lies", 3), ("Get Lost", 3)]
    top8 = [
        {"id": "770", "name": "Dimir Aggro", "share": 0.11, "style": "Aggro", "decks": [_deck(dimir, id="m1", source="mtgtop8"), _deck(dimir[:3], id="m2", source="mtgtop8")]},
        {"id": "12", "name": "UW Control", "share": 0.13, "style": "Control", "decks": [_deck(control, id="m3", source="mtgtop8")]},
    ]
    # One Spicerack list joins Dimir; two near-identical others form their own cluster.
    stompy = [("Llanowar Elves", 4), ("Mossborn Hydra", 4), ("Icetill Explorer", 4)]
    spice = [_deck(dimir, id="s1", wins=4, losses=1), _deck(stompy, id="s2"), _deck(stompy, id="s3")]
    archs = meta.build_archetypes(top8, spice)
    by_name = {a["name"]: a for a in archs}
    assert by_name["Dimir Aggro"]["deckCount"] == 3 and by_name["Dimir Aggro"]["tournamentDecks"] == 1
    assert by_name["Dimir Aggro"]["winRate"] == 0.8
    extra = [a for a in archs if a["source"] == "spicerack"]
    # Lists mtgtop8 doesn't know split the share its archetypes leave over.
    assert len(extra) == 1 and extra[0]["deckCount"] == 2 and abs(extra[0]["share"] - 0.76) < 1e-9

    store = meta.MetaStore(str(tmp_path))
    store.settings = lambda: SimpleNamespace(meta_enabled=True, meta_mtgtop8=True, meta_spicerack_key="")
    store.save("Standard", {"format": "Standard", "fetchedAt": 0, "archetypes": archs})
    hit = store.classify("Standard", {"Kaito": 1, "Dream Beavers": 2, "Spyglass Siren": 1, "Island": 3})
    assert hit["name"] == "Dimir Aggro" and hit["matched"] == ["Dream Beavers", "Kaito", "Spyglass Siren"]
    assert store.classify("Standard", {"Kaito": 1, "Dream Beavers": 2, "Island": 3}) is None
    assert store.classify("Standard", {"Kaito": 1, "Dream Beavers": 1, "Shock": 1, "Lightning Strike": 1, "Play with Fire": 1}) is None

    mine = {"Kaito": 4, "Dream Beavers": 2, "Spyglass Siren": 4, "Shock": 4, "Island": 24}
    res = store.compare("Standard", mine)
    assert res["archetype"]["name"] == "Dimir Aggro"
    assert {m["name"]: m["typical"] for m in res["missing"]}["Dream Beavers"] == 4
    assert [e["name"] for e in res["extra"]] == ["Shock"]
    assert {"name": "Shock", "count": 4} in res["nearest"]["cut"]

    store.settings = lambda: SimpleNamespace(meta_enabled=False)
    assert store.classify("Standard", {"Kaito": 1, "Dream Beavers": 2, "Spyglass Siren": 1}) is None


def test_refresh_keeps_old_data_when_sources_fail(tmp_path, monkeypatch):
    store = meta.MetaStore(str(tmp_path))
    store.settings = lambda: SimpleNamespace(meta_enabled=True, meta_mtgtop8=False, meta_spicerack_key="")
    store.save("Standard", {"format": "Standard", "fetchedAt": 1, "archetypes": [{"name": "Old"}]})

    def boom(*a, **k):
        raise meta.requests.ConnectTimeout("nope")
    monkeypatch.setattr(meta, "fetch_spicerack", boom)
    data = store.refresh("Standard", fetch=object())
    assert data["archetypes"] == [{"name": "Old"}] and data["sources"]["spicerack"] == {"ok": False, "error": "timed out"}
    assert not store.due("Standard")


def test_partial_failure_reuses_the_failed_sources_last_lists(tmp_path, monkeypatch):
    monkeypatch.setattr(meta, "is_land", lambda n: n in LANDS)
    store = meta.MetaStore(str(tmp_path))
    store.settings = lambda: SimpleNamespace(meta_enabled=True, meta_mtgtop8=True, meta_spicerack_key="")
    dimir = [("Kaito", 4), ("Dream Beavers", 4), ("Spyglass Siren", 4)]
    stompy = [("Llanowar Elves", 4), ("Mossborn Hydra", 4), ("Icetill Explorer", 4)]
    top8 = [{"id": "770", "name": "Dimir Aggro", "share": 0.2, "style": "Aggro", "decks": [_deck(dimir, id="m1", source="mtgtop8")]}]
    monkeypatch.setattr(meta, "fetch_mtgtop8", lambda *a, **k: top8)
    monkeypatch.setattr(meta, "fetch_spicerack", lambda *a, **k: [_deck(stompy, id="s1"), _deck(stompy, id="s2")])
    first = store.refresh("Standard", fetch=object())
    assert {a["name"] for a in first["archetypes"]} >= {"Dimir Aggro"} and len(first["archetypes"]) == 2

    def boom(*a, **k):
        raise meta.requests.ConnectTimeout("nope")
    monkeypatch.setattr(meta, "fetch_spicerack", boom)
    second = store.refresh("Standard", fetch=object())
    assert len(second["archetypes"]) == 2, "Spicerack's previous lists stand in while it's down"
    assert second["sources"]["spicerack"]["stale"] and second["lastError"]


def test_refresh_runs_once_per_format(tmp_path, monkeypatch):
    import threading
    store = meta.MetaStore(str(tmp_path))
    store.settings = lambda: SimpleNamespace(meta_enabled=True, meta_mtgtop8=False, meta_spicerack_key="")
    calls, gate = [], threading.Event()

    def slow(*a, **k):
        calls.append(1)
        gate.wait(5)
        return [_deck([("Opt", 40)], id="s1")]
    monkeypatch.setattr(meta, "fetch_spicerack", slow)
    results = []
    threads = [threading.Thread(target=lambda: results.append(store.refresh("Standard", fetch=object()))) for _ in range(2)]
    threads[0].start()
    while not calls:
        time.sleep(0.01)
    threads[1].start()
    time.sleep(0.2)
    gate.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1 and len(results) == 2


def test_pick_guide_tries_meta_name_then_local_label():
    guides = {"Rakdos": {"in": []}, "Dimir Aggro": {"in": []}, "Aggro": {"in": []}}
    assert pick_guide(guides, "Dimir Aggro", "Dimir Midrange")[0] == "Dimir Aggro"
    assert pick_guide(guides, "Reanimator", "Rakdos Midrange")[0] == "Rakdos"
    assert pick_guide(guides, "Boros Aggro")[0] == "Aggro"
