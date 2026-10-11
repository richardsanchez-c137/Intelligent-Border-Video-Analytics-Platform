$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Frontend = Join-Path $Root 'frontend-antigravity'
$EngineExe = Join-Path $Root 'ibvap_webcam_yolo26_zone_editor_integrated.exe'
$BridgeScript = Join-Path $Root 'backend\ibvap_bridge.py'
$FrontendIndex = Join-Path $Frontend 'index.html'
$ApiJs = Join-Path $Frontend 'ibvap-api.js'
$Runtime = Join-Path $Root 'runtime'
$Logs = Join-Path $Root 'logs'
$PidFile = Join-Path $Runtime 'ibvap_launcher_processes.json'
$BridgeUrl = 'http://127.0.0.1:8080/api/health'
$FrontendUrl = 'http://127.0.0.1:8000/'

function Write-Step([string]$Message) { Write-Host "`n[IBVAP] $Message" -ForegroundColor Cyan }
function Test-TcpPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(400)
        if (-not $ok) { return $false }
        $client.EndConnect($async)
        return $client.Connected
    } catch { return $false } finally { $client.Close() }
}
function Get-BridgeHealth {
    try { return Invoke-RestMethod -Uri $BridgeUrl -TimeoutSec 2 } catch { return $null }
}
function Find-RunningEngine {
    try {
        return Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $_.ExecutablePath -and ([string]::Equals($_.ExecutablePath, $EngineExe, [StringComparison]::OrdinalIgnoreCase))
        } | Select-Object -First 1
    } catch { return $null }
}

Write-Host '====================================================' -ForegroundColor DarkCyan
Write-Host ' IBVAP - ONE-CLICK STARTUP' -ForegroundColor Cyan
Write-Host '====================================================' -ForegroundColor DarkCyan
Write-Host "Project: $Root"

foreach ($required in @($EngineExe, $BridgeScript, $FrontendIndex, $ApiJs)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required file not found: $required`nMake sure this launcher is placed in the IBVAP project root and the integrated executable has been compiled."
    }
}
New-Item -ItemType Directory -Force -Path $Runtime, $Logs | Out-Null

# Find Python, preferring the interpreter already seen running the bridge on this PC.
$Python = $null
$candidates = @('C:\Python314\python.exe', (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.12-64\python.exe'))
foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $Python = $candidate; break }
}
if (-not $Python) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) { $Python = $pythonCommand.Source }
}
if (-not $Python) { throw 'Python was not found. Install Python or ensure python.exe is on PATH.' }
Write-Host "Python: $Python"

$owned = [ordered]@{ startedAt = (Get-Date).ToString('o'); projectRoot = $Root; enginePid = $null; bridgePid = $null; frontendPid = $null }
function Save-OwnedProcesses {
    $owned | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding UTF8
}
Save-OwnedProcesses

# Start/reuse the local bridge. A responding IBVAP bridge is reused, avoiding duplicates.
Write-Step 'Checking backend bridge on port 8080...'
$health = Get-BridgeHealth
if ($health -and $health.bridge -eq 'online') {
    Write-Host 'Bridge is already running; reusing it.' -ForegroundColor Green
} else {
    if (Test-TcpPort 8080) { throw 'Port 8080 is occupied, but the IBVAP health endpoint did not respond. Close the unrelated process using port 8080, then run this launcher again.' }
    $bridgeOut = Join-Path $Logs 'ibvap_bridge_stdout.log'
    $bridgeErr = Join-Path $Logs 'ibvap_bridge_stderr.log'
    $bridge = Start-Process -FilePath $Python -ArgumentList ('"' + $BridgeScript + '"') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr -PassThru
    $owned.bridgePid = $bridge.Id
    Save-OwnedProcesses
    Write-Host "Started bridge (PID $($bridge.Id)). Waiting for health endpoint..."
    $deadline = (Get-Date).AddSeconds(15)
    do { Start-Sleep -Milliseconds 400; $health = Get-BridgeHealth } while ((-not $health -or $health.bridge -ne 'online') -and (Get-Date) -lt $deadline)
    if (-not $health -or $health.bridge -ne 'online') { throw "IBVAP bridge did not start. Check $bridgeErr and $bridgeOut" }
    Write-Host 'Bridge is online.' -ForegroundColor Green
}

# Start/reuse the integrated C++ process. The project root is its working directory so relative model/config paths resolve.
Write-Step 'Checking integrated C++ camera engine...'
$engine = Find-RunningEngine
if ($engine) {
    Write-Host "Integrated C++ engine is already running (PID $($engine.ProcessId)); reusing it." -ForegroundColor Green
} else {
    $engineOut = Join-Path $Logs 'ibvap_engine_stdout.log'
    $engineErr = Join-Path $Logs 'ibvap_engine_stderr.log'
    $engineProc = Start-Process -FilePath $EngineExe -WorkingDirectory $Root -WindowStyle Minimized -RedirectStandardOutput $engineOut -RedirectStandardError $engineErr -PassThru
    $owned.enginePid = $engineProc.Id
    Save-OwnedProcesses
    Write-Host "Started integrated camera engine (PID $($engineProc.Id)). It may take several seconds to load both ONNX models."
}

# Start/reuse the frontend static server on loopback only.
Write-Step 'Checking frontend server on port 8000...'
$frontendAlreadyServing = $false
if (Test-TcpPort 8000) {
    try {
        $response = Invoke-WebRequest -Uri $FrontendUrl -TimeoutSec 3 -UseBasicParsing
        if ($response.StatusCode -eq 200 -and $response.Content -match '(?i)IBVAP|Intelligent Border') {
            $frontendAlreadyServing = $true
            Write-Host 'A frontend page is already being served on port 8000; reusing it.' -ForegroundColor Green
        } else {
            throw 'Port 8000 is occupied by a different HTTP service. Close it or change the frontend port before retrying.'
        }
    } catch {
        if ($_.Exception.Message -match 'different HTTP service') { throw }
        throw 'Port 8000 is already in use, but the IBVAP frontend did not respond. Close the other service and retry.'
    }
} else {
    $frontOut = Join-Path $Logs 'ibvap_frontend_stdout.log'
    $frontErr = Join-Path $Logs 'ibvap_frontend_stderr.log'
    $frontProc = Start-Process -FilePath $Python -ArgumentList '-m http.server 8000 --bind 127.0.0.1' -WorkingDirectory $Frontend -WindowStyle Hidden -RedirectStandardOutput $frontOut -RedirectStandardError $frontErr -PassThru
    $owned.frontendPid = $frontProc.Id
    Save-OwnedProcesses
    Write-Host "Started frontend HTTP server (PID $($frontProc.Id))."
    $deadline = (Get-Date).AddSeconds(10)
    $frontReady = $false
    do {
        Start-Sleep -Milliseconds 350
        try { $r = Invoke-WebRequest -Uri $FrontendUrl -TimeoutSec 2 -UseBasicParsing; $frontReady = ($r.StatusCode -eq 200) } catch { $frontReady = $false }
    } while (-not $frontReady -and (Get-Date) -lt $deadline)
    if (-not $frontReady) { throw "Frontend server did not respond. Check $frontErr and $frontOut" }
}

# Report mode without silently changing the user's chosen frontend setting.
$apiText = Get-Content -LiteralPath $ApiJs -Raw
if ($apiText -match "mode\s*:\s*'demo'") {
    Write-Warning "Frontend is configured for DEMO mode. To use the real camera data, change CONFIG.mode to 'backend' in frontend-antigravity\ibvap-api.js, save it, then refresh the browser."
}

# Wait briefly for the C++ telemetry file to become fresh.
Write-Step 'Waiting for camera engine telemetry...'
$deadline = (Get-Date).AddSeconds(60)
$health = Get-BridgeHealth
while ((-not $health -or -not $health.engineConnected) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $health = Get-BridgeHealth
}
if ($health -and $health.engineConnected) {
    Write-Host 'LIVE BACKEND CONNECTED — camera engine is publishing telemetry.' -ForegroundColor Green
} else {
    Write-Warning "The bridge/frontend are running, but the engine has not connected yet. Check logs\ibvap_engine_stderr.log and runtime\state.json."
}

# Persist only PIDs this launcher itself started, so Stop_IBVAP can avoid killing reused/manual processes.
Save-OwnedProcesses
Write-Host ''
Write-Host 'IBVAP startup complete.' -ForegroundColor Green
Write-Host "Frontend: $FrontendUrl"
Write-Host "Backend health: $BridgeUrl"
Write-Host "Logs: $Logs"
Start-Process $FrontendUrl
Write-Host 'Your browser has been opened. Keep the project folders in place while IBVAP runs.'
