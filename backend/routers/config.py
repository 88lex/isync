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
    
    class Config:
        extra = "ignore"


class SyncListUpdate(BaseModel):
    pairs: List[SyncPair]


class SyncPairCreate(BaseModel):
    id: Optional[str] = None
    source: str
    dest: str
    domain_reference: Optional[str] = None
    
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
    
    import uuid
    new_pair = pair.dict()
    if not new_pair.get('id'):
        new_pair['id'] = str(uuid.uuid4())
    pairs.append(new_pair)
    
    success = store.save_synclist(pairs)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save sync pair")
    
    return {"status": "ok", "pair": new_pair, "total": len(pairs)}


@router.put("/sync-pairs/{pair_id}")
def update_sync_pair(pair_id: str, pair: SyncPairCreate):
    """Update an existing sync pair by ID."""
    store = get_store()
    pairs = store.get_sync_pairs()
    
    found_idx = -1
    for i, p in enumerate(pairs):
        if p.get('id') == pair_id:
            found_idx = i
            break
            
    if found_idx == -1:
        # Fallback to index if pair_id is numeric (for backward compatibility during migration)
        if pair_id.isdigit():
            idx = int(pair_id)
            if 0 <= idx < len(pairs):
                found_idx = idx
                
    if found_idx == -1:
        raise HTTPException(status_code=404, detail="Sync pair not found")
    
    # Merge new data into existing pair to preserve domain_reference etc.
    old_pair = pairs[found_idx]
    new_data = pair.dict(exclude_unset=True)
    old_pair.update(new_data)
    # Ensure ID doesn't change
    old_pair['id'] = pair_id
    
    success = store.save_synclist(pairs)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update sync pair")
    
    return {"status": "ok", "pair": pairs[found_idx]}


@router.delete("/sync-pairs/{pair_id}")
def delete_sync_pair(pair_id: str):
    """Delete a sync pair by ID or index."""
    logger.info(f"[config] Deleting sync pair with ID/Index: {pair_id}")
    store = get_store()
    pairs = store.get_sync_pairs()
    
    found_idx = -1
    # 1. Search by UUID
    for i, p in enumerate(pairs):
        if p.get('id') == pair_id:
            found_idx = i
            break
            
    # 2. Search by string match for other IDs
    if found_idx == -1:
        for i, p in enumerate(pairs):
            if str(p.get('id')) == str(pair_id):
                found_idx = i
                break
                
    # 3. Fallback to index if pair_id is numeric
    if found_idx == -1 and pair_id.isdigit():
        idx = int(pair_id)
        if 0 <= idx < len(pairs):
            found_idx = idx
            logger.info(f"[config] Using index fallback for deletion: {idx}")
                
    if found_idx == -1:
        logger.warning(f"[config] Sync pair not found for deletion: {pair_id}")
        raise HTTPException(status_code=404, detail="Sync pair not found")
    
    removed = pairs.pop(found_idx)
    success = store.save_synclist(pairs)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete sync pair from disk")
    
    logger.info(f"[config] Successfully deleted sync pair: {removed.get('source')} -> {removed.get('dest')}")
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
