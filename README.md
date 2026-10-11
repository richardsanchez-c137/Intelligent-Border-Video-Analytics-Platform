# IBVAP — Intelligent Border Video Analytics Platform

IBVAP is a prototype for AI-assisted perimeter monitoring. It combines person/object detection, a configurable restricted zone, audible intrusion alerting, and local incident/evidence records with a lightweight browser-based monitoring interface.

> **Prototype and safety notice:** This is a development/hackathon project, not a certified safety or border-security product. Detection can be wrong. Keep a human operator in the loop, validate in controlled conditions, and do not rely on it as the sole means of protection.

## Features

- C++ camera-processing application using OpenCV and ONNX models.
- YOLO26s model for object/person detection.
- Optional second-stage person/helmet classifier (`helmet_verifier_v3.onnx`).
- Editable normalized rectangular restricted zone. Keyboard shortcuts in the camera window: `T` to enter/cancel editing, drag with the mouse to draw, `S` to save, `M` to silence the current alarm, and `Esc` to exit.
- Local audible alarm for qualifying intrusion detections.
- CSV incident history and captured evidence images.
- Plain HTML/CSS/JavaScript frontend with camera status, detections, restricted-zone editing, incident history and evidence details.
- Python standard-library HTTP bridge that connects the browser interface to the running C++ process using local runtime IPC files.

## Repository contents

The integration layout used by this guide is:

```text
.
├── backend/
│   └── ibvap_bridge.py
├── cpp/
│   └── main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_integrated.cpp
├── frontend-antigravity/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── ibvap-api.js
├── models/
│   ├── yolo26s.onnx                 # required at runtime
│   └── helmet_verifier_v3.onnx      # required at runtime
├── config/                          # local zone configuration; real zone file is ignored
├── logs/                            # generated locally; never commit contents
└── runtime/                         # generated IPC state; never commit contents
```

Some packaging archives may omit model files or other locally generated files. Confirm the required files exist after cloning. If model binaries are not included in the repository, obtain them from the project maintainer through an approved channel. Check model licence and redistribution terms before publishing binaries publicly.

## Requirements

- Windows 10/11.
- MSYS2 UCRT64 with `g++`, `pkg-config`, and OpenCV development libraries available through `pkg-config opencv5`.
- Python 3.10 or newer (the bridge uses the Python standard library; no `pip install` is required for the bridge itself).
- A supported camera/webcam.
- Runtime model files in `models/` as listed above.
- A modern browser.

## 1. Compile the integrated C++ application

Open the **MSYS2 UCRT64** terminal in the repository root and run:

```bash
cd "/d/GitHub/Intelligent Border Video Analytics Platform"
g++ -std=c++17 -pthread cpp/main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_integrated.cpp -o ibvap_webcam_yolo26_zone_editor_integrated.exe $(pkg-config --cflags --libs opencv5)
```

This command assumes the source remains in `cpp/`. The generated executable is ignored by Git and is built locally.

## 2. Start the C++ engine

From the repository root in MSYS2 UCRT64:

```bash
./ibvap_webcam_yolo26_zone_editor_integrated.exe
```

Confirm the camera window starts and both model files load. The application creates/updates local `logs/` and `runtime/` files as it runs.

## 3. Start the local API bridge

Open **PowerShell** in a separate terminal:

```powershell
cd "D:\GitHub\Intelligent Border Video Analytics Platform"
python backend\ibvap_bridge.py
```

The bridge listens on `127.0.0.1:8080`. Check its health endpoint:

<http://127.0.0.1:8080/api/health>

With the integrated C++ engine running, the response should report `ok: true`, `bridge: "online"`, `engineConnected: true`, and `cameraState: "ON"`.

The bridge binds to loopback for local use. **Do not expose it directly to the public internet or an untrusted network.** Some endpoints change the zone, silence an alarm, or delete eligible logs. Public deployment requires authentication, authorization, CSRF protection, and additional security review.

## 4. Start the frontend

Open another PowerShell terminal:

```powershell
cd "D:\GitHub\Intelligent Border Video Analytics Platform\frontend-antigravity"
python -m http.server 8000
```

Visit <http://localhost:8000>.

In `frontend-antigravity/ibvap-api.js`, backend mode should only be enabled after the integrated C++ process and bridge are running. Set the configuration mode from `demo` to `backend`, then refresh the page. If you only want to explore the UI, leave demo mode enabled.

## Keyboard controls

| Key | Action |
| --- | --- |
| `M` | Silence the active alarm in the camera application; frontend control sends a request when backend mode is connected. |
| `T` | Enter restricted-zone editing or cancel the current edit. |
| Mouse drag | Draw a new rectangular restricted zone while editing. |
| `S` | Save/apply a valid restricted zone while editing. |
| `Esc` | Exit the C++ camera application. |

## Local logs, evidence and privacy

The application may generate:

- `logs/intrusion_events.csv`
- `logs/intrusion_events_tracked.csv`
- `logs/intrusion_events_sessions.csv`
- `logs/operator_events.csv` and `logs/incident_dispositions.csv` (when used by the bridge)
- `logs/evidence/` containing incident images
- `datasets/`, including `datasets/fine_tuning/raw/`, `crops/`, and classifier datasets
- `videos/` and `runtime/` generated state/frame/IPC files

**Do not commit these folders or their contents.** The root `.gitignore` excludes the log and evidence folders, training datasets/raw/crops, video recordings, runtime IPC state, CSV/log files, local saved restricted-zone file, training checkpoints, virtual environments, and compiled executables. These exclusions do not delete local data.

A `.gitignore` only prevents untracked files from being added. If any of these files were already tracked, untrack them from Git without deleting local copies:

```bash
git rm -r --cached --ignore-unmatch logs datasets videos runtime runs weights .venv-train
```

Then review `git status` before committing. This command removes the listed paths from the Git index (the next commit will record their removal) but keeps their working copies on disk. It does not erase them from earlier commits already published to GitHub.

### Before publishing

1. Inspect GitHub Desktop's **Changes** tab.
2. Ensure no evidence image/video, raw training image, CSV incident log, runtime state/frame, local zone file, credential or private `.env` file is staged.
3. If a private file was committed in a previous commit, adding it to `.gitignore` is not enough to remove it from repository history. If it was pushed publicly, treat it as exposed and consult GitHub's history-removal guidance; rotate any secrets.
4. Check model redistribution licences before making model binaries public.

## Troubleshooting

- **Model load error:** confirm the two ONNX files are present in `models/` and the application is launched from the repository root.
- **OpenCV compile error:** use MSYS2 UCRT64 and confirm `pkg-config --cflags --libs opencv5` works.
- **Camera unavailable:** check Windows camera permissions and close apps that may be using the camera.
- **Frontend says disconnected:** make sure the C++ process and bridge are running, check `/api/health`, and serve the frontend over `http://localhost:8000` rather than opening `index.html` through `file://`.
- **Changes show evidence/data after `.gitignore`:** confirm the root `.gitignore` is named correctly and use the `git rm --cached` command above if the paths are already tracked.

## Current integration limitations

- The browser interface communicates with a local bridge; the integrated C++ program is still required for live camera processing.
- The frontend and backend are intended for local single-machine use in the current prototype.
- The supplied integration package's frontend does not necessarily include every feature referenced in planning documents (for example, a dedicated log-cleaning UI may require additional work even if bridge cleanup endpoints exist).
- No accuracy, latency, or field-safety claims are made here. Measure detection precision/recall, false alarms per hour, alert latency, and stability before operational use.

## Contributing

Please do not submit private surveillance imagery, real incident evidence, identifiable persons' photos/videos, credentials, `.env` files, or raw training data. Use synthetic/test fixtures in issues and pull requests. Report security issues privately to the project maintainers rather than posting them publicly.
