from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
from backend.storage_service import StorageAuditService
from backend.database import SessionLocal
from backend.models.models import SharedDrive
from backend.scheduler import scheduler
import logging

logger = logging.getLogger("isync.routers.storage")
router = APIRouter(prefix="/api/storage", tags=["Storage"])

class AuditRequest(BaseModel):
    drive_id: Optional[int] = None
    domain: Optional[str] = None
    server_id: Optional[str] = "local" # id of the ssh server to execute on

class AuditScheduleRequest(BaseModel):
    domain: str
    server_id: str
    cron_expression: str
    name: Optional[str] = "Shared Drive Storage Audit"

class PathSizeRequest(BaseModel):
    path: str
    location_type: str = "LOCAL" # LOCAL, SSH, RCLONE
    server_id: Optional[str] = "local"

@router.post("/audit")
async def trigger_audit(req: AuditRequest, background_tasks: BackgroundTasks):
    """Trigger a storage audit for a specific drive or all drives."""
    if req.drive_id:
        # Sync audit for a single drive (if small/fast enough) or background?
        # User said "manually", let's do it in background if they want to wait or just return task started.
        background_tasks.add_task(StorageAuditService.audit_shared_drive, req.drive_id, req.server_id)
        return {"status": "started", "message": f"Audit started for drive id {req.drive_id}"}
    elif req.domain:
        background_tasks.add_task(StorageAuditService.audit_all_drives_for_domain, req.domain, req.server_id)
        return {"status": "started", "message": f"Background audit started for domain {req.domain}"}
    else:
        # Audit everything
        background_tasks.add_task(StorageAuditService.audit_all_drives_for_domain, "all", req.server_id)
        return {"status": "started", "message": "Background audit started for all drives"}

@router.post("/schedule")
def schedule_audit(req: AuditScheduleRequest):
    """Schedule a recurring storage audit."""
    try:
        job = scheduler.add_job(
            name=req.name or f"Audit: {req.domain}",
            source="N/A",
            dest="N/A",
            cron_expression=req.cron_expression,
            domain_reference=req.domain,
            job_type="task",
            task_name="storage_audit",
            task_args={"server_id": req.server_id}
        )
        return {"status": "scheduled", "job_id": job.id, "next_run": job.next_run}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/calculate-size")
async def calculate_path_size(req: PathSizeRequest):
    """Direct size calculation for any path (not necessarily a Shared Drive)."""
    result = await StorageAuditService.get_path_size(req.path, req.location_type, req.server_id)
    if result["status"] == "ok":
        return result
    else:
        raise HTTPException(status_code=500, detail=result.get("message", "Calculation failed"))

@router.get("/shared-drives-stats")
def get_shared_drives_stats():
    """Returns current cached stats for all shared drives from DB."""
    db = SessionLocal()
    try:
        drives = db.query(SharedDrive).all()
        return {
            "drives": [
                {
                    "id": d.id,
                    "drive_id": d.drive_id,
                    "name": d.name,
                    "size_bytes": d.size_bytes,
                    "file_count": d.file_count,
                    "last_scanned": d.last_scanned
                } for d in drives
            ]
        }
    finally:
        db.close()
