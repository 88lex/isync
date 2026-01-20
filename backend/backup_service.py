"""
Backup Service
Handles periodic backups of the SQLite database and configuration files.
"""
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional
import json

# Backup configuration
BACKUP_DIR = os.environ.get("ISYNC_BACKUP_DIR", "backups")
MAX_BACKUPS = int(os.environ.get("ISYNC_MAX_BACKUPS", "7"))
DB_PATH = os.environ.get("ISYNC_DB_PATH", "isync.db")


def ensure_backup_dir():
    """Ensure the backup directory exists."""
    Path(BACKUP_DIR).mkdir(parents=True, exist_ok=True)


def get_backup_filename(prefix: str = "isync") -> str:
    """Generate a timestamped backup filename."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{timestamp}.db"


def list_backups() -> List[dict]:
    """List all available backups."""
    ensure_backup_dir()
    backups = []
    
    for f in sorted(Path(BACKUP_DIR).glob("*.db"), reverse=True):
        stat = f.stat()
        backups.append({
            "filename": f.name,
            "path": str(f),
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "age_hours": round((datetime.now().timestamp() - stat.st_mtime) / 3600, 1)
        })
    
    return backups


def create_backup(prefix: str = "isync") -> dict:
    """Create a backup of the current database."""
    ensure_backup_dir()
    
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Database not found: {DB_PATH}")
    
    backup_filename = get_backup_filename(prefix)
    backup_path = os.path.join(BACKUP_DIR, backup_filename)
    
    # Copy the database file
    shutil.copy2(DB_PATH, backup_path)
    
    # Get file info
    stat = os.stat(backup_path)
    
    # Cleanup old backups
    cleanup_old_backups()
    
    return {
        "status": "success",
        "filename": backup_filename,
        "path": backup_path,
        "size_bytes": stat.st_size,
        "size_mb": round(stat.st_size / (1024 * 1024), 2),
        "created_at": datetime.now().isoformat()
    }


def restore_backup(filename: str) -> dict:
    """Restore a backup to the current database."""
    backup_path = os.path.join(BACKUP_DIR, filename)
    
    if not os.path.exists(backup_path):
        raise FileNotFoundError(f"Backup not found: {filename}")
    
    # Create a safety backup before restoring
    safety_backup = create_backup(prefix="pre_restore")
    
    # Restore the backup
    shutil.copy2(backup_path, DB_PATH)
    
    return {
        "status": "success",
        "restored_from": filename,
        "safety_backup": safety_backup["filename"],
        "restored_at": datetime.now().isoformat()
    }


def delete_backup(filename: str) -> dict:
    """Delete a specific backup."""
    backup_path = os.path.join(BACKUP_DIR, filename)
    
    if not os.path.exists(backup_path):
        raise FileNotFoundError(f"Backup not found: {filename}")
    
    os.remove(backup_path)
    
    return {
        "status": "deleted",
        "filename": filename
    }


def cleanup_old_backups():
    """Remove old backups beyond the retention limit."""
    backups = list_backups()
    
    if len(backups) > MAX_BACKUPS:
        for backup in backups[MAX_BACKUPS:]:
            try:
                os.remove(backup["path"])
            except Exception:
                pass


def get_backup_stats() -> dict:
    """Get backup statistics."""
    backups = list_backups()
    total_size = sum(b["size_bytes"] for b in backups)
    
    return {
        "backup_count": len(backups),
        "total_size_mb": round(total_size / (1024 * 1024), 2),
        "max_backups": MAX_BACKUPS,
        "backup_dir": BACKUP_DIR,
        "db_path": DB_PATH,
        "latest_backup": backups[0] if backups else None
    }
