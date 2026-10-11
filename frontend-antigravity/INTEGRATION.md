# IBVAP frontend/backend integration contract

The provided backend adapter uses REST polling rather than WebSockets. The browser (served from the project-root `frontend-antigravity/` directory) calls `http://127.0.0.1:8080/api`; the local bridge communicates with the C++ process through files under the project root's `runtime/` directory.

## Runtime IPC files

- `runtime/state.json`: latest camera state, telemetry, alarm state, restricted zone and normalized detections.
- `runtime/frame.jpg`: most recent raw webcam frame, refreshed at approximately 10 fps.
- `runtime/camera_enabled.txt`: `1` to enable model inference, `0` to pause inference.
- `runtime/silence_alarm.flag`: one-shot command consumed by the C++ main loop.
- `runtime/zone_request.txt` and `runtime/zone_response.txt`: request/acknowledgement protocol for active zone updates.

The bridge does not execute shell commands and does not accept arbitrary filesystem paths from browser requests.

## REST API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Bridge/engine availability |
| GET | `/api/camera/status` | ON/OFF/DISCONNECTED and telemetry summary |
| POST | `/api/camera/toggle` | Toggle model processing |
| POST | `/api/camera/state` | Set `{"state":"ON"}` or `{"state":"OFF"}` |
| GET | `/api/telemetry` | Latest detections, zone, alarm and performance values |
| GET | `/api/frame.jpg` | Latest raw webcam frame (JPEG) |
| GET | `/api/alarm/status` | Alarm state |
| POST | `/api/alarm/silence` | Ask the C++ loop to silence the alarm |
| GET | `/api/zone` | Read normalized zone coordinates |
| POST | `/api/zone` | Validate, apply, and persist a zone update |
| GET | `/api/logs` | Parse available session/tracked/basic CSV event records |
| GET | `/api/logs/{id}` | Incident details |
| POST | `/api/logs/{id}/ack` | Persist operator disposition/notes separately from detector CSVs |
| GET | `/api/logs/export` | Export filtered incident records as CSV |
| GET | `/api/evidence/{filename}` | Serve an approved evidence image |
| GET | `/api/cleanup/summary` | Counts/sizes for approved log-cleanup scopes |
| POST | `/api/cleanup/preview` | Preview `{"scopes":["evidence","csv"],"olderThanDays":null}` |
| POST | `/api/cleanup/execute` | Execute `{"previewId":"...","confirm":true}` |
| GET | `/api/cleanup/history` | Recent cleanup audit records |

## Detection payload format

`GET /api/telemetry` returns data such as:

```json
{
  "cameraId": "CAM-01 (Local webcam)",
  "cameraState": "ON",
  "fps": 18.7,
  "yoloMs": 26.2,
  "verifierMs": 3.4,
  "zone": {"x1":0.6,"y1":0.15,"x2":0.95,"y2":0.85},
  "alarm": {"state":"NORMAL","activeTrackId":null},
  "detections": [
    {"id":1,"trackId":1,"label":"Person","classId":0,"confidence":0.91,
     "x1":0.1,"y1":0.2,"x2":0.3,"y2":0.9,"isIntrusion":false,"overlapRatio":0.0}
  ]
}
```

Bounding boxes and zone coordinates are normalized to `[0,1]` against the source frame dimensions.

## Frontend mode

`frontend-antigravity/ibvap-api.js` defaults to `mode: 'demo'`. Change it to `mode: 'backend'` only after both the integrated C++ executable and bridge server are running. The browser will poll telemetry and image URLs; it does not connect to a WebSocket endpoint.

## Current limitations

- The integration source is a generated patch based on the uploaded source and needs to be compiled and tested under the user's MSYS2 UCRT64/OpenCV environment.
- Camera OFF pauses detection while keeping the capture handle open.
- Cleanup endpoints are implemented by the local bridge, but the supplied frontend has no Log Cleaning panel yet.
- The API binds only to loopback. It is not a multi-user or network deployment server.
