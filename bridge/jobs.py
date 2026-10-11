"""
bridge/jobs.py
Background jobs for slow engine work (downloads, deck building, simulations).
Progress and results are pushed to overlays as {"type": "job", ...} messages.
"""

import logging
import threading
import uuid
from typing import Any, Callable, Dict, Optional

from bridge.state import state

logger = logging.getLogger(__name__)

_jobs: Dict[str, dict] = {}
_lock = threading.Lock()


class JobContext:
    def __init__(self, job_id: str, kind: str):
        self.id = job_id
        self.kind = kind

    def progress(self, message: Optional[str] = None, value: Optional[float] = None, **extra):
        update = {"status": "running"}
        if message is not None:
            update["message"] = message
        if value is not None:
            update["progress"] = value
        if extra:
            update["data"] = extra
        _publish(self.id, update)


def _publish(job_id: str, update: dict):
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.update(update)
        message = {"type": "job", **job}
        if "data" in update:
            message["data"] = update["data"]
            job.pop("data", None)
    state.broadcast_threadsafe(message)


def start_job(kind: str, fn: Callable[[JobContext], Any], exclusive: bool = True) -> dict:
    """Run fn in a thread. With exclusive=True, a running job of the same kind is reused."""
    with _lock:
        if exclusive:
            for job in _jobs.values():
                if job["kind"] == kind and job["status"] == "running":
                    return dict(job)
        job_id = uuid.uuid4().hex[:10]
        _jobs[job_id] = {"id": job_id, "kind": kind, "status": "running", "message": "", "progress": None}
        job = dict(_jobs[job_id])

    ctx = JobContext(job_id, kind)

    def run():
        try:
            result = fn(ctx)
            _publish(job_id, {"status": "done", "result": result})
        except Exception as e:
            logger.error(f"Job {kind} failed: {e}", exc_info=True)
            _publish(job_id, {"status": "error", "message": str(e)})

    threading.Thread(target=run, daemon=True, name=f"job-{kind}").start()
    return job


def list_jobs():
    with _lock:
        return [dict(j) for j in _jobs.values()]
