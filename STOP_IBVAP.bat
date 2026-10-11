@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0STOP_IBVAP.ps1"
if errorlevel 1 (
  echo.
  echo IBVAP shutdown reported a problem. Read the message above.
)
echo.
pause
endlocal
