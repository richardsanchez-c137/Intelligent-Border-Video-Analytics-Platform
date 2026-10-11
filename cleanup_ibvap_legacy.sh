#!/usr/bin/env bash
set -euo pipefail

# Removes only explicitly named superseded IBVAP source/executable variants.
# The current *_zone_editor_restored.cpp source and current zone-editor executable are protected.
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

CURRENT_SOURCE="main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_restored.cpp"
CURRENT_EXE="ibvap_webcam_yolo26_zone_editor.exe"
for required in "$CURRENT_SOURCE" "models/yolo26s.onnx" "models/helmet_verifier_v3.onnx"; do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: Expected current runtime file missing: $required" >&2
    echo "Nothing was deleted. Run this script from the project root." >&2
    exit 1
  fi
done

legacy_files=(
  "main_zone_ai_webcam_yolo26_perf.cpp"
  "main_zone_ai_webcam_yolo26_perf_verifier.cpp"
  "main_zone_ai_webcam_yolo26_perf_verifier_alarm.cpp"
  "main_zone_ai_webcam_yolo26_perf_verifier_alarm_fast.cpp"
  "main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor.cpp"
  "main_zone_ai_webcam_yolo26_perf_verifier_alarm_zone_editor_fixed.cpp"
  "ibvap_webcam_yolo26_perf.exe"
  "ibvap_webcam_yolo26_verifier.exe"
  "ibvap_webcam_yolo26_verifier_alarm.exe"
  "ibvap_webcam_yolo26_verifier_alarm_fast.exe"
)

found=()
for item in "${legacy_files[@]}"; do
  [[ -e "$item" ]] && found+=("$item")
done

if (( ${#found[@]} == 0 )); then
  echo "No listed legacy source/executable files found. No changes made."
  exit 0
fi

echo "The following explicitly listed older versions will be deleted:"
printf '  %s\n' "${found[@]}"
echo
echo "Protected: $CURRENT_SOURCE, $CURRENT_EXE, models/, config/, logs/, and training assets."
read -r -p 'Type DELETE LEGACY FILES to proceed: ' answer
if [[ "$answer" != "DELETE LEGACY FILES" ]]; then
  echo "Cancelled; nothing was deleted."
  exit 0
fi
rm -f -- "${found[@]}"
echo "Listed legacy variants removed. Current source, models, and saved zone were not touched."
