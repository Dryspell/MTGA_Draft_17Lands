# MTGA Draft Overlay

React + TypeScript overlay (Tauri desktop shell) for the Python draft engine.
The engine runs as a local bridge (`bridge/`, FastAPI on `127.0.0.1:8617`) and
pushes draft snapshots over a WebSocket; this app only renders them.

## Running

Create the Python environment once, from the repository root (Python 3.12+):

```bash
python -m venv .venv
.venv/Scripts/pip install numpy pillow pydantic requests numba scipy pywin32 ttkbootstrap pynput
.venv/Scripts/pip install -r bridge/requirements.txt
```

Then in `overlay/`:

```bash
npm install
npm run tauri dev   # transparent always-on-top window; starts the bridge from .venv
npm run dev         # or just the UI in a browser (start the bridge yourself)
```

The app only starts a bridge if nothing is already listening on port 8617, so
you can run `.venv/Scripts/python -m bridge -f <log>` by hand when needed.

## Building the installer

```bash
.venv/Scripts/pip install pyinstaller
.venv/Scripts/python bridge/build.py   # writes overlay/src-tauri/binaries/mtga-bridge-<triple>.exe
cd overlay && npm run bundle           # src-tauri/target/release/bundle/nsis/*-setup.exe
```

The installed app keeps datasets and logs in its app data folder
(`%APPDATA%/com.mtgadraft.overlay`) and shares `config.json` with the
original Tkinter app.

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
