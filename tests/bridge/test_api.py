"""
tests/bridge/test_api.py
Bridge HTTP API against a synthetic OTJ draft, without booting the network-bound loader.
"""

import asyncio
import json
import os
import shutil
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge import jobs, routes_data, routes_decks, routes_draft, server
from bridge.snapshot import build_snapshot
from bridge.state import state
from src.configuration import Configuration
from src.limited_sets import SetDictionary, SetInfo
from src.log_scanner import ArenaScanner
from src.ui.orchestrator import DraftOrchestrator

OTJ_SNAPSHOT = os.path.join(os.getcwd(), "tests", "data", "OTJ_PremierDraft_Data_2024_5_3.json")
DATASET = "OTJ_PremierDraft_All_Data.json"
PACK = "90734,90584,90631,90362,90440,90349,90486,90527,90406,90439,90488,90480,90388,90459"
EVENT_JOIN = (
    '[UnityCrossThreadLogger]==> Event_Join {"id":"1","request":"{\\"EventName\\":\\"PremierDraft_OTJ_20240416\\"}"}\n'
)
P1P1 = (
    '[UnityCrossThreadLogger]Draft.Notify {"draftId":"test-draft","SelfPick":1,"SelfPack":1,'
    f'"PackCards":"{PACK}"}}\n'
)


def _otj_spells(count):
    with open(OTJ_SNAPSHOT, encoding="utf-8") as f:
        ratings = json.load(f)["card_ratings"]
    names = sorted({c["name"] for c in ratings.values() if "Land" not in c.get("types", []) and c.get("colors") == ["R"]})
    return names[:count]


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    sets = tmp_path / "Sets"
    sets.mkdir()
    for folder in ("Logs", "Temp"):
        (tmp_path / folder).mkdir()
    monkeypatch.setattr("src.constants.SETS_FOLDER", str(sets))
    monkeypatch.setattr("src.constants.DRAFT_LOG_FOLDER", str(tmp_path / "Logs"))
    monkeypatch.setattr("src.constants.TEMP_FOLDER", str(tmp_path / "Temp"))

    dataset = sets / DATASET
    shutil.copy(OTJ_SNAPSHOT, dataset)
    local_sets = (
        [("OTJ", "PremierDraft", "All", "2024-04-16", "2024-05-03", 500, str(dataset), "2024-05-03 12:00:00")],
        [],
    )
    for target in (
        "src.log_scanner.retrieve_local_set_list",
        "src.utils.retrieve_local_set_list",
        "bridge.snapshot.retrieve_local_set_list",
        "bridge.routes_data.retrieve_local_set_list",
        "bridge.routes_decks.retrieve_local_set_list",
    ):
        monkeypatch.setattr(target, lambda *a, **k: local_sets)
    # write_configuration binds the real config path as a default argument,
    # so stub it wherever it was imported to keep the user's config untouched.
    for module in ("bridge.routes_draft", "bridge.routes_data", "bridge.routes_decks", "src.ui.orchestrator"):
        monkeypatch.setattr(f"{module}.write_configuration", lambda *a, **k: True, raising=False)

    log = tmp_path / "Player.log"
    log.write_text("MTGA Log Start\n")
    config = Configuration()
    config.settings.arena_log_location = str(log)
    config.card_data.latest_dataset = DATASET

    mock_sets = SetDictionary(data={"Outlaws": SetInfo(arena=["OTJ"], seventeenlands=["OTJ"], set_code="OTJ")})
    scanner = ArenaScanner(str(log), mock_sets, sets_location=str(sets))
    scanner.file_size = 0
    orchestrator = DraftOrchestrator(scanner, config, None)

    monkeypatch.setattr(state, "config", config)
    monkeypatch.setattr(state, "scanner", scanner)
    monkeypatch.setattr(state, "orchestrator", orchestrator)
    monkeypatch.setattr(state, "loop", None)
    monkeypatch.setattr(state, "status", "Ready")
    monkeypatch.setattr(state, "snapshot", None)
    monkeypatch.setattr(state, "sealed_sessions", {})

    with open(log, "a", encoding="utf-8") as f:
        f.write(EVENT_JOIN)
        f.write(P1P1)
    orchestrator.step_process()
    state.snapshot = build_snapshot(scanner, config, state.status)

    app = FastAPI()
    for router in (routes_draft.router, routes_data.router, routes_decks.router):
        app.include_router(router)
    app.get("/api/jobs")(jobs.list_jobs)
    with TestClient(app) as client:
        yield client


def wait_for_job(client, job, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for j in client.get("/api/jobs").json():
            if j["id"] == job["id"] and j["status"] != "running":
                assert j["status"] == "done", j.get("message")
                return j["result"]
        time.sleep(0.1)
    raise AssertionError(f"Job {job['kind']} did not finish")


def test_snapshot_reflects_live_pack(bridge):
    body = bridge.get("/api/state").json()
    assert body["ready"] is True
    snap = body["snapshot"]
    assert snap["event"]["set"] == "OTJ"
    assert (snap["pack"], snap["pick"]) == (1, 1)
    with open(OTJ_SNAPSHOT, encoding="utf-8") as f:
        known = json.load(f)["card_ratings"]
    expected = {known[i]["name"] for i in PACK.split(",") if i in known}
    assert {card["name"] for card in snap["packCards"]} == expected


def test_meta_exposes_display_constants(bridge):
    meta = bridge.get("/api/meta").json()
    for key in ("version", "columnLabels", "winRateFields", "gradeDeviations", "resultFormats", "basicLands"):
        assert key in meta
    assert "Grade" in meta["resultFormats"]


def test_config_patch_merges_and_validates(bridge):
    res = bridge.patch("/api/config", json={"settings": {"result_format": "Grade"}})
    assert res.status_code == 200
    assert res.json()["settings"]["result_format"] == "Grade"
    assert state.config.settings.result_format == "Grade"

    bad = bridge.patch("/api/config", json={"settings": {"always_on_top": {"not": "a bool"}}})
    assert bad.status_code in (400, 422)
    assert state.config.settings.result_format == "Grade"


def test_card_lookup_and_names(bridge):
    names = bridge.get("/api/cards/names").json()
    assert len(names) > 100
    cards = bridge.post("/api/cards/lookup", json={"names": names[:3]}).json()
    assert {c["name"] for c in cards} == set(names[:3])


def test_export_csv_contains_pack(bridge):
    body = bridge.post("/api/export", json={"format": "csv"}).json()
    first_card = state.snapshot["packCards"][0]["name"]
    assert first_card in body["content"]
    assert bridge.post("/api/export", json={"format": "xml"}).status_code == 400


def test_active_dataset_cannot_be_deleted(bridge):
    res = bridge.delete(f"/api/datasets/{DATASET}")
    assert res.status_code == 400
    assert os.path.exists(os.path.join(routes_data.constants.SETS_FOLDER, DATASET))


def test_deck_analyze_and_export(bridge):
    deck = [{"name": n, "count": 1} for n in _otj_spells(23)] + [{"name": "Mountain", "count": 17}]
    assert len(deck) == 24

    job = bridge.post("/api/deck/analyze", json={"deck": deck, "sideboard": []}).json()
    view = wait_for_job(bridge, job)
    assert sum(c["count"] for c in view["deck"]) == 40
    assert view["stats"]

    text = bridge.post("/api/deck/export", json={"deck": deck, "sideboard": []}).json()["text"]
    assert text.startswith("Deck")
    assert "17 Mountain" in text


def test_suggest_rejects_small_pool(bridge):
    assert bridge.post("/api/deck/suggest", json={}).status_code == 400


def test_pump_clears_stale_loading_status(monkeypatch):
    class Orchestrator:
        def __init__(self):
            import queue

            self.update_queue = queue.Queue()

    orch = Orchestrator()
    orch.update_queue.put({"status": "Loading event dataset..."})
    orch.update_queue.put("REFRESH")
    monkeypatch.setattr(state, "orchestrator", orch)
    monkeypatch.setattr(state, "status", "Ready")
    monkeypatch.setattr(state, "clients", set())

    async def no_refresh():
        pass

    monkeypatch.setattr(server, "refresh", no_refresh)

    async def run():
        task = asyncio.create_task(server._pump())
        await asyncio.sleep(0.3)
        task.cancel()

    asyncio.run(run())
    assert state.status == "Ready"
