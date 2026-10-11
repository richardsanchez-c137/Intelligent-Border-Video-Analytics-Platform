# IBVAP: current build, run, and clean incident records

## Runtime files to retain

- `main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_restored.cpp` — current application source.
- `models/yolo26s.onnx` — primary object detector.
- `models/helmet_verifier_v3.onnx` — person/helmet verifier.
- `config/restricted_zone.txt` — saved restricted-zone rectangle; keep this to retain the operator's chosen zone.
- `ibvap_webcam_yolo26_zone_editor.exe` — built executable (the run script regenerates it).

Run commands from the project root in the **MSYS2 UCRT64** terminal.

## Build and launch

```bash
bash run_ibvap_ucrt64.sh
```

That script checks the required source and models, compiles the current version against `opencv5`, and launches the camera application. Alternatively, build and run manually:

```bash
g++ -std=c++17 -pthread main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_restored.cpp -o ibvap_webcam_yolo26_zone_editor.exe $(pkg-config --cflags --libs opencv5)
./ibvap_webcam_yolo26_zone_editor.exe
```

The program must be launched with the **project root as its working directory** so relative paths to `models/`, `config/`, and `logs/` resolve correctly.

## Clear old evidence and event logs

First close the camera window with **Esc**. Then run:

```bash
bash reset_ibvap_logs.sh
```

Type `YES` when prompted. This deletes only these generated records:

- `logs/intrusion_events.csv`
- `logs/intrusion_events_tracked.csv`
- `logs/intrusion_events_sessions.csv`
- Files directly inside `logs/evidence/`

On the next launch, the application recreates the CSV files with their headers. The script does **not** delete `config/restricted_zone.txt`, either ONNX model, the current source, or unrelated files in `logs/`.

## Before handing the project to a developer

Keep the current source, the two ONNX models, and `config/restricted_zone.txt`. Generated logs/evidence can be left empty. The training virtual environment, datasets, checkpoints, and training scripts are not required to run the already-exported ONNX models, but retain them if future retraining or model evaluation may be needed. Avoid deleting files by a broad wildcard such as `rm -rf *`.

## Remove superseded code/executable variants (optional)

After confirming the current source and executable are working, run:

```bash
bash cleanup_ibvap_legacy.sh
```

Review the exact list and type `DELETE LEGACY FILES` to remove only the specifically named older IBVAP source/executable variants. The script protects the current `*_zone_editor_restored.cpp`, current zone-editor executable, models, saved zone, logs, and training assets. It does not remove arbitrary files.
