$ErrorActionPreference = 'Continue'
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$PidFile = Join-Path $Root 'runtime\ibvap_launcher_processes.json'
if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host 'No launcher PID record was found.' -ForegroundColor Yellow
    Write-Host 'The processes may have been started manually. Close the camera with Esc and stop manually started Python servers with Ctrl+C.'
    exit 0
}
try { $owned = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json } catch {
    Write-Host 'Could not read launcher PID file. No process was stopped.' -ForegroundColor Red
    exit 1
}
$targets = @(
    @{Name='frontend server'; Pid=$owned.frontendPid; Match='http.server 8000'},
    @{Name='Python bridge'; Pid=$owned.bridgePid; Match='ibvap_bridge.py'},
    @{Name='C++ camera engine'; Pid=$owned.enginePid; Match='ibvap_webcam_yolo26_zone_editor_integrated.exe'}
)
foreach ($target in $targets) {
    if (-not $target.Pid) { continue }
    $pidValue = 0
    if (-not [int]::TryParse([string]$target.Pid, [ref]$pidValue)) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
    if (-not $proc) { Write-Host "$($target.Name): already stopped."; continue }
    $matchesExpected = $false
    if ($target.Name -eq 'C++ camera engine') {
        $matchesExpected = $proc.ExecutablePath -and $proc.ExecutablePath.Equals((Join-Path $Root 'ibvap_webcam_yolo26_zone_editor_integrated.exe'), [StringComparison]::OrdinalIgnoreCase)
    } else {
        $matchesExpected = ([string]$proc.CommandLine).IndexOf($target.Match, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($matchesExpected) {
        try {
            Stop-Process -Id $pidValue -Force -ErrorAction Stop
            Write-Host "Stopped $($target.Name) (PID $pidValue)." -ForegroundColor Green
        } catch {
            Write-Host "Could not stop $($target.Name) (PID $pidValue): $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "Skipped PID $pidValue because it no longer matches the expected $($target.Name) process." -ForegroundColor Yellow
    }
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Write-Host 'IBVAP launcher shutdown finished. Any service that was already running before startup was left untouched.'
