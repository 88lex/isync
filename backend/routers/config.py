"""
Config Router
Handles configuration, synclist, and config profile management.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import shutil

from backend.dependencies import get_store, reload_config, get_base_path, reset_engine
from backend.logging_config import get_logger

logger = get_logger("isync.routers.config")

router = APIRouter(prefix="/api", tags=["Config"])


# --- Pydantic Models ---
class DomainConfig(BaseModel):
    domain_name: str
    admin_email: str
    sa_json_path: str
    group_email: str
    remote_sa_json_path: Optional[str] = ""


class SyncPair(BaseModel):
    id: Optional[str] = None
    source: str
    dest: str
    domain_reference: Optional[str] = ""
    source_type: Optional[str] = "LOCAL"
    source_server_id: Optional[str] = None
    dest_type: Optional[str] = "LOCAL"
    dest_server_id: Optional[str] = None
    meta_server_id: Optional[str] = None
    meta_execution_mode: Optional[str] = "local" # local, ssh
    
    # Dashboard Scan Config
    scan_source_server_id: Optional[str] = None
    scan_dest_server_id: Optional[str] = None
    
    class Config:
        extra = "ignore"


class SyncListUpdate(BaseModel):
    pairs: List[SyncPair]


class SyncPairCreate(BaseModel):
    id: Optional[str] = None
    source: str
    dest: str
    domain_reference: Optional[str] = None
    source_type: Optional[str] = "LOCAL"
    source_server_id: Optional[str] = None
    dest_type: Optional[str] = "LOCAL"
    dest_server_id: Optional[str] = None
    meta_server_id: Optional[str] = None
    meta_execution_mode: Optional[str] = "local"
    
    # Dashboard Scan Config
    scan_source_server_id: Optional[str] = None
    scan_dest_server_id: Optional[str] = None
    
    class Config:
        extra = "ignore"


class ProfileRequest(BaseModel):
    filename: str


# --- Config Endpoints ---
@router.get("/config")
def get_config():
    """Get current configuration."""
    store = get_store()
    store.load_all()
    return store.get_config()


@router.post("/config")
def update_config(update: Dict[str, Any]):
    """Update configuration (partial update)."""
    store = get_store()
    current = store.get_config()
    current.update(update)
    success = store.save_config(current)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save config")
    
    # Reset engine to pick up new config
    reset_engine()
    
    return {"status": "ok", "config": current}


@router.post("/config/reload")
def api_reload_config():
    """Force reload config from disk."""
    store = get_store()
    store.reload()
    reset_engine()
    return {
        "status": "ok",
        "config_path": store.get_config_path(),
        "synclist_path": store.get_synclist_path(),
        "config_keys": len(store.get_config()),
        "sync_pairs": len(store.get_sync_pairs())
    }


@router.get("/config/status")
def config_status():
    """Get config persistence status (DB Backed)."""
    store = get_store()
    
    # We report DB status as "file exists" to satisfy frontend
    # In reality, data is in SQLite
    return {
        "config_file": {
            "path": "Database (app_config)",
            "exists": True,
            "size": 0,
        },
        "synclist_file": {
            "path": "Database (sync_pairs)",
            "exists": True,
            "size": 0,
        },
        "in_memory": {
            "config_keys": len(store.get_config()),
            "domains": len(store.get_config().get('domains', [])),
            "sync_pairs": len(store.get_sync_pairs()),
        }
    }


# --- Synclist Endpoints (Database-backed) ---
from fastapi import Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.repositories.sync_pairs import SyncPairRepository

@router.get("/synclist")
def get_synclist(db: Session = Depends(get_db)):
    """Get sync pairs from database."""
    repo = SyncPairRepository(db)
    return repo.list_all()


def _invalidate_sync_pairs_cache(db: Session):
    """Invalidate the sync_pairs cache entry after mutations."""
    from backend.models.models import DataCache
    try:
        db.query(DataCache).filter(DataCache.id == "sync_pairs_local").delete()
        db.commit()
        logger.debug("[config] Invalidated sync_pairs cache")
    except Exception as e:
        logger.warning(f"[config] Failed to invalidate cache: {e}")
        db.rollback()


@router.post("/synclist")
def update_synclist(update: SyncListUpdate, db: Session = Depends(get_db)):
    """Bulk update sync pairs - replaces existing pairs with new ones."""
    from backend.models.models import SyncPair as SyncPairModel
    
    # Delete all existing pairs and add new ones
    db.query(SyncPairModel).delete()
    
    for pair in update.pairs:
        new_pair = SyncPairModel(
            source=pair.source,
            dest=pair.dest,
            domain_reference=pair.domain_reference or "",
            source_type=pair.source_type or "LOCAL",
            source_server_id=pair.source_server_id,
            dest_type=pair.dest_type or "LOCAL",
            dest_server_id=pair.dest_server_id,
            meta_server_id=pair.meta_server_id,
            meta_execution_mode=pair.meta_execution_mode or "local",
            scan_source_server_id=pair.scan_source_server_id,
            scan_dest_server_id=pair.scan_dest_server_id
        )
        db.add(new_pair)
    
    db.commit()
    
    # Invalidate cache
    _invalidate_sync_pairs_cache(db)
    
    return {"status": "ok", "count": len(update.pairs)}


# --- Sync Pair CRUD (Database-backed) ---
@router.post("/sync-pairs")
def create_sync_pair(pair: SyncPairCreate, db: Session = Depends(get_db)):
    """Create a new sync pair (with duplicate check)."""
    repo = SyncPairRepository(db)
    
    # Check for duplicates
    existing = repo.find_by_source_dest(pair.source, pair.dest)
    if existing:
        raise HTTPException(status_code=409, detail="Sync pair already exists")
    
    new_pair = repo.create(
        source=pair.source,
        dest=pair.dest,
        domain_reference=pair.domain_reference,
        source_type=pair.source_type or "LOCAL",
        source_server_id=pair.source_server_id,
        dest_type=pair.dest_type or "LOCAL",
        dest_server_id=pair.dest_server_id,
        meta_server_id=pair.meta_server_id,
        meta_execution_mode=pair.meta_execution_mode or "local",
        scan_source_server_id=pair.scan_source_server_id,
        scan_dest_server_id=pair.scan_dest_server_id
    )
    
    # Invalidate cache
    _invalidate_sync_pairs_cache(db)
    
    return {"status": "ok", "pair": new_pair, "total": repo.count()}


@router.put("/sync-pairs/{pair_id}")
def update_sync_pair(pair_id: str, pair: SyncPairCreate, db: Session = Depends(get_db)):
    """Update an existing sync pair by ID."""
    repo = SyncPairRepository(db)
    
    # Convert pair_id to int if numeric
    try:
        int_id = int(pair_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid pair ID format")
    
    updated = repo.update(
        pair_id=int_id,
        source=pair.source,
        dest=pair.dest,
        domain_reference=pair.domain_reference,
        source_type=pair.source_type,
        source_server_id=pair.source_server_id,
        dest_type=pair.dest_type,
        dest_server_id=pair.dest_server_id,
        meta_server_id=pair.meta_server_id,
        meta_execution_mode=pair.meta_execution_mode,
        scan_source_server_id=pair.scan_source_server_id,
        scan_dest_server_id=pair.scan_dest_server_id
    )
    
    if not updated:
        raise HTTPException(status_code=404, detail="Sync pair not found")
    
    # Invalidate cache
    _invalidate_sync_pairs_cache(db)
    
    return {"status": "ok", "pair": updated}


@router.delete("/sync-pairs/{pair_id}")
def delete_sync_pair(pair_id: str, db: Session = Depends(get_db)):
    """Delete a sync pair by ID."""
    logger.info(f"[config] Deleting sync pair with ID: {pair_id}")
    
    # Convert pair_id to int
    try:
        int_id = int(pair_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid pair ID format")
    
    repo = SyncPairRepository(db)
    
    # Get pair info before deletion for logging
    pair_info = repo.get_by_id(pair_id)
    
    if not repo.delete(int_id):
        logger.warning(f"[config] Sync pair not found for deletion: {pair_id}")
        raise HTTPException(status_code=404, detail="Sync pair not found")
    
    logger.info(f"[config] Successfully deleted sync pair: {pair_info.get('source') if pair_info else 'unknown'} -> {pair_info.get('dest') if pair_info else 'unknown'}")
    
    # Invalidate cache
    _invalidate_sync_pairs_cache(db)
    
    return {"status": "ok", "removed": pair_info, "remaining": repo.count()}




# --- Profile Management ---
@router.get("/profiles")
def list_profiles():
    """List available config profiles."""
    from backend.store import CONFIGS_DIR
    if not os.path.exists(CONFIGS_DIR):
        return []
    return [f for f in os.listdir(CONFIGS_DIR) if f.endswith('.yaml')]


@router.post("/profiles/load")
def load_profile(req: ProfileRequest):
    """Load a config profile."""
    from backend.store import CONFIGS_DIR, CURRENT_CONFIG_FILE
    store = get_store()
    
    src = os.path.join(CONFIGS_DIR, req.filename)
    if not os.path.exists(src):
        raise HTTPException(404, "Profile not found")
    
    shutil.copy(src, CURRENT_CONFIG_FILE)
    store.load_all()
    return {"status": "loaded", "config": store.get_config()}


@router.post("/profiles/save")
def save_profile(req: ProfileRequest):
    """Save current config as a profile."""
    from backend.store import CONFIGS_DIR, CURRENT_CONFIG_FILE
    store = get_store()
    
    fname = req.filename if req.filename.endswith('.yaml') else f"{req.filename}.yaml"
    if not os.path.exists(CONFIGS_DIR):
        os.makedirs(CONFIGS_DIR)
    dest = os.path.join(CONFIGS_DIR, fname)
    
    store.save_config()
    shutil.copy(CURRENT_CONFIG_FILE, dest)
    
    return {"status": "saved", "file": fname}


@router.post("/profiles/reset")
def reset_profile():
    """Reset config to defaults."""
    from backend.store import DEFAULT_CONFIG_FILE, CURRENT_CONFIG_FILE
    store = get_store()
    
    if os.path.exists(DEFAULT_CONFIG_FILE):
        shutil.copy(DEFAULT_CONFIG_FILE, CURRENT_CONFIG_FILE)
        store.load_all()
        return {"status": "reset"}
    raise HTTPException(404, "Default config not found")
