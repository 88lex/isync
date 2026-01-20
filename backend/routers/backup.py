"""
Backup Router
API endpoints for backup and restore operations.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.backup_service import (
    list_backups, create_backup, restore_backup, delete_backup, get_backup_stats
)

router = APIRouter(prefix="/backup", tags=["Backup"])


class RestoreRequest(BaseModel):
    filename: str


@router.get("")
async def get_backups():
    """List all available backups."""
    return {
        "backups": list_backups(),
        "stats": get_backup_stats()
    }


@router.post("")
async def create_new_backup(prefix: Optional[str] = "manual"):
    """Create a new backup."""
    try:
        result = create_backup(prefix=prefix)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restore")
async def restore_from_backup(request: RestoreRequest):
    """Restore from a specific backup."""
    try:
        result = restore_backup(request.filename)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{filename}")
async def remove_backup(filename: str):
    """Delete a specific backup."""
    try:
        result = delete_backup(filename)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def backup_statistics():
    """Get backup statistics."""
    return get_backup_stats()
