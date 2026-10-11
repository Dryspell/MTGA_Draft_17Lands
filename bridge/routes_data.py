"""
bridge/routes_data.py
Dataset manager and tier list routes (Datasets and Tier Lists tabs).
"""

import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src import constants
from src.configuration import CONFIG_LOCK, write_configuration
from src.tier_list import TIER_FILE_PREFIX, TIER_FOLDER, TierList
from src.utils import clear_set_history, invalidate_local_set_cache, read_local_manifest, retrieve_local_set_list

from bridge.jobs import JobContext, start_job
from bridge.state import state

router = APIRouter(prefix="/api")


# --- Datasets -----------------------------------------------------------------------


def _live_set_codes(active_filename: str):
    codes = set()
    try:
        for code in read_local_manifest().get("active_sets") or []:
            if isinstance(code, str) and code.strip():
                codes.add(code.strip().upper())
    except Exception:
        pass
    if active_filename:
        codes.add(active_filename.split("_", 1)[0].upper())
    return codes


@router.get("/datasets")
def list_datasets():
    state.require_ready()
    sets_data = state.scanner.set_list.data if state.scanner.set_list else {}
    codes = [v.seventeenlands[0] for v in sets_data.values() if v.seventeenlands]
    files, _ = retrieve_local_set_list(codes, list(sets_data.keys()))
    active = state.config.card_data.latest_dataset
    rows = [
        {
            "set": f[0], "event": f[1], "group": f[2], "start": f[3], "end": f[4],
            "games": f[5], "filename": os.path.basename(f[6]), "collected": f[7],
            "active": os.path.basename(f[6]) == active,
        }
        for f in sorted(files, key=lambda x: x[7], reverse=True)
    ]
    live = {c.upper() for c in (read_local_manifest().get("active_sets") or []) if isinstance(c, str)}
    sets = [
        {
            "name": name,
            "code": info.seventeenlands[0] if info.seventeenlands else info.set_code,
            "formats": sorted(info.formats) if info.formats else constants.LIMITED_TYPE_LIST,
            "startDate": info.start_date,
            "live": bool({c.upper() for c in info.seventeenlands} & live),
        }
        for name, info in sets_data.items()
    ]
    sets.sort(key=lambda s: not s["live"])
    return {
        "files": rows,
        "sets": sets,
        "excluded": list(state.config.card_data.excluded_datasets),
        "liveSets": sorted(_live_set_codes(active)),
    }


class DownloadBody(BaseModel):
    set: str
    event: str
    group: str = "All"
    period: str = constants.TIME_PERIOD_DEFAULT_LABEL
    threshold: int = 500


class _Status:
    def __init__(self, ctx: JobContext):
        self.ctx = ctx

    def set(self, value):
        self.ctx.progress(message=str(value))

    def get(self):
        return ""


class _Bar(dict):
    """Stands in for the Tk progress bar FileExtractor drives."""

    def __init__(self, ctx: JobContext):
        super().__init__(value=0)
        self.ctx = ctx

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        if key == "value":
            self.ctx.progress(value=float(value))

    def winfo_exists(self):
        return True


class _UI:
    def after(self, _ms, callback):
        callback()

    def winfo_exists(self):
        return True

    def update_idletasks(self):
        pass


@router.post("/datasets/download")
def download_dataset(body: DownloadBody):
    state.require_ready()
    from src.file_extractor import FileExtractor

    sets_data = state.scanner.set_list.data
    set_info = sets_data.get(body.set)
    if not set_info:
        raise HTTPException(404, f"Unknown set: {body.set}")
    start = set_info.start_date
    if start == constants.START_DATE_DEFAULT:
        codes = {c.upper() for c in set_info.seventeenlands}
        manifest_dates = [
            e["start_date"] for k, e in read_local_manifest().get("datasets", {}).items()
            if k.split("_")[0].upper() in codes and e.get("start_date")
        ]
        start = min(manifest_dates) if manifest_dates else start

    def run(ctx: JobContext):
        ex = FileExtractor(state.config.settings.database_location, _Bar(ctx), _Status(ctx), _UI(), threshold=body.threshold)
        ex.clear_data()
        ex.select_sets(set_info)
        ex.set_draft_type(body.event)
        ex.set_start_date(start)
        ex.set_end_date(datetime.now().strftime("%Y-%m-%d"))
        ex.set_time_period(constants.time_period_value(body.period))
        ex.set_user_group(body.group)
        ex.set_version(3.0)
        ok, _ = ex.retrieve_17lands_color_ratings()
        if not ok:
            raise RuntimeError("17Lands connection failed")
        success, msg, _ = ex.download_card_data(0)
        if not success:
            raise RuntimeError(msg)
        filename = ex.export_card_data()
        if not filename:
            raise RuntimeError("Could not save dataset. Your previous dataset was kept.")
        state.scanner.retrieve_set_data(os.path.join(constants.SETS_FOLDER, filename))
        state.config.card_data.latest_dataset = filename
        write_configuration(state.config)
        state.orchestrator.request_math_update()
        state.request_refresh()
        return {"filename": filename, "message": msg, "limited": "Min Games" in msg}

    return start_job("dataset-download", run)


@router.delete("/datasets/{filename}")
def delete_dataset(filename: str):
    state.require_ready()
    filename = os.path.basename(filename)
    if state.config.card_data.latest_dataset == filename:
        raise HTTPException(400, "You cannot delete the active dataset. Switch to a different dataset first.")
    path = os.path.join(constants.SETS_FOLDER, filename)
    with CONFIG_LOCK:
        excluded = state.config.card_data.excluded_datasets
        previous = list(excluded)
        if filename not in excluded:
            excluded.append(filename)
        if not write_configuration(state.config):
            state.config.card_data.excluded_datasets = previous
            raise HTTPException(500, "Could not save the dataset exclusion.")
        try:
            os.remove(path)
        except OSError as e:
            state.config.card_data.excluded_datasets = previous
            write_configuration(state.config)
            raise HTTPException(500, f"Failed to delete file: {e}")
    invalidate_local_set_cache()
    state.request_refresh()
    return {"ok": True}


@router.post("/datasets/clear-inactive")
def clear_inactive():
    state.require_ready()
    active = state.config.card_data.latest_dataset
    live = _live_set_codes(active)
    names = [
        n for n in os.listdir(constants.SETS_FOLDER)
        if n.endswith(constants.SET_FILE_SUFFIX) and n != active
        and n.split("_", 1)[0].upper() not in live
        and os.path.isfile(os.path.join(constants.SETS_FOLDER, n))
    ] if os.path.exists(constants.SETS_FOLDER) else []
    removed, failures = 0, []
    if names:
        with CONFIG_LOCK:
            previous = list(state.config.card_data.excluded_datasets)
            state.config.card_data.excluded_datasets = list(dict.fromkeys(previous + names))
            if not write_configuration(state.config):
                state.config.card_data.excluded_datasets = previous
                raise HTTPException(500, "Could not save dataset exclusions. No files were removed.")
            for n in names:
                try:
                    os.remove(os.path.join(constants.SETS_FOLDER, n))
                    removed += 1
                except OSError as e:
                    failures.append(f"{n}: {e}")
        invalidate_local_set_cache()
        state.request_refresh()
    return {"removed": removed, "failures": failures, "liveSets": sorted(live)}


@router.post("/datasets/restore")
def restore_excluded():
    state.require_ready()
    state.config.card_data.excluded_datasets = []
    if not write_configuration(state.config):
        raise HTTPException(500, "Could not save dataset preferences.")
    return {"ok": True}


@router.post("/datasets/reset")
def reset_cache():
    state.require_ready()
    removed = clear_set_history()
    state.config.card_data.latest_dataset = ""
    state.config.settings.last_run_version = ""
    write_configuration(state.config)
    state.request_refresh()
    return {"removed": removed}


# --- Tier lists ------------------------------------------------------------------------


@router.get("/tiers")
def list_tiers():
    return [
        {"set": s, "label": label, "date": date, "filename": name}
        for s, label, date, name in sorted(TierList.retrieve_files(), key=lambda t: t[2], reverse=True)
    ]


class TierImportBody(BaseModel):
    url: str
    label: Optional[str] = ""


@router.post("/tiers/import")
def import_tier(body: TierImportBody):
    if not body.url.startswith("https://www.17lands.com/tier_list/"):
        raise HTTPException(400, "Paste a 17Lands tier list URL (https://www.17lands.com/tier_list/...)")

    def run(ctx: JobContext):
        ctx.progress("Connecting to 17Lands...")
        tier = TierList.from_api(body.url)
        if not tier:
            raise RuntimeError("17Lands API error")
        if body.label:
            tier.meta.label = body.label
        filename = f"{TIER_FILE_PREFIX}_{tier.meta.set}_{int(datetime.now().timestamp())}.txt"
        tier.to_file(os.path.join(TIER_FOLDER, filename))
        state.request_refresh()
        return {"filename": filename}

    return start_job("tier-import", run)


@router.delete("/tiers/{filename}")
def delete_tier(filename: str):
    TierList.delete_file(os.path.basename(filename))
    state.request_refresh()
    return {"ok": True}
