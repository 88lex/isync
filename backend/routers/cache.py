"""
Data Cache Router
Provides CRUD operations for the persistent data cache.
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import json

from backend.database import get_db
from backend.models.models import DataCache

router = APIRouter(prefix="/api/cache", tags=["Cache"])


# --- Pydantic Models ---

class CacheEntryResponse(BaseModel):
    id: str
    data_type: str
    context_key: str
    payload: dict | list
    fetched_at: datetime
    source_info: Optional[str] = None


class CacheUpdateRequest(BaseModel):
    payload: dict | list
    source_info: Optional[str] = None


class CacheSummaryItem(BaseModel):
    id: str
    data_type: str
    context_key: str
    fetched_at: datetime
    payload_size: int


# --- Endpoints ---

@router.get("", response_model=List[CacheSummaryItem])
async def list_cache_entries(
    data_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List all cache entries, optionally filtered by data_type."""
    query = db.query(DataCache)
    if data_type:
        query = query.filter(DataCache.data_type == data_type)
    
    entries = query.all()
    return [
        CacheSummaryItem(
            id=e.id,
            data_type=e.data_type,
            context_key=e.context_key,
            fetched_at=e.fetched_at,
            payload_size=len(e.payload) if e.payload else 0
        )
        for e in entries
    ]


@router.get("/{data_type}/{context_key}", response_model=Optional[CacheEntryResponse])
async def get_cache_entry(
    data_type: str,
    context_key: str,
    db: Session = Depends(get_db)
):
    """Get a cached entry by data_type and context_key."""
    cache_id = f"{data_type}_{context_key}"
    entry = db.query(DataCache).filter(DataCache.id == cache_id).first()
    
    if not entry:
        return None
    
    try:
        payload = json.loads(entry.payload)
    except json.JSONDecodeError:
        payload = []
    
    return CacheEntryResponse(
        id=entry.id,
        data_type=entry.data_type,
        context_key=entry.context_key,
        payload=payload,
        fetched_at=entry.fetched_at,
        source_info=entry.source_info
    )


@router.put("/{data_type}/{context_key}", response_model=CacheEntryResponse)
async def update_cache_entry(
    data_type: str,
    context_key: str,
    request: CacheUpdateRequest,
    db: Session = Depends(get_db)
):
    """Create or update a cache entry."""
    cache_id = f"{data_type}_{context_key}"
    
    entry = db.query(DataCache).filter(DataCache.id == cache_id).first()
    
    payload_json = json.dumps(request.payload)
    now = datetime.utcnow()
    
    if entry:
        entry.payload = payload_json
        entry.fetched_at = now
        entry.source_info = request.source_info
    else:
        entry = DataCache(
            id=cache_id,
            data_type=data_type,
            context_key=context_key,
            payload=payload_json,
            fetched_at=now,
            source_info=request.source_info
        )
        db.add(entry)
    
    db.commit()
    db.refresh(entry)
    
    return CacheEntryResponse(
        id=entry.id,
        data_type=entry.data_type,
        context_key=entry.context_key,
        payload=request.payload,
        fetched_at=entry.fetched_at,
        source_info=entry.source_info
    )


@router.delete("/{data_type}/{context_key}")
async def delete_cache_entry(
    data_type: str,
    context_key: str,
    db: Session = Depends(get_db)
):
    """Delete a specific cache entry."""
    cache_id = f"{data_type}_{context_key}"
    entry = db.query(DataCache).filter(DataCache.id == cache_id).first()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Cache entry not found")
    
    db.delete(entry)
    db.commit()
    
    return {"status": "deleted", "id": cache_id}


@router.delete("")
async def clear_all_cache(
    data_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Clear all cache entries, optionally filtered by data_type."""
    query = db.query(DataCache)
    if data_type:
        query = query.filter(DataCache.data_type == data_type)
    
    count = query.count()
    query.delete()
    db.commit()
    
    return {"status": "cleared", "deleted_count": count, "filter": data_type or "all"}


@router.get("/types")
async def get_cache_types(db: Session = Depends(get_db)):
    """Get a summary of cached data types."""
    from sqlalchemy import func
    
    results = db.query(
        DataCache.data_type,
        func.count(DataCache.id).label('count'),
        func.max(DataCache.fetched_at).label('last_updated')
    ).group_by(DataCache.data_type).all()
    
    return [
        {
            "data_type": r.data_type,
            "count": r.count,
            "last_updated": r.last_updated
        }
        for r in results
    ]
