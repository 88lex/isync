"""
Batch Groups Router
Handles batch group management, reordering, and group script generation.
Uses database storage via BatchGroupRepository.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
import os
from datetime import datetime
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.repositories.batch_groups import BatchGroupRepository, get_ssh_server_by_id
from backend.logging_config import get_logger

logger = get_logger("isync.routers.batch_groups")

router = APIRouter(prefix="/api/batch-groups", tags=["Batch Groups"])

# Path for batch files
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BATCH_DIR = os.path.join(BASE_DIR, "batch")


# --- Pydantic Models ---
class BatchGroupCreate(BaseModel):
    name: str
    description: str = ""
    batch_files: List[str] = []


class BatchGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    batch_files: Optional[List[str]] = None


class ReorderRequest(BaseModel):
    batch_files: List[str]


class PushGroupRequest(BaseModel):
    server_id: str


class RemoteGroupRequest(BaseModel):
    server_id: str


# --- CRUD Endpoints ---
@router.get("")
def list_batch_groups(db: Session = Depends(get_db)) -> List[dict]:
    """List all batch groups."""
    repo = BatchGroupRepository(db)
    return repo.list_all()


@router.post("")
def create_batch_group(req: BatchGroupCreate, db: Session = Depends(get_db)):
    """Create a new batch group."""
    repo = BatchGroupRepository(db)
    
    # Check for duplicate names
    existing = repo.get_by_name(req.name)
    if existing:
        raise HTTPException(status_code=409, detail="A group with this name already exists")
    
    new_id = str(uuid.uuid4())[:8]
    group = repo.create(
        id=new_id,
        name=req.name,
        description=req.description,
        batch_files=req.batch_files
    )
    
    return {"status": "ok", "group": group}


@router.get("/{group_id}")
def get_batch_group(group_id: str, db: Session = Depends(get_db)):
    """Get a specific batch group with batch file details."""
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    # Enrich with batch file info
    batch_details = []
    for filename in group.get("batch_files", []):
        filepath = os.path.join(BATCH_DIR, filename)
        if os.path.exists(filepath):
            stat = os.stat(filepath)
            batch_details.append({
                "name": filename,
                "exists": True,
                "size": stat.st_size,
                "modified": stat.st_mtime
            })
        else:
            batch_details.append({
                "name": filename,
                "exists": False,
                "size": 0,
                "modified": None
            })
    
    group["batch_details"] = batch_details
    return group


@router.put("/{group_id}")
def update_batch_group(group_id: str, req: BatchGroupUpdate, db: Session = Depends(get_db)):
    """Update a batch group."""
    repo = BatchGroupRepository(db)
    
    existing = repo.get_by_id(group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    # Check for duplicate name (if changing name)
    if req.name and req.name.lower() != existing["name"].lower():
        duplicate = repo.get_by_name(req.name)
        if duplicate and duplicate["id"] != group_id:
            raise HTTPException(status_code=409, detail="A group with this name already exists")
    
    updated = repo.update(
        group_id=group_id,
        name=req.name,
        description=req.description,
        batch_files=req.batch_files
    )
    
    return {"status": "ok", "group": updated}


@router.delete("/{group_id}")
def delete_batch_group(group_id: str, db: Session = Depends(get_db)):
    """Delete a batch group."""
    repo = BatchGroupRepository(db)
    
    if not repo.delete(group_id):
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    return {"status": "ok", "deleted": group_id}


@router.post("/{group_id}/reorder")
def reorder_batch_group(group_id: str, req: ReorderRequest, db: Session = Depends(get_db)):
    """Reorder batches within a group."""
    repo = BatchGroupRepository(db)
    
    updated = repo.update(group_id=group_id, batch_files=req.batch_files)
    if not updated:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    return {"status": "ok", "group": updated}


@router.post("/{group_id}/generate")
def generate_group_script(group_id: str, db: Session = Depends(get_db)):
    """Generate a group batch command script that runs all batches in order."""
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    batch_files = group.get("batch_files", [])
    if not batch_files:
        raise HTTPException(status_code=400, detail="Group has no batch files")
    
    # Generate script content
    lines = [
        "#!/bin/bash",
        f"# ISync Group Batch Command",
        f"# Group: {group['name']}",
        f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"# Batches: {len(batch_files)}",
        "",
        "set -e  # Exit on first error",
        "",
        f"BATCH_DIR=\"$(dirname \"$0\")\"",
        "",
    ]
    
    for i, batch_file in enumerate(batch_files, 1):
        lines.append(f"echo \"=== Running batch {i}/{len(batch_files)}: {batch_file} ===\"")
        lines.append(f"bash \"$BATCH_DIR/../{batch_file}\"")
        lines.append(f"echo \"Completed: {batch_file}\"")
        lines.append("")
    
    lines.append("echo \"=== All batches complete ===\"")
    
    script_content = "\n".join(lines)
    
    # Save to groups directory
    groups_dir = os.path.join(BATCH_DIR, "groups")
    os.makedirs(groups_dir, exist_ok=True)
    
    filename = f"group_{group['name'].replace(' ', '_').lower()}.sh"
    filepath = os.path.join(groups_dir, filename)
    
    with open(filepath, 'w') as f:
        f.write(script_content)
    
    # Make executable
    os.chmod(filepath, 0o755)
    
    return {
        "status": "ok",
        "filename": filename,
        "path": filepath,
        "content": script_content,
        "batch_count": len(batch_files)
    }


@router.post("/{group_id}/push")
def push_batch_group(group_id: str, req: PushGroupRequest, db: Session = Depends(get_db)):
    """Push the batch group (files and script) to a remote server."""
    from backend.ops import exec_remote_command, copy_file_to_remote, SSHBaseRequest
    
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    # Get server from database
    server = get_ssh_server_by_id(db, req.server_id)
    if not server:
        raise HTTPException(404, "SSH Server configuration not found")

    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=30
    )

    remote_base = f"{server.get('remote_path', '/opt/isync')}/batch"
    res = exec_remote_command(ssh_req, f"mkdir -p {remote_base}/groups")
    if res['status'] != 'success':
        raise HTTPException(500, f"Failed to create remote directories: {res.get('message')}")

    results = []

    # Push Batch Files
    for filename in group.get("batch_files", []):
        local_path = os.path.join(BATCH_DIR, filename)
        if not os.path.exists(local_path):
            results.append(f"Skipped {filename} (Local missing)")
            continue
             
        res = copy_file_to_remote(ssh_req, local_path, f"{remote_base}/{filename}")
        if res['status'] == 'success':
            results.append(f"Pushed {filename}")
        else:
            results.append(f"Failed {filename}: {res.get('message')}")

    # Generate and Push Group Script
    script_name = f"group_{group['name'].replace(' ', '_').lower()}.sh"
    local_script = os.path.join(BATCH_DIR, "groups", script_name)
    
    if not os.path.exists(local_script):
        gen_res = generate_group_script(group_id, db)
        local_script = gen_res['path']
    
    res = copy_file_to_remote(ssh_req, local_script, f"{remote_base}/groups/{script_name}")
    if res['status'] == 'success':
        results.append(f"Pushed script {script_name}")
        exec_remote_command(ssh_req, f"chmod +x {remote_base}/groups/{script_name}")
    else:
        results.append(f"Failed script {script_name}: {res.get('message')}")

    return {
        "status": "completed",
        "results": results,
        "server": server['name']
    }


@router.get("/{group_id}/script")
def get_group_script(group_id: str, db: Session = Depends(get_db)):
    """Get the generated group script if it exists."""
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    filename = f"group_{group['name'].replace(' ', '_').lower()}.sh"
    filepath = os.path.join(BATCH_DIR, "groups", filename)
    
    if not os.path.exists(filepath):
        return {"exists": False, "filename": filename}
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    return {
        "exists": True,
        "filename": filename,
        "path": filepath,
        "content": content
    }


@router.post("/{group_id}/check")
def check_group_remote(group_id: str, req: RemoteGroupRequest, db: Session = Depends(get_db)):
    """Check if a batch group script exists on the remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    server = get_ssh_server_by_id(db, req.server_id)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=10
    )
    
    script_name = f"group_{group['name'].replace(' ', '_').lower()}.sh"
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/groups/{script_name}"
    res = exec_remote_command(ssh_req, f"test -f {remote_path} && echo EXISTS || echo MISSING")
    
    if res['status'] == 'success':
        exists = 'EXISTS' in res.get('stdout', '')
        return {"exists": exists, "server": server['name'], "remote_path": remote_path}
    else:
        return {"exists": False, "error": res.get('message')}


@router.post("/{group_id}/pull")
def pull_group_remote(group_id: str, req: RemoteGroupRequest, db: Session = Depends(get_db)):
    """Pull a batch group script from a remote server."""
    import subprocess
    
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    server = get_ssh_server_by_id(db, req.server_id)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    script_name = f"group_{group['name'].replace(' ', '_').lower()}.sh"
    local_dir = os.path.join(BATCH_DIR, "groups")
    os.makedirs(local_dir, exist_ok=True)
    local_path = os.path.join(local_dir, script_name)
    
    ssh_target = server.get('alias') or server.get('host')
    if server.get('user'):
        ssh_target = f"{server['user']}@{ssh_target}"
    
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/groups/{script_name}"
    
    cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
    if server.get('key_path'):
        cmd.extend(["-i", server['key_path']])
    cmd.extend([f"{ssh_target}:{remote_path}", local_path])
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if res.returncode == 0:
            return {"status": "success", "message": f"Pulled {script_name} from {server['name']}"}
        else:
            raise HTTPException(500, f"Pull failed: {res.stderr}")
    except Exception as e:
        raise HTTPException(500, f"Pull failed: {str(e)}")


@router.delete("/{group_id}/remote")
def delete_group_remote(group_id: str, server_id: str, db: Session = Depends(get_db)):
    """Delete a batch group script from a remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    
    repo = BatchGroupRepository(db)
    group = repo.get_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    server = get_ssh_server_by_id(db, server_id)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=10
    )
    
    script_name = f"group_{group['name'].replace(' ', '_').lower()}.sh"
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/groups/{script_name}"
    res = exec_remote_command(ssh_req, f"rm -f {remote_path}")
    
    if res['status'] == 'success':
        return {"status": "success", "message": f"Deleted {script_name} from {server['name']}"}
    else:
        raise HTTPException(500, f"Delete failed: {res.get('message')}")
