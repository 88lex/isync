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

REM --- RUNNING CHECK (Optional but helpful for native Windows detection) ---
netstat -ano | findstr :8000 >nul
IF %ERRORLEVEL% EQU 0 SET "BACKEND_UP=1"
netstat -ano | findstr :5173 >nul
IF %ERRORLEVEL% EQU 0 SET "FRONTEND_UP=1"

IF "%BACKEND_UP%"=="1" (
    ECHO.
    ECHO [!] ISync Backend or port 8000 is already in use.
)
IF "%FRONTEND_UP%"=="1" (
    ECHO [!] ISync Frontend or port 5173 is already in use.
)

IF "%BACKEND_UP%"=="1" (
    GOTO :ALREADY_RUNNING
)
IF "%FRONTEND_UP%"=="1" (
    GOTO :ALREADY_RUNNING
)
GOTO :PROCEED

:ALREADY_RUNNING
ECHO.
ECHO ISync appears to be already running.
ECHO [R] Restart - Stop existing and start fresh
ECHO [O] Open browser only (don't restart)
ECHO [Q] Quit
ECHO.
SET /P choice="Choice [R,O,Q]: "
IF /I "%choice%"=="R" (
    ECHO Killing existing ISync processes...
    FOR /F "tokens=5" %%P IN ('netstat -ano ^| findstr :8000') DO taskkill /F /PID %%P >nul 2>&1
    FOR /F "tokens=5" %%P IN ('netstat -ano ^| findstr :5173') DO taskkill /F /PID %%P >nul 2>&1
    TIMEOUT /T 2 >nul
    GOTO :PROCEED
)
IF /I "%choice%"=="O" (
    ECHO Opening browser at http://localhost:5173...
    start http://localhost:5173
    EXIT /B 0
)
IF /I "%choice%"=="Q" EXIT /B 0
GOTO :ALREADY_RUNNING

:PROCEED

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
