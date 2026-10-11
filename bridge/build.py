"""
Build the bridge into a single executable and place it where Tauri expects
its sidecar: overlay/src-tauri/binaries/mtga-bridge-<target-triple>[.exe]

    python bridge/build.py
"""

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BINARIES = os.path.join(ROOT, "overlay", "src-tauri", "binaries")


def target_triple() -> str:
    out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("Could not determine Rust host triple")


def main():
    build_dir = os.path.join(ROOT, "build", "bridge")
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--distpath", os.path.join(build_dir, "dist"),
            "--workpath", os.path.join(build_dir, "work"),
            os.path.join(HERE, "bridge.spec"),
        ],
        cwd=HERE,
        check=True,
    )
    ext = ".exe" if sys.platform == "win32" else ""
    os.makedirs(BINARIES, exist_ok=True)
    target = os.path.join(BINARIES, f"mtga-bridge-{target_triple()}{ext}")
    shutil.copy2(os.path.join(build_dir, "dist", f"mtga-bridge{ext}"), target)
    print(f"Sidecar written to {target}")


if __name__ == "__main__":
    main()
