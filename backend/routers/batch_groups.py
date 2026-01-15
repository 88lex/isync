"""
Batch Groups Router
Handles batch group management, reordering, and group script generation.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import uuid
import os
from datetime import datetime

from backend.models.batch_groups import (
    BatchGroup, BatchGroupCreate, BatchGroupUpdate, ReorderRequest,
    load_batch_groups, save_batch_groups, BATCH_DIR
)
from backend.logging_config import get_logger

logger = get_logger("isync.routers.batch_groups")

router = APIRouter(prefix="/api/batch-groups", tags=["Batch Groups"])


# --- CRUD Endpoints ---
@router.get("")
def list_batch_groups() -> List[dict]:
    """List all batch groups."""
    groups = load_batch_groups()
    return [g.dict() for g in groups]


@router.post("")
def create_batch_group(req: BatchGroupCreate):
    """Create a new batch group."""
    groups = load_batch_groups()
    
    # Check for duplicate names
    for g in groups:
        if g.name.lower() == req.name.lower():
            raise HTTPException(status_code=409, detail="A group with this name already exists")
    
    now = datetime.now().isoformat()
    new_group = BatchGroup(
        id=str(uuid.uuid4())[:8],
        name=req.name,
        description=req.description,
        batch_files=req.batch_files,
        created_at=now,
        updated_at=now
    )
    
    groups.append(new_group)
    save_batch_groups(groups)
    
    return {"status": "ok", "group": new_group.dict()}


@router.get("/{group_id}")
def get_batch_group(group_id: str):
    """Get a specific batch group with batch file details."""
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    # Enrich with batch file info
    batch_details = []
    for filename in group.batch_files:
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
    
    result = group.dict()
    result["batch_details"] = batch_details
    return result


@router.put("/{group_id}")
def update_batch_group(group_id: str, req: BatchGroupUpdate):
    """Update a batch group."""
    groups = load_batch_groups()
    group_idx = None
    
    for i, g in enumerate(groups):
        if g.id == group_id:
            group_idx = i
            break
    
    if group_idx is None:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    # Check for duplicate name (if changing name)
    if req.name:
        for g in groups:
            if g.id != group_id and g.name.lower() == req.name.lower():
                raise HTTPException(status_code=409, detail="A group with this name already exists")
    
    # Update fields
    group = groups[group_idx]
    updated = group.dict()
    if req.name is not None:
        updated["name"] = req.name
    if req.description is not None:
        updated["description"] = req.description
    if req.batch_files is not None:
        updated["batch_files"] = req.batch_files
    updated["updated_at"] = datetime.now().isoformat()
    
    groups[group_idx] = BatchGroup(**updated)
    save_batch_groups(groups)
    
    return {"status": "ok", "group": groups[group_idx].dict()}


@router.delete("/{group_id}")
def delete_batch_group(group_id: str):
    """Delete a batch group."""
    groups = load_batch_groups()
    original_len = len(groups)
    groups = [g for g in groups if g.id != group_id]
    
    if len(groups) == original_len:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    save_batch_groups(groups)
    return {"status": "ok", "deleted": group_id}


@router.post("/{group_id}/reorder")
def reorder_batch_group(group_id: str, req: ReorderRequest):
    """Reorder batches within a group."""
    groups = load_batch_groups()
    group_idx = None
    
    for i, g in enumerate(groups):
        if g.id == group_id:
            group_idx = i
            break
    
    if group_idx is None:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    # Update batch order
    updated = groups[group_idx].dict()
    updated["batch_files"] = req.batch_files
    updated["updated_at"] = datetime.now().isoformat()
    
    groups[group_idx] = BatchGroup(**updated)
    save_batch_groups(groups)
    
    return {"status": "ok", "group": groups[group_idx].dict()}


@router.post("/{group_id}/generate")
def generate_group_script(group_id: str):
    """Generate a group batch command script that runs all batches in order."""
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    if not group.batch_files:
        raise HTTPException(status_code=400, detail="Group has no batch files")
    
    # Generate script content
    lines = [
        "#!/bin/bash",
        f"# ISync Group Batch Command",
        f"# Group: {group.name}",
        f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"# Batches: {len(group.batch_files)}",
        "",
        "set -e  # Exit on first error",
        "",
        f"BATCH_DIR=\"$(dirname \"$0\")\"",
        "",
    ]
    
    for i, batch_file in enumerate(group.batch_files, 1):
        lines.append(f"echo \"=== Running batch {i}/{len(group.batch_files)}: {batch_file} ===\"")
        # Since script is in batch/groups/ and files are in batch/
        lines.append(f"bash \"$BATCH_DIR/../{batch_file}\"")
        lines.append(f"echo \"Completed: {batch_file}\"")
        lines.append("")
    
    lines.append("echo \"=== All batches complete ===\"")
    
    script_content = "\n".join(lines)
    
    # Save to groups directory
    groups_dir = os.path.join(BATCH_DIR, "groups")
    os.makedirs(groups_dir, exist_ok=True)
    
    filename = f"group_{group.name.replace(' ', '_').lower()}.sh"
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
        "batch_count": len(group.batch_files)
    }

class PushGroupRequest(BaseModel):
    server_id: str

from pydantic import BaseModel

@router.post("/{group_id}/push")
def push_batch_group(group_id: str, req: PushGroupRequest):
    """Push the batch group (files and script) to a remote server."""
    # Imports
    from backend.ops import exec_remote_command, copy_file_to_remote, SSHBaseRequest
    from backend.store import store
    
    # 1. Get Group
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
        
    # 2. Get Server
    app_config = store.get_config()
    server = next((s for s in app_config.get('remote_servers', []) if s['id'] == req.server_id), None)
    if not server:
         raise HTTPException(404, "SSH Server configuration not found")

    ssh_req = SSHBaseRequest(
        host=server['host'],
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=30
    )

    # 3. Ensure remote directories exist
    # We assume base is /opt/isync/batch and /opt/isync/batch/groups
    # Or relative to user home?
    # isync standard is /opt/isync. But user might not have perms?
    # Assuming standard setup.
    remote_base = "/opt/isync/batch"
    res = exec_remote_command(ssh_req, f"mkdir -p {remote_base}/groups")
    if res['status'] != 'success':
        # Fallback? Or fail.
        # Maybe user uses ~/isync/batch ?
        # Code in crontab uses /opt/isync. We stick to that.
        raise HTTPException(500, f"Failed to create remote directories: {res.get('message')}")

    results = []

    # 4. Push Batch Files
    for filename in group.batch_files:
        local_path = os.path.join(BATCH_DIR, filename)
        if not os.path.exists(local_path):
             results.append(f"Skipped {filename} (Local missing)")
             continue
             
        # Push to batch/
        res = copy_file_to_remote(ssh_req, local_path, f"{remote_base}/{filename}")
        if res['status'] == 'success':
            results.append(f"Pushed {filename}")
        else:
            results.append(f"Failed {filename}: {res.get('message')}")

    # 5. Generate and Push Group Script
    # We generate it freshly to ensure content is up to date (or use existing file?)
    # Calling generate internal logic logic or just use file?
    # Better to regenerate to be safe.
    # We reuse the logic by calling the endpoint function? Or extracting helper?
    # I'll just call the file read logic or assume it exists.
    # Helper extract is better but let's just regenerate content inline or read file.
    
    # We'll use the existing generation endpoint logic if possible, or just read the file if it exists.
    # The user might have manually generated it.
    # Let's check getting script.
    
    script_name = f"group_{group.name.replace(' ', '_').lower()}.sh"
    local_script = os.path.join(BATCH_DIR, "groups", script_name)
    
    # If not exists, generate it
    if not os.path.exists(local_script):
        # We need to generate it.
        # Call generate_group_script(group_id) ? 
        # But that's a route function.
        # We can just call it directly? Yes, it returns dict.
        gen_res = generate_group_script(group_id)
        local_script = gen_res['path'] # type: ignore
    
    # Push script
    res = copy_file_to_remote(ssh_req, local_script, f"{remote_base}/groups/{script_name}")
    if res['status'] == 'success':
        results.append(f"Pushed script {script_name}")
        
        # Make executable
        exec_remote_command(ssh_req, f"chmod +x {remote_base}/groups/{script_name}")
    else:
        results.append(f"Failed script {script_name}: {res.get('message')}")

    return {
        "status": "completed",
        "results": results,
        "server": server['name']
    }


@router.get("/{group_id}/script")
def get_group_script(group_id: str):
    """Get the generated group script if it exists."""
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    filename = f"group_{group.name.replace(' ', '_').lower()}.sh"
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


class RemoteGroupRequest(BaseModel):
    server_id: str


@router.post("/{group_id}/check")
def check_group_remote(group_id: str, req: RemoteGroupRequest):
    """Check if a batch group script exists on the remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    from backend.store import store
    
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
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
    
    script_name = f"group_{group.name.replace(' ', '_').lower()}.sh"
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/groups/{script_name}"
    res = exec_remote_command(ssh_req, f"test -f {remote_path} && echo EXISTS || echo MISSING")
    
    if res['status'] == 'success':
        exists = 'EXISTS' in res.get('stdout', '')
        return {"exists": exists, "server": server['name'], "remote_path": remote_path}
    else:
        return {"exists": False, "error": res.get('message')}


@router.post("/{group_id}/pull")
def pull_group_remote(group_id: str, req: RemoteGroupRequest):
    """Pull a batch group script from a remote server."""
    from backend.store import store
    import subprocess
    
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
    app_config = store.get_config()
    server = next((s for s in app_config.get('ssh_servers', []) if s['id'] == req.server_id), None)
    if not server:
        raise HTTPException(404, "SSH Server not found")
    
    script_name = f"group_{group.name.replace(' ', '_').lower()}.sh"
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
def delete_group_remote(group_id: str, server_id: str):
    """Delete a batch group script from a remote server."""
    from backend.ops import exec_remote_command, SSHBaseRequest
    from backend.store import store
    
    groups = load_batch_groups()
    group = next((g for g in groups if g.id == group_id), None)
    if not group:
        raise HTTPException(status_code=404, detail="Batch group not found")
    
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
    
    script_name = f"group_{group.name.replace(' ', '_').lower()}.sh"
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/groups/{script_name}"
    res = exec_remote_command(ssh_req, f"rm -f {remote_path}")
    
    if res['status'] == 'success':
        return {"status": "success", "message": f"Deleted {script_name} from {server['name']}"}
    else:
        raise HTTPException(500, f"Delete failed: {res.get('message')}")

