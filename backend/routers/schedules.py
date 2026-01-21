"""
Schedules Router
Handles unified schedule management for both local (APScheduler) and remote (SSH crontab) jobs.
Schedules are stored in the database and synced with the appropriate execution engine.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import uuid
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.repositories.schedules import ScheduleRepository
from backend.repositories.batch_groups import get_ssh_server_by_id
from backend.logging_config import get_logger

logger = get_logger("isync.routers.schedules")

router = APIRouter(prefix="/api/schedules", tags=["Schedules"])


# --- Pydantic Models ---
class ScheduleCreate(BaseModel):
    name: str
    cron_expression: str
    command_type: str = "sync"  # sync, batch, task
    command: Optional[Dict[str, Any]] = None  # {source, dest, domain_reference, dry_run} for sync
    execution_context: str = "LOCAL"  # LOCAL or SSH
    target_server_id: Optional[str] = None  # Required if execution_context is SSH
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    cron_expression: Optional[str] = None
    command_type: Optional[str] = None
    command: Optional[Dict[str, Any]] = None
    execution_context: Optional[str] = None
    target_server_id: Optional[str] = None
    enabled: Optional[bool] = None


class CrontabPushRequest(BaseModel):
    server_id: str


# Helper to get APScheduler (lazy import)
def get_apscheduler():
    """Lazy import of APScheduler to avoid circular imports."""
    try:
        from backend.scheduler import scheduler
        return scheduler
    except ImportError:
        return None


# --- Database-backed Endpoints ---
@router.get("")
def list_schedules(
    context: Optional[str] = None,
    server_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    List all schedules from database.
    
    Query params:
    - context: Filter by execution context (LOCAL or SSH)
    - server_id: Filter by target server ID
    """
    repo = ScheduleRepository(db)
    
    if server_id:
        schedules = repo.list_by_server(server_id)
    elif context:
        schedules = repo.list_by_context(context)
    else:
        schedules = repo.list_all()
    
    return {
        "schedules": schedules,
        "total": len(schedules),
        "local_count": repo.count_by_context("LOCAL"),
        "ssh_count": repo.count_by_context("SSH")
    }


@router.post("")
def create_schedule(req: ScheduleCreate, db: Session = Depends(get_db)):
    """
    Create a new schedule.
    
    For LOCAL schedules, also registers with APScheduler.
    For SSH schedules, stores in database (push to server separately).
    """
    repo = ScheduleRepository(db)
    
    # Validate SSH context has server_id
    if req.execution_context == "SSH" and not req.target_server_id:
        raise HTTPException(status_code=400, detail="target_server_id required for SSH schedules")
    
    # Validate server exists for SSH schedules
    if req.target_server_id:
        server = get_ssh_server_by_id(db, req.target_server_id)
        if not server:
            raise HTTPException(status_code=400, detail="Invalid target_server_id")
    
    schedule_id = str(uuid.uuid4())[:8]
    
    schedule = repo.create(
        id=schedule_id,
        name=req.name,
        cron_expression=req.cron_expression,
        command_type=req.command_type,
        command=req.command,
        execution_context=req.execution_context,
        target_server_id=req.target_server_id,
        enabled=req.enabled
    )
    
    # For LOCAL schedules, also add to APScheduler
    if req.execution_context == "LOCAL" and req.enabled:
        apscheduler = get_apscheduler()
        if apscheduler:
            try:
                cmd = req.command or {}
                apscheduler.add_job(
                    name=req.name,
                    source=cmd.get("source", ""),
                    dest=cmd.get("dest", ""),
                    cron_expression=req.cron_expression,
                    domain_reference=cmd.get("domain_reference"),
                    dry_run=cmd.get("dry_run", False),
                    job_type=req.command_type,
                    task_name=cmd.get("task_name"),
                    task_args=cmd.get("task_args")
                )
                logger.info(f"[Schedules] Added schedule {schedule_id} to APScheduler")
            except Exception as e:
                logger.warning(f"[Schedules] Failed to add to APScheduler: {e}")
    
    return {"status": "created", "schedule": schedule}


@router.get("/{schedule_id}")
def get_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Get a specific schedule."""
    repo = ScheduleRepository(db)
    schedule = repo.get_by_id(schedule_id)
    
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    return schedule


@router.put("/{schedule_id}")
def update_schedule(schedule_id: str, update: ScheduleUpdate, db: Session = Depends(get_db)):
    """Update a schedule."""
    repo = ScheduleRepository(db)
    
    existing = repo.get_by_id(schedule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    update_dict = {k: v for k, v in update.dict().items() if v is not None}
    
    # Validate server if changing target
    if 'target_server_id' in update_dict:
        server = get_ssh_server_by_id(db, update_dict['target_server_id'])
        if not server:
            raise HTTPException(status_code=400, detail="Invalid target_server_id")
    
    updated = repo.update(schedule_id, **update_dict)
    
    return {"status": "updated", "schedule": updated}


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Delete a schedule."""
    repo = ScheduleRepository(db)
    
    existing = repo.get_by_id(schedule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Remove from APScheduler if LOCAL
    if existing.get("execution_context") == "LOCAL":
        apscheduler = get_apscheduler()
        if apscheduler:
            try:
                apscheduler.remove_job(schedule_id)
            except Exception as e:
                logger.warning(f"[Schedules] Failed to remove from APScheduler: {e}")
    
    repo.delete(schedule_id)
    return {"status": "deleted", "id": schedule_id}


@router.post("/{schedule_id}/pause")
def pause_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Pause/disable a schedule."""
    repo = ScheduleRepository(db)
    
    updated = repo.set_enabled(schedule_id, False)
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Also pause in APScheduler
    if updated.get("execution_context") == "LOCAL":
        apscheduler = get_apscheduler()
        if apscheduler:
            try:
                apscheduler.pause_job(schedule_id)
            except:
                pass
    
    return {"status": "paused", "schedule": updated}


@router.post("/{schedule_id}/resume")
def resume_schedule(schedule_id: str, db: Session = Depends(get_db)):
    """Resume/enable a schedule."""
    repo = ScheduleRepository(db)
    
    updated = repo.set_enabled(schedule_id, True)
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    # Also resume in APScheduler
    if updated.get("execution_context") == "LOCAL":
        apscheduler = get_apscheduler()
        if apscheduler:
            try:
                apscheduler.resume_job(schedule_id)
            except:
                pass
    
    return {"status": "resumed", "schedule": updated}


@router.post("/{schedule_id}/run")
def run_schedule_now(schedule_id: str, db: Session = Depends(get_db)):
    """Trigger a schedule to run immediately."""
    repo = ScheduleRepository(db)
    schedule = repo.get_by_id(schedule_id)
    
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    if schedule.get("execution_context") == "LOCAL":
        apscheduler = get_apscheduler()
        if apscheduler:
            try:
                apscheduler.run_job_now(schedule_id)
                return {"status": "triggered", "id": schedule_id}
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        raise HTTPException(status_code=503, detail="APScheduler not available")
    else:
        # For SSH schedules, we would need to trigger remote execution
        raise HTTPException(status_code=501, detail="Remote schedule execution not implemented")


# --- Crontab Management Endpoints ---
@router.get("/crontab/{server_id}")
def get_crontab(server_id: str, db: Session = Depends(get_db)):
    """Generate crontab content for a specific SSH server."""
    repo = ScheduleRepository(db)
    
    # Verify server exists
    server = get_ssh_server_by_id(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    schedules = repo.list_by_server(server_id)
    crontab_content = repo.generate_crontab_entries(server_id)
    
    return {
        "server_id": server_id,
        "server_name": server.get("name"),
        "schedule_count": len(schedules),
        "crontab": crontab_content
    }


@router.post("/crontab/push")
def push_crontab(req: CrontabPushRequest, db: Session = Depends(get_db)):
    """Push crontab to a remote SSH server."""
    from backend.ops import exec_remote_command, copy_file_to_remote, SSHBaseRequest
    import tempfile
    import os
    
    repo = ScheduleRepository(db)
    
    # Get server
    server = get_ssh_server_by_id(db, req.server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Generate crontab content
    crontab_content = repo.generate_crontab_entries(req.server_id)
    
    # Write to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.cron', delete=False) as f:
        f.write(crontab_content)
        temp_path = f.name
    
    try:
        ssh_req = SSHBaseRequest(
            host=server.get('alias') or server.get('host'),
            user=server.get('user'),
            key_path=server.get('key_path'),
            timeout=30
        )
        
        remote_path = f"{server.get('remote_path', '/opt/isync')}/crontab/isync.cron"
        
        # Ensure directory exists
        exec_remote_command(ssh_req, f"mkdir -p {os.path.dirname(remote_path)}")
        
        # Copy crontab file
        result = copy_file_to_remote(ssh_req, temp_path, remote_path)
        
        if result.get('status') != 'success':
            raise HTTPException(status_code=500, detail=f"Failed to push crontab: {result.get('message')}")
        
        # Optionally install the crontab
        # exec_remote_command(ssh_req, f"crontab {remote_path}")
        
        return {
            "status": "pushed",
            "server_id": req.server_id,
            "server_name": server.get("name"),
            "remote_path": remote_path,
            "schedule_count": repo.count_by_context("SSH")
        }
        
    finally:
        os.unlink(temp_path)


@router.get("/stats")
def get_schedule_stats(db: Session = Depends(get_db)):
    """Get schedule statistics."""
    repo = ScheduleRepository(db)
    
    return {
        "total": repo.count(),
        "local": repo.count_by_context("LOCAL"),
        "ssh": repo.count_by_context("SSH"),
        "enabled": len(repo.list_enabled())
    }
