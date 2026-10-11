# IBVAP one-click launcher (Windows)

These scripts let you double-click one file to start the integrated C++ camera engine, the local Python bridge, and the static frontend server. They do not replace the original working executable or delete logs/models/configuration.

## Install

1. Copy `START_IBVAP.bat`, `START_IBVAP.ps1`, `STOP_IBVAP.bat`, and `STOP_IBVAP.ps1` into the project root:
   `D:\GitHub\Intelligent Border Video Analytics Platform`
2. Verify the root has:
   - `ibvap_webcam_yolo26_zone_editor_integrated.exe`
   - `backend\ibvap_bridge.py`
   - `frontend-antigravity\index.html`
   - `frontend-antigravity\ibvap-api.js`
3. If your integrated executable has a different name, update `$EngineExe` in `START_IBVAP.ps1` to match it.
4. Double-click `START_IBVAP.bat`.

## What it does

- Reuses a responding IBVAP bridge if one is already running; otherwise starts it hidden on `127.0.0.1:8080`.
- Starts the integrated C++ engine if it is not already running, with the project root as the working directory so `models/`, `config/`, and `logs/` resolve correctly.
- Starts the plain static frontend server on `127.0.0.1:8000`, unless an IBVAP page is already served there.
- Waits up to 60 seconds for `engineConnected` and opens `http://127.0.0.1:8000` in the default browser.
- Writes helper process output to `logs/ibvap_*_stdout.log` and `logs/ibvap_*_stderr.log`.
- Records only process IDs it started in `runtime/ibvap_launcher_processes.json`.

Python is searched in `C:\Python314\python.exe`, then the per-user Python 3.12 location, then `PATH`. The current bridge uses only Python standard-library modules.

## Stop

Double-click `STOP_IBVAP.bat`. It only stops process IDs started by the launcher and verified against their command lines. Any C++/Python process that was already running before the launcher is left alone. You can also close the camera with Esc.

## Troubleshooting

- If port 8080 or 8000 is in use by a different application, close that application or adjust the ports consistently in the bridge/frontend before retrying.
- If the bridge reports `engineConnected: false`, check `runtime/state.json`, `logs/ibvap_engine_stderr.log`, and `logs/ibvap_bridge_stderr.log`.
- If the frontend is in DEMO mode, edit `frontend-antigravity/ibvap-api.js` and change `CONFIG.mode` to `'backend'`, then refresh the page. The launcher warns but does not silently change this setting.
- The bridge must remain bound to loopback for local-only operation. Do not expose it directly to the public internet.

The `.bat` file is a one-click launcher; it is not a compiled native executable. It avoids needing extra packaging utilities. A real `.exe` wrapper is possible later, but this script approach is easier to inspect and troubleshoot.
