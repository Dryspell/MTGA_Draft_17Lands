# -*- mode: python ; coding: utf-8 -*-
# Build with: python bridge/build.py
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["__main__.py"],
    pathex=[".."],
    binaries=[],
    datas=[],
    hiddenimports=collect_submodules("uvicorn") + collect_submodules("bridge"),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "ttkbootstrap", "pynput", "PIL.ImageTk", "pytest"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="mtga-bridge",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Uvicorn logs to stdout/stderr, which are None in a windowed build.
    # The overlay spawns this hidden (CREATE_NO_WINDOW), so no console appears.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
