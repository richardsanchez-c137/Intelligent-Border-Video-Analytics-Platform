/**
 * IBVAP — Intelligent Border Video Analytics Platform
 * Application Controller & Canvas Rendering Engine
 */

(function () {
    'use strict';

    // DOM Elements
    const elements = {
        // Badges & Header
        appModeBadge: document.getElementById('appModeBadge'),
        cameraStatusBadge: document.getElementById('cameraStatusBadge'),
        cameraStatusText: document.getElementById('cameraStatusText'),
        alarmStatusBadge: document.getElementById('alarmStatusBadge'),
        alarmStatusText: document.getElementById('alarmStatusText'),
        systemClock: document.getElementById('systemClock'),

        // Tabs
        tabBtnMonitor: document.getElementById('tabBtnMonitor'),
        tabBtnHistory: document.getElementById('tabBtnHistory'),
        tabMonitor: document.getElementById('tabMonitor'),
        tabHistory: document.getElementById('tabHistory'),

        // Camera Viewport
        viewportContainer: document.getElementById('cameraViewportContainer'),
        cameraCanvas: document.getElementById('cameraCanvas'),
        standbyPlaceholder: document.getElementById('cameraStandbyPlaceholder'),
        standbyHeading: document.getElementById('standbyHeading'),
        standbySubtext: document.getElementById('standbySubtext'),
        hudTelemetry: document.getElementById('hudTelemetry'),
        telemetryFps: document.getElementById('telemetryFps'),
        telemetryYoloMs: document.getElementById('telemetryYoloMs'),
        telemetryVerifierMs: document.getElementById('telemetryVerifierMs'),
        telemetryDetections: document.getElementById('telemetryDetections'),
        telemetryIntrusions: document.getElementById('telemetryIntrusions'),
        hudAlarmBanner: document.getElementById('hudAlarmBanner'),
        hudZoneEditBanner: document.getElementById('hudZoneEditBanner'),

        // Controls
        btnToggleCamera: document.getElementById('btnToggleCamera'),
        btnToggleCameraText: document.getElementById('btnToggleCameraText'),
        btnSilenceAlarm: document.getElementById('btnSilenceAlarm'),
        btnSoundToggle: document.getElementById('btnSoundToggle'),
        soundToggleIcon: document.getElementById('soundToggleIcon'),
        btnEditZone: document.getElementById('btnEditZone'),
        btnEditZoneText: document.getElementById('btnEditZoneText'),
        btnSaveZone: document.getElementById('btnSaveZone'),
        btnResetDefaultZone: document.getElementById('btnResetDefaultZone'),

        // Sidebar Info
        zoneEditStatusText: document.getElementById('zoneEditStatusText'),
        zoneValX1: document.getElementById('zoneValX1'),
        zoneValY1: document.getElementById('zoneValY1'),
        zoneValX2: document.getElementById('zoneValX2'),
        zoneValY2: document.getElementById('zoneValY2'),
        tickerStream: document.getElementById('tickerStream'),
        tickerCount: document.getElementById('tickerCount'),

        // History Table & Filters
        filterSearch: document.getElementById('filterSearch'),
        filterEventType: document.getElementById('filterEventType'),
        filterSeverity: document.getElementById('filterSeverity'),
        filterCamera: document.getElementById('filterCamera'),
        btnResetFilters: document.getElementById('btnResetFilters'),
        btnExportCsv: document.getElementById('btnExportCsv'),
        historyTable: document.getElementById('historyTable'),
        historyTableBody: document.getElementById('historyTableBody'),
        historyResultsCount: document.getElementById('historyResultsCount'),

        // Modal
        incidentModal: document.getElementById('incidentModal'),
        modalIncidentId: document.getElementById('modalIncidentId'),
        modalSeverityBadge: document.getElementById('modalSeverityBadge'),
        modalEvidenceImg: document.getElementById('modalEvidenceImg'),
        modalEvidencePlaceholder: document.getElementById('modalEvidencePlaceholder'),
        modalEvidenceTimestamp: document.getElementById('modalEvidenceTimestamp'),
        modalCameraId: document.getElementById('modalCameraId'),
        modalEventType: document.getElementById('modalEventType'),
        modalObjectClass: document.getElementById('modalObjectClass'),
        modalTrackConfidence: document.getElementById('modalTrackConfidence'),
        modalZoneBreach: document.getElementById('modalZoneBreach'),
        modalAlarmAction: document.getElementById('modalAlarmAction'),
        modalSessionId: document.getElementById('modalSessionId'),
        modalStatusSelect: document.getElementById('modalStatusSelect'),
        modalNotesInput: document.getElementById('modalNotesInput'),
        btnSaveAcknowledgement: document.getElementById('btnSaveAcknowledgement'),
        btnDownloadEvidence: document.getElementById('btnDownloadEvidence'),
        modalCloseBtn: document.getElementById('modalCloseBtn'),
        modalCloseFooterBtn: document.getElementById('modalCloseFooterBtn'),

        // Toast
        toastContainer: document.getElementById('toastContainer')
    };

    // Application State
    const state = {
        camera: 'ON', // 'ON' | 'OFF' | 'DISCONNECTED'
        backendMode: false,
        liveFrameImage: null,
        frameImageLoading: false,
        lastFrameUrl: null,
        alarm: 'NORMAL', // 'NORMAL' | 'TRIGGERED' | 'SILENCED'
        audioMuted: false,
        isEditingZone: false,
        activeZone: { x1: 0.60, y1: 0.15, x2: 0.95, y2: 0.85 },
        originalZone: null, // Saved for T-key cancel
        latestDetections: [],
        latestTelemetry: { fps: 29.4, yoloMs: 14.2, verifierMs: 3.8 },
        activeModalIncident: null,
        historySort: { column: 'timestamp', ascending: false },

        // Mouse Drag & Resize State for Zone Editor
        mouse: {
            isDown: false,
            mode: null, // 'DRAW' | 'MOVE' | 'RESIZE'
            resizeHandle: null, // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
            startX: 0,
            startY: 0,
            initialZone: null
        }
    };

    // Canvas context
    const ctx = elements.cameraCanvas.getContext('2d');
    const CANVAS_WIDTH = 1280;
    const CANVAS_HEIGHT = 800;

    // Web Audio Alarm Synthesizer
    let audioCtx = null;
    let alarmOscillator = null;
    let alarmGain = null;
    let alarmInterval = null;

    /**
     * Show lightweight toast notification
     */
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            toast.style.transition = 'all 0.25s ease';
            setTimeout(() => toast.remove(), 250);
        }, 3000);
    }

    /**
     * Start Web Audio warning pulses when alarm is TRIGGERED
     */
    function playAlarmTone() {
        if (state.audioMuted || state.alarm !== 'TRIGGERED') return;
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            if (alarmInterval) return;

            alarmInterval = setInterval(() => {
                if (state.alarm !== 'TRIGGERED' || state.audioMuted) {
                    stopAlarmTone();
                    return;
                }
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(950, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1300, audioCtx.currentTime + 0.15);

                gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);

                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.25);
            }, 550);
        } catch (e) {
            console.warn('[IBVAP Audio] Could not play alarm tone:', e);
        }
    }

    function stopAlarmTone() {
        if (alarmInterval) {
            clearInterval(alarmInterval);
            alarmInterval = null;
        }
    }

    /**
     * Initialize Application
     */
    async function initApp() {
        // Update clock
        updateClock();
        setInterval(updateClock, 1000);

        // Load initial zone from API
        try {
            const savedZone = await IbvapApi.getRestrictedZone();
            if (savedZone) {
                state.activeZone = savedZone;
                updateZoneCoordinateDisplay();
            }
        } catch (e) {
            console.warn('Could not load zone:', e);
        }

        // Load initial camera state
        const cam = await IbvapApi.getCameraStatus();
        updateCameraStateUI(cam.state, cam.modeLabel);

        // Subscribe to detection events from API/mock service
        IbvapApi.subscribeDetections((payload) => {
            onDetectionPayload(payload);
        });

        // Subscribe to alarm state changes
        IbvapApi.subscribeAlarm((payload) => {
            onAlarmStateChanged(payload.state);
        });
        IbvapApi.subscribeCamera((payload) => {
            updateCameraStateUI(payload.state, payload.modeLabel);
        });

        // Setup event listeners
        setupNavigationListeners();
        setupControlListeners();
        setupCanvasMouseListeners();
        setupKeyboardShortcuts();
        setupHistoryTableListeners();

        // Load history logs table
        loadHistoryLogs();

        // Start render loop
        requestAnimationFrame(renderLoop);
    }

    /**
     * Update digital system clock
     */
    function updateClock() {
        const now = new Date();
        const str = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
        elements.systemClock.textContent = str;
    }

    /**
     * UI Updates for Camera State
     */
    function updateCameraStateUI(cameraState, modeLabel) {
        state.camera = cameraState;
        if (modeLabel) state.backendMode = modeLabel.toUpperCase().includes('BACKEND');

        elements.cameraStatusBadge.className = 'status-badge';
        if (cameraState === 'ON') {
            elements.cameraStatusBadge.classList.add('camera-on');
            elements.cameraStatusText.textContent = 'CAMERA: ON';
            elements.btnToggleCameraText.textContent = 'Turn Camera OFF';
            elements.standbyPlaceholder.classList.remove('active');
        } else if (cameraState === 'OFF') {
            elements.cameraStatusBadge.classList.add('camera-off');
            elements.cameraStatusText.textContent = 'CAMERA: OFF';
            elements.btnToggleCameraText.textContent = 'Turn Camera ON';
            elements.standbyPlaceholder.classList.add('active');
            elements.standbyHeading.textContent = 'CAMERA FEED PAUSED';
            elements.standbySubtext.textContent = 'Surveillance capture paused by operator.';
        } else {
            elements.cameraStatusBadge.classList.add('camera-disconnected');
            elements.cameraStatusText.textContent = 'CAMERA: DISCONNECTED';
            elements.btnToggleCameraText.textContent = 'Connect Camera';
            elements.standbyPlaceholder.classList.add('active');
            elements.standbyHeading.textContent = 'CAMERA DISCONNECTED';
            elements.standbySubtext.textContent = 'No video capture device detected on backend.';
        }

        if (modeLabel) {
            elements.appModeBadge.textContent = modeLabel;
        }
    }

    /**
     * UI Updates for Alarm State
     */
    function onAlarmStateChanged(alarmState) {
        state.alarm = alarmState;

        elements.alarmStatusBadge.className = 'status-badge';
        elements.btnSilenceAlarm.classList.remove('flashing');
        elements.hudAlarmBanner.classList.remove('active');

        if (alarmState === 'TRIGGERED') {
            elements.alarmStatusBadge.classList.add('alarm-triggered');
            elements.alarmStatusText.textContent = 'ALARM: TRIGGERED';
            elements.btnSilenceAlarm.classList.add('flashing');
            elements.hudAlarmBanner.classList.add('active');
            if (state.backendMode) stopAlarmTone();
            else playAlarmTone();
        } else if (alarmState === 'SILENCED') {
            elements.alarmStatusBadge.classList.add('alarm-silenced');
            elements.alarmStatusText.textContent = 'ALARM: SILENCED';
            stopAlarmTone();
        } else {
            elements.alarmStatusBadge.classList.add('alarm-normal');
            elements.alarmStatusText.textContent = 'ALARM: NORMAL';
            stopAlarmTone();
        }
    }

    /**
     * Handle incoming detections payload from API/mock service
     */
    function onDetectionPayload(payload) {
        if (payload.modeLabel) state.backendMode = payload.modeLabel.toUpperCase().includes('BACKEND');
        if (payload.cameraState) updateCameraStateUI(payload.cameraState, payload.modeLabel || 'LIVE BACKEND CONNECTED');
        if (payload.alarm && payload.alarm.state) onAlarmStateChanged(payload.alarm.state);
        if (payload.frameUrl && !state.frameImageLoading && payload.frameUrl !== state.lastFrameUrl) {
            state.frameImageLoading = true;
            const liveImage = new Image();
            liveImage.crossOrigin = 'anonymous';
            liveImage.onload = () => {
                state.liveFrameImage = liveImage;
                state.lastFrameUrl = payload.frameUrl;
                state.frameImageLoading = false;
            };
            liveImage.onerror = () => { state.frameImageLoading = false; };
            liveImage.src = payload.frameUrl;
        }
        state.latestDetections = payload.detections || [];
        state.latestTelemetry = {
            fps: Number(payload.fps || 0).toFixed(1),
            yoloMs: Number(payload.yoloMs || 0).toFixed(1),
            verifierMs: Number(payload.verifierMs || 0).toFixed(1)
        };

        // Update telemetry HUD
        elements.telemetryFps.textContent = state.latestTelemetry.fps;
        elements.telemetryYoloMs.textContent = state.latestTelemetry.yoloMs + ' ms';
        elements.telemetryVerifierMs.textContent = state.latestTelemetry.verifierMs + ' ms';

        const totalDetections = state.latestDetections.length;
        const intrusionsCount = state.latestDetections.filter(d => d.isIntrusion).length;

        elements.telemetryDetections.textContent = totalDetections;
        elements.telemetryIntrusions.textContent = intrusionsCount;

        // If not editing, keep activeZone synchronized with backend
        if (!state.isEditingZone && payload.zone) {
            state.activeZone = payload.zone;
            updateZoneCoordinateDisplay();
        }

        // Ticker update
        if (intrusionsCount > 0 && Math.random() < 0.08) {
            pushLiveTickerItem('CRITICAL', `Intrusion alert: Track in Sector 4 boundary`);
        }
    }

    /**
     * Push event to live ticker
     */
    function pushLiveTickerItem(severity, message) {
        const timeStr = new Date().toTimeString().split(' ')[0];
        const item = document.createElement('div');
        item.className = `ticker-entry ticker-${severity.toLowerCase()}`;
        item.innerHTML = `
            <div class="ticker-entry-header">
                <span>${timeStr}</span>
                <span>${severity}</span>
            </div>
            <div class="ticker-entry-msg">${message}</div>
        `;
        elements.tickerStream.prepend(item);
        if (elements.tickerStream.children.length > 20) {
            elements.tickerStream.lastElementChild.remove();
        }
        elements.tickerCount.textContent = `${elements.tickerStream.children.length} live`;
    }

    /**
     * Update zone coordinate display in sidebar
     */
    function updateZoneCoordinateDisplay() {
        elements.zoneValX1.textContent = state.activeZone.x1.toFixed(3);
        elements.zoneValY1.textContent = state.activeZone.y1.toFixed(3);
        elements.zoneValX2.textContent = state.activeZone.x2.toFixed(3);
        elements.zoneValY2.textContent = state.activeZone.y2.toFixed(3);
    }

    /**
     * Toggle Zone Editing Mode (Shortcut: T)
     */
    function toggleZoneEditMode() {
        if (!state.isEditingZone) {
            // ENTER edit mode
            state.isEditingZone = true;
            state.originalZone = { ...state.activeZone }; // Save backup to restore if cancelled
            elements.btnEditZone.classList.add('editing-active');
            elements.btnEditZoneText.textContent = 'Cancel Edit';
            elements.btnSaveZone.disabled = false;
            elements.hudZoneEditBanner.classList.add('active');
            elements.cameraCanvas.classList.add('zone-editor-active-cursor');
            elements.zoneEditStatusText.textContent = 'EDITING...';
            elements.zoneEditStatusText.style.color = 'var(--color-warning)';
            showToast('Zone editing active: Drag on canvas to reposition, drag handles to resize. Press S to save, T to cancel.', 'warning');
        } else {
            // CANCEL edit mode & restore
            state.isEditingZone = false;
            if (state.originalZone) {
                state.activeZone = { ...state.originalZone };
                updateZoneCoordinateDisplay();
            }
            exitZoneEditModeUI();
            showToast('Zone edit cancelled. Restored previous saved zone.', 'info');
        }
    }

    function exitZoneEditModeUI() {
        state.isEditingZone = false;
        elements.btnEditZone.classList.remove('editing-active');
        elements.btnEditZoneText.textContent = 'Edit Zone';
        elements.btnSaveZone.disabled = true;
        elements.hudZoneEditBanner.classList.remove('active');
        elements.cameraCanvas.classList.remove('zone-editor-active-cursor');
        elements.zoneEditStatusText.textContent = 'SAVED';
        elements.zoneEditStatusText.style.color = 'var(--color-normal)';
    }

    /**
     * Save Restricted Zone (Shortcut: S)
     */
    async function saveRestrictedZone() {
        if (!state.isEditingZone) {
            showToast('Enter zone editing mode first (Press T)', 'info');
            return;
        }

        // Validate dimensions
        const width = state.activeZone.x2 - state.activeZone.x1;
        const height = state.activeZone.y2 - state.activeZone.y1;

        if (width < 0.02 || height < 0.02) {
            showToast('Selection is too small. Drag a larger rectangle (min 2% dimension).', 'error');
            return;
        }

        try {
            await IbvapApi.updateRestrictedZone(state.activeZone);
            state.originalZone = { ...state.activeZone };
            exitZoneEditModeUI();
            updateZoneCoordinateDisplay();
            showToast(`Restricted zone saved & applied successfully [${state.activeZone.x1.toFixed(3)}, ${state.activeZone.y1.toFixed(3)} - ${state.activeZone.x2.toFixed(3)}, ${state.activeZone.y2.toFixed(3)}]`, 'success');
        } catch (err) {
            showToast(err.message || 'Failed to save zone.', 'error');
        }
    }

    /**
     * Silence Alarm (Shortcut: M)
     */
    async function silenceActiveAlarm() {
        try {
            const res = await IbvapApi.silenceAlarm();
            if (res.success) {
                onAlarmStateChanged('SILENCED');
                showToast('Audible alarm silenced manually by operator.', 'info');
                pushLiveTickerItem('INFO', 'Operator silenced active perimeter alarm');
            } else {
                showToast(res.message || 'No active alarm to silence.', 'info');
            }
        } catch (err) {
            showToast('Failed to silence alarm: ' + err.message, 'error');
        }
    }

    /**
     * Setup Keyboard Shortcuts: M, T, S
     * Strict requirement: shortcuts MUST NOT activate when user is typing in inputs or textareas.
     */
    function setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const target = e.target;
            const tagName = target.tagName;
            // Ignore if focus is in input, textarea, select, or editable element
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) {
                return;
            }

            const key = e.key.toUpperCase();

            if (key === 'M') {
                e.preventDefault();
                silenceActiveAlarm();
            } else if (key === 'T') {
                e.preventDefault();
                toggleZoneEditMode();
            } else if (key === 'S') {
                e.preventDefault();
                if (state.isEditingZone) {
                    saveRestrictedZone();
                }
            }
        });
    }

    /**
     * Setup UI Control Buttons
     */
    function setupControlListeners() {
        // Toggle Camera ON/OFF
        elements.btnToggleCamera.addEventListener('click', async () => {
            const res = await IbvapApi.toggleCamera();
            updateCameraStateUI(res.state, res.modeLabel);
            showToast(`Camera feed ${res.state === 'ON' ? 'activated' : 'paused'} (${res.modeLabel})`, 'info');
        });

        // Silence Alarm Button (Same as M)
        elements.btnSilenceAlarm.addEventListener('click', () => {
            silenceActiveAlarm();
        });

        // Sound Toggle Button
        elements.btnSoundToggle.addEventListener('click', () => {
            state.audioMuted = !state.audioMuted;
            elements.soundToggleIcon.textContent = state.audioMuted ? '🔇' : '🔊';
            if (state.audioMuted) {
                stopAlarmTone();
                showToast('Audible alarm sound muted.', 'info');
            } else {
                if (state.alarm === 'TRIGGERED') playAlarmTone();
                showToast('Audible alarm sound unmuted.', 'info');
            }
        });

        // Edit Zone Button (Same as T)
        elements.btnEditZone.addEventListener('click', () => {
            toggleZoneEditMode();
        });

        // Save Zone Button (Same as S)
        elements.btnSaveZone.addEventListener('click', () => {
            saveRestrictedZone();
        });

        // Reset Default Zone Button
        elements.btnResetDefaultZone.addEventListener('click', async () => {
            state.activeZone = { x1: 0.60, y1: 0.15, x2: 0.95, y2: 0.85 };
            if (state.isEditingZone) {
                updateZoneCoordinateDisplay();
                showToast('Zone reset to default perimeter bounds in editor. Press S to save.', 'warning');
            } else {
                await IbvapApi.updateRestrictedZone(state.activeZone);
                updateZoneCoordinateDisplay();
                showToast('Reset restricted zone to default factory coordinates.', 'success');
            }
        });
    }

    /**
     * Navigation Switcher: Monitor vs History
     */
    function setupNavigationListeners() {
        elements.tabBtnMonitor.addEventListener('click', () => {
            elements.tabBtnMonitor.classList.add('active');
            elements.tabBtnHistory.classList.remove('active');
            elements.tabMonitor.classList.add('active');
            elements.tabHistory.classList.remove('active');
        });

        elements.tabBtnHistory.addEventListener('click', () => {
            elements.tabBtnHistory.classList.add('active');
            elements.tabBtnMonitor.classList.remove('active');
            elements.tabHistory.classList.add('active');
            elements.tabMonitor.classList.remove('active');
            loadHistoryLogs();
        });
    }

    /**
     * Canvas Mouse Interaction for Zone Editing (Move, Resize, Draw)
     */
    function setupCanvasMouseListeners() {
        const canvas = elements.cameraCanvas;

        function getNormalizedPos(e) {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.clientX;
            const clientY = e.clientY;
            const nx = (clientX - rect.left) / rect.width;
            const ny = (clientY - rect.top) / rect.height;
            return {
                x: Math.max(0, Math.min(1, nx)),
                y: Math.max(0, Math.min(1, ny))
            };
        }

        // Check if cursor is over one of 8 resize handles
        function getResizeHandle(nx, ny, zone) {
            const handleRadiusNorm = 12 / CANVAS_WIDTH;
            const x1 = zone.x1, y1 = zone.y1, x2 = zone.x2, y2 = zone.y2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            const handles = [
                { id: 'nw', x: x1, y: y1 },
                { id: 'n',  x: midX, y: y1 },
                { id: 'ne', x: x2, y: y1 },
                { id: 'e',  x: x2, y: midY },
                { id: 'se', x: x2, y: y2 },
                { id: 's',  x: midX, y: y2 },
                { id: 'sw', x: x1, y: y2 },
                { id: 'w',  x: x1, y: midY }
            ];

            for (const h of handles) {
                const dist = Math.hypot(nx - h.x, ny - h.y);
                if (dist < handleRadiusNorm) return h.id;
            }
            return null;
        }

        // Check if cursor is inside the zone rectangle
        function isInsideZone(nx, ny, zone) {
            return nx >= zone.x1 && nx <= zone.x2 && ny >= zone.y1 && ny <= zone.y2;
        }

        canvas.addEventListener('mousedown', (e) => {
            if (!state.isEditingZone) return;
            const pos = getNormalizedPos(e);
            state.mouse.isDown = true;
            state.mouse.startX = pos.x;
            state.mouse.startY = pos.y;
            state.mouse.initialZone = { ...state.activeZone };

            const handle = getResizeHandle(pos.x, pos.y, state.activeZone);
            if (handle) {
                state.mouse.mode = 'RESIZE';
                state.mouse.resizeHandle = handle;
            } else if (isInsideZone(pos.x, pos.y, state.activeZone)) {
                state.mouse.mode = 'MOVE';
            } else {
                state.mouse.mode = 'DRAW';
                state.activeZone = {
                    x1: pos.x,
                    y1: pos.y,
                    x2: pos.x + 0.01,
                    y2: pos.y + 0.01
                };
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!state.isEditingZone) {
                canvas.style.cursor = 'default';
                return;
            }

            const pos = getNormalizedPos(e);

            if (!state.mouse.isDown) {
                // Hover cursor styling
                const handle = getResizeHandle(pos.x, pos.y, state.activeZone);
                if (handle) {
                    if (handle === 'nw' || handle === 'se') canvas.style.cursor = 'nwse-resize';
                    else if (handle === 'ne' || handle === 'sw') canvas.style.cursor = 'nesw-resize';
                    else if (handle === 'n' || handle === 's') canvas.style.cursor = 'ns-resize';
                    else if (handle === 'e' || handle === 'w') canvas.style.cursor = 'ew-resize';
                } else if (isInsideZone(pos.x, pos.y, state.activeZone)) {
                    canvas.style.cursor = 'move';
                } else {
                    canvas.style.cursor = 'crosshair';
                }
                return;
            }

            // Dragging interactions
            const init = state.mouse.initialZone;
            const dx = pos.x - state.mouse.startX;
            const dy = pos.y - state.mouse.startY;

            if (state.mouse.mode === 'MOVE') {
                const zWidth = init.x2 - init.x1;
                const zHeight = init.y2 - init.y1;
                let newX1 = Math.max(0, Math.min(1 - zWidth, init.x1 + dx));
                let newY1 = Math.max(0, Math.min(1 - zHeight, init.y1 + dy));
                state.activeZone.x1 = newX1;
                state.activeZone.y1 = newY1;
                state.activeZone.x2 = newX1 + zWidth;
                state.activeZone.y2 = newY1 + zHeight;
            } else if (state.mouse.mode === 'RESIZE') {
                const h = state.mouse.resizeHandle;
                if (h.includes('w')) state.activeZone.x1 = Math.max(0, Math.min(init.x2 - 0.02, init.x1 + dx));
                if (h.includes('e')) state.activeZone.x2 = Math.min(1, Math.max(init.x1 + 0.02, init.x2 + dx));
                if (h.includes('n')) state.activeZone.y1 = Math.max(0, Math.min(init.y2 - 0.02, init.y1 + dy));
                if (h.includes('s')) state.activeZone.y2 = Math.min(1, Math.max(init.y1 + 0.02, init.y2 + dy));
            } else if (state.mouse.mode === 'DRAW') {
                state.activeZone.x1 = Math.min(state.mouse.startX, pos.x);
                state.activeZone.y1 = Math.min(state.mouse.startY, pos.y);
                state.activeZone.x2 = Math.max(state.mouse.startX, pos.x);
                state.activeZone.y2 = Math.max(state.mouse.startY, pos.y);
            }

            updateZoneCoordinateDisplay();
        });

        window.addEventListener('mouseup', () => {
            if (state.mouse.isDown) {
                state.mouse.isDown = false;
                state.mouse.mode = null;
                state.mouse.resizeHandle = null;

                // Normalize coordinate bounds
                const xMin = Math.min(state.activeZone.x1, state.activeZone.x2);
                const xMax = Math.max(state.activeZone.x1, state.activeZone.x2);
                const yMin = Math.min(state.activeZone.y1, state.activeZone.y2);
                const yMax = Math.max(state.activeZone.y1, state.activeZone.y2);

                state.activeZone.x1 = xMin;
                state.activeZone.x2 = xMax;
                state.activeZone.y1 = yMin;
                state.activeZone.y2 = yMax;

                updateZoneCoordinateDisplay();
                elements.btnSaveZone.disabled = false;
            }
        });
    }

    /**
     * Render Loop: Camera Canvas & Visualizations
     */
    function renderLoop() {
        if (state.camera === 'ON') {
            drawCameraFrame();
        }
        requestAnimationFrame(renderLoop);
    }

    /**
     * Draw Simulated Video Scene, Detections, and Restricted Zone
     */
    function drawCameraFrame() {
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Real backend frames replace the simulated scenery when connected.
        if (state.backendMode) {
            if (state.liveFrameImage && state.liveFrameImage.complete && state.liveFrameImage.naturalWidth > 0) {
                ctx.drawImage(state.liveFrameImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            } else {
                ctx.fillStyle = '#05070b';
                ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                ctx.fillStyle = '#94a3b8';
                ctx.font = 'bold 18px monospace';
                ctx.fillText('WAITING FOR LIVE C++ CAMERA FRAME', 28, 48);
            }
        } else {
            const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
            bgGrad.addColorStop(0, '#070a10');
            bgGrad.addColorStop(0.35, '#0e1420');
            bgGrad.addColorStop(0.7, '#151c2a');
            bgGrad.addColorStop(1, '#0a0d14');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            drawBorderEnvironment();
        }

        // 2. Restricted Zone
        drawRestrictedZone(state.activeZone, state.isEditingZone);

        // 3. Person & Vehicle Detections (Green = Normal, Red = Intrusion)
        for (const det of state.latestDetections) {
            drawDetectionBox(det);
        }

        // 4. On-Screen Camera OSD Watermarks
        drawCameraOsdWatermark();
    }

    /**
     * Draw Border Scenery Background (Fence, watchtower silhouette, road)
     */
    function drawBorderEnvironment() {
        // Distant horizon mountain silhouettes
        ctx.fillStyle = '#0a101c';
        ctx.beginPath();
        ctx.moveTo(0, 260);
        ctx.lineTo(240, 210);
        ctx.lineTo(540, 240);
        ctx.lineTo(820, 190);
        ctx.lineTo(1120, 230);
        ctx.lineTo(CANVAS_WIDTH, 200);
        ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.lineTo(0, CANVAS_HEIGHT);
        ctx.closePath();
        ctx.fill();

        // Ground terrain
        ctx.fillStyle = '#0f1724';
        ctx.beginPath();
        ctx.moveTo(0, 320);
        ctx.lineTo(CANVAS_WIDTH, 290);
        ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.lineTo(0, CANVAS_HEIGHT);
        ctx.closePath();
        ctx.fill();

        // Perimeter service road
        ctx.fillStyle = '#162134';
        ctx.beginPath();
        ctx.moveTo(0, CANVAS_HEIGHT - 60);
        ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT - 130);
        ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.lineTo(0, CANVAS_HEIGHT);
        ctx.closePath();
        ctx.fill();

        // Wire fence posts & barbed wire netting
        ctx.strokeStyle = 'rgba(74, 96, 128, 0.35)';
        ctx.lineWidth = 1;

        // Horizontal fence wires
        for (let y = 300; y < CANVAS_HEIGHT - 50; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(CANVAS_WIDTH, y - 40);
            ctx.stroke();
        }

        // Vertical fence posts
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(100, 126, 163, 0.45)';
        for (let x = 60; x < CANVAS_WIDTH; x += 110) {
            const groundY = 320 + (x / CANVAS_WIDTH) * (CANVAS_HEIGHT - 380);
            ctx.beginPath();
            ctx.moveTo(x, 260);
            ctx.lineTo(x, groundY + 80);
            ctx.stroke();
        }

        // Distant perimeter watchtower silhouette
        ctx.fillStyle = '#101622';
        ctx.fillRect(1020, 160, 28, 90);
        ctx.fillRect(1005, 140, 58, 25);
        ctx.beginPath();
        ctx.moveTo(1000, 140);
        ctx.lineTo(1034, 115);
        ctx.lineTo(1068, 140);
        ctx.fill();
    }

    /**
     * Draw Restricted Zone Rectangle
     */
    function drawRestrictedZone(zone, isEditing) {
        const x = zone.x1 * CANVAS_WIDTH;
        const y = zone.y1 * CANVAS_HEIGHT;
        const w = (zone.x2 - zone.x1) * CANVAS_WIDTH;
        const h = (zone.y2 - zone.y1) * CANVAS_HEIGHT;

        // Translucent red fill
        ctx.fillStyle = isEditing ? 'rgba(239, 68, 68, 0.28)' : 'rgba(239, 68, 68, 0.18)';
        ctx.fillRect(x, y, w, h);

        // Red outline
        ctx.lineWidth = isEditing ? 3 : 2.5;
        ctx.strokeStyle = isEditing ? '#ff3838' : '#ef4444';

        if (isEditing) {
            ctx.setLineDash([8, 5]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        } else {
            ctx.strokeRect(x, y, w, h);
        }

        // Zone label header banner
        ctx.fillStyle = isEditing ? '#ff3838' : 'rgba(239, 68, 68, 0.9)';
        const headerH = 22;
        ctx.fillRect(x, y, Math.min(w, 240), headerH);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(isEditing ? '✎ EDITING RESTRICTED ZONE' : '⛔ RESTRICTED ZONE [SECTOR 4]', x + 6, y + 15);

        // If editing, draw 8 resize handles
        if (isEditing) {
            drawResizeHandles(x, y, w, h);
        }
    }

    /**
     * Draw 8 Resize Handles on Active Zone
     */
    function drawResizeHandles(x, y, w, h) {
        const handleSize = 10;
        const half = handleSize / 2;
        const midX = x + w / 2;
        const midY = y + h / 2;

        const points = [
            { x: x, y: y },                 // NW
            { x: midX, y: y },              // N
            { x: x + w, y: y },             // NE
            { x: x + w, y: midY },          // E
            { x: x + w, y: y + h },         // SE
            { x: midX, y: y + h },          // S
            { x: x, y: y + h },             // SW
            { x: x, y: midY }               // W
        ];

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;

        points.forEach(p => {
            ctx.fillRect(p.x - half, p.y - half, handleSize, handleSize);
            ctx.strokeRect(p.x - half, p.y - half, handleSize, handleSize);
        });
    }

    /**
     * Draw Bounding Box for Person / Object Detection
     * GREEN for normal detections, RED for detected intrusions!
     */
    function drawDetectionBox(det) {
        const x = det.x1 * CANVAS_WIDTH;
        const y = det.y1 * CANVAS_HEIGHT;
        const w = (det.x2 - det.x1) * CANVAS_WIDTH;
        const h = (det.y2 - det.y1) * CANVAS_HEIGHT;

        const isIntrusion = det.isIntrusion;
        const primaryColor = isIntrusion ? '#ef4444' : '#10b981';
        const fillColor = isIntrusion ? 'rgba(239, 68, 68, 0.22)' : 'rgba(16, 185, 129, 0.12)';

        // Box fill
        ctx.fillStyle = fillColor;
        ctx.fillRect(x, y, w, h);

        // Box border
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = isIntrusion ? 3 : 2;
        ctx.strokeRect(x, y, w, h);

        // Corner tick accents
        const tick = Math.min(w * 0.25, 14);
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        // Top-left
        ctx.moveTo(x, y + tick); ctx.lineTo(x, y); ctx.lineTo(x + tick, y);
        // Top-right
        ctx.moveTo(x + w - tick, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + tick);
        // Bottom-left
        ctx.moveTo(x, y + h - tick); ctx.lineTo(x, y + h); ctx.lineTo(x + tick, y + h);
        // Bottom-right
        ctx.moveTo(x + w - tick, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - tick);
        ctx.stroke();

        // Label Badge
        const confPct = Math.round(det.confidence * 100);
        const labelText = isIntrusion
            ? `⚠️ INTRUSION #${det.trackId} [RESTRICTED] ${confPct}%`
            : `${det.label} #${det.trackId} ${confPct}%`;

        ctx.font = 'bold 11px monospace';
        const textMetrics = ctx.measureText(labelText);
        const tagW = textMetrics.width + 12;
        const tagH = 18;

        ctx.fillStyle = primaryColor;
        ctx.fillRect(x, Math.max(0, y - tagH), tagW, tagH);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, x + 6, Math.max(12, y - 5));
    }

    /**
     * Draw Camera OSD Watermarks (matching real OpenCV console)
     */
    function drawCameraOsdWatermark() {
        // Bottom timestamp watermark
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, CANVAS_HEIGHT - 28, CANVAS_WIDTH, 28);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
        const cameraLabel = state.backendMode ? 'CAM-01 [LOCAL WEBCAM]' : 'CAM-01 [DEMO BORDER SECTOR]';
        ctx.fillText(`${cameraLabel} | FPS: ${state.latestTelemetry.fps} | YOLO26s: ${state.latestTelemetry.yoloMs}ms | Verifier: ${state.latestTelemetry.verifierMs}ms | ${ts}`, 14, CANVAS_HEIGHT - 10);
    }

    /**
     * History Logs & Incident Modal
     */
    async function loadHistoryLogs() {
        const filter = {
            search: elements.filterSearch.value,
            eventType: elements.filterEventType.value,
            severity: elements.filterSeverity.value,
            camera: elements.filterCamera.value
        };

        const logs = await IbvapApi.getHistoryLogs(filter);

        // Apply sorting
        const col = state.historySort.column;
        const asc = state.historySort.ascending;

        logs.sort((a, b) => {
            let valA = a[col] || '';
            let valB = b[col] || '';
            if (col === 'timestamp') {
                valA = new Date(valA).getTime();
                valB = new Date(valB).getTime();
            }
            if (valA < valB) return asc ? -1 : 1;
            if (valA > valB) return asc ? 1 : -1;
            return 0;
        });

        renderHistoryTable(logs);
    }

    function renderHistoryTable(logs) {
        elements.historyTableBody.innerHTML = '';
        elements.historyResultsCount.textContent = `Showing ${logs.length} incident records`;

        if (logs.length === 0) {
            elements.historyTableBody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 30px;">
                        No incident records match the selected filters.
                    </td>
                </tr>
            `;
            return;
        }

        logs.forEach(inc => {
            const tr = document.createElement('tr');

            // Severity badge
            let sevBadgeClass = 'badge-info';
            if (inc.severity === 'CRITICAL') sevBadgeClass = 'badge-critical';
            else if (inc.severity === 'WARNING') sevBadgeClass = 'badge-warning';

            // Intrusion badge
            const isIntrusionBadge = inc.isIntrusion
                ? '<span class="badge-pill badge-critical">YES</span>'
                : '<span class="badge-pill badge-muted">NO</span>';

            // Status badge
            let statusBadgeClass = 'badge-muted';
            if (inc.status === 'Resolved') statusBadgeClass = 'badge-success';
            else if (inc.status === 'Acknowledged' || inc.status === 'Investigating') statusBadgeClass = 'badge-warning';

            // Evidence link
            const evidenceHtml = inc.evidenceAvailable
                ? `<span class="evidence-thumb-link" data-id="${inc.id}">📷 View</span>`
                : `<span style="color: var(--text-muted); font-size: 11px;">None</span>`;

            tr.innerHTML = `
                <td style="font-family: var(--font-mono); font-weight: 600;">${inc.id}</td>
                <td style="font-family: var(--font-mono); color: var(--text-secondary);">${inc.timestamp}</td>
                <td>${inc.cameraId}</td>
                <td style="font-family: var(--font-mono);">${inc.eventType}</td>
                <td><span class="badge-pill ${sevBadgeClass}">${inc.severity}</span></td>
                <td>${isIntrusionBadge}</td>
                <td>${inc.alarmState}</td>
                <td>${evidenceHtml}</td>
                <td><span class="badge-pill ${statusBadgeClass}">${inc.status}</span></td>
                <td style="text-align: right;">
                    <button class="btn btn-secondary btn-dossier" data-id="${inc.id}" style="padding: 4px 10px; font-size: 11px;">
                        Inspect
                    </button>
                </td>
            `;

            elements.historyTableBody.appendChild(tr);
        });

        // Attach inspect handlers
        elements.historyTableBody.querySelectorAll('.btn-dossier, .evidence-thumb-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.getAttribute('data-id');
                openIncidentModal(id);
            });
        });
    }

    /**
     * Open Incident Dossier Modal
     */
    async function openIncidentModal(incidentId) {
        const inc = await IbvapApi.getIncidentDetails(incidentId);
        if (!inc) {
            showToast('Incident not found.', 'error');
            return;
        }

        state.activeModalIncident = inc;

        elements.modalIncidentId.textContent = inc.id;
        elements.modalSeverityBadge.className = `badge-pill ${inc.severity === 'CRITICAL' ? 'badge-critical' : inc.severity === 'WARNING' ? 'badge-warning' : 'badge-info'}`;
        elements.modalSeverityBadge.textContent = inc.severity;

        // Never assign an empty src: browsers can interpret it as the current page
        // and display a broken-image icon. Only load snapshots the backend confirms exist.
        const evidenceUrl = inc.evidenceAvailable && inc.evidenceSnapshot
            ? inc.evidenceSnapshot
            : '';
        elements.modalEvidenceImg.onload = null;
        elements.modalEvidenceImg.onerror = null;
        elements.modalEvidenceImg.hidden = true;
        elements.modalEvidencePlaceholder.hidden = false;
        elements.btnDownloadEvidence.disabled = !evidenceUrl;
        elements.modalEvidencePlaceholder.querySelector('strong').textContent = evidenceUrl
            ? 'Loading evidence snapshot…'
            : 'No evidence snapshot';
        elements.modalEvidencePlaceholder.querySelector('span:last-child').textContent = evidenceUrl
            ? 'Loading the image saved for this event.'
            : 'This event has no saved image. New operator actions and intrusion events may have their own snapshots.';
        if (evidenceUrl) {
            elements.modalEvidenceImg.onload = () => {
                elements.modalEvidenceImg.hidden = false;
                elements.modalEvidencePlaceholder.hidden = true;
                elements.btnDownloadEvidence.disabled = false;
            };
            elements.modalEvidenceImg.onerror = () => {
                elements.modalEvidenceImg.hidden = true;
                elements.modalEvidencePlaceholder.hidden = false;
                elements.modalEvidencePlaceholder.querySelector('strong').textContent = 'Evidence image unavailable';
                elements.modalEvidencePlaceholder.querySelector('span:last-child').textContent = 'The event references an image, but the backend could not serve it. Check logs/evidence and the bridge.';
                elements.btnDownloadEvidence.disabled = true;
            };
            elements.modalEvidenceImg.src = evidenceUrl + (evidenceUrl.includes('?') ? '&' : '?') + 'ts=' + Date.now();
        } else {
            elements.modalEvidenceImg.removeAttribute('src');
        }
        elements.modalEvidenceTimestamp.textContent = inc.timestamp;

        elements.modalCameraId.textContent = inc.cameraId;
        elements.modalEventType.textContent = inc.eventType;
        elements.modalObjectClass.textContent = inc.objectClass || 'Person';
        elements.modalTrackConfidence.textContent = inc.trackId !== null
            ? `Track #${inc.trackId} (${Math.round((inc.confidence || 0.8) * 100)}%)`
            : 'N/A';

        elements.modalZoneBreach.innerHTML = inc.isIntrusion
            ? '<span style="color: var(--color-intrusion);">YES (Boundary Overlap Verified)</span>'
            : '<span style="color: var(--color-normal);">NO (Outside Perimeter)</span>';

        elements.modalAlarmAction.textContent = inc.alarmState || 'Triggered';
        elements.modalSessionId.textContent = inc.sessionId || 'N/A';

        elements.modalStatusSelect.value = inc.status || 'Unacknowledged';
        elements.modalNotesInput.value = inc.operatorNotes || '';

        elements.incidentModal.classList.add('active');
    }

    function closeIncidentModal() {
        elements.incidentModal.classList.remove('active');
        state.activeModalIncident = null;
    }

    /**
     * Setup History Filters & Table Event Listeners
     */
    function setupHistoryTableListeners() {
        elements.filterSearch.addEventListener('input', () => loadHistoryLogs());
        elements.filterEventType.addEventListener('change', () => loadHistoryLogs());
        elements.filterSeverity.addEventListener('change', () => loadHistoryLogs());
        elements.filterCamera.addEventListener('change', () => loadHistoryLogs());

        elements.btnResetFilters.addEventListener('click', () => {
            elements.filterSearch.value = '';
            elements.filterEventType.value = 'ALL';
            elements.filterSeverity.value = 'ALL';
            elements.filterCamera.value = 'ALL';
            loadHistoryLogs();
            showToast('Filters cleared.', 'info');
        });

        // Export CSV
        elements.btnExportCsv.addEventListener('click', async () => {
            const csv = await IbvapApi.exportLogsAsCsv({
                search: elements.filterSearch.value,
                eventType: elements.filterEventType.value,
                severity: elements.filterSeverity.value,
                camera: elements.filterCamera.value
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `IBVAP_incidents_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Exported incident history CSV.', 'success');
        });

        // Table Header Sorting
        elements.historyTable.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.getAttribute('data-sort');
                if (state.historySort.column === col) {
                    state.historySort.ascending = !state.historySort.ascending;
                } else {
                    state.historySort.column = col;
                    state.historySort.ascending = true;
                }
                loadHistoryLogs();
            });
        });

        // Modal Close Buttons
        elements.modalCloseBtn.addEventListener('click', closeIncidentModal);
        elements.modalCloseFooterBtn.addEventListener('click', closeIncidentModal);
        elements.incidentModal.addEventListener('click', (e) => {
            if (e.target === elements.incidentModal) closeIncidentModal();
        });

        // Save Acknowledgement & Notes
        elements.btnSaveAcknowledgement.addEventListener('click', async () => {
            if (!state.activeModalIncident) return;
            const newStatus = elements.modalStatusSelect.value;
            const newNotes = elements.modalNotesInput.value.trim();

            await IbvapApi.acknowledgeIncident(state.activeModalIncident.id, newStatus, newNotes);
            showToast(`Incident ${state.activeModalIncident.id} updated to ${newStatus}.`, 'success');
            closeIncidentModal();
            loadHistoryLogs();
        });

        // Download Evidence Image
        elements.btnDownloadEvidence.addEventListener('click', () => {
            if (!state.activeModalIncident || !state.activeModalIncident.evidenceAvailable || !state.activeModalIncident.evidenceSnapshot) return;
            const a = document.createElement('a');
            a.href = state.activeModalIncident.evidenceSnapshot;
            a.download = `evidence_${state.activeModalIncident.id}.jpg`;
            a.click();
            showToast('Evidence snapshot image downloaded.', 'info');
        });
    }

    // Launch app once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }

})();
