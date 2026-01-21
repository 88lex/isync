import logging
import json
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.models import SharedDrive, NodeStats
from backend.ops import SSHBaseRequest, exec_remote_command
from backend.store import store

logger = logging.getLogger("isync.storage_service")

class StorageAuditService:
    @staticmethod
    async def get_path_size(path: str, location_type: str, server_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Calculates size and file count for a path using rclone size.
        Supports: LOCAL, SSH, RCLONE (remote:path)
        """
        # Build rclone command
        # We always use --json for machine-readable output
        # If path doesn't end in :, we assume it might be a local path or we add : if it's a remote name
        rclone_path = path
        if location_type == "RCLONE" and ":" not in rclone_path:
            rclone_path = f"{rclone_path}:"
            
        cmd = f"rclone size {rclone_path} --json"
        
        try:
            if server_id and server_id != "local":
                # Execute on remote server
                cfg = store.get_config()
                server = next((s for s in cfg.get('ssh_servers', []) if s['id'] == server_id), None)
                if not server:
                    raise ValueError(f"SSH Server {server_id} not found")
                
                req = SSHBaseRequest(
                    host=server.get('alias') or server.get('host'),
                    user=server.get('user'),
                    key_path=server.get('key_path'),
                    timeout=1200 # 20m timeout for large drives
                )
                
                # Run blocking I/O in thread executor to avoid blocking event loop
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, lambda: exec_remote_command(req, cmd))
                
                if result["status"] == "success":
                    data = json.loads(result["stdout"])
                    return {
                        "status": "ok",
                        "bytes": data.get("bytes", 0),
                        "count": data.get("count", 0)
                    }
                else:
                    return {"status": "error", "message": result.get("message", "Unknown error")}
            else:
                # Execute locally
                import subprocess
                process = await asyncio.create_subprocess_shell(
                    cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await process.communicate()
                
                if process.returncode == 0:
                    data = json.loads(stdout.decode())
                    return {
                        "status": "ok",
                        "bytes": data.get("bytes", 0),
                        "count": data.get("count", 0)
                    }
                else:
                    return {"status": "error", "message": stderr.decode() or "Rclone execution failed"}
                    
        except Exception as e:
            logger.error(f"Storage audit failed for {path}: {e}")
            return {"status": "error", "message": str(e)}

    @staticmethod
    async def audit_shared_drive(drive_db_id: int, server_id: Optional[str] = None):
        """Audits a single shared drive by its database ID and updates stats."""
        db = SessionLocal()
        try:
            drive = db.query(SharedDrive).filter(SharedDrive.id == drive_db_id).first()
            if not drive:
                return {"status": "error", "message": "Drive not found in database"}
            
            # Use rclone name format: drive_name:
            # We assume the remote is already configured in rclone as drive_name
            # Or we might need to use the drive-id directly with a generic remote
            # In ISync, SharedDrive names are often used as rclone remotes
            remote_name = drive.name.replace(" ", "-").lower()
            
            # Start audit
            result = await StorageAuditService.get_path_size(remote_name, "RCLONE", server_id)
            
            if result["status"] == "ok":
                drive.size_bytes = float(result["bytes"])
                drive.file_count = int(result["count"])
                drive.last_scanned = datetime.utcnow()
                db.commit()
                return {"status": "ok", "drive": drive.name, "size_bytes": drive.size_bytes, "file_count": drive.file_count}
            else:
                return result
        finally:
            db.close()

    @staticmethod
    async def audit_shared_drive_by_resource_id(drive_resource_id: str, drive_name: str, server_id: Optional[str] = None):
        """
        Audits a shared drive by its Resource ID (0A...). 
        Creates or updates the DB record as needed.
        """
        db = SessionLocal()
        try:
            # Check if drive exists in DB
            drive = db.query(SharedDrive).filter(SharedDrive.drive_id == drive_resource_id).first()
            if not drive:
                logger.info(f"Drive {drive_name} ({drive_resource_id}) not found in DB. Creating...")
                drive = SharedDrive(
                    drive_id=drive_resource_id,
                    name=drive_name,
                    status='ACTIVE', # Assume active if we are auditing
                    size_bytes=0,
                    file_count=0
                )
                db.add(drive)
                db.commit()
                db.refresh(drive)
            
            # Use rclone name format: drive_name:
            # Optimization: pass drive_resource_id if we have a way to use it genericly, 
            # but usually we rely on config. For now, try name-based remote.
            remote_name = drive.name.replace(" ", "-").lower()
            
            # Start audit
            result = await StorageAuditService.get_path_size(remote_name, "RCLONE", server_id)
            
            if result["status"] == "ok":
                drive.size_bytes = float(result["bytes"])
                drive.file_count = int(result["count"])
                drive.last_scanned = datetime.utcnow()
                db.commit()
                logger.info(f"Audit complete for {drive.name}: {drive.size_bytes} bytes")
                return {"status": "ok", "drive": drive.name, "size_bytes": drive.size_bytes, "file_count": drive.file_count}
            else:
                logger.error(f"Audit failed for {drive.name}: {result.get('message')}")
                return result
        except Exception as e:
             logger.error(f"Error in audit_shared_drive_by_resource_id: {e}")
             return {"status": "error", "message": str(e)}
        finally:
            db.close()

    @staticmethod
    async def audit_all_drives_for_domain(domain: str, server_id: Optional[str] = None):
        """Background task to audit all drives."""
        # This will be called via an endpoint and run asynchronously
        db = SessionLocal()
        try:
            # We need a way to filter drives by domain? 
            # In current schema, SharedDrive doesn't directly store domain, 
            # but usually they are associated with a UnionGroup or we can just audit all Active ones.
            # For now, let's audit all ACTIVE drives.
            drives = db.query(SharedDrive).filter(SharedDrive.status == 'ACTIVE').all()
            total = len(drives)
            logger.info(f"Starting background audit for {total} drives on {server_id or 'local'}")
            
            for drive in drives:
                await StorageAuditService.audit_shared_drive(drive.id, server_id)
                # Small sleep to avoid hammering
                await asyncio.sleep(0.5)
                
            logger.info("Background audit completed")
        finally:
            db.close()
