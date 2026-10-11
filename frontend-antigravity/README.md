# IBVAP Frontend

Lightweight HTML5/CSS3/vanilla-JavaScript security console for IBVAP. No package installation or build step is required.

## Features

- Large camera viewport with green/red detection overlays.
- Camera ON/OFF status and toggle.
- `M` or **Silence Alarm** requests alarm silencing.
- `T` to enter/cancel restricted-zone editing; mouse to draw/move/resize; `S` to save.
- Searchable/filterable incident history and detail modal.
- Evidence preview/download and CSV export.
- Separate API adapter in `ibvap-api.js`.

## Run in demo mode

Copy this directory's contents to `D:\GitHub\Intelligent Border Video Analytics Platform\frontend-antigravity`, then open PowerShell there:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Demo mode works without a backend.

## Connect to the integrated backend

1. Start `ibvap_webcam_yolo26_zone_editor_integrated.exe` from the IBVAP project root.
2. Start `python backend\ibvap_bridge.py` from the same project root in another terminal.
3. Visit `http://127.0.0.1:8080/api/health` and confirm `engineConnected` is `true`.
4. In this folder's `ibvap-api.js`, change `CONFIG.mode` from `demo` to `backend` and refresh the browser.

The integrated adapter uses REST polling rather than WebSockets. Live camera frames come from `/api/frame.jpg`, and telemetry/detections from `/api/telemetry`. The bridge must be running on the same computer and binds only to loopback.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `M` | Silence the active alarm |
| `T` | Enter zone editing, or cancel and restore previous zone |
| `S` | Save a valid zone while editing |

Shortcuts are ignored while typing in an input, textarea, select, or editable element.

## Notes and limitations

- The real C++ app and bridge must both be running for connected mode.
- Camera OFF pauses model inference in the integrated C++ copy but leaves camera capture open for quick resumption.
- Incident severity is mapped for display because the current source CSV schema does not contain a severity column. Confidence below 0.50 is shown as WARNING; otherwise intrusion records are shown as CRITICAL.
- The supplied frontend does not yet include a Log Cleaning page. The local bridge exposes narrowly scoped cleanup endpoints for later wiring.
- Do not expose the local bridge to an untrusted network.
