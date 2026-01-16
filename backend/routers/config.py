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
    source: str
    dest: str
    domain_reference: Optional[str] = ""
    
    class Config:
        extra = "ignore"


class SyncListUpdate(BaseModel):
    pairs: List[SyncPair]


class SyncPairCreate(BaseModel):
    source: str
    dest: str
    domain_reference: Optional[str] = None


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
    """Get config persistence status for debugging."""
    store = get_store()
    config_path = store.get_config_path()
    synclist_path = store.get_synclist_path()
    
    return {
        "config_file": {
            "path": config_path,
            "exists": os.path.exists(config_path),
            "size": os.path.getsize(config_path) if os.path.exists(config_path) else 0,
        },
        "synclist_file": {
            "path": synclist_path,
            "exists": os.path.exists(synclist_path),
            "size": os.path.getsize(synclist_path) if os.path.exists(synclist_path) else 0,
        },
        "in_memory": {
            "config_keys": len(store.get_config()),
            "domains": len(store.get_config().get('domains', [])),
            "sync_pairs": len(store.get_sync_pairs()),
        }
    }


# --- Synclist Endpoints ---
@router.get("/synclist")
def get_synclist():
    """Get sync pairs."""
    store = get_store()
    store.load_all()
    return store.get_sync_pairs()


@router.post("/synclist")
def update_synclist(update: SyncListUpdate):
    """Update sync pairs."""
    store = get_store()
    pairs_data = [p.dict() for p in update.pairs]
    success = store.save_synclist(pairs_data)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save synclist")
    return {"status": "ok", "count": len(pairs_data)}


# --- Sync Pair CRUD ---
@router.post("/sync-pairs")
def create_sync_pair(pair: SyncPairCreate):
    """Create a new sync pair (with duplicate check)."""
    store = get_store()
    pairs = store.get_sync_pairs()
    
    for existing in pairs:
        if existing.get('source') == pair.source and existing.get('dest') == pair.dest:
            raise HTTPException(status_code=409, detail="Sync pair already exists")
    
    new_pair = pair.dict()
    pairs.append(new_pair)
    
    success = store.save_synclist(pairs)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save sync pair")
    
    return {"status": "ok", "pair": new_pair, "total": len(pairs)}


@router.put("/sync-pairs/{index}")
def update_sync_pair(index: int, pair: SyncPairCreate):
    """Update an existing sync pair by index."""
    store = get_store()
    pairs = store.get_sync_pairs()
    
    if index < 0 or index >= len(pairs):
        raise HTTPException(status_code=404, detail="Sync pair not found")
    
    pairs[index] = pair.dict()
    success = store.save_synclist(pairs)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update sync pair")
    
    return {"status": "ok", "pair": pairs[index]}


@router.delete("/sync-pairs/{index}")
def delete_sync_pair(index: int):
    """Delete a sync pair by index."""
    store = get_store()
    pairs = store.get_sync_pairs()
    
    if index < 0 or index >= len(pairs):
        raise HTTPException(status_code=404, detail="Sync pair not found")
    
    removed = pairs.pop(index)
    success = store.save_synclist(pairs)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete sync pair")
    
    return {"status": "ok", "removed": removed, "remaining": len(pairs)}


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
