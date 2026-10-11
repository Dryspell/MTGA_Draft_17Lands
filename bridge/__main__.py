"""Run the bridge: python -m bridge [-f Player.log] [-d MTGA_Data] [--port 8617]"""

import argparse
import uvicorn

from bridge.server import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-f", "--file", help="Path to Player.log")
    parser.add_argument("-d", "--data", help="Path to MTGA Data")
    parser.add_argument("--port", type=int, default=8617)
    args = parser.parse_args()
    uvicorn.run(create_app(args), host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
