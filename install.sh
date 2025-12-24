#!/bin/bash
echo "=== ISync Installer ==="

# Auto-install tmux on Debian/Ubuntu
if ! command -v tmux &> /dev/null; then
    if command -v apt-get &> /dev/null; then
        echo "[INFO] Installing tmux..."
        sudo apt-get update && sudo apt-get install -y tmux
    else
        echo "[WARN] Please install tmux manually for background persistence."
    fi
fi

if ! command -v python3 &> /dev/null; then echo "[ERR] python3 required."; exit 1; fi

echo "[1/2] Creating venv..."
python3 -m venv venv

echo "[2/2] Installing libs..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

chmod +x run_isync.sh
echo "Done! Run: ./run_isync.sh"