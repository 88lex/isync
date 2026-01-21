"""
Admin Router
Handles local restart controls and system administration.
"""
from fastapi import APIRouter, HTTPException
import subprocess
import os
import sys

from backend.logging_config import get_logger

logger = get_logger("isync.routers.admin")

router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.post("/restart")
def restart_local():
    """Restart the local ISync instance."""
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script_path = os.path.join(base_path, "run_isync.sh")
    
    if not os.path.exists(script_path):
        raise HTTPException(status_code=404, detail="run_isync.sh not found")
    
    try:
        # Spawn in background and detach
        subprocess.Popen(
            [script_path, "--force"],
            cwd=base_path,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        return {"status": "restarting", "message": "Restart initiated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
def stop_local():
    """Stop the local ISync instance."""
    try:
        # Kill uvicorn and vite processes
        subprocess.run(["pkill", "-f", "uvicorn.*backend.main"], check=False)
        subprocess.run(["pkill", "-f", "vite.*5173"], check=False)
        return {"status": "stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
def get_local_status():
    """Get local ISync status."""
    try:
        # Check if processes are running
        uvicorn_check = subprocess.run(
            ["pgrep", "-f", "uvicorn.*backend.main"],
            capture_output=True
        )
        vite_check = subprocess.run(
            ["pgrep", "-f", "vite.*5173"],
            capture_output=True
        )
        
        return {
            "backend_running": uvicorn_check.returncode == 0,
            "frontend_running": vite_check.returncode == 0,
            "python_version": sys.version,
            "pid": os.getpid()
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/logs")
def get_recent_logs(lines: int = 100):
    """Get recent log entries."""
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    log_file = os.path.join(base_path, "logs", "isync.log")
    
    if not os.path.exists(log_file):
        return {"logs": [], "message": "Log file not found"}
    
    try:
        with open(log_file, 'r') as f:
            all_lines = f.readlines()
            recent = all_lines[-lines:] if len(all_lines) > lines else all_lines
        return {"logs": [l.strip() for l in recent], "total": len(all_lines)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/logs")
def clear_logs():
    """Clear log files."""
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    logs_dir = os.path.join(base_path, "logs")
    
    if not os.path.exists(logs_dir):
        return {"status": "ok", "message": "No logs directory"}
    
    cleared = []
    for f in os.listdir(logs_dir):
        if f.endswith('.log'):
            log_path = os.path.join(logs_dir, f)
            try:
                with open(log_path, 'w') as fp:
                    fp.truncate(0)
                cleared.append(f)
            except Exception:
                pass
    
    return {"status": "ok", "cleared": cleared}


@router.get("/info")
def get_system_info():
    """Get system information."""
    import platform
    
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    return {
        "python_version": sys.version,
        "platform": platform.platform(),
        "hostname": platform.node(),
        "base_path": base_path,
        "pid": os.getpid(),
        "cwd": os.getcwd()
    }


# =============================================================================
# Database Maintenance Endpoints
# =============================================================================

from pydantic import BaseModel
from typing import Optional
from fastapi import Depends
from sqlalchemy.orm import Session
from backend.database import get_db


class MaintenanceRequest(BaseModel):
    action: str  # 'check', 'vacuum', 'clean_logs', 'clean_cache', 'validate', 'full'
    days: Optional[int] = 30  # For log cleanup


@router.get("/maintenance/stats")
def get_database_stats(db: Session = Depends(get_db)):
    """Get database statistics."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.get_database_stats(db)


@router.post("/maintenance/check")
def run_integrity_check():
    """Run database integrity check."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.run_integrity_check()


@router.post("/maintenance/vacuum")
def run_vacuum():
    """Run VACUUM to optimize database."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.run_vacuum()


@router.post("/maintenance/clean-logs")
def clean_old_logs(days: int = 30):
    """Clean job logs older than specified days."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.clean_old_logs(days)


@router.post("/maintenance/clean-cache")
def clean_orphaned_cache(db: Session = Depends(get_db)):
    """Clean stale cache entries."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.clean_orphaned_cache(db)


@router.post("/maintenance/validate")
def validate_references(db: Session = Depends(get_db)):
    """Validate referential integrity."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.validate_references(db)


@router.post("/maintenance/full")
def run_full_maintenance(days: int = 30):
    """Run complete maintenance cycle."""
    from backend.maintenance_service import DatabaseMaintenanceService
    return DatabaseMaintenanceService.run_full_maintenance(days)
