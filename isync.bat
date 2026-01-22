@echo off
REM =======================================================================================
REM ISync Windows Stub
REM =======================================================================================
REM This script is a lightweight wrapper that delegates execution to the unified
REM ./isync Bash script running inside WSL.
REM
REM It supports command pass-through, so you can run:
REM   run_isync.bat           -> ./isync start
REM   run_isync.bat stop      -> ./isync stop
REM   run_isync.bat ssh host  -> ./isync ssh host
REM =======================================================================================

TITLE ISync Launcher

REM Check if WSL is available
wsl --status >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO ERROR: WSL is not available os not running.
    ECHO Please ensure WSL is installed and Ubuntu is set up.
    PAUSE
    EXIT /B 1
)

REM Construct the command to run in WSL
REM We pass all arguments (%*) to the ./isync script
REM If no arguments, we default to "start" implicitly by calling ./isync with no args

SET "WSL_CMD=cd /opt/isync && ./isync %*"

REM --- TERMINAL DETECTION & LAUNCH ---

REM 1. Windows Terminal (Preferred)
where wt >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    ECHO Launching ISync in Windows Terminal...
    wt -w 0 new-tab --title "ISync" pwsh -NoExit -Command "wsl -d Ubuntu -e bash -c '%WSL_CMD%'"
    EXIT /B 0
)

REM 2. PowerShell 7 (Core)
where pwsh >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    ECHO Launching ISync in PowerShell 7...
    start "ISync" pwsh -NoExit -Command "wsl -d Ubuntu -e bash -c '%WSL_CMD%'"
    EXIT /B 0
)

REM 3. Windows PowerShell (Legacy)
where powershell >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    ECHO Launching ISync in Windows PowerShell...
    start "ISync" powershell -NoExit -Command "wsl -d Ubuntu -e bash -c '%WSL_CMD%'"
    EXIT /B 0
)

REM 4. CMD Fallback (Last Resort)
ECHO Launching ISync in CMD...
wsl -d Ubuntu -e bash -c "%WSL_CMD%"
PAUSE
