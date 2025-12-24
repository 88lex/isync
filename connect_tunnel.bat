@echo off
TITLE ISync SSH Tunnel
ECHO ========================================================
ECHO  ISync Remote Access (Mode 3: SSH Tunnel)
ECHO ========================================================
ECHO.
ECHO This will forward http://localhost:8501 to your remote server.
ECHO Use this if the server is NOT on Tailscale/VPN.
ECHO.
SET /P REMOTE_HOST="Enter Remote Host (e.g. user@1.2.3.4): "

ECHO.
ECHO [STATUS] Opening Tunnel... Keep this window OPEN.
ECHO [ACTION] Open your browser to: http://localhost:8501
ECHO.
ssh -L 8501:localhost:8501 %REMOTE_HOST% -N
PAUSE