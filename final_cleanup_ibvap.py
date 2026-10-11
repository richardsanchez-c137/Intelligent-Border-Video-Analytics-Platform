#!/usr/bin/env python3
"""Safely tidy the IBVAP project root.

Default is DRY RUN. Use --apply to move known helper scripts into tools/,
move clearly stray root items and the old archive outside the project root,
and keep the active detector, fallback build, reports, datasets, logs, models,
training environment, runs, videos, and weights untouched.
"""
from __future__ import annotations

import argparse
import datetime as dt
import shutil
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply the planned moves. Default is dry-run only.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    parent = root.parent
    legacy_dest = parent / f"IBVAP_legacy_archive_{stamp}"
    quarantine_dest = parent / f"IBVAP_cleanup_quarantine_{stamp}"
    tools_dir = root / "tools"
    mode = "APPLY" if args.apply else "DRY RUN"

    # Current app and fallback source/executables intentionally remain in root.
    keep_root = {
        "main_zone_ai_webcam_yolo26_perf_verifier.cpp",
        "ibvap_webcam_yolo26_verifier.exe",
        "main_zone_ai_webcam_yolo26_perf.cpp",
        "ibvap_webcam_yolo26_perf.exe",
        "incident_report.cpp",
        "incident_report.exe",
        "yolo26n-cls.pt",
        "final_cleanup_ibvap.py",
    }

    # Helper utilities stay available, but move out of the application root.
    helper_names = {
        "capture_finetune_frames.cpp",
        "capture_finetune_frames.exe",
        "cleanup_legacy_ibvap.sh",
        "crop_classifier_samples.cpp",
        "crop_classifier_samples.exe",
        "crop_more_helmet_negatives.py",
        "evaluate_classifier_v2_fixed.py",
        "evaluate_classifier_v2.py",
        "evaluate_classifier_v3.py",
        "evaluate_verifier_threshold.py",
        "prepare_classifier_dataset.py",
        "prepare_classifier_dataset_v2.py",
        "prepare_classifier_dataset_v3.py",
        "verify_classifier_onnx.py",
        "evaluate_classifier_v2_fixed.py",
        "evaluate_classifier_v2.py",
        "evaluate_classifier_v3.py",
    }

    # Items visible in the screenshots that look like accidental root clutter.
    # They are quarantined, not permanently deleted, so recovery remains possible.
    stray_names = {
        "0.1.45", "0.8.5", "0.9.0", "0.20.0", "1.8.0", "1.12.0",
        "1.13.3", "1.23.0", "2.2.2", "2.5.1", "2.23.0", "3.3.0",
        "4.7.0", "4.10.0", "5.3.0", "5.3.1", "5.8.0", "7.1.2",
        "12.0.0", "77.0.3", "dir", "py", "start", "torch",
        "ultralytics", "legacy",
    }

    print(f"IBVAP final cleanup — {mode}")
    print(f"Project root: {root}")
    print("\nPRESERVE (not modified):")
    for name in [
        ".venv-train", "datasets", "logs", "models", "runs", "videos", "weights",
        "main_zone_ai_webcam_yolo26_perf_verifier.cpp", "ibvap_webcam_yolo26_verifier.exe",
        "main_zone_ai_webcam_yolo26_perf.cpp", "ibvap_webcam_yolo26_perf.exe",
        "incident_report.cpp", "incident_report.exe", "yolo26n-cls.pt",
    ]:
        p = root / name
        print(f"  KEEP {name}" + (" (present)" if p.exists() else " (not found; no action)"))

    plans: list[tuple[Path, Path, str]] = []

    archive_dir = root / "archive"
    if archive_dir.exists():
        plans.append((archive_dir, legacy_dest / "archive", "move old archive outside project root"))

    # Known old NanoDet model, if still present, is moved aside but not destroyed.
    old_model = root / "models" / "object_detection_nanodet_2022nov.onnx"
    if old_model.exists():
        plans.append((old_model, legacy_dest / "models" / old_model.name, "archive old NanoDet model"))

    for name in sorted(helper_names):
        src = root / name
        if src.exists():
            plans.append((src, tools_dir / name, "organize helper utility under tools/"))

    for name in sorted(stray_names):
        src = root / name
        if src.exists():
            plans.append((src, quarantine_dest / name, "quarantine likely stray root item; recoverable"))

    print("\nPLANNED MOVES:")
    if not plans:
        print("  (none for the known items in this script)")
    for src, dst, reason in plans:
        print(f"  MOVE {src.relative_to(root)} -> {dst}  [{reason}]")

    # List other loose root items that the script will deliberately leave alone.
    action_sources = {src.resolve() for src, _, _ in plans}
    print("\nOTHER ROOT-LEVEL ITEMS LEFT UNCHANGED (review if needed):")
    found_other = False
    for item in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if item.resolve() in action_sources or item.name in keep_root or item.name in {
            ".venv-train", "datasets", "logs", "models", "runs", "videos", "weights", "tools"
        }:
            continue
        if item.is_dir():
            # archive already planned above; should not be shown as unchanged.
            if item.name == "archive" and item.resolve() in action_sources:
                continue
            print(f"  {item.name}/")
            found_other = True
        else:
            print(f"  {item.name}")
            found_other = True
    if not found_other:
        print("  (none)")

    print("\nMODEL FILES under models/ (all preserved for now):")
    model_dir = root / "models"
    if model_dir.exists():
        for p in sorted(model_dir.rglob("*")):
            if p.is_file():
                print(f"  {p.relative_to(root)} ({p.stat().st_size:,} bytes)")
    else:
        print("  models/ not found")

    print("\nFILES under weights/ (preserved because their purpose is not confirmed):")
    weights_dir = root / "weights"
    if weights_dir.exists():
        for p in sorted(weights_dir.rglob("*")):
            if p.is_file():
                print(f"  {p.relative_to(root)} ({p.stat().st_size:,} bytes)")
    else:
        print("  weights/ not found")

    if not args.apply:
        print("\nDRY RUN ONLY — no files were changed.")
        print("Review the plan. If it looks correct, run:")
        print("  py -3.12 final_cleanup_ibvap.py --apply")
        return 0

    # Check all destinations first and avoid overwriting files.
    for src, dst, _ in plans:
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        final_dst = dst
        if final_dst.exists():
            suffix = 1
            while True:
                candidate = dst.with_name(f"{dst.stem}_{suffix}{dst.suffix}")
                if not candidate.exists():
                    final_dst = candidate
                    break
                suffix += 1
        shutil.move(str(src), str(final_dst))
        print(f"MOVED: {src} -> {final_dst}")

    # Empty tools directory should not be left behind if no helper files existed.
    if tools_dir.exists() and not any(tools_dir.iterdir()):
        tools_dir.rmdir()

    print("\nCleanup moves complete.")
    print("No kept project directories, logs, datasets, active source files, or active executables were deleted.")
    print("Old archive and stray files were moved outside the project root, not permanently deleted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
