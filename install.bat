@echo off
TITLE ISync Installer
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 ( ECHO Python not found & PAUSE & EXIT /B )
python -m venv venv
call venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt

ECHO Creating directories...
IF NOT EXIST keys mkdir keys
IF NOT EXIST logs mkdir logs

ECHO Setup Complete! Run run_isync.bat
PAUSE