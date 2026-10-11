"""
Dev tool: replay a recorded Player.log into a target file to drive the bridge.

    python -m bridge.replay SOURCE TARGET --start 5 [--step 4]

Copies SOURCE into TARGET up to (and including) the Nth pack notification,
then optionally advances one pack every --step seconds until the log ends.
Run the bridge with `-f TARGET` against a local config.json so the user's
real configuration is left alone.
"""

import argparse
import time

PACK_MARKER = "Draft.Notify"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--start", type=int, default=1, help="Pack notifications to include initially")
    parser.add_argument("--step", type=float, default=0, help="Seconds between subsequent packs (0 = stop)")
    args = parser.parse_args()

    seen = 0
    with open(args.source, "r", encoding="utf-8", errors="replace") as src, open(
        args.target, "w", encoding="utf-8"
    ) as dst:
        for line in src:
            dst.write(line)
            if PACK_MARKER not in line:
                continue
            seen += 1
            if seen < args.start:
                continue
            dst.flush()
            print(f"Pack notification {seen} written")
            if args.step <= 0:
                return
            time.sleep(args.step)
    print("Source log exhausted")


if __name__ == "__main__":
    main()
