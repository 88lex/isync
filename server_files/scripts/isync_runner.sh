#!/bin/bash
# ISync Runner - Minimal script for executing batch files on remote servers
# This script is designed to be deployed to remote servers

set -e

ISYNC_DIR="${ISYNC_DIR:-$HOME/isync}"
LOG_DIR="$ISYNC_DIR/logs"
BATCH_DIR="$ISYNC_DIR/batch"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Function to run a batch file
run_batch() {
    local batch_file="$1"
    local log_file="$LOG_DIR/batch_$(date +%Y%m%d_%H%M%S).log"
    
    if [[ ! -f "$batch_file" ]]; then
        echo "Error: Batch file not found: $batch_file" >&2
        exit 1
    fi
    
    echo "Starting batch: $batch_file"
    echo "Log file: $log_file"
    
    # Run the batch file
    bash "$batch_file" 2>&1 | tee "$log_file"
    
    echo "Batch completed: $batch_file"
}

# Function to list available batch files
list_batches() {
    echo "Available batch files:"
    find "$BATCH_DIR" -name "*.sh" -type f 2>/dev/null | sort
}

# Function to check if a batch is running
check_running() {
    pgrep -f "isync_runner.sh" -a 2>/dev/null | grep -v "$$" || echo "No batch jobs running"
}

# Main
case "${1:-}" in
    run)
        if [[ -z "${2:-}" ]]; then
            echo "Usage: $0 run <batch_file>"
            exit 1
        fi
        run_batch "$2"
        ;;
    list)
        list_batches
        ;;
    status)
        check_running
        ;;
    *)
        echo "ISync Runner"
        echo ""
        echo "Usage:"
        echo "  $0 run <batch_file>   Run a batch file"
        echo "  $0 list               List available batch files"
        echo "  $0 status             Check if any batch is running"
        ;;
esac
