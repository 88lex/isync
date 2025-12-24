@echo off
TITLE ISync Manager
CD /D "%~dp0"

IF NOT EXIST keys mkdir keys
IF NOT EXIST logs mkdir logs

IF NOT EXIST venv ( ECHO Run install.bat first & PAUSE & EXIT /B )
call venv\Scripts\activate
ECHO ISync is running. DO NOT CLOSE THIS WINDOW.
streamlit run isync_ui.py
PAUSE