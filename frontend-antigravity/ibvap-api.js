/**
 * IBVAP API Interface & Mock Service Layer
 * Intelligent Border Video Analytics Platform (IBVAP)
 * 
 * Ready for integration with the C++ OpenCV/YOLO26s backend.
 * Provides full mock simulation for standalone demonstration,
 * with clearly isolated API contracts for live backend communication.
 */

(function (window) {
    'use strict';

    // Application Configuration
    const CONFIG = {
        // 'demo' uses the realistic in-memory & localStorage mock service.
        // 'backend' connects to the real C++ IBVAP HTTP/WebSocket server.
        mode: 'backend', // Switch to 'backend' only after starting the integrated C++ app and local bridge.
        apiBaseUrl: 'http://127.0.0.1:8080/api',
        pollIntervalMs: 180, // Local REST polling; image endpoint is refreshed separately
    };

    // Storage key for persisting zone & logs in demo mode
    const STORAGE_KEY_ZONE = 'ibvap_restricted_zone_v1';
    const STORAGE_KEY_LOGS = 'ibvap_history_logs_v1';

    // Default zone matching config/restricted_zone.txt normalized coordinates (x1, y1, x2, y2)
    const DEFAULT_ZONE = {
        x1: 0.60,
        y1: 0.15,
        x2: 0.95,
        y2: 0.85
    };

    /**
     * Generate synthetic evidence snapshot data URL for demo incidents.
     * Generates a high-contrast dark border surveillance frame with bounding boxes.
     */
    function generateSyntheticEvidenceSnapshot(incident) {
        const width = 640;
        const height = 400;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Background: surveillance night/dusk scene
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#090d14');
        grad.addColorStop(0.5, '#121824');
        grad.addColorStop(1, '#0b0f19');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // Security fence grid lines
        ctx.strokeStyle = 'rgba(70, 90, 120, 0.25)';
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += 30) {
            ctx.beginPath();
            ctx.moveTo(x, 100);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 100; y < height; y += 25) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw restricted zone if available
        const z = incident.zoneSnapshot || DEFAULT_ZONE;
        const zx = z.x1 * width;
        const zy = z.y1 * height;
        const zw = (z.x2 - z.x1) * width;
        const zh = (z.y2 - z.y1) * height;

        ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.fillRect(zx, zy, zw, zh);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(zx, zy, zw, zh);
        ctx.setLineDash([]);

        // Label restricted zone
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('RESTRICTED ZONE (SECTOR 4)', zx + 8, zy + 16);

        // Draw intruder detection box
        if (incident.isIntrusion) {
            const bx = zx + zw * 0.25;
            const by = zy + zh * 0.20;
            const bw = zw * 0.50;
            const bh = zh * 0.65;

            ctx.strokeStyle = '#ff2a2a';
            ctx.lineWidth = 2.5;
            ctx.strokeRect(bx, by, bw, bh);

            ctx.fillStyle = 'rgba(255, 42, 42, 0.2)';
            ctx.fillRect(bx, by, bw, bh);

            // Intruder tag
            ctx.fillStyle = '#ff2a2a';
            ctx.fillRect(bx, by - 18, 180, 18);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px monospace';
            ctx.fillText(`INTRUSION Track #${incident.trackId || 5} (${Math.round((incident.confidence || 0.85) * 100)}%)`, bx + 4, by - 5);
        }

        // HUD Watermark
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, width, 24);
        ctx.fillStyle = '#00ffcc';
        ctx.font = '11px monospace';
        ctx.fillText(`IBVAP EVIDENCE RECORD [DEMO] | ${incident.cameraId} | ${incident.timestamp}`, 10, 16);

        ctx.fillStyle = '#f59e0b';
        ctx.font = '10px monospace';
        ctx.fillText(`ID: ${incident.id} | Track: ${incident.trackId || 'N/A'} | Conf: ${incident.confidence || '0.90'}`, width - 260, 16);

        return canvas.toDataURL('image/jpeg', 0.85);
    }

    /**
     * Seed initial mock incidents modeled directly on real C++ IBVAP log files:
     * logs/intrusion_events.csv, logs/intrusion_events_tracked.csv, and logs/intrusion_events_sessions.csv
     */
    function seedMockHistoryLogs() {
        const baseTimestamp = '2026-10-11 ';
        const seeds = [
            {
                id: 'INC-20261011-090938',
                timestamp: baseTimestamp + '09:09:38',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 5,
                confidence: 0.76,
                sessionId: 'SESSION_20261011_090904_646358',
                alarmState: 'Triggered & Silenced',
                evidenceAvailable: true,
                status: 'Resolved',
                operatorNotes: 'Verified border personnel responded; perimeter secure.'
            },
            {
                id: 'INC-20261011-091759',
                timestamp: baseTimestamp + '09:17:59',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 1,
                confidence: 0.81,
                sessionId: 'SESSION_20261011_091743_884649',
                alarmState: 'Triggered & Silenced',
                evidenceAvailable: true,
                status: 'Acknowledged',
                operatorNotes: 'Intrusion near fence post 12.'
            },
            {
                id: 'INC-20261011-091820',
                timestamp: baseTimestamp + '09:18:20',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 4,
                confidence: 0.59,
                sessionId: 'SESSION_20261011_091743_884649',
                alarmState: 'Triggered',
                evidenceAvailable: true,
                status: 'Investigating',
                operatorNotes: 'Multiple individuals moving along ditch.'
            },
            {
                id: 'INC-20261011-091836',
                timestamp: baseTimestamp + '09:18:36',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 3,
                confidence: 0.72,
                sessionId: 'SESSION_20261011_091743_884649',
                alarmState: 'Triggered & Silenced',
                evidenceAvailable: true,
                status: 'Investigating',
                operatorNotes: 'Operator dispatched quick reaction patrol.'
            },
            {
                id: 'INC-20261011-091859',
                timestamp: baseTimestamp + '09:18:59',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'WARNING',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 5,
                confidence: 0.45,
                sessionId: 'SESSION_20261011_091743_884649',
                alarmState: 'Triggered',
                evidenceAvailable: true,
                status: 'Resolved',
                operatorNotes: 'Subject exited restricted zone towards access road.'
            },
            {
                id: 'INC-20261011-100938',
                timestamp: baseTimestamp + '10:09:38',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 1,
                confidence: 0.94,
                sessionId: 'SESSION_20261011_100916_149014',
                alarmState: 'Triggered & Silenced',
                evidenceAvailable: true,
                status: 'Resolved',
                operatorNotes: 'High-confidence detection verified by second camera.'
            },
            {
                id: 'INC-20261011-101015',
                timestamp: baseTimestamp + '10:10:15',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 2,
                confidence: 0.77,
                sessionId: 'SESSION_20261011_100916_149014',
                alarmState: 'Triggered & Silenced',
                evidenceAvailable: true,
                status: 'Acknowledged',
                operatorNotes: 'Interception completed.'
            },
            {
                id: 'INC-20261011-101046',
                timestamp: baseTimestamp + '10:10:46',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 2,
                confidence: 0.96,
                sessionId: 'SESSION_20261011_100916_149014',
                alarmState: 'Triggered',
                evidenceAvailable: true,
                status: 'Resolved',
                operatorNotes: 'Clear frame capture stored in evidence folder.'
            },
            {
                id: 'INC-20261011-110037',
                timestamp: baseTimestamp + '11:00:37',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'WARNING',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 6,
                confidence: 0.42,
                sessionId: 'SESSION_20261011_110000_123456',
                alarmState: 'Triggered',
                evidenceAvailable: true,
                status: 'Unacknowledged',
                operatorNotes: 'Low-confidence perimeter movement detected.'
            },
            {
                id: 'INC-20261011-110113',
                timestamp: baseTimestamp + '11:01:13',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: 2,
                confidence: 0.91,
                sessionId: 'SESSION_20261011_110000_123456',
                alarmState: 'Triggered & Silenced',
                evidenceAvailable: true,
                status: 'Unacknowledged',
                operatorNotes: 'Person entered restricted perimeter sector 4.'
            },
            {
                id: 'INC-20261011-110500',
                timestamp: baseTimestamp + '11:05:00',
                cameraId: 'CAM-02 (Perimeter West)',
                eventType: 'HELMET_VERIFIER_ALERT',
                severity: 'WARNING',
                isIntrusion: false,
                objectClass: 'Person',
                trackId: 9,
                confidence: 0.88,
                sessionId: 'SESSION_20261011_110000_123456',
                alarmState: 'None',
                evidenceAvailable: true,
                status: 'Unacknowledged',
                operatorNotes: 'Person detected without protective helmet/gear in safety buffer.'
            },
            {
                id: 'INC-20261011-110820',
                timestamp: baseTimestamp + '11:08:20',
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'ALARM_SILENCED',
                severity: 'INFO',
                isIntrusion: false,
                objectClass: 'System',
                trackId: null,
                confidence: 1.0,
                sessionId: 'SESSION_20261011_110000_123456',
                alarmState: 'Silenced',
                evidenceAvailable: false,
                status: 'Resolved',
                operatorNotes: 'Audible alarm silenced manually by operator (Shortcut M).'
            }
        ];

        // Generate synthetic evidence image for each seed
        seeds.forEach(s => {
            if (s.evidenceAvailable) {
                s.evidenceSnapshot = generateSyntheticEvidenceSnapshot(s);
            }
        });

        return seeds;
    }

    /**
     * Mock Service Implementation
     * Manages simulated camera state, restricted zone, alarm state, and incident history.
     */
    class IbvapMockService {
        constructor() {
            this.cameraState = 'ON'; // 'ON' | 'OFF' | 'DISCONNECTED'
            this.alarmState = 'NORMAL'; // 'NORMAL' | 'TRIGGERED' | 'SILENCED'
            this.activeTrackId = null;
            this.lastIntrusionTime = 0;

            // Load saved zone or fallback to default
            this.zone = this.loadZone();

            // Load history logs from localStorage or initialize with realistic seeds
            this.historyLogs = this.loadLogs();

            // Listeners for live events
            this.detectionListeners = new Set();
            this.alarmListeners = new Set();
            this.cameraListeners = new Set();

            // Internal simulation tick
            this.simTick = 0;
            this.simInterval = null;
            this.startSimulation();
        }

        loadZone() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY_ZONE);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (this.isValidZone(parsed)) return parsed;
                }
            } catch (e) {
                console.warn('[IBVAP Mock] Could not read zone from localStorage:', e);
            }
            return { ...DEFAULT_ZONE };
        }

        saveZone(newZone) {
            this.zone = { ...newZone };
            try {
                localStorage.setItem(STORAGE_KEY_ZONE, JSON.stringify(this.zone));
            } catch (e) {
                console.warn('[IBVAP Mock] Could not write zone to localStorage:', e);
            }
            return true;
        }

        isValidZone(z) {
            if (!z || typeof z !== 'object') return false;
            const { x1, y1, x2, y2 } = z;
            if (typeof x1 !== 'number' || typeof y1 !== 'number' ||
                typeof x2 !== 'number' || typeof y2 !== 'number') return false;
            if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1) return false;
            if ((x2 - x1) < 0.02 || (y2 - y1) < 0.02) return false;
            return true;
        }

        loadLogs() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY_LOGS);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
                }
            } catch (e) {
                console.warn('[IBVAP Mock] Could not read history from localStorage:', e);
            }
            const seeds = seedMockHistoryLogs();
            this.persistLogs(seeds);
            return seeds;
        }

        persistLogs(logs) {
            try {
                // Keep the most recent 200 incidents to prevent localStorage quota overflow
                const trimmed = logs.slice(0, 200);
                localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(trimmed));
            } catch (e) {
                console.warn('[IBVAP Mock] Could not persist logs:', e);
            }
        }

        startSimulation() {
            if (this.simInterval) clearInterval(this.simInterval);
            this.simInterval = setInterval(() => {
                this.updateSimulationStep();
            }, 100); // 10 ticks per second
        }

        updateSimulationStep() {
            if (this.cameraState !== 'ON') {
                return;
            }

            this.simTick++;

            // Create simulated detections:
            // 1. Guard / Friendly Patrol (Green box, walks back & forth across bottom)
            const guardProgress = (Math.sin(this.simTick * 0.03) + 1) / 2; // 0 to 1
            const guardBox = {
                id: 1,
                trackId: 1,
                label: 'Person (Patrol)',
                confidence: 0.94,
                classId: 0,
                x1: 0.12 + guardProgress * 0.35,
                y1: 0.65,
                x2: 0.22 + guardProgress * 0.35,
                y2: 0.92,
                isIntrusion: false,
                overlapRatio: 0.0
            };

            // 2. Intruder (Approaches and traverses through the restricted zone)
            // Cycle period ~20 seconds
            const intruderCycle = (this.simTick % 220) / 220; // 0 to 1
            let intruderBox = null;
            let hasIntrusion = false;

            if (intruderCycle < 0.85) {
                // Moving across upper sector
                const ix1 = 0.52 + intruderCycle * 0.40;
                const iy1 = 0.10 + intruderCycle * 0.40;
                const ix2 = ix1 + 0.09;
                const iy2 = iy1 + 0.25;

                const intruderCandidate = {
                    id: 2,
                    trackId: 2,
                    label: 'Person (Border Crosser)',
                    confidence: 0.91,
                    classId: 0,
                    x1: ix1,
                    y1: iy1,
                    x2: ix2,
                    y2: iy2,
                    isIntrusion: false,
                    overlapRatio: 0.0
                };

                const overlap = this.calculateOverlapRatio(intruderCandidate, this.zone);
                intruderCandidate.overlapRatio = overlap;

                if (overlap > 0.08) {
                    intruderCandidate.isIntrusion = true;
                    hasIntrusion = true;
                }
                intruderBox = intruderCandidate;
            }

            // 3. Occasional Service Vehicle (Safe zone)
            const vehicleProgress = ((this.simTick * 0.015) % 2);
            let vehicleBox = null;
            if (vehicleProgress < 1.0) {
                vehicleBox = {
                    id: 7,
                    trackId: 7,
                    label: 'Vehicle (Patrol ATV)',
                    confidence: 0.89,
                    classId: 2,
                    x1: 0.02 + vehicleProgress * 0.35,
                    y1: 0.78,
                    x2: 0.16 + vehicleProgress * 0.35,
                    y2: 0.96,
                    isIntrusion: false,
                    overlapRatio: 0.0
                };
            }

            const detections = [guardBox];
            if (intruderBox) detections.push(intruderBox);
            if (vehicleBox) detections.push(vehicleBox);

            // Handle alarm state transitions
            if (hasIntrusion) {
                if (this.alarmState === 'NORMAL') {
                    this.alarmState = 'TRIGGERED';
                    this.activeTrackId = intruderBox ? intruderBox.trackId : 2;
                    this.notifyAlarmSubscribers();
                    this.recordLiveIntrusionIncident(intruderBox);
                }
            } else {
                // When intrusion clears, reset alarm to NORMAL after 3 seconds
                if (this.alarmState !== 'NORMAL') {
                    if (!this.intrusionClearTimer) {
                        this.intrusionClearTimer = setTimeout(() => {
                            if (!this.checkAnyCurrentIntrusion(detections)) {
                                this.alarmState = 'NORMAL';
                                this.activeTrackId = null;
                                this.notifyAlarmSubscribers();
                            }
                            this.intrusionClearTimer = null;
                        }, 3000);
                    }
                }
            }

            // Emit detections payload
            const payload = {
                timestamp: new Date().toISOString(),
                cameraId: 'CAM-01 (Sector North)',
                fps: 29.4 + Math.sin(this.simTick) * 0.8,
                yoloMs: 14.1 + Math.cos(this.simTick * 0.5) * 1.2,
                verifierMs: 3.8 + Math.sin(this.simTick * 0.2) * 0.5,
                detections: detections,
                zone: { ...this.zone },
                alarm: {
                    state: this.alarmState,
                    activeTrackId: this.activeTrackId
                }
            };

            this.detectionListeners.forEach(cb => {
                try { cb(payload); } catch (e) { console.error(e); }
            });
        }

        checkAnyCurrentIntrusion(detections) {
            return detections.some(d => d.isIntrusion);
        }

        calculateOverlapRatio(box, zone) {
            const ix1 = Math.max(box.x1, zone.x1);
            const iy1 = Math.max(box.y1, zone.y1);
            const ix2 = Math.min(box.x2, zone.x2);
            const iy2 = Math.min(box.y2, zone.y2);

            if (ix2 <= ix1 || iy2 <= iy1) return 0.0;
            const interArea = (ix2 - ix1) * (iy2 - iy1);
            const boxArea = (box.x2 - box.x1) * (box.y2 - box.y1);
            if (boxArea <= 0) return 0.0;
            return interArea / boxArea;
        }

        recordLiveIntrusionIncident(intruder) {
            const now = Date.now();
            if (now - this.lastIntrusionTime < 15000) {
                // Debounce rapid continuous triggers for the same intrusion session
                return;
            }
            this.lastIntrusionTime = now;

            const d = new Date();
            const dateStr = d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0') + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0') + ':' +
                String(d.getSeconds()).padStart(2, '0');

            const idStr = 'INC-' + dateStr.replace(/[- :]/g, '').slice(0, 14);

            const incident = {
                id: idStr,
                timestamp: dateStr,
                cameraId: 'CAM-01 (Sector North)',
                eventType: 'RESTRICTED_ZONE_INTRUSION',
                severity: 'CRITICAL',
                isIntrusion: true,
                objectClass: 'Person',
                trackId: intruder ? intruder.trackId : 2,
                confidence: intruder ? intruder.confidence : 0.91,
                sessionId: 'SESSION_' + dateStr.replace(/[- :]/g, '').slice(0, 14) + '_DEMO',
                alarmState: 'Triggered',
                evidenceAvailable: true,
                status: 'Unacknowledged',
                operatorNotes: 'Real-time simulated zone boundary breach.',
                zoneSnapshot: { ...this.zone }
            };

            incident.evidenceSnapshot = generateSyntheticEvidenceSnapshot(incident);

            this.historyLogs.unshift(incident);
            this.persistLogs(this.historyLogs);
        }

        notifyAlarmSubscribers() {
            const payload = {
                state: this.alarmState,
                activeTrackId: this.activeTrackId,
                timestamp: new Date().toISOString()
            };
            this.alarmListeners.forEach(cb => {
                try { cb(payload); } catch (e) { console.error(e); }
            });
        }

        notifyCameraSubscribers() {
            const payload = {
                state: this.cameraState,
                isDemo: true
            };
            this.cameraListeners.forEach(cb => {
                try { cb(payload); } catch (e) { console.error(e); }
            });
        }

        // --- Public Mock API methods ---

        async getCameraStatus() {
            return {
                state: this.cameraState,
                isDemo: true,
                modeLabel: 'DEMO MODE - Simulated Feed'
            };
        }

        async toggleCamera() {
            if (this.cameraState === 'ON') {
                this.cameraState = 'OFF';
            } else {
                this.cameraState = 'ON';
            }
            this.notifyCameraSubscribers();
            return {
                state: this.cameraState,
                isDemo: true,
                modeLabel: 'DEMO MODE - Simulated Feed'
            };
        }

        async setCameraState(state) {
            if (['ON', 'OFF', 'DISCONNECTED'].includes(state)) {
                this.cameraState = state;
                this.notifyCameraSubscribers();
            }
            return {
                state: this.cameraState,
                isDemo: true,
                modeLabel: 'DEMO MODE - Simulated Feed'
            };
        }

        async silenceAlarm() {
            if (this.alarmState === 'TRIGGERED') {
                this.alarmState = 'SILENCED';
                this.notifyAlarmSubscribers();

                // Also log the operator silencing action
                const d = new Date();
                const dateStr = d.toISOString().replace('T', ' ').substring(0, 19);
                const silLog = {
                    id: 'INC-' + dateStr.replace(/[- :]/g, '').slice(0, 14),
                    timestamp: dateStr,
                    cameraId: 'CAM-01 (Sector North)',
                    eventType: 'ALARM_SILENCED',
                    severity: 'INFO',
                    isIntrusion: false,
                    objectClass: 'System',
                    trackId: null,
                    confidence: 1.0,
                    sessionId: 'OPERATOR_ACTION',
                    alarmState: 'Silenced',
                    evidenceAvailable: false,
                    status: 'Resolved',
                    operatorNotes: 'Alarm silenced manually by operator.'
                };
                this.historyLogs.unshift(silLog);
                this.persistLogs(this.historyLogs);
                return { success: true, state: 'SILENCED' };
            }
            return { success: false, state: this.alarmState, message: 'No active alarm to silence.' };
        }

        async getAlarmStatus() {
            return {
                state: this.alarmState,
                activeTrackId: this.activeTrackId
            };
        }

        async getRestrictedZone() {
            return { ...this.zone };
        }

        async updateRestrictedZone(newZone) {
            if (!this.isValidZone(newZone)) {
                throw new Error('Invalid zone dimensions. Minimum width and height must be at least 2% of viewport.');
            }
            this.saveZone(newZone);
            return { success: true, zone: { ...this.zone } };
        }

        async getHistoryLogs(filter = {}) {
            let logs = [...this.historyLogs];

            if (filter.search) {
                const q = filter.search.toLowerCase().trim();
                logs = logs.filter(l =>
                    l.id.toLowerCase().includes(q) ||
                    l.eventType.toLowerCase().includes(q) ||
                    l.cameraId.toLowerCase().includes(q) ||
                    (l.operatorNotes && l.operatorNotes.toLowerCase().includes(q)) ||
                    (l.sessionId && l.sessionId.toLowerCase().includes(q))
                );
            }

            if (filter.eventType && filter.eventType !== 'ALL') {
                logs = logs.filter(l => l.eventType === filter.eventType);
            }

            if (filter.severity && filter.severity !== 'ALL') {
                logs = logs.filter(l => l.severity === filter.severity);
            }

            if (filter.camera && filter.camera !== 'ALL') {
                logs = logs.filter(l => l.cameraId.includes(filter.camera));
            }

            if (filter.startDate) {
                const sDate = new Date(filter.startDate).getTime();
                logs = logs.filter(l => new Date(l.timestamp).getTime() >= sDate);
            }

            if (filter.endDate) {
                const eDate = new Date(filter.endDate).getTime();
                logs = logs.filter(l => new Date(l.timestamp).getTime() <= eDate);
            }

            return logs;
        }

        async getIncidentDetails(incidentId) {
            const found = this.historyLogs.find(l => l.id === incidentId);
            return found ? { ...found } : null;
        }

        async acknowledgeIncident(incidentId, status, notes = '') {
            const idx = this.historyLogs.findIndex(l => l.id === incidentId);
            if (idx !== -1) {
                this.historyLogs[idx].status = status;
                if (notes) {
                    this.historyLogs[idx].operatorNotes = notes;
                }
                this.persistLogs(this.historyLogs);
                return { success: true, incident: { ...this.historyLogs[idx] } };
            }
            throw new Error(`Incident ID ${incidentId} not found.`);
        }

        async exportLogsAsCsv(filter = {}) {
            const logs = await this.getHistoryLogs(filter);
            const headers = ['id', 'timestamp', 'camera_id', 'event_type', 'severity', 'is_intrusion', 'track_id', 'confidence', 'session_id', 'alarm_state', 'status', 'notes'];
            const rows = logs.map(l => [
                l.id,
                `"${l.timestamp}"`,
                `"${l.cameraId}"`,
                l.eventType,
                l.severity,
                l.isIntrusion ? 'YES' : 'NO',
                l.trackId !== null ? l.trackId : '',
                l.confidence !== null ? l.confidence : '',
                `"${l.sessionId || ''}"`,
                `"${l.alarmState || ''}"`,
                l.status,
                `"${(l.operatorNotes || '').replace(/"/g, '""')}"`
            ]);
            return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        }

        subscribeDetections(callback) {
            this.detectionListeners.add(callback);
            return () => this.detectionListeners.delete(callback);
        }

        subscribeAlarm(callback) {
            this.alarmListeners.add(callback);
            return () => this.alarmListeners.delete(callback);
        }

        subscribeCamera(callback) {
            this.cameraListeners.add(callback);
            return () => this.cameraListeners.delete(callback);
        }
    }

    /**
     * Real backend adapter. This bridge uses REST polling rather than WebSocket;
     * the C++ process publishes runtime/state.json and runtime/frame.jpg via IPC.
     */
    class IbvapBackendClient {
        constructor(config) {
            this.baseUrl = config.apiBaseUrl.replace(/\/$/, '');
            this.pollIntervalMs = Math.max(150, Number(config.pollIntervalMs) || 250);
            this.pollTimer = null;
            this.pollInFlight = false;
            this.detectionListeners = new Set();
            this.alarmListeners = new Set();
            this.cameraListeners = new Set();
            this.lastAlarmState = null;
            this.lastCameraState = null;
        }

        async requestJson(path, options = {}) {
            const res = await fetch(`${this.baseUrl}${path}`, {
                cache: 'no-store',
                ...options,
                headers: { ...(options.headers || {}) }
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
            return data;
        }

        async getCameraStatus() {
            try {
                const data = await this.requestJson('/camera/status');
                return {
                    state: data.state || 'DISCONNECTED',
                    isDemo: false,
                    modeLabel: data.modeLabel || 'LIVE BACKEND CONNECTED'
                };
            } catch (err) {
                return { state: 'DISCONNECTED', isDemo: false, modeLabel: 'BACKEND OFFLINE / DISCONNECTED' };
            }
        }

        async toggleCamera() {
            return await this.requestJson('/camera/toggle', { method: 'POST' });
        }

        async setCameraState(state) {
            return await this.requestJson('/camera/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state })
            });
        }

        async silenceAlarm() {
            return await this.requestJson('/alarm/silence', { method: 'POST' });
        }

        async getAlarmStatus() {
            return await this.requestJson('/alarm/status');
        }

        async getRestrictedZone() {
            return await this.requestJson('/zone');
        }

        async updateRestrictedZone(newZone) {
            return await this.requestJson('/zone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newZone)
            });
        }

        async getHistoryLogs(filter = {}) {
            const query = new URLSearchParams(filter).toString();
            return await this.requestJson(`/logs${query ? `?${query}` : ''}`);
        }

        async getIncidentDetails(incidentId) {
            return await this.requestJson(`/logs/${encodeURIComponent(incidentId)}`);
        }

        async acknowledgeIncident(incidentId, status, notes = '') {
            return await this.requestJson(`/logs/${encodeURIComponent(incidentId)}/ack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, notes })
            });
        }

        async exportLogsAsCsv(filter = {}) {
            const query = new URLSearchParams(filter).toString();
            const res = await fetch(`${this.baseUrl}/logs/export${query ? `?${query}` : ''}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        }

        async pollOnce() {
            if (this.pollInFlight) return;
            this.pollInFlight = true;
            try {
                const payload = await this.requestJson('/telemetry');
                payload.isDemo = false;
                payload.modeLabel = 'LIVE BACKEND CONNECTED';
                // Use a cache-busted same-host endpoint for the real camera image.
                payload.frameUrl = `${this.baseUrl.replace(/\/$/, '')}/frame.jpg?ts=${Date.now()}`;
                this.detectionListeners.forEach(cb => {
                    try { cb(payload); } catch (e) { console.error('[IBVAP telemetry] Listener error:', e); }
                });

                const alarm = payload.alarm || { state: 'NORMAL', activeTrackId: null };
                if (alarm.state !== this.lastAlarmState) {
                    this.lastAlarmState = alarm.state;
                    this.alarmListeners.forEach(cb => {
                        try { cb(alarm); } catch (e) { console.error('[IBVAP alarm] Listener error:', e); }
                    });
                }
                const camera = { state: payload.cameraState || 'DISCONNECTED', isDemo: false, modeLabel: payload.modeLabel };
                if (camera.state !== this.lastCameraState) {
                    this.lastCameraState = camera.state;
                    this.cameraListeners.forEach(cb => {
                        try { cb(camera); } catch (e) { console.error('[IBVAP camera] Listener error:', e); }
                    });
                }
            } catch (err) {
                const camera = { state: 'DISCONNECTED', isDemo: false, modeLabel: 'BACKEND OFFLINE / DISCONNECTED' };
                if (camera.state !== this.lastCameraState) {
                    this.lastCameraState = camera.state;
                    this.cameraListeners.forEach(cb => { try { cb(camera); } catch (_) {} });
                }
            } finally {
                this.pollInFlight = false;
            }
        }

        connectPolling() {
            if (this.pollTimer !== null) return;
            this.pollOnce();
            this.pollTimer = window.setInterval(() => this.pollOnce(), this.pollIntervalMs);
        }

        subscribeDetections(callback) {
            this.detectionListeners.add(callback);
            this.connectPolling();
            return () => this.detectionListeners.delete(callback);
        }

        subscribeAlarm(callback) {
            this.alarmListeners.add(callback);
            this.connectPolling();
            return () => this.alarmListeners.delete(callback);
        }

        subscribeCamera(callback) {
            this.cameraListeners.add(callback);
            this.connectPolling();
            return () => this.cameraListeners.delete(callback);
        }
    }

    // Factory to export the active service
    const mockInstance = new IbvapMockService();
    const backendInstance = new IbvapBackendClient(CONFIG);

    const API = {
        config: CONFIG,
        setMode(newMode) {
            if (newMode === 'demo' || newMode === 'backend') {
                CONFIG.mode = newMode;
            }
        },
        getService() {
            return CONFIG.mode === 'backend' ? backendInstance : mockInstance;
        },
        // Direct delegation
        getCameraStatus() { return this.getService().getCameraStatus(); },
        toggleCamera() { return this.getService().toggleCamera(); },
        setCameraState(st) { return this.getService().setCameraState(st); },
        silenceAlarm() { return this.getService().silenceAlarm(); },
        getAlarmStatus() { return this.getService().getAlarmStatus(); },
        getRestrictedZone() { return this.getService().getRestrictedZone(); },
        updateRestrictedZone(z) { return this.getService().updateRestrictedZone(z); },
        getHistoryLogs(f) { return this.getService().getHistoryLogs(f); },
        getIncidentDetails(id) { return this.getService().getIncidentDetails(id); },
        acknowledgeIncident(id, st, n) { return this.getService().acknowledgeIncident(id, st, n); },
        exportLogsAsCsv(f) { return this.getService().exportLogsAsCsv(f); },
        subscribeDetections(cb) { return this.getService().subscribeDetections(cb); },
        subscribeAlarm(cb) { return this.getService().subscribeAlarm(cb); },
        subscribeCamera(cb) { return this.getService().subscribeCamera(cb); },
    };

    // Expose to window
    window.IbvapApi = API;

})(window);
