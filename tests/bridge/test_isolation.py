"""
tests/bridge/test_isolation.py
The overlay's engine must keep all state in its own home, never in the classic app's
%APPDATA%/MTGA_Draft_Tool, so the two installs can coexist.
"""

import json
import os
import subprocess
import sys

PROBE = (
    "import json; from src import configuration, logger, constants, tier_list; from bridge import arena_cards, decks, game_view; "
    "print(json.dumps([configuration.CONFIG_FILE, logger.DEBUG_LOG_FOLDER, constants.SETS_FOLDER, "
    "constants.DRAFT_LOG_FOLDER, tier_list.TIER_FOLDER, game_view.HISTORY_FILE, game_view.MATCHES_FILE, "
    "decks.DECKS_FILE, arena_cards.CACHE_FILE]))"
)


def test_home_override_isolates_all_state(tmp_path):
    env = {**os.environ, "MTGA_DRAFT_TOOL_HOME": str(tmp_path)}
    out = subprocess.run(
        [sys.executable, "-c", PROBE], cwd=os.getcwd(), env=env, capture_output=True, text=True, check=True
    ).stdout
    paths = json.loads(out.strip().splitlines()[-1])
    home = os.path.normcase(os.path.abspath(tmp_path))
    for path in paths:
        assert os.path.normcase(os.path.abspath(path)).startswith(home), path
    assert os.path.exists(tmp_path / "config.json")
