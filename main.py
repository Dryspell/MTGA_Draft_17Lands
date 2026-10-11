"""
main.py
MTGA Draft Tool - Entry Point.
Handles Robust Path Discovery and Splash Lifecycle.
"""

import locale

# Intercept unsupported locale settings that cause ttkbootstrap to crash on certain Windows regions.
_original_setlocale = locale.setlocale


def _safe_setlocale(category, loc=None):
    try:
        return _original_setlocale(category, loc)
    except locale.Error:
        # Fallback to the safe 'C' standard locale if the system's regional setting is unsupported
        return _original_setlocale(category, "C")


locale.setlocale = _safe_setlocale

import ttkbootstrap as ttk

# The ttkbootstrap msgcat guard (Tcl 9 startup crash) lives in src.ui.styles so
# that every entry point constructing a Style is protected, not just this one.
# It is installed as a side effect of the src.ui imports below.

import argparse
import os
import sys
import logging
from src import constants
from src.configuration import read_configuration, write_configuration
from src.boot import load_data, load_event_dataset  # noqa: F401 (re-exported)
from src.ui.app import DraftApp
from src.ui.windows.splash import SplashWindow
from src.ui.styles import Theme

logger = logging.getLogger(__name__)


def main():
    import time
    from src import constants

    # 30-day draft log cleanup
    if os.path.exists(constants.DRAFT_LOG_FOLDER):
        try:
            now = time.time()
            for f in os.listdir(constants.DRAFT_LOG_FOLDER):
                if f.startswith("DraftLog_") and f.endswith(".log"):
                    filepath = os.path.join(constants.DRAFT_LOG_FOLDER, f)
                    try:
                        # 30 days * 24h * 60m * 60s = 2592000 seconds
                        if now - os.path.getmtime(filepath) > 2592000:
                            os.remove(filepath)
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"Failed cleaning old draft logs: {e}")

    # CLI Argument Parsing
    parser = argparse.ArgumentParser()
    parser.add_argument("-f", "--file", help="Path to Player.log")
    parser.add_argument("-d", "--data", help="Path to MTGA Data")
    parser.add_argument("--version", action="store_true", help="Print version and exit")
    args, _ = parser.parse_known_args()

    # --- CI/CD SMOKE TEST EXIT ---
    # Instantly boots the app, validates all C-extension imports, and exits safely.
    if args.version:
        print(f"MTGA Draft Tool v{constants.APPLICATION_VERSION}")
        sys.exit(0)

    # Load Config
    config, _ = read_configuration()
    root = None

    def launch_ui(is_safe_mode=False):
        nonlocal root
        if is_safe_mode:
            logger.info("Attempting safe-mode UI launch with default theme.")
            config.settings.theme = "Neutral"
            config.settings.theme_base = "clam"
            config.settings.theme_custom_path = ""
            write_configuration(config)
            if root:
                try:
                    root.destroy()
                except Exception:
                    pass

        root = ttk.Window(themename="cyborg")
        root.withdraw()

        # Initialize Styling Engine
        # We apply a baseline theme so the splash screen matches the app
        Theme.apply(
            root,
            engine=getattr(config.settings, "theme_base", "clam"),
            palette=getattr(config.settings, "theme", "Neutral"),
        )

        def on_ready(data, splash):
            try:
                splash.close()
                root.update()
                app = DraftApp(root, data["scanner"], data["config"])

                # 1. Show the window skeleton immediately
                root.deiconify()

                # 2. Immediately trigger Phase 1 (Geometry & Data Sync)
                # We use a very short delay (10ms) to ensure the window is 'active'
                root.after(10, app._perform_boot_sync)

            except Exception as e:
                logger.error(f"Launch Error: {e}", exc_info=True)
                root.destroy()

        # Launch non-blocking Splash
        SplashWindow(
            root,
            task=lambda cb: load_data(args, config, cb),
            on_complete=on_ready,
            show_ui=getattr(config.settings, "show_splash_screen", True),
        )

    try:
        launch_ui(is_safe_mode=False)
    except Exception as e:
        logger.error(f"Fatal error during UI initialization: {e}", exc_info=True)
        # Guarantee the user is never permanently locked out due to a corrupted theme
        launch_ui(is_safe_mode=True)

    try:
        if root:
            root.mainloop()
    except KeyboardInterrupt:
        logger.info("Application stopped by user (KeyboardInterrupt).")
        if root:
            root.destroy()
        sys.exit(0)


if __name__ == "__main__":
    main()
