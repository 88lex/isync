"""
Monitor Router
API endpoints for the On-Demand Monitor and Expansion Wizard.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json

from backend.database import SessionLocal
from backend.models.models import UnionGroup, SharedDrive, CapacityAlert, AppConfig
from backend.monitor_service import (
    check_google_capacity,
    check_workspace_quota,
    get_active_alerts,
    resolve_alert
)
from backend.drive_manager import expand_union_group

router = APIRouter(prefix="/api", tags=["monitor"])


# --- Request Models ---

class ExpandRequest(BaseModel):
    group_emails: Optional[List[str]] = None


# --- Monitor Endpoints ---

@router.post("/monitor/run")
async def run_capacity_check():
    """
    Trigger an on-demand capacity check for all SharedDrives.
    """
    result = check_google_capacity()
    return result


@router.get("/monitor/alerts")
async def list_alerts():
    """
    Get all unresolved capacity alerts.
    """
    alerts = get_active_alerts()
    return {"status": "ok", "alerts": alerts, "count": len(alerts)}


@router.put("/alerts/{alert_id}/resolve")
async def mark_alert_resolved(alert_id: int):
    """
    Mark an alert as resolved.
    """
    success = resolve_alert(alert_id)
    if success:
        return {"status": "ok", "message": f"Alert {alert_id} resolved"}
    else:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")


@router.get("/monitor/quota")
async def check_quota():
    """
    Check workspace storage quota (placeholder).
    """
    result = check_workspace_quota()
    return result


# --- Union Group Endpoints ---

@router.get("/unions")
async def list_union_groups():
    """
    List all UnionGroups and their drives.
    """
    db = SessionLocal()
    try:
        groups = db.query(UnionGroup).all()
        result = []
        for g in groups:
            drives = db.query(SharedDrive).filter(
                SharedDrive.union_group_id == g.id,
                SharedDrive.status == 'ACTIVE'
            ).all()
            
            result.append({
                "id": g.id,
                "name": g.name,
                "remote_name": g.remote_name,
                "drives": [
                    {
                        "id": d.id,
                        "drive_id": d.drive_id,
                        "name": d.name,
                        "file_count": d.file_count,
                        "is_full": d.is_full,
                        "last_scanned": d.last_scanned.isoformat() if d.last_scanned else None
                    }
                    for d in drives
                ],
                "drive_count": len(drives)
            })
        
        return {"status": "ok", "groups": result, "count": len(result)}
    finally:
        db.close()


@router.post("/unions/{union_id}/expand")
async def expand_union(union_id: int, request: ExpandRequest):
    """
    Expand a UnionGroup by creating a new Shared Drive.
    
    This is the "One-Click Expansion" endpoint called from the UI.
    """
    db = SessionLocal()
    try:
        # Get auth config
        domains_config = db.query(AppConfig).filter(AppConfig.key == 'domains').first()
        if not domains_config or not domains_config.value:
            raise HTTPException(status_code=500, detail="No domains configured")
        
        domains = json.loads(domains_config.value)
        if not domains:
            raise HTTPException(status_code=500, detail="Domains config is empty")
        
        primary = domains[0]
        sa_file = primary.get('sa_json_path')
        admin_email = primary.get('admin_email')
        
        if not sa_file or not admin_email:
            raise HTTPException(status_code=500, detail="Primary domain missing credentials")
        
        # Call expansion function
        result = await expand_union_group(
            union_group_id=union_id,
            service_account_file=sa_file,
            impersonate_email=admin_email,
            group_emails=request.group_emails
        )
        
        if result["status"] != "ok":
            raise HTTPException(status_code=500, detail=result.get("message", "Expansion failed"))
        
        return result
        
    finally:
        db.close()


@router.post("/unions")
async def create_union_group(name: str, remote_name: Optional[str] = None):
    """
    Create a new UnionGroup.
    """
    db = SessionLocal()
    try:
        # Check if exists
        existing = db.query(UnionGroup).filter(UnionGroup.name == name).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"UnionGroup '{name}' already exists")
        
        ug = UnionGroup(name=name, remote_name=remote_name or f"{name}-union")
        db.add(ug)
        db.commit()
        db.refresh(ug)
        
        return {"status": "ok", "id": ug.id, "name": ug.name}
    finally:
        db.close()


# --- Shared Drive Endpoints ---

@router.post("/drives")
async def add_drive_to_db(drive_id: str, name: str, union_group_id: Optional[int] = None):
    """
    Add an existing Shared Drive to the database (for tracking).
    """
    db = SessionLocal()
    try:
        # Check if exists
        existing = db.query(SharedDrive).filter(SharedDrive.drive_id == drive_id).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Drive {drive_id} already exists in DB")
        
        drive = SharedDrive(
            drive_id=drive_id,
            name=name,
            union_group_id=union_group_id,
            status='ACTIVE'
        )
        db.add(drive)
        db.commit()
        db.refresh(drive)
        
        return {"status": "ok", "id": drive.id, "name": drive.name}
    finally:
        db.close()
