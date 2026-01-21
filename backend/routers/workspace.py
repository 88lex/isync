from fastapi import APIRouter, HTTPException, Query
from typing import Dict, Any, Optional
from backend.dependencies import get_store, get_db
from sqlalchemy.orm import Session
from fastapi import Depends
from backend.models.models import DomainStats
from backend.workspace_service import WorkspaceService
from backend.logging_config import get_logger
from datetime import datetime

logger = get_logger("isync.routers.workspace")

router = APIRouter(prefix="/api/workspace", tags=["Workspace Manager"])

def _get_ws_service(domain_name: str) -> WorkspaceService:
    store = get_store()
    cfg = store.get_config()
    
    # Find domain config
    d_cfg = next((d for d in cfg.get('domains', []) if d['domain_name'] == domain_name), None)
    if not d_cfg:
        raise HTTPException(status_code=404, detail=f"Domain {domain_name} not configured")
    
    sa_path = d_cfg.get('sa_json_path')
    admin_email = d_cfg.get('admin_email')
    
    if not sa_path or not admin_email:
        raise HTTPException(status_code=400, detail="Domain configuration missing SA JSON or Admin Email")
        
    return WorkspaceService(sa_path, admin_email)

@router.get("/metadata")
async def get_workspace_metadata(domain: str):
    """Retrieve Section 1: Identity & Organizational Metadata"""
    try:
        service = _get_ws_service(domain)
        return await service.get_identity_metadata(domain)
    except Exception as e:
        logger.error(f"Failed to get workspace metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/inventory")
async def get_workspace_inventory(domain: str):
    """Retrieve Section 2: User & Group Inventory"""
    try:
        service = _get_ws_service(domain)
        return await service.get_inventory_stats(domain)
    except Exception as e:
        logger.error(f"Failed to get workspace inventory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/storage")
async def get_workspace_storage(domain: str):
    """Retrieve Section 3: Storage & Usage Statistics"""
    try:
        service = _get_ws_service(domain)
        return await service.get_storage_usage(domain)
    except Exception as e:
        logger.error(f"Failed to get workspace storage: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/shared-drives")
async def get_workspace_drives(domain: str):
    """Retrieve Section 4: Shared Drives"""
    try:
        service = _get_ws_service(domain)
        return await service.get_shared_drives()
    except Exception as e:
        logger.error(f"Failed to get shared drives: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/auth-status")
async def get_workspace_auth_status(domain: str):
    """Retrieve Authorization & Scope Status for the Service Account"""
    try:
        service = _get_ws_service(domain)
        return await service.get_auth_status()
    except Exception as e:
        logger.error(f"Failed to get auth status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary")
async def get_workspace_summary(domain: str, db: Session = Depends(get_db)):
    """Combined summary for all sections (for landing page)"""
    try:
        service = _get_ws_service(domain)
        logger.info(f"Fetching workspace summary for domain: {domain}")
        
        # Section-wise partial success model
        try:
            auth = await service.get_auth_status()
        except Exception as e:
            logger.error(f"Failed to get auth status for {domain}: {e}")
            auth = {"error": str(e)}

        try:
            meta = await service.get_identity_metadata(domain)
        except Exception as e:
            logger.error(f"Failed to get metadata for {domain}: {e}")
            meta = {"error": str(e)}
            
        try:
            inv = await service.get_inventory_stats(domain)
        except Exception as e:
            logger.error(f"Failed to get inventory for {domain}: {e}")
            inv = {"error": str(e)}
            
        try:
            storage = await service.get_storage_usage(domain)
        except Exception as e:
            logger.error(f"Failed to get storage for {domain}: {e}")
            storage = {"error": str(e)}
            
        try:
            drives = await service.get_shared_drives()
        except Exception as e:
            logger.error(f"Failed to get drives for {domain}: {e}")
            drives = {"error": str(e)}
        
        # Update DomainStats in DB
        try:
            d_stats = db.query(DomainStats).filter(DomainStats.domain == domain).first()
            if not d_stats:
                d_stats = DomainStats(domain=domain)
                db.add(d_stats)
            
            if "error" not in storage:
                q = storage.get("quota_info", {})
                d_stats.total_quota_gb = q.get("total_quota_gb", 0)
                d_stats.total_used_gb = q.get("total_used_gb", 0)
            
            if "error" not in inv:
                s = inv.get("user_stats", {})
                d_stats.user_count = s.get("total", 0)
                d_stats.group_count = inv.get("group_count", 0)
            
            d_stats.last_updated = datetime.utcnow()
            db.commit()
        except Exception as db_err:
            logger.error(f"Failed to update DomainStats for {domain}: {db_err}")
            db.rollback()

        return {
            "auth": auth,
            "metadata": meta,
            "inventory": inv,
            "storage": storage,
            "drives": drives
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_workspace_summary for {domain}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/storage-overview")
async def get_storage_overview(db: Session = Depends(get_db)):
    """Retrieve Storage Overview for all domains from the database."""
    stats = db.query(DomainStats).all()
    return stats
