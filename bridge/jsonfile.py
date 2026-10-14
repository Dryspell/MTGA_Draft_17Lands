"""
bridge/jsonfile.py
JSON persistence for the overlay's own data (decks, game history, match notes,
metagame cache) that survives crashes and Windows file locking.

On Windows, replacing or opening a file fails while another handle (a reader
thread, antivirus, a backup tool) has it open, so both sides retry briefly.
A file that exists but can't be parsed is copied aside before anything can
overwrite it.
"""

import json
import logging
import os
import shutil
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

RETRIES = 8


class Unreadable(Exception):
    def __init__(self, message: str, corrupt: bool):
        super().__init__(message)
        self.corrupt = corrupt


def read_json(path: str, default: Any = None) -> Any:
    """The file's data, `default` if it doesn't exist. Raises Unreadable if it exists but
    can't be read: corrupt=True (already copied aside) or corrupt=False (still locked)."""
    for attempt in range(RETRIES):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return default
        except PermissionError:
            time.sleep(0.03 * (attempt + 1))
        except (ValueError, UnicodeDecodeError) as e:
            backup = f"{path}.corrupt-{time.strftime('%Y%m%d-%H%M%S')}"
            try:
                shutil.copy2(path, backup)
            except OSError:
                backup = "(could not copy it)"
            logger.error("%s is unreadable (%s); kept a copy at %s", path, e, backup)
            raise Unreadable(f"{path} is corrupt", corrupt=True) from e
        except OSError as e:
            raise Unreadable(f"{path}: {e}", corrupt=False) from e
    raise Unreadable(f"{path} stayed locked", corrupt=False)


def write_json(path: str, data: Any):
    """Write to a private temp file, flush it to disk, then swap it in."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.{os.getpid()}-{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    for attempt in range(RETRIES):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == RETRIES - 1:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
            time.sleep(0.05 * (attempt + 1))
