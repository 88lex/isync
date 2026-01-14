@echo off
REM ISync Launcher for Windows
REM Uses Windows Terminal with PowerShell if available, falls back to regular CMD

TITLE ISync Launcher

REM Check if WSL is available
wsl --status >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: WSL is not available or not running.
    ECHO Please ensure WSL is installed and Ubuntu is set up.
    PAUSE
    EXIT /B 1
)

REM Check if Windows Terminal is available (for tab support)
where wt >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    REM Windows Terminal is available - use it with PowerShell
    ECHO Launching ISync in Windows Terminal...
    wt -w 0 new-tab --title "ISync" pwsh -NoExit -Command "wsl -d Ubuntu -e bash -c 'cd /opt/isync_refactor && ./run_isync.sh'"
    EXIT /B 0
)

REM Fallback: Check if PowerShell is available
where pwsh >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    ECHO Launching ISync in PowerShell 7...
    start "ISync" pwsh -NoExit -Command "wsl -d Ubuntu -e bash -c 'cd /opt/isync_refactor && ./run_isync.sh'"
    EXIT /B 0
)

REM Fallback: Use Windows PowerShell (powershell.exe)
where powershell >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    ECHO Launching ISync in Windows PowerShell...
    start "ISync" powershell -NoExit -Command "wsl -d Ubuntu -e bash -c 'cd /opt/isync_refactor && ./run_isync.sh'"
    EXIT /B 0
)

REM Final fallback: Run in current CMD window
ECHO ==========================================
ECHO           ISync Application Launcher
ECHO ==========================================
ECHO.
ECHO Launching ISync from WSL Ubuntu...
ECHO Starting backend on port 8000 and frontend on port 5173...
ECHO Press Ctrl+C in the WSL window to stop.
ECHO.

wsl -d Ubuntu -e bash -c "cd /opt/isync_refactor && ./run_isync.sh"

ECHO.
ECHO ISync has stopped.
PAUSE
