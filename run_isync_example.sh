#!/bin/bash
# Generic Example for running ISync
# Copy this to run_isync.sh and modify as needed

# --- Configuration ---
# Set the backend port (default 8000)
export PORT=8000

# Set the environment
export ENVIRONMENT=production

# Activate virtual environment
if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found. Please create one."
    exit 1
fi

# Run the application
echo "Starting ISync..."
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
