---
description: how to restart the ISync backend and frontend services
---

To restart the ISync services and ensure all code changes are active, use the following steps:

1. Stop any existing processes:
   ```bash
   pkill -f 'uvicorn.*backend.main'
   pkill -f 'vite'
   pkill -f 'npm.*dev'
   ```

2. Start services using the launcher script:
// turbo
   ```bash
   ./run_isync.sh --force
   ```

3. (Optional) For development with auto-reload, start the backend manually:
   ```bash
   source venv/bin/activate
   uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
   ```
