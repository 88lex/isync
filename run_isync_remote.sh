#!/bin/bash
#
# ISync Remote Launcher
# Starts ISync on a remote server and opens the UI locally via SSH tunnel
#
# Usage: 
#   ./run_isync_remote.sh [ssh-host] [remote-path]    # Start and connect
#   ./run_isync_remote.sh --list                       # List saved servers
#   ./run_isync_remote.sh --status [ssh-host]          # Check remote status
#   ./run_isync_remote.sh --restart [ssh-host]         # Restart remote ISync
#   ./run_isync_remote.sh --stop [ssh-host]            # Stop remote ISync
#
# Examples:
#   ./run_isync_remote.sh myserver                    # Uses default path ~/isync
#   ./run_isync_remote.sh myserver /opt/isync         # Custom remote path
#   ./run_isync_remote.sh user@server.com ~/isync     # Full SSH host
#   ./run_isync_remote.sh --status myserver           # Check if running
#   ./run_isync_remote.sh --restart myserver          # Restart ISync
#

set -e

# Configuration
LOCAL_FRONTEND_PORT=5173
LOCAL_BACKEND_PORT=8000
REMOTE_FRONTEND_PORT=5173
REMOTE_BACKEND_PORT=8000
CONFIG_EXPORT_FILE="$HOME/.isync_servers.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  ISync Remote Launcher${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_usage() {
    echo ""
    echo "Usage: $0 [OPTIONS] <ssh-host> [remote-path]"
    echo ""
    echo "Commands:"
    echo "  (default)          Start ISync on remote and open tunnel"
    echo "  --list             List saved servers from ISync config"
    echo "  --status <host>    Check if ISync is running on remote"
    echo "  --restart <host>   Restart ISync on remote server"
    echo "  --stop <host>      Stop ISync on remote server"
    echo "  --help             Show this help message"
    echo ""
    echo "Arguments:"
    echo "  ssh-host     SSH host (e.g., myserver, user@server.com)"
    echo "  remote-path  Path to ISync on remote server (default: ~/isync)"
    echo ""
    echo "Examples:"
    echo "  $0 myserver"
    echo "  $0 myserver /opt/isync_refactor"
    echo "  $0 --status myserver"
    echo "  $0 --restart user@192.168.1.100"
    echo ""
}

# Export servers from local ISync API (if running)
export_servers() {
    if curl -s http://localhost:8000/api/ssh/servers/export > /dev/null 2>&1; then
        curl -s http://localhost:8000/api/ssh/servers/export > "$CONFIG_EXPORT_FILE"
        return 0
    fi
    return 1
}

# List saved servers
list_servers() {
    print_header
    echo ""
    echo -e "${YELLOW}Saved SSH Servers:${NC}"
    echo ""
    
    # Try to export from running ISync
    if export_servers; then
        if command -v jq &> /dev/null; then
            jq -r '.servers[] | "  [\(.id)] \(.name)\n       Host: \(.alias // (.user + "@" + .host))  Path: \(.remote_path)\n"' "$CONFIG_EXPORT_FILE" 2>/dev/null || echo "  No servers configured"
        else
            cat "$CONFIG_EXPORT_FILE"
        fi
    elif [ -f "$CONFIG_EXPORT_FILE" ]; then
        echo "  (Using cached server list)"
        if command -v jq &> /dev/null; then
            jq -r '.servers[] | "  [\(.id)] \(.name)\n       Host: \(.alias // (.user + "@" + .host))  Path: \(.remote_path)\n"' "$CONFIG_EXPORT_FILE" 2>/dev/null || echo "  No servers configured"
        else
            cat "$CONFIG_EXPORT_FILE"
        fi
    else
        echo -e "  ${RED}No saved servers found.${NC}"
        echo "  Start ISync locally and add servers via the Remote Servers page."
    fi
    echo ""
}

check_ssh_connection() {
    local host="$1"
    echo -e "${YELLOW}Checking SSH connection to ${host}...${NC}"
    if ssh -o ConnectTimeout=5 -o BatchMode=yes "${host}" "echo 'OK'" &>/dev/null; then
        echo -e "${GREEN}✓ SSH connection successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Cannot connect to ${host}${NC}"
        echo "  Please ensure:"
        echo "  - SSH host is correct"
        echo "  - SSH key is configured (or use ssh-agent)"
        echo "  - Host is reachable"
        return 1
    fi
}

check_isync_installed() {
    local host="$1"
    local path="$2"
    echo -e "${YELLOW}Checking ISync installation at ${path}...${NC}"
    if ssh "${host}" "test -f ${path}/run_isync.sh"; then
        echo -e "${GREEN}✓ ISync found at ${path}${NC}"
        return 0
    else
        echo -e "${RED}✗ ISync not found at ${path}${NC}"
        echo "  Please ensure ISync is installed on the remote server"
        return 1
    fi
}

# Check remote ISync status
check_status() {
    local host="$1"
    local path="${2:-~/isync}"
    
    print_header
    echo ""
    echo -e "${CYAN}Checking ISync status on ${host}...${NC}"
    echo ""
    
    check_ssh_connection "$host" || return 1
    
    local check_cmd="
        cd ${path} 2>/dev/null && echo 'PATH_OK' || echo 'PATH_NOT_FOUND';
        tmux has-session -t isync 2>/dev/null && echo 'TMUX_SESSION_EXISTS' || echo 'TMUX_SESSION_MISSING';
        pgrep -f 'uvicorn.*backend.main' >/dev/null && echo 'BACKEND_RUNNING' || echo 'BACKEND_STOPPED';
        pgrep -f 'vite.*5173' >/dev/null && echo 'FRONTEND_RUNNING' || echo 'FRONTEND_STOPPED';
        curl -s http://localhost:8000/health 2>/dev/null && echo 'BACKEND_HEALTHY' || echo 'BACKEND_UNHEALTHY';
    "
    
    local output
    output=$(ssh "${host}" "$check_cmd" 2>/dev/null)
    
    echo "Status Report:"
    echo "─────────────────────────────"
    
    if echo "$output" | grep -q "PATH_NOT_FOUND"; then
        echo -e "  Path:      ${RED}Not Found${NC}"
    else
        echo -e "  Path:      ${GREEN}OK${NC} (${path})"
    fi
    
    if echo "$output" | grep -q "TMUX_SESSION_EXISTS"; then
        echo -e "  Tmux:      ${GREEN}Active${NC} (session: isync)"
    else
        echo -e "  Tmux:      ${YELLOW}No Session${NC}"
    fi
    
    if echo "$output" | grep -q "BACKEND_RUNNING"; then
        echo -e "  Backend:   ${GREEN}Running${NC}"
    else
        echo -e "  Backend:   ${RED}Stopped${NC}"
    fi
    
    if echo "$output" | grep -q "FRONTEND_RUNNING"; then
        echo -e "  Frontend:  ${GREEN}Running${NC}"
    else
        echo -e "  Frontend:  ${RED}Stopped${NC}"
    fi
    
    if echo "$output" | grep -q "BACKEND_HEALTHY"; then
        echo -e "  API:       ${GREEN}Healthy${NC}"
    else
        echo -e "  API:       ${RED}Unhealthy${NC}"
    fi
    
    echo ""
    
    if echo "$output" | grep -q "BACKEND_RUNNING" && echo "$output" | grep -q "FRONTEND_RUNNING"; then
        echo -e "${GREEN}ISync is running on ${host}${NC}"
        return 0
    else
        echo -e "${YELLOW}ISync is NOT fully running on ${host}${NC}"
        return 1
    fi
}

start_remote_isync() {
    local host="$1"
    local path="$2"
    
    echo -e "${YELLOW}Starting ISync on remote server...${NC}"
    
    # Start ISync in a detached tmux session on the remote server
    ssh "${host}" "cd ${path} && \
        (tmux has-session -t isync 2>/dev/null && echo 'ISync session exists' || \
        tmux new-session -d -s isync './run_isync.sh')"
    
    echo -e "${GREEN}✓ ISync started in tmux session 'isync'${NC}"
    echo "  To attach to remote session: ssh ${host} -t 'tmux attach -t isync'"
}

stop_remote_isync() {
    local host="$1"
    
    print_header
    echo ""
    echo -e "${YELLOW}Stopping ISync on ${host}...${NC}"
    
    check_ssh_connection "$host" || return 1
    
    ssh "${host}" "
        tmux kill-session -t isync 2>/dev/null;
        pkill -f 'uvicorn.*backend.main' 2>/dev/null;
        pkill -f 'vite.*5173' 2>/dev/null;
        pkill -f 'npm.*dev' 2>/dev/null;
        echo 'STOPPED'
    "
    
    echo -e "${GREEN}✓ ISync stopped on ${host}${NC}"
}

restart_remote_isync() {
    local host="$1"
    local path="${2:-~/isync}"
    
    print_header
    echo ""
    echo -e "${YELLOW}Restarting ISync on ${host}...${NC}"
    
    check_ssh_connection "$host" || return 1
    check_isync_installed "$host" "$path" || return 1
    
    ssh "${host}" "
        tmux kill-session -t isync 2>/dev/null;
        pkill -f 'uvicorn.*backend.main' 2>/dev/null;
        pkill -f 'vite.*5173' 2>/dev/null;
        sleep 2;
        cd ${path} && tmux new-session -d -s isync './run_isync.sh' && echo 'RESTARTED'
    "
    
    echo -e "${GREEN}✓ ISync restarted on ${host}${NC}"
    echo ""
    echo "To connect to this server:"
    echo "  $0 ${host} ${path}"
}

wait_for_backend() {
    local host="$1"
    echo -e "${YELLOW}Waiting for backend to be ready...${NC}"
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if ssh "${host}" "curl -s http://localhost:${REMOTE_BACKEND_PORT}/health" 2>/dev/null | grep -q "running"; then
            echo -e "${GREEN}✓ Backend is ready${NC}"
            return 0
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 1
    done
    
    echo ""
    echo -e "${YELLOW}⚠ Backend may not be fully ready yet, continuing...${NC}"
    return 0
}

open_browser() {
    local url="http://localhost:${LOCAL_FRONTEND_PORT}"
    echo -e "${YELLOW}Opening browser at ${url}...${NC}"
    
    # Detect OS and open browser
    case "$(uname -s)" in
        Linux*)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                # WSL - use Windows browser
                cmd.exe /c start "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null
            else
                xdg-open "$url" 2>/dev/null
            fi
            ;;
        Darwin*)
            open "$url"
            ;;
        MINGW*|CYGWIN*)
            start "$url"
            ;;
    esac
    
    echo -e "${GREEN}✓ Browser opened${NC}"
}

start_tunnel() {
    local host="$1"
    local path="$2"
    
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  ISync is running!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${BLUE}Local UI:${NC}      http://localhost:${LOCAL_FRONTEND_PORT}"
    echo -e "  ${BLUE}Remote Host:${NC}   ${host}"
    echo -e "  ${BLUE}Remote Path:${NC}   ${path}"
    echo ""
    echo -e "  ${YELLOW}Press Ctrl+C to disconnect (ISync keeps running on remote)${NC}"
    echo ""
    
    # Open browser after a short delay
    (sleep 2 && open_browser) &
    
    # Start SSH tunnel with port forwarding
    # This keeps the connection open and forwards both ports
    ssh -N \
        -L ${LOCAL_FRONTEND_PORT}:localhost:${REMOTE_FRONTEND_PORT} \
        -L ${LOCAL_BACKEND_PORT}:localhost:${REMOTE_BACKEND_PORT} \
        "${host}"
}

cleanup() {
    local host="$1"
    local path="$2"
    echo ""
    echo -e "${YELLOW}Disconnecting from remote server...${NC}"
    echo -e "${GREEN}ISync continues running on ${host}${NC}"
    echo ""
    echo "Useful commands:"
    echo "  Stop ISync:    $0 --stop ${host}"
    echo "  Restart:       $0 --restart ${host} ${path}"
    echo "  Check status:  $0 --status ${host}"
    echo "  Reconnect:     $0 ${host} ${path}"
    exit 0
}

# Main
print_header

# Parse arguments
case "${1:-}" in
    --help|-h)
        print_usage
        exit 0
        ;;
    --list|-l)
        list_servers
        exit 0
        ;;
    --status|-s)
        if [ -z "${2:-}" ]; then
            echo -e "${RED}Error: SSH host required${NC}"
            echo "Usage: $0 --status <ssh-host> [remote-path]"
            exit 1
        fi
        check_status "$2" "${3:-~/isync}"
        exit $?
        ;;
    --stop)
        if [ -z "${2:-}" ]; then
            echo -e "${RED}Error: SSH host required${NC}"
            echo "Usage: $0 --stop <ssh-host>"
            exit 1
        fi
        stop_remote_isync "$2"
        exit $?
        ;;
    --restart|-r)
        if [ -z "${2:-}" ]; then
            echo -e "${RED}Error: SSH host required${NC}"
            echo "Usage: $0 --restart <ssh-host> [remote-path]"
            exit 1
        fi
        restart_remote_isync "$2" "${3:-~/isync}"
        exit $?
        ;;
    "")
        print_usage
        exit 1
        ;;
    *)
        # Default: start and connect
        SSH_HOST="$1"
        REMOTE_PATH="${2:-~/isync}"
        ;;
esac

trap "cleanup '$SSH_HOST' '$REMOTE_PATH'" INT TERM

check_ssh_connection "$SSH_HOST" || exit 1
check_isync_installed "$SSH_HOST" "$REMOTE_PATH" || exit 1
start_remote_isync "$SSH_HOST" "$REMOTE_PATH"
wait_for_backend "$SSH_HOST"
start_tunnel "$SSH_HOST" "$REMOTE_PATH"
