"""
Schedules Router
Handles scheduled job management via APScheduler.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.logging_config import get_logger

logger = get_logger("isync.routers.schedules")

router = APIRouter(prefix="/api/schedules", tags=["Schedules"])


# --- Pydantic Models ---
class ScheduleRequest(BaseModel):
    name: str
    source: str
    dest: str
    cron_expression: str
    domain_reference: Optional[str] = None
    dry_run: bool = False


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    source: Optional[str] = None
    dest: Optional[str] = None
    cron_expression: Optional[str] = None
    domain_reference: Optional[str] = None
    dry_run: Optional[bool] = None


def get_scheduler():
    """Lazy import of scheduler to avoid circular imports."""
    try:
        from backend.scheduler import scheduler
        return scheduler
    except ImportError:
        return None


# --- Endpoints ---
@router.get("")
def list_schedules():
    """List all scheduled jobs."""
    scheduler = get_scheduler()
    if not scheduler:
        return {"schedules": [], "error": "Scheduler not available (install apscheduler)"}
    
    jobs = scheduler.list_jobs()
    return {"schedules": [j.to_dict() for j in jobs]}


@router.post("")
def create_schedule(req: ScheduleRequest):
    """Create a new scheduled job."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available (install apscheduler)")
    
    try:
        job = scheduler.add_job(
            name=req.name,
            source=req.source,
            dest=req.dest,
            cron_expression=req.cron_expression,
            domain_reference=req.domain_reference,
            dry_run=req.dry_run
        )
        return {"status": "created", "schedule": job.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{schedule_id}")
def get_schedule(schedule_id: str):
    """Get a specific scheduled job."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")
    
    job = scheduler.get_job(schedule_id)
    if not job:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return job.to_dict()


@router.put("/{schedule_id}")
def update_schedule(schedule_id: str, update: ScheduleUpdate):
    """Update a scheduled job."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")
    
    job = scheduler.get_job(schedule_id)
    if not job:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    update_dict = {k: v for k, v in update.dict().items() if v is not None}
    
    try:
        updated_job = scheduler.update_job(schedule_id, **update_dict)
        return {"status": "updated", "schedule": updated_job.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: str):
    """Delete a scheduled job."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")
    
    if scheduler.remove_job(schedule_id):
        return {"status": "deleted", "id": schedule_id}
    raise HTTPException(status_code=404, detail="Schedule not found")


@router.post("/{schedule_id}/pause")
def pause_schedule(schedule_id: str):
    """Pause a scheduled job."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")
    
    if scheduler.pause_job(schedule_id):
        return {"status": "paused", "id": schedule_id}
    raise HTTPException(status_code=404, detail="Schedule not found")


@router.post("/{schedule_id}/resume")
def resume_schedule(schedule_id: str):
    """Resume a paused scheduled job."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")
    
    if scheduler.resume_job(schedule_id):
        return {"status": "resumed", "id": schedule_id}
    raise HTTPException(status_code=404, detail="Schedule not found")


@router.post("/{schedule_id}/run")
def run_schedule_now(schedule_id: str):
    """Trigger a scheduled job to run immediately."""
    scheduler = get_scheduler()
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler not available")
    
    job = scheduler.get_job(schedule_id)
    if not job:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    try:
        scheduler.run_job_now(schedule_id)
        return {"status": "triggered", "id": schedule_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
