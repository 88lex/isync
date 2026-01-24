from fastapi import APIRouter, HTTPException, Query
from typing import Dict, Any, Optional
from backend.dependencies import get_store, get_db
from sqlalchemy.orm import Session
from fastapi import Depends
from backend.models.models import DomainStats, DataCache
from backend.workspace_service import WorkspaceService
from backend.logging_config import get_logger
from datetime import datetime
import json
import asyncio

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
async def get_workspace_summary(domain: str, refresh: bool = False, quick: bool = False, db: Session = Depends(get_db)):
    """
    Combined summary for all sections.
    Implements cache-first logic to prevent redundant external API hits.
    
    Args:
        domain: The domain to scan
        refresh: Force a fresh scan ignoring cache
        quick: valid only with refresh=True, skips heavy permission scanning
    """
    cache_id = f"workspace_summary_{domain}"
    
    # 1. Check local cache first unless refresh is requested
    if not refresh:
        existing_cache = db.query(DataCache).filter(DataCache.id == cache_id).first()
        if existing_cache and existing_cache.payload:
            try:
                logger.info(f"Returning cached workspace summary for domain: {domain}")
                payload = json.loads(existing_cache.payload)
                # Ensure we return a consistent format to the frontend
                # If cached as object, wrap in list for frontend's expectation
                # If cached as list, return as is (to be unwrapped by frontend)
                return payload
            except Exception as e:
                logger.warning(f"Failed to parse cached summary for {domain}: {e}")

    # 2. Perform fresh scan concurrently
    try:
        service = _get_ws_service(domain)
        logger.info(f"Performing fresh concurrent workspace scan for domain: {domain} (quick={quick})")
        
        # Map section names to co-routines
        tasks = {
            "auth": service.get_auth_status(),
            "metadata": service.get_identity_metadata(domain),
            "inventory": service.get_inventory_stats(domain),
            "storage": service.get_storage_usage(domain),
            "drives": service.get_shared_drives(include_permissions=not quick)
        }
        
        # Execute all tasks in parallel
        ordered_keys = list(tasks.keys())
        ordered_tasks = [tasks[k] for k in ordered_keys]
        
        responses = await asyncio.gather(*ordered_tasks, return_exceptions=True)
        
        results = {}
        for i, key in enumerate(ordered_keys):
            res = responses[i]
            if isinstance(res, Exception):
                logger.error(f"Concurrent task '{key}' failed for {domain}: {res}")
                results[key] = {"error": str(res)}
            else:
                results[key] = res
        
        # 3. Update DomainStats in DB
        try:
            d_stats = db.query(DomainStats).filter(DomainStats.domain == domain).first()
            if not d_stats:
                d_stats = DomainStats(domain=domain)
                db.add(d_stats)
            
            storage = results.get("storage", {})
            if "error" not in storage:
                q = storage.get("quota_info", {})
                d_stats.total_quota_gb = q.get("total_quota_gb", 0)
                d_stats.total_used_gb = q.get("total_used_gb", 0)
            
            inv = results.get("inventory", {})
            if "error" not in inv:
                s = inv.get("user_stats", {})
                d_stats.user_count = s.get("total", 0)
                d_stats.group_count = inv.get("group_count", 0)
            
            d_stats.last_updated = datetime.utcnow()
            db.commit()
        except Exception as db_err:
            logger.error(f"Failed to update DomainStats for {domain}: {db_err}")
            db.rollback()

        # 4. Update DataCache in DB
        try:
            now = datetime.utcnow()
            # Wrap in list for consistency with frontend's setCached logic
            payload_json = json.dumps([results]) 
            cache_entry = db.query(DataCache).filter(DataCache.id == cache_id).first()
            
            if cache_entry:
                cache_entry.payload = payload_json
                cache_entry.fetched_at = now
            else:
                cache_entry = DataCache(
                    id=cache_id,
                    data_type="workspace_summary",
                    context_key=domain,
                    payload=payload_json,
                    fetched_at=now
                )
                db.add(cache_entry)
            db.commit()
        except Exception as cache_err:
            logger.error(f"Failed to update DataCache for {domain}: {cache_err}")
            db.rollback()

        # Return as list for consistency
        return [results]

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
