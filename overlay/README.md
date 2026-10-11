# MTGA Draft Overlay

React + TypeScript overlay (Tauri desktop shell) for the Python draft engine.
The engine runs as a local bridge (`bridge/`, FastAPI on `127.0.0.1:8617`) and
pushes draft snapshots over a WebSocket; this app only renders them.

## Running

From the repository root, start the bridge (Python 3.12+):

```bash
python -m venv .venv
.venv/Scripts/pip install numpy pillow pydantic requests numba scipy pywin32 ttkbootstrap pynput
.venv/Scripts/pip install -r bridge/requirements.txt
.venv/Scripts/python -m bridge
```

Then in `overlay/`:

```bash
npm install
npm run tauri dev   # transparent always-on-top window
npm run dev         # or just the UI in a browser at http://localhost:5173
```

## Developing without a live draft

Replay a recorded Arena log, stopping at the Nth pack (and optionally stepping
forward every few seconds):

```bash
python -m bridge.replay "<path>/Player-prev.log" test_logs/replay.log --start 145 --step 4
python -m bridge -f test_logs/replay.log
```

Put a `config.json` in the repository root first (copy it from
`%APPDATA%/MTGA_Draft_Tool/`) so the bridge doesn't overwrite the installed
app's settings with the replay log path.
