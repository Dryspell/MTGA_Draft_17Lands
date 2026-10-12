"""
bridge/routes_draft.py
Live-draft and general routes: constants, configuration, data sources,
draft history, log files, exports, card lookups.
"""

import asyncio
import os
import webbrowser
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from src import constants
from src.configuration import Configuration, write_configuration
from src.card_logic import clear_deck_cache, export_draft_to_csv, export_draft_to_json

from bridge.serialize import serialize_cards
from bridge.state import state

router = APIRouter(prefix="/api")


@router.get("/meta")
def meta():
    return {
        "version": constants.APPLICATION_VERSION,
        "colorNames": constants.COLOR_NAMES_DICT,
        "deckColors": constants.DECK_COLORS,
        "tagVisuals": constants.TAG_VISUALS,
        "columnLabels": constants.COLUMN_FIELD_LABELS,
        "winRateFields": constants.WIN_RATE_OPTIONS,
        "gradeDeviations": {k.strip(): v for k, v in constants.GRADE_DEVIATION_DICT.items()},
        "resultFormats": constants.RESULT_FORMAT_LIST,
        "filterFormats": constants.DECK_FILTER_FORMAT_LIST,
        "uiSizes": list(constants.UI_SIZE_DICT.keys()),
        "limitedTypes": constants.LIMITED_TYPE_LIST,
        "userGroups": constants.LIMITED_GROUPS_LIST,
        "timePeriods": list(dict.fromkeys([constants.TIME_PERIOD_DEFAULT_LABEL, *constants.TIME_PERIOD_LABELS])),
        "basicLands": constants.BASIC_LANDS,
    }


@router.get("/state")
def get_state():
    return {"status": state.status, "ready": state.ready, "snapshot": state.snapshot}


# --- Configuration -----------------------------------------------------------


@router.get("/config")
def get_config():
    state.require_ready()
    return state.config.model_dump()


@router.patch("/config")
async def patch_config(body: Dict[str, Dict[str, Any]]):
    state.require_ready()
    config = state.config
    merged = config.model_dump()
    for section, values in body.items():
        if section not in merged or not isinstance(values, dict):
            raise HTTPException(400, f"Unknown section: {section}")
        merged[section].update(values)
    try:
        validated = Configuration.model_validate(merged)
    except ValidationError as e:
        problems = "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors())
        raise HTTPException(422, f"Invalid settings: {problems}")

    settings_changes = body.get("settings", {})
    if "arena_log_location" in settings_changes:
        validated.settings.arena_log_pinned = bool(str(settings_changes["arena_log_location"]).strip())

    for section in body:
        setattr(config, section, getattr(validated, section))
    if not write_configuration(config):
        raise HTTPException(500, "Could not save configuration")

    scanner = state.scanner
    if "arena_log_location" in settings_changes:
        state.orchestrator.live_log_path = config.settings.arena_log_location
    if "database_location" in settings_changes and scanner.set_data:
        scanner.set_data.db_path = config.settings.database_location
        scanner.set_data.unknown_id_cache.clear()
    if "draft_log_enabled" in settings_changes and scanner.arena_file == state.orchestrator.live_log_path:
        scanner.log_enable(config.settings.draft_log_enabled)

    state.request_refresh()
    return config.model_dump()


@router.post("/config/reset")
def reset_config():
    state.require_ready()
    fresh = Configuration()
    for section in ("settings", "card_logic", "features", "card_data"):
        setattr(state.config, section, getattr(fresh, section))
    write_configuration(state.config)
    state.request_refresh()
    return state.config.model_dump()


# --- Engine control -----------------------------------------------------------


@router.post("/reload")
def reload():
    state.require_ready()
    scanner = state.scanner
    with scanner.lock:
        scanner.clear_draft(True)
        if getattr(scanner, "set_data", None):
            scanner.set_data.unknown_id_cache.clear()
    state.orchestrator.trigger_full_scan()
    return {"ok": True}


class DatasetBody(BaseModel):
    filename: str


@router.post("/dataset/active")
async def set_active_dataset(body: DatasetBody):
    state.require_ready()
    path = os.path.join(constants.SETS_FOLDER, os.path.basename(body.filename))
    if not os.path.exists(path):
        raise HTTPException(404, "Dataset not found")

    def load():
        state.scanner.retrieve_set_data(path)
        state.config.card_data.latest_dataset = os.path.basename(path)
        write_configuration(state.config)
        clear_deck_cache()

    await state.set_status("Loading dataset...")
    await asyncio.to_thread(load)
    state.orchestrator.request_math_update()
    await state.set_status("Ready")
    state.request_refresh()
    return {"ok": True}


# --- Draft history & log files ----------------------------------------------------


@router.get("/history")
def history():
    state.require_ready()
    live = state.config.settings.arena_log_location
    logs = []
    if os.path.exists(constants.DRAFT_LOG_FOLDER):
        for f in os.listdir(constants.DRAFT_LOG_FOLDER):
            if not (f.startswith("DraftLog_") and f.endswith(".log")):
                continue
            path = os.path.join(constants.DRAFT_LOG_FOLDER, f)
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            parts = f[:-4].split("_")
            card_set, event = (parts[1], parts[2]) if len(parts) >= 4 else ("UNKNOWN", "Draft")
            logs.append({"path": path, "file": f, "set": card_set, "event": event, "time": datetime.fromtimestamp(mtime).isoformat()})
    logs.sort(key=lambda x: x["time"], reverse=True)
    return {
        "live": live if live and os.path.exists(live) else None,
        "logs": logs,
        "current": state.scanner.arena_file,
    }


class PathBody(BaseModel):
    path: str


@router.post("/log/open")
def open_log(body: PathBody):
    state.require_ready()
    if not os.path.isfile(body.path):
        raise HTTPException(404, "Log file not found")
    state.orchestrator.set_file_and_scan(body.path)
    return {"ok": True}


@router.post("/mtga-data")
def locate_mtga_data(body: PathBody):
    state.require_ready()
    folder = body.path
    if not folder.rstrip("/\\").endswith("MTGA_Data") and os.path.exists(os.path.join(folder, "MTGA_Data")):
        folder = os.path.join(folder, "MTGA_Data")
    if not os.path.exists(os.path.join(folder, "Downloads", "Raw")):
        raise HTTPException(400, "Could not find 'Downloads/Raw' in the selected folder. Select the MTGA_Data folder.")
    state.config.settings.database_location = folder
    write_configuration(state.config)
    if state.scanner.set_data:
        state.scanner.set_data.db_path = folder
        state.scanner.set_data.unknown_id_cache.clear()
    state.orchestrator.request_math_update()
    return {"ok": True, "path": folder}


# --- Exports ------------------------------------------------------------------------


class ExportBody(BaseModel):
    format: str
    path: Optional[str] = None


def _export_text(fmt: str) -> str:
    scanner = state.scanner
    history = scanner.retrieve_draft_history()
    if not history:
        raise HTTPException(400, "No draft to export")
    fn = export_draft_to_csv if fmt == "csv" else export_draft_to_json
    return fn(history, scanner.set_data, scanner.picked_cards)


@router.post("/export")
def export_draft(body: ExportBody):
    state.require_ready()
    if body.format not in ("csv", "json"):
        raise HTTPException(400, "format must be csv or json")
    text = _export_text(body.format)
    if body.path:
        with open(body.path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        return {"ok": True, "path": body.path}
    return {"ok": True, "content": text}


# --- Cards --------------------------------------------------------------------------


@router.get("/cards/names")
def card_names():
    state.require_ready()
    return sorted(state.scanner.set_data.get_all_names())


class NamesBody(BaseModel):
    names: List[str]


@router.post("/cards/lookup")
def lookup_cards(body: NamesBody):
    state.require_ready()
    cards = state.scanner.set_data.get_data_by_name(body.names)
    return serialize_cards(cards, None, state.scanner.retrieve_tier_data())


@router.get("/draft-record")
def draft_record(draft_id: str):
    from src.seventeenlands import Seventeenlands

    return Seventeenlands().get_draft_record(draft_id) or {}


class UrlBody(BaseModel):
    url: str


@router.post("/open-url")
def open_url(body: UrlBody):
    if not body.url.startswith(("https://", "http://")):
        raise HTTPException(400, "Only web URLs can be opened")
    webbrowser.open(body.url)
    return {"ok": True}
