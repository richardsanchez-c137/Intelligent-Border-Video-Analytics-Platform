#!/usr/bin/env python3
"""IBVAP local HTTP bridge. Python standard library only; binds to loopback."""
from __future__ import annotations
import csv
import io
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNTIME = PROJECT_ROOT / "runtime"
LOGS = PROJECT_ROOT / "logs"
EVIDENCE = LOGS / "evidence"
ZONE_FILE = PROJECT_ROOT / "config" / "restricted_zone.txt"
DEFAULT_ZONE = {"x1": 0.60, "y1": 0.15, "x2": 0.95, "y2": 0.85}
STATE_FILE = RUNTIME / "state.json"
FRAME_FILE = RUNTIME / "frame.jpg"
CAMERA_FLAG = RUNTIME / "camera_enabled.txt"
SILENCE_FLAG = RUNTIME / "silence_alarm.flag"
ZONE_REQUEST = RUNTIME / "zone_request.txt"
ZONE_RESPONSE = RUNTIME / "zone_response.txt"
DISPOSITIONS_FILE = LOGS / "incident_dispositions.csv"
OPERATOR_EVENTS_FILE = LOGS / "operator_events.csv"
CLEANUP_HISTORY_FILE = LOGS / "cleanup_history.jsonl"
PORT = int(os.environ.get("IBVAP_BRIDGE_PORT", "8080"))
ENGINE_MAX_AGE_SECONDS = 3.0
ZONE_REQUEST_LOCK = threading.Lock()
OPERATOR_EVENTS_LOCK = threading.Lock()
CLEANUP_LOCK = threading.Lock()
PREVIEW_LOCK = threading.Lock()
CLEANUP_PREVIEWS: dict[str, dict] = {}

RUNTIME.mkdir(parents=True, exist_ok=True)
LOGS.mkdir(parents=True, exist_ok=True)
if not CAMERA_FLAG.exists():
    CAMERA_FLAG.write_text("1\n", encoding="utf-8")


def atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8", newline="")
    os.replace(tmp, path)


def read_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def engine_connected() -> bool:
    try:
        return STATE_FILE.exists() and (time.time() - STATE_FILE.stat().st_mtime) <= ENGINE_MAX_AGE_SECONDS
    except OSError:
        return False


def read_zone() -> dict:
    try:
        parts = ZONE_FILE.read_text(encoding="utf-8").split()
        if len(parts) >= 4:
            vals = [float(v) for v in parts[:4]]
            zone = dict(zip(("x1", "y1", "x2", "y2"), vals))
            if valid_zone(zone):
                return zone
    except (OSError, ValueError):
        pass
    state = read_state()
    zone = state.get("zone")
    return zone if isinstance(zone, dict) and valid_zone(zone) else dict(DEFAULT_ZONE)


def valid_zone(z: dict) -> bool:
    try:
        x1, y1, x2, y2 = (float(z[k]) for k in ("x1", "y1", "x2", "y2"))
        return (all(map(lambda v: 0.0 <= v <= 1.0, (x1, y1, x2, y2)))
                and x2 - x1 >= 0.02 and y2 - y1 >= 0.02)
    except (KeyError, TypeError, ValueError):
        return False


def disposition_map() -> dict[str, dict]:
    result = {}
    try:
        with DISPOSITIONS_FILE.open("r", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("id"):
                    result[row["id"]] = {"status": row.get("status") or "Unacknowledged",
                                         "operatorNotes": row.get("notes") or ""}
    except OSError:
        pass
    return result


def safe_incident_id(timestamp: str, session: str, track_id: str) -> str:
    digits = "".join(ch for ch in timestamp if ch.isdigit())
    session_short = "".join(ch for ch in session if ch.isalnum())[-12:] or "LEGACY"
    tid = "".join(ch for ch in str(track_id) if ch.isdigit()) or "0"
    return f"INC-{digits}-S{session_short}-T{tid}"


def evidence_name(timestamp: str, track_id: str) -> str:
    file_ts = timestamp.replace(":", "-").replace(" ", "_")
    return f"intrusion_{file_ts}_track_{track_id}.jpg"


def capture_operator_evidence(incident_id: str) -> str:
    """Save the current camera frame as an evidence snapshot for a new operator event."""
    if not FRAME_FILE.is_file():
        return ""
    try:
        image_bytes = FRAME_FILE.read_bytes()
        # Basic JPEG signature check avoids recording a temporary/invalid file as evidence.
        if len(image_bytes) < 4 or not image_bytes.startswith(b"\xff\xd8") or not image_bytes.endswith(b"\xff\xd9"):
            return ""
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        filename = f"operator_{incident_id}.jpg"
        target = EVIDENCE / filename
        temp = target.with_suffix(".jpg.tmp")
        temp.write_bytes(image_bytes)
        os.replace(temp, target)
        return filename
    except OSError:
        return ""


def append_operator_event(event_type: str, notes: str, alarm_state: str = "SILENCED") -> dict:
    now = datetime.now().astimezone()
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
    incident_id = "INC-" + now.strftime("%Y%m%d%H%M%S%f") + "-OPERATOR"
    evidence_filename = capture_operator_evidence(incident_id)
    row = {"id": incident_id, "timestamp": timestamp, "event": event_type,
           "object": "System", "track_id": "", "confidence": "", "session_id": "OPERATOR_ACTION",
           "severity": "INFO", "status": "Resolved", "notes": notes,
           "alarm_state": alarm_state}
    with OPERATOR_EVENTS_LOCK:
        exists = OPERATOR_EVENTS_FILE.exists() and OPERATOR_EVENTS_FILE.stat().st_size > 0
        with OPERATOR_EVENTS_FILE.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["id", "timestamp", "event", "object", "track_id", "confidence", "session_id", "severity", "status", "notes", "alarm_state"])
            if not exists:
                writer.writeheader()
            writer.writerow(row)
    row["cameraId"] = "CAM-01 (Local webcam)"
    row["eventType"] = row["event"]
    row["isIntrusion"] = False
    row["objectClass"] = "System"
    row["trackId"] = None
    row["confidence"] = None
    row["sessionId"] = row["session_id"]
    row["alarmState"] = alarm_state
    row["evidenceAvailable"] = bool(evidence_filename)
    row["evidenceSnapshot"] = (f"http://127.0.0.1:{PORT}/api/evidence/{evidence_filename}"
                               if evidence_filename else "")
    row["operatorNotes"] = notes
    return row


def load_incidents() -> list[dict]:
    source = LOGS / "intrusion_events_sessions.csv"
    if not source.exists():
        source = LOGS / "intrusion_events_tracked.csv"
    if not source.exists():
        source = LOGS / "intrusion_events.csv"
    rows: list[dict] = []
    dispositions = disposition_map()
    try:
        with source.open("r", newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for raw in reader:
                timestamp = (raw.get("timestamp") or "").strip()
                event_type = (raw.get("event") or "").strip() or "UNKNOWN_EVENT"
                object_class = (raw.get("object") or "Person").strip()
                track_id = (raw.get("track_id") or "").strip()
                confidence_text = (raw.get("confidence") or "").strip()
                session_id = (raw.get("session_id") or "LEGACY").strip()
                try:
                    confidence = float(confidence_text) if confidence_text else None
                except ValueError:
                    confidence = None
                incident_id = safe_incident_id(timestamp, session_id, track_id)
                filename = evidence_name(timestamp, track_id) if track_id else ""
                evidence_path = EVIDENCE / filename if filename else None
                evidence_available = bool(evidence_path and evidence_path.is_file())
                saved = dispositions.get(incident_id, {})
                rows.append({
                    "id": incident_id,
                    "timestamp": timestamp,
                    "cameraId": "CAM-01 (Local webcam)",
                    "eventType": event_type,
                    "severity": "WARNING" if confidence is not None and confidence < 0.50 else "CRITICAL",
                    "isIntrusion": "INTRUSION" in event_type,
                    "objectClass": object_class,
                    "trackId": int(track_id) if track_id.isdigit() else None,
                    "confidence": confidence,
                    "sessionId": session_id,
                    "alarmState": "Triggered",
                    "evidenceAvailable": evidence_available,
                    "evidenceSnapshot": f"http://127.0.0.1:{PORT}/api/evidence/{filename}" if evidence_available else "",
                    "status": saved.get("status", "Unacknowledged"),
                    "operatorNotes": saved.get("operatorNotes", "")
                })
    except (OSError, csv.Error):
        return []
    # Append explicit operator actions, such as silencing the audible alarm.
    try:
        if OPERATOR_EVENTS_FILE.exists():
            with OPERATOR_EVENTS_FILE.open("r", newline="", encoding="utf-8-sig") as f:
                for raw in csv.DictReader(f):
                    event_id = (raw.get("id") or "").strip()
                    if not event_id:
                        continue
                    operator_evidence_name = f"operator_{event_id}.jpg"
                    operator_evidence_path = EVIDENCE / operator_evidence_name
                    operator_evidence_available = operator_evidence_path.is_file()
                    rows.append({
                        "id": event_id,
                        "timestamp": (raw.get("timestamp") or "").strip(),
                        "cameraId": "CAM-01 (Local webcam)",
                        "eventType": (raw.get("event") or "ALARM_SILENCED").strip(),
                        "severity": (raw.get("severity") or "INFO").strip(),
                        "isIntrusion": False,
                        "objectClass": (raw.get("object") or "System").strip(),
                        "trackId": None,
                        "confidence": None,
                        "sessionId": (raw.get("session_id") or "OPERATOR_ACTION").strip(),
                        "alarmState": (raw.get("alarm_state") or "SILENCED").strip(),
                        "evidenceAvailable": operator_evidence_available,
                        "evidenceSnapshot": (f"http://127.0.0.1:{PORT}/api/evidence/{operator_evidence_name}"
                                             if operator_evidence_available else ""),
                        "status": (raw.get("status") or "Resolved").strip(),
                        "operatorNotes": (raw.get("notes") or "").strip()
                    })
    except (OSError, csv.Error):
        pass
    rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    # Refresh status/notes from the operator disposition file.
    dispositions = disposition_map()
    for row in rows:
        row.update(dispositions.get(row["id"], {}))
    return rows


def filter_incidents(rows: list[dict], query: dict) -> list[dict]:
    search = (query.get("search", [""])[0] or "").lower().strip()
    event_type = (query.get("eventType", query.get("event_type", ["ALL"]))[0] or "ALL")
    severity = (query.get("severity", ["ALL"])[0] or "ALL")
    camera = (query.get("camera", ["ALL"])[0] or "ALL")
    start_date = (query.get("startDate", [""])[0] or "")
    end_date = (query.get("endDate", [""])[0] or "")
    result = []
    for item in rows:
        if search and search not in " ".join(str(item.get(k, "")) for k in ("id", "trackId", "eventType", "cameraId", "operatorNotes", "sessionId")).lower():
            continue
        if event_type != "ALL" and item.get("eventType") != event_type:
            continue
        if severity != "ALL" and item.get("severity") != severity:
            continue
        if camera != "ALL" and camera.lower() not in str(item.get("cameraId", "")).lower():
            continue
        date = str(item.get("timestamp", ""))[:10]
        if start_date and date < start_date:
            continue
        if end_date and date > end_date:
            continue
        result.append(item)
    try:
        limit = int(query.get("limit", ["1000"])[0])
        result = result[:max(1, min(limit, 5000))]
    except ValueError:
        result = result[:1000]
    return result


def save_disposition(incident_id: str, status: str, notes: str) -> dict | None:
    allowed = {"Unacknowledged", "Acknowledged", "Investigating", "Resolved"}
    if status not in allowed:
        raise ValueError("Invalid incident status")
    incidents = load_incidents()
    found = next((r for r in incidents if r["id"] == incident_id), None)
    if not found:
        return None
    existing = disposition_map()
    existing[incident_id] = {"status": status, "operatorNotes": notes[:2000]}
    DISPOSITIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DISPOSITIONS_FILE.with_suffix(".csv.tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "status", "notes"])
        writer.writeheader()
        for key, val in existing.items():
            writer.writerow({"id": key, "status": val.get("status", "Unacknowledged"), "notes": val.get("operatorNotes", "")})
    os.replace(tmp, DISPOSITIONS_FILE)
    found["status"] = status
    found["operatorNotes"] = notes[:2000]
    return found


def cleanup_scope_inventory(scopes: list[str], older_than_days: int | None) -> dict:
    allowed_scopes = {"evidence", "csv"}
    if not scopes or any(s not in allowed_scopes for s in scopes):
        raise ValueError("Allowed cleanup scopes are evidence and csv")
    cutoff = None if older_than_days is None else time.time() - max(0, older_than_days) * 86400
    entries = []
    if "evidence" in scopes and EVIDENCE.exists():
        for path in EVIDENCE.iterdir():
            if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            stat = path.stat()
            if cutoff is not None and stat.st_mtime > cutoff:
                continue
            entries.append({"scope": "evidence", "name": path.name, "size": stat.st_size,
                            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                            "modifiedNs": stat.st_mtime_ns})
    if "csv" in scopes:
        for name in ("intrusion_events.csv", "intrusion_events_tracked.csv", "intrusion_events_sessions.csv", "operator_events.csv"):
            path = LOGS / name
            if not path.is_file():
                continue
            # CSV clearing is a truncation operation preserving the first header row.
            try:
                raw = path.read_bytes()
                first_line = raw.splitlines(keepends=True)[:1]
                header = first_line[0] if first_line else b""
            except OSError:
                continue
            st = path.stat()
            if cutoff is not None and st.st_mtime > cutoff:
                continue
            entries.append({"scope": "csv", "name": name, "size": max(0, len(raw) - len(header)),
                            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                            "modifiedNs": st.st_mtime_ns,
                            "recordCount": max(0, len(raw.splitlines()) - 1)})
    return {"entries": entries, "fileCount": len(entries), "estimatedBytes": sum(x["size"] for x in entries),
            "scopes": scopes, "olderThanDays": older_than_days}


class Handler(BaseHTTPRequestHandler):
    server_version = "IBVAPLocalBridge/1.0"

    def log_message(self, fmt, *args):
        print("[IBVAP API] " + fmt % args)

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _send(self, status: int, data, content_type="application/json"):
        if isinstance(data, (dict, list)):
            body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        elif isinstance(data, str):
            body = data.encode("utf-8")
        else:
            body = data
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _body_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > 64 * 1024:
            raise ValueError("Request body too large")
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON request body must be an object")
        return value

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        connected = engine_connected()
        state = read_state() if connected else {}

        if path == "/api/health":
            return self._send(200, {"ok": True, "bridge": "online", "engineConnected": connected,
                                    "cameraState": state.get("cameraState", "DISCONNECTED")})
        if path == "/api/camera/status":
            cam = state.get("cameraState", "DISCONNECTED") if connected else "DISCONNECTED"
            return self._send(200, {"state": cam, "isDemo": False,
                                    "modeLabel": "LIVE BACKEND CONNECTED" if connected else "BACKEND OFFLINE / DISCONNECTED",
                                    "fps": state.get("fps", 0), "yolo_ms": state.get("yoloMs", 0),
                                    "verifier_ms": state.get("verifierMs", 0)})
        if path == "/api/telemetry":
            if not connected:
                return self._send(503, {"error": "C++ engine is not publishing runtime/state.json. Start the integrated C++ executable from the project root."})
            state["isDemo"] = False
            state["modeLabel"] = "LIVE BACKEND CONNECTED"
            return self._send(200, state)
        if path == "/api/frame.jpg":
            if not connected or not FRAME_FILE.is_file():
                return self._send(503, {"error": "Live frame is not available yet."})
            try:
                return self._send(200, FRAME_FILE.read_bytes(), "image/jpeg")
            except OSError as exc:
                return self._send(503, {"error": str(exc)})
        if path == "/api/alarm/status":
            alarm = state.get("alarm", {}) if connected else {"state": "NORMAL", "activeTrackId": None}
            return self._send(200, {"state": alarm.get("state", "NORMAL"),
                                    "active_track_id": alarm.get("activeTrackId")})
        if path == "/api/zone":
            return self._send(200, read_zone())
        if path == "/api/logs":
            return self._send(200, filter_incidents(load_incidents(), query))
        if path == "/api/logs/export":
            items = filter_incidents(load_incidents(), query)
            output = io.StringIO(newline="")
            cols = ["id", "timestamp", "cameraId", "eventType", "severity", "isIntrusion", "objectClass", "trackId", "confidence", "sessionId", "alarmState", "evidenceAvailable", "status", "operatorNotes"]
            writer = csv.DictWriter(output, fieldnames=cols, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(items)
            return self._send(200, output.getvalue(), "text/csv; charset=utf-8")
        if path.startswith("/api/evidence/"):
            filename = unquote(path.rsplit("/", 1)[-1])
            if (not filename or Path(filename).name != filename
                    or not filename.startswith(("intrusion_", "operator_"))):
                return self._send(400, {"error": "Invalid evidence filename"})
            file_path = EVIDENCE / filename
            if not file_path.is_file():
                return self._send(404, {"error": "Evidence not found"})
            return self._send(200, file_path.read_bytes(), "image/jpeg")
        if path.startswith("/api/logs/"):
            incident_id = unquote(path.rsplit("/", 1)[-1])
            incident = next((r for r in load_incidents() if r["id"] == incident_id), None)
            if incident is None:
                return self._send(404, {"error": "Incident not found"})
            return self._send(200, incident)
        if path == "/api/cleanup/summary":
            evidence_items = list(EVIDENCE.glob("*.jpg")) if EVIDENCE.exists() else []
            csv_items = [LOGS / n for n in ("intrusion_events.csv", "intrusion_events_tracked.csv", "intrusion_events_sessions.csv", "operator_events.csv") if (LOGS / n).exists()]
            csv_bytes = sum(max(0, p.stat().st_size - len(p.read_bytes().splitlines(keepends=True)[:1][0] if p.stat().st_size else b"")) for p in csv_items)
            return self._send(200, {"evidenceFiles": len(evidence_items), "incidentRecords": len(load_incidents()),
                                    "evidenceBytes": sum(p.stat().st_size for p in evidence_items),
                                    "csvRecordBytes": csv_bytes, "mode": "CONNECTED" if connected else "ENGINE_OFFLINE"})
        if path == "/api/cleanup/history":
            entries = []
            try:
                for line in CLEANUP_HISTORY_FILE.read_text(encoding="utf-8").splitlines()[-100:]:
                    try: entries.append(json.loads(line))
                    except json.JSONDecodeError: pass
            except OSError:
                pass
            return self._send(200, entries[::-1])
        return self._send(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/camera/toggle":
                if not engine_connected():
                    return self._send(503, {"success": False, "message": "C++ engine is offline."})
                try:
                    current_enabled = CAMERA_FLAG.read_text(encoding="utf-8").strip() != "0"
                except OSError:
                    current_enabled = True
                desired = "OFF" if current_enabled else "ON"
                atomic_write(CAMERA_FLAG, "0\n" if desired == "OFF" else "1\n")
                return self._send(200, {"state": desired, "isDemo": False, "modeLabel": "LIVE BACKEND CONNECTED"})
            if path == "/api/camera/state":
                if not engine_connected():
                    return self._send(503, {"success": False, "message": "C++ engine is offline."})
                body = self._body_json()
                desired = str(body.get("state", "")).upper()
                if desired not in {"ON", "OFF"}:
                    return self._send(400, {"success": False, "error": "state must be ON or OFF"})
                atomic_write(CAMERA_FLAG, "1\n" if desired == "ON" else "0\n")
                return self._send(200, {"state": desired, "success": True, "modeLabel": "LIVE BACKEND CONNECTED"})
            if path == "/api/alarm/silence":
                if not engine_connected():
                    return self._send(503, {"success": False, "message": "C++ engine is offline."})
                SILENCE_FLAG.write_text("silence\n", encoding="utf-8")
                deadline = time.time() + 1.25
                confirmed = False
                while time.time() < deadline:
                    s = read_state()
                    if engine_connected() and s.get("alarm", {}).get("state") == "SILENCED":
                        confirmed = True
                        break
                    time.sleep(0.04)
                append_operator_event("ALARM_SILENCED", "Alarm silenced from the IBVAP web console.")
                if confirmed:
                    return self._send(200, {"success": True, "state": "SILENCED"})
                return self._send(200, {"success": True, "state": "SILENCED", "message": "Silence command was queued; state will refresh shortly."})
            if path == "/api/zone":
                z = self._body_json()
                if not valid_zone(z):
                    return self._send(400, {"success": False, "error": "Invalid zone. Coordinates must be normalized with minimum 2% width and height."})
                if not engine_connected():
                    return self._send(503, {"success": False, "error": "C++ engine is offline; zone cannot be applied to the active process."})
                with ZONE_REQUEST_LOCK:
                    if ZONE_REQUEST.exists():
                        return self._send(409, {"success": False, "error": "Another zone update is pending."})
                    request_id = uuid.uuid4().hex[:16]
                    atomic_write(ZONE_REQUEST, f"{request_id} {float(z['x1']):.6f} {float(z['y1']):.6f} {float(z['x2']):.6f} {float(z['y2']):.6f}\n")
                    deadline = time.time() + 2.0
                    response_line = ""
                    while time.time() < deadline:
                        try:
                            line = ZONE_RESPONSE.read_text(encoding="utf-8").strip()
                            if line.startswith(request_id + " "):
                                response_line = line
                                break
                        except OSError:
                            pass
                        time.sleep(0.04)
                    if not response_line:
                        return self._send(504, {"success": False, "error": "Zone request timed out. Check that the C++ main loop is running."})
                    bits = response_line.split()
                    if len(bits) >= 2 and bits[1] == "OK":
                        return self._send(200, {"success": True, "zone": read_zone()})
                    return self._send(500, {"success": False, "error": "The C++ application could not save/apply the zone."})
            if path.startswith("/api/logs/") and path.endswith("/ack"):
                incident_id = unquote(path[len("/api/logs/"):-len("/ack")].strip("/"))
                body = self._body_json()
                item = save_disposition(incident_id, str(body.get("status", "Acknowledged")), str(body.get("notes", "")))
                if item is None:
                    return self._send(404, {"error": "Incident not found"})
                return self._send(200, {"success": True, "incident": item})
            if path == "/api/cleanup/preview":
                body = self._body_json()
                scopes = body.get("scopes", [])
                older = body.get("olderThanDays")
                if older is not None:
                    older = int(older)
                    if older < 0 or older > 36500: raise ValueError("olderThanDays is out of range")
                inventory = cleanup_scope_inventory(scopes, older)
                preview_id = uuid.uuid4().hex
                record = {**inventory, "previewId": preview_id, "expiresAt": time.time() + 120}
                with PREVIEW_LOCK:
                    CLEANUP_PREVIEWS[preview_id] = record
                return self._send(200, record)
            if path == "/api/cleanup/execute":
                body = self._body_json()
                preview_id = str(body.get("previewId", ""))
                if body.get("confirm") is not True:
                    return self._send(400, {"success": False, "error": "Explicit confirmation is required."})
                with CLEANUP_LOCK:
                    with PREVIEW_LOCK:
                        preview = CLEANUP_PREVIEWS.pop(preview_id, None)
                    if not preview or preview.get("expiresAt", 0) < time.time():
                        return self._send(410, {"success": False, "error": "Cleanup preview is missing or expired. Preview again."})
                    # Recompute the eligible set; do not trust stale client paths.
                    current = cleanup_scope_inventory(preview["scopes"], preview.get("olderThanDays"))
                    def entry_signature(entry):
                        return (entry.get("scope"), entry.get("name"), entry.get("size"), entry.get("modifiedNs"), entry.get("recordCount"))
                    expected = {entry_signature(e) for e in preview["entries"]}
                    now_set = {entry_signature(e) for e in current["entries"]}
                    if expected != now_set:
                        return self._send(409, {"success": False, "error": "Eligible files changed after preview. Preview again."})
                    deleted_files = 0; truncated_csv = 0; actual_bytes = 0; errors = []
                    for entry in current["entries"]:
                        path_obj = (EVIDENCE / entry["name"]) if entry["scope"] == "evidence" else (LOGS / entry["name"])
                        try:
                            if entry["scope"] == "evidence":
                                size = path_obj.stat().st_size
                                path_obj.unlink()
                                deleted_files += 1; actual_bytes += size
                            elif entry["scope"] == "csv":
                                raw = path_obj.read_bytes()
                                lines = raw.splitlines(keepends=True)
                                header = lines[0] if lines else b""
                                removed = max(0, len(raw) - len(header))
                                tmp = path_obj.with_suffix(path_obj.suffix + ".tmp")
                                tmp.write_bytes(header)
                                os.replace(tmp, path_obj)
                                truncated_csv += 1; actual_bytes += removed
                        except OSError as exc:
                            errors.append({"file": entry["name"], "error": str(exc)})
                    history = {"timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
                               "scopes": preview["scopes"], "filesDeleted": deleted_files,
                               "csvFilesCleared": truncated_csv, "bytesReclaimed": actual_bytes,
                               "errors": errors, "success": not errors}
                    with CLEANUP_HISTORY_FILE.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(history, ensure_ascii=False) + "\n")
                    return self._send(200 if not errors else 207, {"success": not errors, **history})
            return self._send(404, {"error": "Not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            return self._send(400, {"error": str(exc)})
        except OSError as exc:
            return self._send(500, {"error": str(exc)})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"IBVAP local bridge listening at http://127.0.0.1:{PORT}")
    print(f"Project root: {PROJECT_ROOT}")
    print("This server only binds to loopback. Press Ctrl+C to stop.")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nStopping IBVAP bridge...")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
