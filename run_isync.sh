#!/bin/bash
# ISync Launcher for Linux/WSL
# Starts both backend and frontend services
#
# Usage:
#   ./run_isync.sh           # Interactive mode (prompts if already running)
#   ./run_isync.sh --force   # Force restart without prompts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
FORCE_MODE=false
if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then
    FORCE_MODE=true
fi

echo -e "${BLUE}=== ISync Launcher ===${NC}"
echo "Working directory: $SCRIPT_DIR"

# Check if already running
BACKEND_RUNNING=false
FRONTEND_RUNNING=false

if pgrep -f 'uvicorn.*backend.main' > /dev/null 2>&1; then
    BACKEND_RUNNING=true
fi

if pgrep -f 'vite.*5173' > /dev/null 2>&1; then
    FRONTEND_RUNNING=true
fi

if [ "$BACKEND_RUNNING" = true ] || [ "$FRONTEND_RUNNING" = true ]; then
    echo ""
    echo -e "${YELLOW}⚠ ISync is already running:${NC}"
    if [ "$BACKEND_RUNNING" = true ]; then
        BACKEND_PID=$(pgrep -f 'uvicorn.*backend.main' | head -1)
        echo -e "  Backend:  ${GREEN}Running${NC} (PID: $BACKEND_PID)"
    else
        echo -e "  Backend:  ${RED}Stopped${NC}"
    fi
    if [ "$FRONTEND_RUNNING" = true ]; then
        FRONTEND_PID=$(pgrep -f 'vite.*5173' | head -1)
        echo -e "  Frontend: ${GREEN}Running${NC} (PID: $FRONTEND_PID)"
    else
        echo -e "  Frontend: ${RED}Stopped${NC}"
    fi
    
    if [ "$FORCE_MODE" = true ]; then
        # Force mode: stop existing and restart without prompts
        echo ""
        echo -e "${YELLOW}Force mode: Stopping existing ISync...${NC}"
        pkill -f 'uvicorn.*backend.main' 2>/dev/null
        pkill -f 'vite.*5173' 2>/dev/null
        pkill -f 'npm.*dev' 2>/dev/null
        sleep 2
        echo -e "${GREEN}Stopped. Starting fresh...${NC}"
    else
        # Interactive mode: ask user
        echo ""
        echo "Options:"
        echo "  [R] Restart - Stop existing and start fresh"
        echo "  [O] Open browser only (don't restart)"
        echo "  [Q] Quit"
        echo ""
        read -p "Choice [R/O/Q]: " choice
        
        case "${choice,,}" in
            r|restart)
                echo ""
                echo -e "${YELLOW}Stopping existing ISync...${NC}"
                pkill -f 'uvicorn.*backend.main' 2>/dev/null
                pkill -f 'vite.*5173' 2>/dev/null
                pkill -f 'npm.*dev' 2>/dev/null
                sleep 2
                echo -e "${GREEN}Stopped. Starting fresh...${NC}"
                ;;
            o|open)
                echo ""
                echo -e "${GREEN}Opening browser...${NC}"
                if command -v xdg-open &> /dev/null; then
                    xdg-open "http://localhost:5173" 2>/dev/null &
                elif grep -qi microsoft /proc/version 2>/dev/null; then
                    cmd.exe /c start "http://localhost:5173" 2>/dev/null &
                fi
                echo ""
                echo "  Frontend: http://localhost:5173"
                echo "  Backend:  http://localhost:8000"
                exit 0
                ;;
            q|quit|*)
                echo "Exiting."
                exit 0
                ;;
        esac
    fi
fi

# Check if venv exists
if [ ! -d "venv" ]; then
    echo -e "${RED}ERROR: Virtual environment not found at $SCRIPT_DIR/venv${NC}"
    echo "Please create it with: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Check if uvicorn is available
if ! command -v uvicorn &> /dev/null; then
    echo -e "${YELLOW}uvicorn not found. Installing requirements...${NC}"
    pip install -r requirements.txt
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down ISync...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

# Start backend
echo -e "${BLUE}Starting backend on port 8000...${NC}"
uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend is ready!${NC}"
        break
    fi
    sleep 1
done

# Start frontend
echo -e "${BLUE}Starting frontend on port 5173...${NC}"
cd frontend
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!
cd ..

# Wait a moment for frontend to start
sleep 3

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  ISync is running!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

# Open browser (works in WSL and native Linux)
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:5173" 2>/dev/null &
elif grep -qi microsoft /proc/version 2>/dev/null; then
    # WSL - use Windows browser
    cmd.exe /c start "http://localhost:5173" 2>/dev/null &
fi

# Wait for processes
wait $BACKEND_PID $FRONTEND_PID
