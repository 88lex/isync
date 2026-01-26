"""
Jobs Router
Handles job execution, history, batch generation, and saved batch management.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict
import os
import re
import random
from datetime import datetime

from backend.dependencies import get_store, get_job_manager, get_engine
from backend.logging_config import get_logger

logger = get_logger("isync.routers.jobs")

router = APIRouter(prefix="/api", tags=["Jobs"])


# --- Pydantic Models ---
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


class JobRequest(BaseModel):
    pairs: List[SyncPair]
    dry_run: bool = False
    selected_users: Optional[List[str]] = None
    random_order: bool = False
    
    class Config:
        extra = "ignore"


class SaveBatchRequest(BaseModel):
    filename: str
    commands: Dict[str, str]
    include_header: bool = True
    random_order: bool = False


class BatchCompareRequest(BaseModel):
    filename: str
    domain: Optional[str] = None
    compare_users: Optional[List[str]] = None


class RandomBatchRequest(BaseModel):
    """Request to generate batch with random users from selected domains."""
    pairs: List[SyncPair]
    user_count: Optional[int] = 0
    domains: List[str]
    dry_run: bool = False
    random_order: bool = False

# --- Helper Functions ---
def get_batch_dir():
    """Get the batch directory path."""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "batch")


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


def extract_sync_pair_from_batch(content: str) -> Optional[Dict[str, str]]:
    """Extract the first sync pair (source -> dest) and PairID from batch file comments."""
    # Look for lines like: # /source/path -> remote:dest/path
    # And: # PairID: <uuid>
    pattern = r'^#\s*(.+?)\s*->\s*(.+?)\s*$'
    id_pattern = r'^#\s*PairID:\s*(.+?)\s*$'
    
    pair_info = {}
    for line in content.split('\n'):
        line = line.strip()
        
        # Match ID (first one wins)
        id_match = re.match(id_pattern, line)
        if id_match and "id" not in pair_info:
            pair_info["id"] = id_match.group(1).strip()
            
        # Match Source -> Dest (first valid one wins)
        match = re.match(pattern, line)
        if match and "source" not in pair_info:
            s, d = match.group(1).strip(), match.group(2).strip()
            # Basic validation to skip common headers
            if s and d and not s.startswith('ISync') and not s.startswith('Generated') and not s.startswith('Regenerated') and not s.startswith('PairID'):
                pair_info["source"] = s
                pair_info["dest"] = d
        
    return pair_info if pair_info else None


def generate_batch_filename(source: str, dest: str) -> str:
    """Generate a consistent batch filename from source and dest."""
    # Extract basename from source path
    source_base = os.path.basename(source.rstrip('/')) or 'source'
    # Extract remote name from dest (before the colon)
    dest_remote = dest.split(':')[0] if ':' in dest else 'dest'
    # Clean for filename safety
    source_base = re.sub(r'[^\w\-]', '_', source_base)
    dest_remote = re.sub(r'[^\w\-]', '_', dest_remote)
    return f"batch_{source_base}_{dest_remote}.sh"


def get_batch_info_for_pair(source: str, dest: str, pair_id: Optional[str] = None) -> Optional[Dict]:
    """Get batch file info if it exists for this sync pair (matches by content, not filename)."""
    batch_dir = get_batch_dir()
    default_filename = generate_batch_filename(source, dest)
    
    if not os.path.exists(batch_dir):
        return {"filename": default_filename, "exists": False}
    
    # Scan all batch files and match by PairID (if provided) or content (source -> dest comment)
    for filename in os.listdir(batch_dir):
        if filename.startswith('.'):
            continue
        filepath = os.path.join(batch_dir, filename)
        if not os.path.isfile(filepath):
            continue
        try:
            with open(filepath, 'r') as f:
                content = f.read()
            pair_info = extract_sync_pair_from_batch(content)
            if not pair_info:
                continue
                
            match = False
            if pair_id and pair_info.get('id') == pair_id:
                match = True
                logger.debug(f"[jobs] Matched {filename} by PairID: {pair_id}")
            elif pair_info.get('source') == source and pair_info.get('dest') == dest:
                match = True
                logger.debug(f"[jobs] Matched {filename} by paths: {source} -> {dest}")
                
            if match:
                # Found a match
                stat = os.stat(filepath)
                user_count = len(extract_users_from_batch(content))
                
                # Auto-migration: If matched by path but file has no ID, add it
                if match and pair_id and not pair_info.get('id'):
                    try:
                        # Append PairID comment to the header area (after shebang)
                        lines = content.split('\n')
                        for idx, line in enumerate(lines):
                            if line.startswith('#') and not line.startswith('#!'):
                                lines.insert(idx, f"# PairID: {pair_id}")
                                break
                        else:
                            # If no comments found, insert after first line
                            lines.insert(1, f"# PairID: {pair_id}")
                            
                        with open(filepath, 'w') as f:
                            f.write('\n'.join(lines))
                        logger.info(f"[jobs] Auto-assigned PairID {pair_id} to batch {filename}")
                    except Exception as e:
                        logger.warning(f"[jobs] Failed to auto-assign PairID: {e}")
                
                # Check if it needs update (paths changed)
                needs_update = False
                if pair_id and (pair_info.get('source') != source or pair_info.get('dest') != dest):
                    needs_update = True
                    
                return {
                    "filename": filename,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "user_count": user_count,
                    "exists": True,
                    "needs_update": needs_update
                }
        except Exception:
            continue
    
    # No match found - return default filename for new generation
    return {"filename": default_filename, "exists": False}


# --- Unified Sync Pair + Batch Endpoints ---
@router.get("/sync-pairs/with-batches")
def get_sync_pairs_with_batches():
    """Get all sync pairs with their associated batch file status."""
    store = get_store()
    pairs = store.get_sync_pairs()
    
    result = []
    for i, pair in enumerate(pairs):
        source = pair.get('source', '')
        dest = pair.get('dest', '')
        pair_id = pair.get('id')
        batch_info = get_batch_info_for_pair(source, dest, pair_id)
        result.append({
            "index": i,
            "id": pair_id,
            "source": source,
            "dest": dest,
            "domain_reference": pair.get('domain_reference', ''),
            "meta_server_id": pair.get('meta_server_id'),
            "meta_execution_mode": pair.get('meta_execution_mode', 'local'),
            "batch": batch_info
        })
    
    return {"pairs": result}


class BulkGenerateRequest(BaseModel):
    indices: List[int]
    random_order: bool = False
    dry_run: bool = False
    selected_users: Optional[List[str]] = None


@router.post("/sync-pairs/generate-batches")
def bulk_generate_batches(req: BulkGenerateRequest):
    """Generate/regenerate batch files for selected sync pairs."""
    store = get_store()
    engine = get_engine()
    pairs = store.get_sync_pairs()
    
    results = []
    for idx in req.indices:
        if idx < 0 or idx >= len(pairs):
            results.append({"index": idx, "status": "error", "message": "Invalid index"})
            continue
        
        pair = pairs[idx]
        source = pair.get('source', '')
        dest = pair.get('dest', '')
        
        # Check for existing batch file by ID (or paths) to preserve filename
        batch_info = get_batch_info_for_pair(source, dest, pair.get('id'))
        filename = batch_info.get('filename', generate_batch_filename(source, dest))
        
        try:
            # Generate commands with fresh shuffle if random_order is True
            commands = engine.generate_batch_command(
                pair,
                dry_run=req.dry_run,
                user_list=req.selected_users,  # Use selected users if provided
                random_order=req.random_order
            )
            
            if commands.startswith("Error"):
                results.append({"index": idx, "filename": filename, "status": "error", "message": commands})
                continue
            
            # Save to file (preserves existing filename or uses generated one)
            batch_dir = get_batch_dir()
            os.makedirs(batch_dir, exist_ok=True)
            filepath = os.path.join(batch_dir, filename)
            
            with open(filepath, 'w') as f:
                f.write("#!/bin/bash\n")
                f.write(f"# ISync Batch Commands\n")
                f.write(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"# Random Order: {req.random_order}\n")
                if pair.get('id'):
                    f.write(f"# PairID: {pair.get('id')}\n")
                f.write("#\n")
                f.write(f"# {source} -> {dest}\n")
                f.write("#" + "=" * 60 + "\n\n")
                f.write(commands)
                f.write("\n")
            
            user_count = len(extract_users_from_batch(commands))
            results.append({
                "index": idx,
                "filename": filename,
                "status": "ok",
                "user_count": user_count
            })
        except Exception as e:
            results.append({"index": idx, "filename": filename, "status": "error", "message": str(e)})
    
    return {
        "status": "ok",
        "results": results,
        "generated": len([r for r in results if r.get('status') == 'ok']),
        "failed": len([r for r in results if r.get('status') == 'error'])
    }


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
        try:
            cmd = engine.generate_batch_command(
                pair_dict, 
                dry_run=request.dry_run, 
                user_list=request.selected_users,
                random_order=request.random_order
            )
            label = f"{pair.source} -> {pair.dest}"
            results[label] = cmd
        except ValueError as e:
            label = f"{pair.source} -> {pair.dest}"
            results[label] = f"Error: {str(e)}"
        except Exception as e:
            label = f"{pair.source} -> {pair.dest}"
            results[label] = f"Error: {str(e)}"
    
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
                f.write(f"# Random Order: {request.random_order}\n")
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
        # Skip hidden files and git-related files
        if f.startswith('.'):
            continue
        filepath = os.path.join(batch_dir, f)
        if os.path.isfile(filepath):
            stat = os.stat(filepath)
            user_count = 0
            sync_pair = None
            try:
                with open(filepath, 'r') as file:
                    content = file.read()
                user_count = len(extract_users_from_batch(content))
                sync_pair = extract_sync_pair_from_batch(content)
                
                # Extract random_order
                random_order = False
                if "# Random Order: True" in content:
                    random_order = True
            except Exception:
                random_order = False
                pass  # If we can't read, just leave defaults
            
            files.append({
                "name": f,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "user_count": user_count,
                "sync_pair": sync_pair,
                "random_order": random_order
            })
    
    files.sort(key=lambda x: x['modified'], reverse=True)
    return {"files": files}


# --- User Summary ---
@router.get("/manual/batch/user-summary")
def get_user_batch_summary():
    """Get a summary of which users appear in which batch files."""
    batch_dir = get_batch_dir()
    
    if not os.path.exists(batch_dir):
        return {"users": {}, "batches": [], "total_users": 0}
    
    # Map user -> list of batch files
    user_batches: Dict[str, List[str]] = {}
    batch_files = []
    
    for f in os.listdir(batch_dir):
        filepath = os.path.join(batch_dir, f)
        if os.path.isfile(filepath) and (f.endswith('.sh') or f.endswith('.txt')):
            batch_files.append(f)
            try:
                with open(filepath, 'r') as file:
                    content = file.read()
                users = extract_users_from_batch(content)
                for user in users:
                    if user not in user_batches:
                        user_batches[user] = []
                    user_batches[user].append(f)
            except Exception as e:
                logger.warning(f"Failed to parse batch file {f}: {e}")
    
    # Sort users by email
    sorted_users = dict(sorted(user_batches.items()))
    
    return {
        "users": sorted_users,
        "batches": sorted(batch_files),
        "total_users": len(sorted_users),
        "total_batches": len(batch_files)
    }


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
    
    # Normalize paths for comparison
    if os.path.abspath(old_path) == os.path.abspath(new_path):
        return {"status": "ok", "old_name": filename, "new_name": new_name, "message": "No change"}

    if not os.path.exists(old_path):
        logger.error(f"[jobs] Rename failed: Source file {filename} not found at {old_path}")
        raise HTTPException(status_code=404, detail="Batch file not found")
        
    if os.path.exists(new_path):
        logger.warning(f"[jobs] Rename failed: Destination {new_name} already exists")
        raise HTTPException(status_code=409, detail="A file with that name already exists")
    
    try:
        os.rename(old_path, new_path)
        logger.info(f"[jobs] Success: Renamed batch {filename} to {new_name}")
        return {"status": "ok", "old_name": filename, "new_name": new_name}
    except Exception as e:
        logger.error(f"[jobs] Rename error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to rename: {str(e)}")


# --- Random Batch Generation ---
@router.post("/manual/batch/generate-random")
def generate_random_batch(request: RandomBatchRequest):
    """Generate batch commands with N random users from selected domains."""
    from backend.ops import list_domain_users
    
    engine = get_engine()
    
    # Collect users from all specified domains
    all_users = []
    for domain in request.domains:
        try:
            domain_data = list_domain_users(domain)
            users = [u['email'] for u in domain_data.get('users', []) if not u.get('suspended', False)]
            all_users.extend(users)
        except Exception as e:
            logger.warning(f"Failed to fetch users from {domain}: {e}")
    
    if not all_users:
        raise HTTPException(status_code=400, detail="No users found in specified domains")
    
    # Select random users
    if request.user_count == 0:
        count = len(all_users)
    else:
        count = min(request.user_count, len(all_users))
    
    selected_users = random.sample(all_users, count)
    
    # Generate batch commands
    results = {}
    for pair in request.pairs:
        pair_dict = pair.dict()
        cmd = engine.generate_batch_command(
            pair_dict, 
            dry_run=request.dry_run, 
            user_list=selected_users,
            random_order=request.random_order
        )
        label = f"{pair.source} -> {pair.dest}"
        results[label] = cmd
    
    return {
        "status": "ok",
        "commands": results,
        "selected_users": selected_users,
        "user_count": len(selected_users),
        "domains_queried": request.domains
    }


class PushBatchRequest(BaseModel):
    server_id: str


@router.post("/batch/{filename}/push")
def push_batch(filename: str, req: PushBatchRequest):
    """Push a single batch file to a remote server."""
    # Imports
    from backend.ops import exec_remote_command, copy_file_to_remote, SSHBaseRequest
    from backend.store import store

    # Check file exists
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Batch file not found")
        
    # Get Server
    app_config = store.get_config()
    server = next((s for s in app_config.get('ssh_servers', []) if s['id'] == req.server_id), None)
    if not server:
         raise HTTPException(404, "SSH Server configuration not found")

    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user') or None,
        key_path=server.get('key_path') or None,
        timeout=30
    )
    
    # Ensure remote dir (try without sudo first, then with sudo)
    remote_base = "/opt/isync/batch"
    res = exec_remote_command(ssh_req, f"mkdir -p {remote_base}")
    if res['status'] != 'success':
        # Try with sudo
        res = exec_remote_command(ssh_req, f"sudo mkdir -p {remote_base} && sudo chown $(whoami) {remote_base}")
        if res['status'] != 'success':
            raise HTTPException(500, f"Failed to ensure remote directory: {res.get('message')}")
    
    remote_dest = f"{remote_base}/{filename}"
    
    # Log push details
    logger.info(f"[push_batch] Pushing {filepath} -> {server.get('alias')}:{remote_dest}")
    
    res = copy_file_to_remote(ssh_req, filepath, remote_dest)
    if res['status'] != 'success':
        # Try with sudo workaround - copy to tmp then sudo mv
        logger.info(f"[push_batch] Direct copy failed, trying sudo workaround")
        tmp_dest = f"/tmp/{filename}"
        res = copy_file_to_remote(ssh_req, filepath, tmp_dest)
        if res['status'] != 'success':
            raise HTTPException(500, f"Failed to push batch: {res.get('message')}")
        # Move from tmp to target with sudo
        mv_res = exec_remote_command(ssh_req, f"sudo mv {tmp_dest} {remote_dest} && sudo chmod 755 {remote_dest}")
        if mv_res['status'] != 'success':
            raise HTTPException(500, f"Failed to move file to target: {mv_res.get('message')}")
    
    # Verify file exists on remote
    verify_res = exec_remote_command(ssh_req, f"test -f {remote_dest} && stat --printf='%s' {remote_dest}")
    if verify_res['status'] != 'success' or not verify_res.get('stdout'):
        raise HTTPException(500, f"File push appeared to succeed but verification failed - file not found at {remote_dest}")
    
    remote_file_size = verify_res.get('stdout', '0').strip()
    local_file_size = os.path.getsize(filepath)
    
    return {
        "status": "success", 
        "message": f"Pushed {filename} to {server.get('name') or server.get('alias')}",
        "details": {
            "source": filepath,
            "destination_server": server.get('name') or server.get('alias'),
            "destination_path": remote_dest,
            "server_id": req.server_id,
            "local_size": local_file_size,
            "remote_size": int(remote_file_size) if remote_file_size.isdigit() else 0,
            "verified": True
        }
    }


class UpdateBatchContentRequest(BaseModel):
    content: str


@router.patch("/manual/batch/{filename}")
def update_batch_content(filename: str, req: UpdateBatchContentRequest):
    """Update the content of a batch file."""
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Batch file not found")
    
    try:
        with open(filepath, 'w') as f:
            f.write(req.content)
        return {"status": "ok", "filename": filename, "size": len(req.content)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update: {str(e)}")


class RegenerateBatchRequest(BaseModel):
    random_order: bool = False
    selected_users: Optional[List[str]] = None
    all_users: bool = False
    pair_id: Optional[str] = None


@router.post("/manual/batch/{filename}/regenerate")
def regenerate_batch(filename: str, req: RegenerateBatchRequest):
    """Regenerate a batch file with specific users or latest sync pair paths."""
    batch_dir = get_batch_dir()
    filepath = os.path.join(batch_dir, filename)
    
    if not os.path.exists(filepath):
        logger.error(f"[jobs] Batch file not found: {filepath}")
        raise HTTPException(status_code=404, detail="Batch file not found")
        
    try:
        with open(filepath, 'r') as f:
            content = f.read()
            
        # 1. Extract what we have
        current_pair_info = extract_sync_pair_from_batch(content) or {}
        
        # Priority: req.pair_id -> extracted ID -> extracted paths
        pair_id = req.pair_id or current_pair_info.get('id')
        current_users = extract_users_from_batch(content)
        
        # 2. Find the latest Sync Pair info from store
        # Start with what we parsed from the file
        latest_pair = {
            "source": current_pair_info.get('source', ''), 
            "dest": current_pair_info.get('dest', '')
        }
        domain_ref = ""
        
        if pair_id:
            store = get_store()
            target_pair = None
            for p in store.get_sync_pairs():
                if p.get('id') == pair_id:
                    target_pair = p
                    break
            
            if target_pair:
                latest_pair["source"] = target_pair.get('source')
                latest_pair["dest"] = target_pair.get('dest')
                domain_ref = target_pair.get('domain_reference', '')
                logger.info(f"[jobs] Using latest store info for {filename} (PairID: {pair_id}): {latest_pair['source']} -> {latest_pair['dest']}")
            else:
                logger.warning(f"[jobs] PairID {pair_id} passed/found but not in current store!")
        
        if not latest_pair["source"] or not latest_pair["dest"]:
            logger.error(f"[jobs] Could not determine paths for regeneration of {filename}")
            raise HTTPException(status_code=400, detail="Could not determine sync paths. Is the file header missing or Sync Pair deleted?")

        latest_pair["domain_reference"] = domain_ref
        
        # 3. Determine User Set
        user_list = current_users # Default: Keep existing
        if req.selected_users is not None and len(req.selected_users) > 0:
            user_list = req.selected_users
            logger.info(f"[jobs] Regenerating {filename} with {len(user_list)} selected users")
        elif req.all_users:
            user_list = None # Engine will fetch all
            logger.info(f"[jobs] Regenerating {filename} with all domain users")
        else:
            # Re-verify we found users in the old file
            if not user_list:
                 logger.warning(f"[jobs] No users found in {filename} to preserve!")
            logger.info(f"[jobs] Regenerating {filename} while keeping existing {len(user_list) if user_list else 0} users")

        # 4. Generate Fresh Commands
        engine = get_engine()
        new_commands = engine.generate_batch_command(
            latest_pair,
            dry_run=False,
            user_list=user_list,
            random_order=req.random_order
        )
        
        if new_commands.startswith("Error"):
            logger.error(f"[jobs] Engine error during regeneration: {new_commands}")
            raise HTTPException(status_code=400, detail=new_commands)
            
        # 5. Build Final Content
        # We construct a clean new header and append the commands
        from datetime import datetime
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        header_lines = [
            "#!/bin/bash",
            "# ISync Batch Commands",
            f"# Regenerated: {now_str}",
            f"# Random Order: {req.random_order}"
        ]
        if pair_id:
            header_lines.append(f"# PairID: {pair_id}")
        header_lines.append("#")
        header_lines.append(f"# {latest_pair['source']} -> {latest_pair['dest']}")
        header_lines.append("#" + "=" * 60)
        header_lines.append("")
        
        new_content = "\n".join(header_lines) + new_commands
        if not new_content.endswith("\n"):
            new_content += "\n"

        # 6. Verify and Write
        if not new_commands.strip() and user_list:
            logger.error(f"[jobs] Regeneration produced NO commands for file {filename} despite having a user list!")
            raise HTTPException(status_code=500, detail="Generated command list is empty. Internal engine error?")

        with open(filepath, 'w') as f:
            f.write(new_content)
            f.flush()
            os.fsync(f.fileno())
            
        logger.info(f"[jobs] Successfully updated {filename} ({len(new_content)} bytes). Paths: {latest_pair['source']} -> {latest_pair['dest']}")
        
        new_user_count = len(extract_users_from_batch(new_commands))
        
        return {
            "status": "ok",
            "filename": filename,
            "sync_pair": {"id": pair_id, "source": latest_pair['source'], "dest": latest_pair['dest']},
            "user_count": new_user_count,
            "bytes_written": len(new_content)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Regeneration failed: {str(e)}")


class RemoteBatchRequest(BaseModel):
    server_id: str


@router.post("/batch/{filename}/check")
def check_batch_remote(filename: str, req: RemoteBatchRequest):
    """Check if a batch file exists on the remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    from backend.store import store
    
    app_config = store.get_config()
    server = next((s for s in app_config.get('ssh_servers', []) if s['id'] == req.server_id), None)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=10
    )
    
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/{filename}"
    res = exec_remote_command(ssh_req, f"test -f {remote_path} && echo EXISTS || echo MISSING")
    
    if res['status'] == 'success':
        exists = 'EXISTS' in res.get('stdout', '')
        return {"exists": exists, "server": server['name'], "remote_path": remote_path}
    else:
        return {"exists": False, "error": res.get('message')}


@router.post("/batch/{filename}/pull")
def pull_batch_remote(filename: str, req: RemoteBatchRequest):
    """Pull a batch file from a remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    from backend.store import store
    import subprocess
    
    app_config = store.get_config()
    server = next((s for s in app_config.get('ssh_servers', []) if s['id'] == req.server_id), None)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    batch_dir = get_batch_dir()
    local_path = os.path.join(batch_dir, filename)
    
    ssh_target = server.get('alias') or server.get('host')
    if server.get('user'):
        ssh_target = f"{server['user']}@{ssh_target}"
    
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/{filename}"
    
    cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
    if server.get('key_path'):
        cmd.extend(["-i", server['key_path']])
    cmd.extend([f"{ssh_target}:{remote_path}", local_path])
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if res.returncode == 0:
            return {"status": "success", "message": f"Pulled {filename} from {server['name']}"}
        else:
            raise HTTPException(500, f"Pull failed: {res.stderr}")
    except Exception as e:
        raise HTTPException(500, f"Pull failed: {str(e)}")


@router.delete("/batch/{filename}/remote")
def delete_batch_remote(filename: str, server_id: str):
    """Delete a batch file from a remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    from backend.store import store
    
    app_config = store.get_config()
    server = next((s for s in app_config.get('ssh_servers', []) if s['id'] == server_id), None)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=10
    )
    
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/{filename}"
    res = exec_remote_command(ssh_req, f"rm -f {remote_path}")
    
    if res['status'] == 'success':
        return {"status": "success", "message": f"Deleted {filename} from {server['name']}"}
    else:
        raise HTTPException(500, f"Delete failed: {res.get('message')}")


