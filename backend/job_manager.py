import threading
import asyncio
import logging
from typing import List, Optional
import json

# Import directly from root (assuming running from root)
from isync_engine import ISyncEngine
from backend.store import store

logger = logging.getLogger("isync_job_manager")

class JobManager:
    def __init__(self):
        self.engine: Optional[ISyncEngine] = None
        self.thread: Optional[threading.Thread] = None
        self.status_listeners = []
        self.last_status = {}

    async def broadcast_status(self, data):
        """Push status to all websocket listeners."""
        self.last_status = data
        to_remove = []
        for ws in self.status_listeners:
            try:
                await ws.send_json(data)
            except Exception:
                to_remove.append(ws)
        
        for ws in to_remove:
            if ws in self.status_listeners:
                self.status_listeners.remove(ws)

    def status_callback_sync(self, data):
        """Called by engine thread. Bridges to AsyncIO loop if needed or just generic broadcast."""
        # Since we are in a thread, we can't await directly.
        # But for websockets, we need an event loop.
        # A simple hack: just store it, and let the loop polling pick it up, 
        # OR use run_coroutine_threadsafe if we had a reference to the loop.
        # For simplicity in this architecture:
        # We will use a dedicated async queue or just rely on the stored last_status 
        # and have a background task in FastAPI push updates.
        self.last_status = data

    def start_job(self, pairs, dry_run=False, user_list=None):
        if self.thread and self.thread.is_alive():
            raise Exception("Job already running")

        config = store.get_config()
        # Initialize Engine with callback
        self.engine = ISyncEngine(config, status_callback=self.status_callback_sync)
        
        def run():
            try:
                # If multiple pairs, we might need a wrapper to run them sequentially
                # ISyncEngine currently takes one pair in execute_job
                for pair in pairs:
                    if self.engine and self.engine.stop_event.is_set(): break
                    self.engine.execute_job(pair, dry_run=dry_run, user_list=user_list)
            except Exception as e:
                logger.error(f"Job failed: {e}")
                self.status_callback_sync({"status": "ERROR", "error": str(e)})

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def stop_job(self):
        if self.engine:
            self.engine.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)

    def add_listener(self, ws):
        self.status_listeners.append(ws)

    def remove_listener(self, ws):
        if ws in self.status_listeners:
            self.status_listeners.remove(ws)

job_manager = JobManager()
