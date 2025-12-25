@echo off
CD /D "%~dp0"

REM Check for PowerShell and launch ps1 script if available
where powershell >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    start "" powershell -NoProfile -ExecutionPolicy Bypass -File "run_isync.ps1"
    EXIT
)

TITLE ISync Manager
IF NOT EXIST keys mkdir keys
IF NOT EXIST logs mkdir logs

IF NOT EXIST venv ( ECHO Run install.bat first & PAUSE & EXIT /B )
call venv\Scripts\activate
ECHO ISync is running. DO NOT CLOSE THIS WINDOW.
streamlit run isync_ui.py
PAUSE