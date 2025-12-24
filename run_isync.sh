#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

SESSION_NAME="isync"

# Ensure runtime directories exist
mkdir -p keys
mkdir -p logs

# 1. Check Tmux
if ! command -v tmux &> /dev/null; then
    echo "⚠️  Tmux not installed. Running in foreground (risk of disconnect)."
    read -p "Continue? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        source venv/bin/activate
        streamlit run isync_ui.py
    fi
    exit 1
fi

# 2. Check Context (Are we already inside tmux?)
if [ -n "$TMUX" ]; then
    echo "✅ Detected existing tmux session."
    echo "   Running ISync directly in current pane..."
    source venv/bin/activate
    streamlit run isync_ui.py
    exit 0
fi

# 3. Handle External Launch (Create or Attach Session)
tmux has-session -t $SESSION_NAME 2>/dev/null
if [ $? != 0 ]; then
    echo "🚀 Creating new background session 'isync'..."
    tmux new-session -d -s $SESSION_NAME
    tmux send-keys -t $SESSION_NAME "cd \"$DIR\"" C-m
    tmux send-keys -t $SESSION_NAME "source venv/bin/activate" C-m
    tmux send-keys -t $SESSION_NAME "streamlit run isync_ui.py" C-m
fi

echo "✅ Attaching to background session..."
echo "   Logs are being written to: logs/isync.log"
echo "   (To detach and keep running: Ctrl+B, then D)"
tmux attach -t $SESSION_NAME