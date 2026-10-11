"""Run the bridge: python -m bridge [-f Player.log] [-d MTGA_Data] [--port 8617] [--watch-stdin]"""

import argparse
import os
import sys
import threading

import uvicorn

from bridge.server import create_app


def _exit_when_stdin_closes():
    """The overlay holds our stdin open; EOF means it exited or crashed."""
    try:
        while sys.stdin.read(1024):
            pass
    finally:
        os._exit(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-f", "--file", help="Path to Player.log")
    parser.add_argument("-d", "--data", help="Path to MTGA Data")
    parser.add_argument("--port", type=int, default=8617)
    parser.add_argument("--watch-stdin", action="store_true", help="Exit when stdin closes")
    args = parser.parse_args()

    if args.watch_stdin and sys.stdin:
        threading.Thread(target=_exit_when_stdin_closes, daemon=True).start()

    uvicorn.run(create_app(args), host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
