"""
Dashboard Router
Handles statistics and scanning operations for the Dashboard.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List
from sqlalchemy.orm import Session
from datetime import datetime
import json
import logging
import subprocess

from backend.database import get_db
from backend.models.models import SyncPair, SSHServer
from backend.repositories.sync_pairs import SyncPairRepository
from backend.ops import SSHBaseRequest, exec_remote_command

logger = logging.getLogger("isync.routers.dashboard")
router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

class ScanRequest(BaseModel):
    pair_id: str
    side: Literal["source", "dest"]
    server_id: Optional[str] = None  # If 'local', use "local". If None, use stored.
    timeout: Optional[int] = 1200 # Default 20m if not specified

class BulkScanServerUpdateRequest(BaseModel):
    pair_ids: List[str]
    source_server_id: Optional[str] = None
    dest_server_id: Optional[str] = None

class ScanResult(BaseModel):
    bytes: int
    count: int
    scanned_at: str

def parse_rclone_size(output: str) -> dict:
    """Parse rclone size --json output."""
    try:
        # Expected: {"count": 123, "bytes": 456}
        return json.loads(output)
    except json.JSONDecodeError:
        # Fallback for plain text: "Total objects: 123 (123)\nTotal size: 456 Byte (456)"
        # But --json should be reliable
        logger.warning(f"Failed to parse rclone json: {output}")
        return None

def run_local_scan(path: str) -> dict:
    """Run scan command locally."""
    # Try rclone first
    try:
        cmd = ["rclone", "size", path, "--json"]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = parse_rclone_size(res.stdout)
        if data:
            return data
    except subprocess.CalledProcessError as e:
        logger.debug(f"Local rclone scan failed: {e.stderr}")
    except Exception as e:
        logger.debug(f"Local rclone scan failed: {e}")
    
    # Fallback to du/find for local paths
    try:
        # Size
        du_res = subprocess.run(["du", "-sb", path], capture_output=True, text=True)
        if du_res.returncode != 0:
            raise Exception(f"du failed: {du_res.stderr}")
        size_bytes = int(du_res.stdout.split()[0])
        
        # Count
        find_res = subprocess.run(f"find '{path}' -type f | wc -l", shell=True, capture_output=True, text=True)
        if find_res.returncode != 0:
            raise Exception(f"find failed: {find_res.stderr}")
        count = int(find_res.stdout.strip())
        
        return {"bytes": size_bytes, "count": count}
    except Exception as e:
        logger.error(f"Local fallback scan failed: {e}")
        # Return detail in error
        raise HTTPException(status_code=500, detail=f"Local scan failed: {str(e)}")

def run_remote_scan(server_id: str, path: str, db: Session, timeout: int = 1200) -> dict:
    """Run scan command on remote SSH server."""
    # Use direct DB query
    server = db.query(SSHServer).filter(SSHServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    req = SSHBaseRequest(
        host=server.alias or server.host,
        user=server.user,
        key_path=server.key_path,
        timeout=timeout # Use provided timeout
    )
    
    errors = []
    
    # Try rclone
    try:
        cmd = f"rclone size '{path}' --json"
        res = exec_remote_command(req, cmd)
        
        if res.get("status") == "success":
            data = parse_rclone_size(res.get("stdout", ""))
            if data:
                return data
        else:
            errors.append(f"Rclone failed: {res.get('message')}")
            
    except Exception as e:
        logger.debug(f"Remote rclone scan logic failed: {e}")
        errors.append(f"Rclone exception: {str(e)}")
    
    # Fallback to du/find
    try:
        # Combine into one command to save connection time
        # du -sb path typically logic
        cmd = f"du -sb '{path}' | cut -f1 && find '{path}' -type f | wc -l"
        res = exec_remote_command(req, cmd)
        
        if res.get("status") == "success":
            output = res.get("stdout", "")
            lines = output.strip().split('\n')
            if len(lines) >= 2:
                param1 = lines[0].strip()
                param2 = lines[1].strip()
                # Verification if param1 is digit
                if param1.isdigit() and param2.isdigit():
                    return {
                        "bytes": int(param1),
                        "count": int(param2)
                    }
            errors.append(f"Fallback output parse error: {output}")
        else:
             errors.append(f"Fallback failed: {res.get('message')}")
             
    except Exception as e:
        logger.error(f"Remote fallback scan failed: {e}")
        errors.append(f"Fallback exception: {str(e)}")
        
    # If we reached here, both failed
    detail_msg = "; ".join(errors)
    raise HTTPException(status_code=500, detail=f"Remote scan failed. Errors: {detail_msg}")

@router.post("/scan")
def scan_path(req: ScanRequest, db: Session = Depends(get_db)):
    """
    Scan a source or destination path to get size and file count.
    """
    repo = SyncPairRepository(db)
    
    # Get Sync Pair
    logger.info(f"Looking up SyncPair with ID: {req.pair_id}")
    
    # Convert to int (pair_id is string from frontend, id column is int)
    try:
        pair_id_int = int(req.pair_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid pair_id format: {req.pair_id}")
    
    pair = db.query(SyncPair).filter(SyncPair.id == pair_id_int).first()

    if not pair:
        raise HTTPException(status_code=404, detail=f"Sync pair not found (ID: {req.pair_id})")
    
    # Determine Path and Server
    if req.side == "source":
        path = pair.source
        current_server = pair.scan_source_server_id
    else:
        path = pair.dest
        current_server = pair.scan_dest_server_id
    
    # 1. Update Server Preference if provided
    target_server = req.server_id
    if target_server:
        if req.side == "source":
            pair.scan_source_server_id = target_server
        else:
            pair.scan_dest_server_id = target_server
        db.commit()
    elif current_server:
        target_server = current_server
    else:
        # Raise error to prompt user
        raise HTTPException(status_code=400, detail="SERVER_SELECTION_REQUIRED")
    
    # 2. Execute Scan
    logger.info(f"Scanning {req.side} for pair {pair.id} on {target_server}: {path}")
    
    normalized_server = target_server.lower()
    if normalized_server == "local":
        result = run_local_scan(path)
    else:
        result = run_remote_scan(target_server, path, db, timeout=req.timeout or 1200)
        
    # 3. Update Stats
    now = datetime.utcnow()
    if req.side == "source":
        pair.source_size_bytes = result["bytes"]
        pair.source_file_count = result["count"]
        pair.source_scanned_at = now
    else:
        pair.dest_size_bytes = result["bytes"]
        pair.dest_file_count = result["count"]
        pair.dest_scanned_at = now
        
    db.commit()
    db.refresh(pair)
    
    return {
        "status": "ok",
        "pair_id": pair.id,
        "side": req.side,
        "result": {
            "bytes": result["bytes"],
            "count": result["count"],
            "scanned_at": now.isoformat()
        }
    }

@router.post("/bulk-update-scan-servers")
def bulk_update_scan_servers(req: BulkScanServerUpdateRequest, db: Session = Depends(get_db)):
    """
    Update scan server preferences for multiple sync pairs.
    """
    try:
        int_ids = [int(pid) for pid in req.pair_ids]
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid pair_id in list")
    
    pairs = db.query(SyncPair).filter(SyncPair.id.in_(int_ids)).all()
    
    for pair in pairs:
        if req.source_server_id:
            pair.scan_source_server_id = req.source_server_id
        if req.dest_server_id:
            pair.scan_dest_server_id = req.dest_server_id
            
    db.commit()
    return {"status": "ok", "updated_count": len(pairs)}
