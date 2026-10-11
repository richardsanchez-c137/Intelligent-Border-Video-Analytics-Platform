#!/usr/bin/env bash
set -euo pipefail

# Removes generated incident CSV logs and evidence images only.
# Keeps the current source, ONNX models, and saved restricted-zone configuration.
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if pgrep -f 'ibvap_webcam_yolo26_zone_editor.exe' >/dev/null 2>&1; then
  echo "ERROR: IBVAP appears to be running. Close the camera window first, then retry." >&2
  exit 1
fi

read -r -p "Delete generated intrusion CSV logs and all files in logs/evidence? Type YES to confirm: " answer
if [[ "$answer" != "YES" ]]; then
  echo "Cancelled; nothing was deleted."
  exit 0
fi

mkdir -p logs/evidence
rm -f -- logs/intrusion_events.csv logs/intrusion_events_tracked.csv logs/intrusion_events_sessions.csv
find logs/evidence -mindepth 1 -maxdepth 1 -type f -delete
# Remove nested subdirectories under evidence only if empty; don't touch other log contents.
find logs/evidence -mindepth 1 -type d -empty -delete

echo "Generated incident logs and evidence images cleared."
echo "The application will recreate the CSV headers on its next launch."
echo "Saved zone config remains unchanged: config/restricted_zone.txt"
