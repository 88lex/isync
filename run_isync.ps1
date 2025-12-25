$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

$host.UI.RawUI.WindowTitle = "ISync Manager"

if (-not (Test-Path "keys")) { New-Item -ItemType Directory -Path "keys" | Out-Null }
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

if (-not (Test-Path "venv")) {
    Write-Host "Run install.bat first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit
}

# Activate Venv
. "$ScriptDir\venv\Scripts\Activate.ps1"

Write-Host "ISync is running. DO NOT CLOSE THIS WINDOW." -ForegroundColor Cyan

streamlit run isync_ui.py
Read-Host "Press Enter to exit"