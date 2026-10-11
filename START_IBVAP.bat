@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0START_IBVAP.ps1"
if errorlevel 1 (
  echo.
  echo IBVAP could not be started. Read the message above.
)
echo.
pause
endlocal
