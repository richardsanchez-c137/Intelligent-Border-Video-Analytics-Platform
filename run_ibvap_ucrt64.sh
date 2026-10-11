#!/usr/bin/env bash
set -euo pipefail

# Build and launch IBVAP from the project root using the MSYS2 UCRT64 environment.
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

SOURCE="main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_restored.cpp"
EXECUTABLE="ibvap_webcam_yolo26_zone_editor.exe"
YOLO_MODEL="models/yolo26s.onnx"
VERIFIER_MODEL="models/helmet_verifier_v3.onnx"

for item in "$SOURCE" "$YOLO_MODEL" "$VERIFIER_MODEL"; do
  if [[ ! -f "$item" ]]; then
    echo "ERROR: Required file not found: $item" >&2
    echo "Run this script from the folder containing the current source and models." >&2
    exit 1
  fi
done

if ! command -v g++ >/dev/null 2>&1; then
  echo "ERROR: g++ not found. Open the MSYS2 UCRT64 terminal." >&2
  exit 1
fi
if ! command -v pkg-config >/dev/null 2>&1 || ! pkg-config --exists opencv5; then
  echo "ERROR: OpenCV package 'opencv5' not found in this MSYS2 environment." >&2
  echo "Check that the OpenCV UCRT64 package and pkg-config are installed." >&2
  exit 1
fi

echo "Building IBVAP..."
g++ -std=c++17 -pthread "$SOURCE" -o "$EXECUTABLE" $(pkg-config --cflags --libs opencv5)

echo "Build succeeded. Starting IBVAP..."
exec "./$EXECUTABLE"
