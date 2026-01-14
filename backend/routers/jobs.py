"""
Jobs Router
Handles job execution, history, batch generation, and saved batch management.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict
import os
import re
from datetime import datetime

from backend.dependencies import get_store, get_job_manager, get_engine
from backend.logging_config import get_logger

logger = get_logger("isync.routers.jobs")

router = APIRouter(prefix="/api", tags=["Jobs"])


# --- Pydantic Models ---
class SyncPair(BaseModel):
    source: str
    dest: str
    domain_reference: Optional[str] = ""
    
    class Config:
        extra = "ignore"


class JobRequest(BaseModel):
    pairs: List[SyncPair]
    dry_run: bool = False
    selected_users: Optional[List[str]] = None
    
    class Config:
        extra = "ignore"


class SaveBatchRequest(BaseModel):
    filename: str
    commands: Dict[str, str]
    include_header: bool = True


class BatchCompareRequest(BaseModel):
    filename: str
    domain: Optional[str] = None
    compare_users: Optional[List[str]] = None


# --- Helper Functions ---
def get_batch_dir():
    """Get the batch directory path."""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "isync_batch")


def extract_users_from_batch(content: str) -> List[str]:
    """Extract user emails from batch file content."""
    pattern = r'--drive-impersonate=([^\s]+)'
    matches = re.findall(pattern, content)
    seen = set()
    users = []
    for email in matches:
        if email not in seen:
            seen.add(email)
            users.append(email)
    return users


# --- Job Execution Endpoints ---
@router.post("/jobs/start")
def start_job(request: JobRequest):
    """Start a sync job."""
    job_manager = get_job_manager()
    try:
        pairs_dicts = [p.dict() for p in request.pairs]
        job_manager.start_job(pairs_dicts, dry_run=request.dry_run, user_list=request.selected_users)
        return {"status": "started"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/jobs/stop")
def stop_job():
    """Stop the current job."""
    job_manager = get_job_manager()
    job_manager.stop_job()
    return {"status": "stopped"}


@router.post("/jobs/preview")
def preview_job(request: JobRequest):
    """Preview job execution."""
    engine = get_engine()
    previews = []
    
    for pair in request.pairs:
        pair_dict = pair.dict()
        data = engine.generate_preview(pair_dict)
        previews.append({
            "pair": pair_dict,
            "context": data['context'],
            "command": data['command']
        })
    
    return previews


# --- Job History Endpoints ---
@router.get("/jobs/history")
def get_job_history(limit: int = 50, offset: int = 0, status: Optional[str] = None):
    """Get paginated job history."""
    try:
        from backend.features import HISTORY_AVAILABLE, SessionLocal, JobHistoryRepository
        if not HISTORY_AVAILABLE:
            return {"runs": [], "error": "Job history not available (install sqlalchemy)"}
        
        db = SessionLocal()
        try:
            repo = JobHistoryRepository(db)
            runs = repo.get_runs(limit=limit, offset=offset, status=status)
            return {
                "runs": [r.to_dict() for r in runs],
                "limit": limit,
                "offset": offset
            }
        finally:
            db.close()
    except ImportError:
        return {"runs": [], "error": "History module not available"}


@router.get("/jobs/history/{run_id}")
def get_job_run(run_id: int):
    """Get a specific job run with details."""
    try:
        from backend.features import HISTORY_AVAILABLE, SessionLocal, JobHistoryRepository
        if not HISTORY_AVAILABLE:
            raise HTTPException(status_code=503, detail="Job history not available")
        
        db = SessionLocal()
        try:
            repo = JobHistoryRepository(db)
            run = repo.get_run(run_id)
            if not run:
                raise HTTPException(status_code=404, detail="Job run not found")
            return run.to_dict()
        finally:
            db.close()
    except ImportError:
        raise HTTPException(status_code=503, detail="History module not available")


@router.get("/jobs/history/{run_id}/logs")
def get_job_logs(run_id: int, limit: int = 500):
    """Get logs for a specific job run."""
    try:
        from backend.features import HISTORY_AVAILABLE, SessionLocal, JobHistoryRepository
        if not HISTORY_AVAILABLE:
            raise HTTPException(status_code=503, detail="Job history not available")
        
        db = SessionLocal()
        try:
            repo = JobHistoryRepository(db)
            run = repo.get_run(run_id)
            if not run:
                raise HTTPException(status_code=404, detail="Job run not found")
            logs = repo.get_logs(run_id, limit=limit)
            return {
                "run_id": run_id,
                "logs": [l.to_dict() for l in logs],
                "count": len(logs)
            }
        finally:
            db.close()
    except ImportError:
        raise HTTPException(status_code=503, detail="History module not available")


@router.delete("/jobs/history/cleanup")
def cleanup_old_jobs(days: int = 30):
    """Delete job history older than specified days."""
    try:
        from backend.features import HISTORY_AVAILABLE, SessionLocal, JobHistoryRepository
        if not HISTORY_AVAILABLE:
            raise HTTPException(status_code=503, detail="Job history not available")
        
        db = SessionLocal()
        try:
            repo = JobHistoryRepository(db)
            deleted = repo.delete_old_runs(days=days)
            return {"deleted": deleted, "days": days}
        finally:
            db.close()
    except ImportError:
        raise HTTPException(status_code=503, detail="History module not available")


# --- Batch Generation Endpoints ---
@router.post("/manual/batch")
def generate_batch(request: JobRequest):
    """Generate batch commands for the given sync pairs."""
    engine = get_engine()
    results = {}
    
    for pair in request.pairs:
        pair_dict = pair.dict()
        cmd = engine.generate_batch_command(
            pair_dict, 
            dry_run=request.dry_run, 
            user_list=request.selected_users
        )
        label = f"{pair.source} -> {pair.dest}"
        results[label] = cmd
    
    return {"status": "ok", "commands": results}


@router.post("/manual/batch/save")
def save_batch(request: SaveBatchRequest):
    """Save batch commands to a file."""
    batch_dir = get_batch_dir()
    os.makedirs(batch_dir, exist_ok=True)
    
    filename = request.filename.strip()
    if not filename:
        filename = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    if not filename.endswith('.sh') and not filename.endswith('.txt'):
        filename += '.sh'
    
    filepath = os.path.join(batch_dir, filename)
    
    try:
        with open(filepath, 'w') as f:
            if request.include_header:
                f.write("#!/bin/bash\n")
                f.write(f"# ISync Batch Commands\n")
                f.write(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"# Commands: {len(request.commands)}\n")
                f.write("#\n")
                f.write("# Copy and paste these commands to a remote server\n")
                f.write("# or run: bash " + filename + "\n")
                f.write("#" + "=" * 60 + "\n\n")
            
            for label, cmd in request.commands.items():
                f.write(f"# {label}\n")
                f.write(f"{cmd}\n\n")
        
        return {
            "status": "ok", 
            "file": filename, 
            "path": filepath,
            "commands_saved": len(request.commands)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save batch: {str(e)}")


@router.get("/manual/batch/list")
def list_saved_batches():
    """List all saved batch files."""
    batch_dir = get_batch_dir()
    
    if not os.path.exists(batch_dir):
        return {"files": []}
    
    files = []
    for f in os.listdir(batch_dir):
        filepath = os.path.join(batch_dir, f)
        if os.path.isfile(filepath):
            stat = os.stat(filepath)
            files.append({
                "name": f,
                "size": stat.st_size,
                "modified": stat.st_mtime
            })
    
    files.sort(key=lambda x: x['modified'], reverse=True)
    return {"files": files}


@router.get("/manual/batch/{filename}")
def get_batch_file(filename: str):
    """Get contents of a saved batch file."""
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Batch file not found")
    
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        return {"filename": filename, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read batch: {str(e)}")


@router.get("/manual/batch/{filename}/users")
def get_batch_users(filename: str):
    """Get list of users from a batch file."""
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Batch file not found")
    
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        users = extract_users_from_batch(content)
        
        domain = None
        if users and '@' in users[0]:
            domain = users[0].split('@')[1]
        
        return {
            "filename": filename,
            "users": users,
            "count": len(users),
            "domain": domain
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse batch: {str(e)}")


@router.post("/manual/batch/compare")
def compare_batch_users(request: BatchCompareRequest):
    """Compare users in batch file with domain users."""
    from backend.ops import list_domain_users
    
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, request.filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Batch file not found")
    
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        batch_users = set(extract_users_from_batch(content))
        
        if request.compare_users:
            compare_set = set(request.compare_users)
        elif request.domain:
            domain_data = list_domain_users(request.domain)
            compare_set = set(u['email'] for u in domain_data.get('users', []))
        else:
            domain = None
            for u in batch_users:
                if '@' in u:
                    domain = u.split('@')[1]
                    break
            if domain:
                domain_data = list_domain_users(domain)
                compare_set = set(u['email'] for u in domain_data.get('users', []))
            else:
                compare_set = set()
        
        in_batch_only = sorted(batch_users - compare_set)
        in_compare_only = sorted(compare_set - batch_users)
        in_both = sorted(batch_users & compare_set)
        
        return {
            "filename": request.filename,
            "batch_count": len(batch_users),
            "compare_count": len(compare_set),
            "in_batch_only": in_batch_only,
            "in_compare_only": in_compare_only,
            "in_both": in_both,
            "batch_coverage": round(len(in_both) / len(compare_set) * 100, 1) if compare_set else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")


@router.delete("/manual/batch/{filename}")
def delete_batch_file(filename: str):
    """Delete a saved batch file."""
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Batch file not found")
    
    try:
        os.remove(filepath)
        return {"status": "ok", "deleted": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")


@router.put("/manual/batch/{filename}")
def rename_batch_file(filename: str, new_name: str):
    """Rename a batch file."""
    batch_dir = get_batch_dir()
    old_path = os.path.join(batch_dir, filename)
    new_path = os.path.join(batch_dir, new_name)
    
    if not os.path.exists(old_path):
        raise HTTPException(status_code=404, detail="Batch file not found")
    if os.path.exists(new_path):
        raise HTTPException(status_code=409, detail="A file with that name already exists")
    
    try:
        os.rename(old_path, new_path)
        return {"status": "ok", "old_name": filename, "new_name": new_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename: {str(e)}")
