"""
ISync API - Main Application
FastAPI application with modular routers.

Version: 3.0 (Modular)
"""
from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import os
import asyncio
import json

from backend.store import store
from backend.job_manager import job_manager
from backend.auth import APIKeyMiddleware
from backend.logging_config import get_logger

# Import all routers
from backend.routers import (
    prep_router,
    drives_router,
    jobs_router,
    config_router,
    ssh_router,
    ops_router,
    schedules_router,
    orchestrator_router,
    admin_router,
    batch_groups_router,
    crontab_router,
    rclone_router,
    keys_router,
    cache_router,
    backup_router,
    workspace_router,
    storage_router,
    dashboard_router,
)

logger = get_logger("isync.api")

# Create FastAPI app
app = FastAPI(
    title="ISync API",
    version="3.0",
    description="Modular API for ISync - Google Workspace Data Migration Tool"
)

# --- CORS Configuration ---
CORS_ORIGINS = os.environ.get(
    "ISYNC_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API Key Authentication (optional) ---
app.add_middleware(APIKeyMiddleware)


# --- Mount All Routers ---
app.include_router(prep_router)
app.include_router(drives_router)
app.include_router(jobs_router)
app.include_router(config_router)
app.include_router(ssh_router)
app.include_router(ops_router)
app.include_router(schedules_router)
app.include_router(orchestrator_router)
app.include_router(admin_router)
app.include_router(batch_groups_router)
app.include_router(crontab_router)
app.include_router(rclone_router)
app.include_router(keys_router)
app.include_router(cache_router)
app.include_router(backup_router)
app.include_router(workspace_router)
app.include_router(storage_router)
app.include_router(dashboard_router)


from backend.database import init_db

# --- Lifecycle Events ---
@app.on_event("startup")
async def startup_event():
    logger.info("[Startup] ISync API v3.0 (Modular) starting...")
    init_db()
    asyncio.create_task(status_broadcaster())
    logger.info(f"[Startup] CORS origins: {CORS_ORIGINS}")
    if os.environ.get("ISYNC_API_KEY"):
        logger.info("[Startup] API Key authentication ENABLED")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("[Shutdown] ISync API shutting down...")
    job_manager.stop_job()
    
    # Stop scheduler if running
    try:
        from backend.scheduler import scheduler
        scheduler.stop()
        logger.info("[Shutdown] Scheduler stopped")
    except ImportError:
        pass


# --- WebSocket Status Broadcaster ---
async def status_broadcaster():
    """Background task to broadcast status updates via WebSocket."""
    while True:
        await asyncio.sleep(1)
        if job_manager.status_listeners:
            status = job_manager.last_status or {}
            for client in list(job_manager.status_listeners):
                try:
                    await client.send_json(status)
                except Exception:
                    job_manager.remove_listener(client)


# --- WebSocket Endpoint ---
@app.websocket("/ws/status")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    job_manager.add_listener(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        job_manager.remove_listener(websocket)


# --- Validation Error Handler ---
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(exc.body)[:200]}
    )


# --- Health Check ---
@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "running", "version": "3.0"}


@app.get("/api/status")
def get_status():
    """Get current job status."""
    return job_manager.last_status or {}


# --- Run directly ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
