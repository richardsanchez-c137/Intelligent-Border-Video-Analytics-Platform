# IBVAP integration: step-by-step runbook

## Preserve the working version first

Keep `ibvap_webcam_yolo26_zone_editor.exe` and `main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_restored.cpp` unchanged. The integrated copy is a new executable/source.

## 1. Place the files

From the package:

- Copy `cpp/main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_integrated.cpp` to the project root, or compile it from the `cpp/` subfolder as shown below.
- Copy `backend/ibvap_bridge.py` into `<project-root>\backend\ibvap_bridge.py`.
- Copy all contents of the package `frontend/` directory into a new folder named `<project-root>\frontend-antigravity`. Do not overwrite your existing frontend; keep it as rollback.

## 2. Compile (MSYS2 UCRT64)

```bash
cd "/d/GitHub/Intelligent Border Video Analytics Platform"
g++ -std=c++17 -pthread cpp/main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_integrated.cpp -o ibvap_webcam_yolo26_zone_editor_integrated.exe $(pkg-config --cflags --libs opencv5)
```

If the compiler errors, stop and send the complete first error and following diagnostics. Do not delete the old executable.

## 3. Start the C++ process

```bash
cd "/d/GitHub/Intelligent Border Video Analytics Platform"
./ibvap_webcam_yolo26_zone_editor_integrated.exe
```

Confirm the camera window opens and green/red boxes still work.

## 4. Start the bridge (PowerShell)

```powershell
cd "D:\GitHub\Intelligent Border Video Analytics Platform"
python backend\ibvap_bridge.py
```

Check in a browser: `http://127.0.0.1:8080/api/health`. It should report `"engineConnected":true` within a few seconds of the C++ app running.

## 5. Start frontend static hosting (PowerShell)

```powershell
cd "D:\GitHub\Intelligent Border Video Analytics Platform\frontend-antigravity"
python -m http.server 8000
```

Open `http://localhost:8000`. In `ibvap-api.js`, change the top-level `CONFIG.mode` from `demo` to `backend`, save and refresh.

## 6. Test one feature at a time

1. Confirm actual camera frames and detection boxes are visible in the frontend.
2. Toggle the camera off and on; verify telemetry state changes.
3. Trigger a safe controlled intrusion and verify the alarm state updates.
4. Press M in the frontend and verify the C++ alarm actually silences.
5. Draw a new frontend zone, press S, then inspect `config/restricted_zone.txt` and the C++ window to confirm active configuration changes.
6. Open History Logs and compare rows against `logs/intrusion_events_sessions.csv`. Check existing evidence images open in the incident modal.
7. Do not test destructive cleanup until reviewing the preview output; cleanup routes are not yet wired into this supplied UI.

## 7. If the frontend says disconnected

- Ensure both the bridge terminal and integrated C++ window are still running.
- Visit `/api/health` and check `engineConnected`.
- Confirm you launched C++ from the project root so the relative `models/`, `config/`, `logs/` and `runtime/` paths resolve.
- Ensure port 8080 is not already in use.
- Make sure the frontend was served over `http://localhost:8000`, not opened from `file://`.
