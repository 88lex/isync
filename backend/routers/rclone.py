"""
Rclone Router
API endpoints for managing rclone remotes on local and remote servers.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
import subprocess
import re
import os

from backend.dependencies import get_store
from backend.logging_config import get_logger

logger = get_logger("isync.routers.rclone")

router = APIRouter(prefix="/api/rclone", tags=["Rclone Management"])


# --- Pydantic Models ---
class RcloneRemote(BaseModel):
    name: str
    type: str
    config: Dict[str, str] = {}


class RcloneRemoteUpdate(BaseModel):
    config: Dict[str, str]


class PullRemoteRequest(BaseModel):
    server_id: str
    remote_names: List[str]


# --- Helper Functions ---
def get_rclone_config_path():
    """Get the path to rclone.conf."""
    # Check common locations
    home = os.path.expanduser("~")
    paths = [
        os.path.join(home, ".config", "rclone", "rclone.conf"),
        os.path.join(home, ".rclone.conf"),
        "/etc/rclone/rclone.conf"
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    # Default to standard location
    return os.path.join(home, ".config", "rclone", "rclone.conf")


def parse_rclone_config(content: str) -> Dict[str, Dict[str, str]]:
    """Parse rclone.conf content into a dict of remotes."""
    remotes = {}
    current_remote = None
    current_config = {}
    
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        # Section header [remote_name]
        match = re.match(r'^\[(.+)\]$', line)
        if match:
            if current_remote:
                remotes[current_remote] = current_config
            current_remote = match.group(1)
            current_config = {}
        elif '=' in line and current_remote:
            key, value = line.split('=', 1)
            current_config[key.strip()] = value.strip()
    
    if current_remote:
        remotes[current_remote] = current_config
    
    return remotes


def write_rclone_config(remotes: Dict[str, Dict[str, str]], config_path: str):
    """Write remotes dict back to rclone.conf."""
    lines = []
    for name, config in remotes.items():
        lines.append(f"[{name}]")
        for key, value in config.items():
            lines.append(f"{key} = {value}")
        lines.append("")
    
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, 'w') as f:
        f.write('\n'.join(lines))


# --- Local Rclone Endpoints ---
@router.get("/remotes")
def list_local_remotes():
    """List all rclone remotes on local machine."""
    config_path = get_rclone_config_path()
    
    if not os.path.exists(config_path):
        return {"remotes": [], "config_path": config_path, "exists": False}
    
    try:
        with open(config_path, 'r') as f:
            content = f.read()
        
        remotes_dict = parse_rclone_config(content)
        remotes = [
            {"name": name, "type": config.get("type", "unknown"), "config": config}
            for name, config in remotes_dict.items()
        ]
        
        return {"remotes": remotes, "config_path": config_path, "exists": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remotes")
def create_local_remote(remote: RcloneRemote):
    """Create a new rclone remote."""
    config_path = get_rclone_config_path()
    
    # Load existing
    remotes_dict = {}
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            remotes_dict = parse_rclone_config(f.read())
    
    if remote.name in remotes_dict:
        raise HTTPException(status_code=409, detail="Remote already exists")
    
    # Add new remote
    config = remote.config.copy()
    config['type'] = remote.type
    remotes_dict[remote.name] = config
    
    write_rclone_config(remotes_dict, config_path)
    
    return {"status": "ok", "remote": remote.name}


@router.put("/remotes/{name}")
def update_local_remote(name: str, update: RcloneRemoteUpdate):
    """Update an existing rclone remote."""
    config_path = get_rclone_config_path()
    
    if not os.path.exists(config_path):
        raise HTTPException(status_code=404, detail="Config file not found")
    
    with open(config_path, 'r') as f:
        remotes_dict = parse_rclone_config(f.read())
    
    if name not in remotes_dict:
        raise HTTPException(status_code=404, detail="Remote not found")
    
    remotes_dict[name].update(update.config)
    write_rclone_config(remotes_dict, config_path)
    
    return {"status": "ok", "remote": name}


@router.delete("/remotes/{name}")
def delete_local_remote(name: str):
    """Delete an rclone remote."""
    config_path = get_rclone_config_path()
    
    if not os.path.exists(config_path):
        raise HTTPException(status_code=404, detail="Config file not found")
    
    with open(config_path, 'r') as f:
        remotes_dict = parse_rclone_config(f.read())
    
    if name not in remotes_dict:
        raise HTTPException(status_code=404, detail="Remote not found")
    
    del remotes_dict[name]
    write_rclone_config(remotes_dict, config_path)
    
    return {"status": "ok", "removed": name}


# --- Remote Server Rclone Endpoints ---
@router.post("/remote/list")
def list_remote_server_remotes(server_id: str):
    """List rclone remotes on a remote server."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    target = server.get('alias') or server.get('host')
    if server.get('user'):
        target = f"{server['user']}@{target}"
    
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]
    if server.get('key_path'):
        cmd.extend(["-i", server['key_path']])
    cmd.extend([target, "cat ~/.config/rclone/rclone.conf 2>/dev/null || cat ~/.rclone.conf 2>/dev/null || echo ''"])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        remotes_dict = parse_rclone_config(result.stdout)
        remotes = [
            {"name": name, "type": cfg.get("type", "unknown"), "config": cfg}
            for name, cfg in remotes_dict.items()
        ]
        return {"remotes": remotes, "server": server['name']}
    except Exception as e:
        return {"remotes": [], "error": str(e)}


@router.post("/remote/pull")
def pull_remote_remotes(req: PullRemoteRequest):
    """Pull selected rclone remotes from remote server and merge into local."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == req.server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Get remote config
    target = server.get('alias') or server.get('host')
    if server.get('user'):
        target = f"{server['user']}@{target}"
    
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
    if server.get('key_path'):
        cmd.extend(["-i", server['key_path']])
    cmd.extend([target, "cat ~/.config/rclone/rclone.conf 2>/dev/null || cat ~/.rclone.conf 2>/dev/null"])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        remote_remotes = parse_rclone_config(result.stdout)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read remote config: {e}")
    
    # Load local config
    config_path = get_rclone_config_path()
    local_remotes = {}
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            local_remotes = parse_rclone_config(f.read())
    
    # Merge selected remotes
    merged = []
    for name in req.remote_names:
        if name in remote_remotes:
            local_remotes[name] = remote_remotes[name]
            merged.append(name)
    
    write_rclone_config(local_remotes, config_path)
    
    return {"status": "ok", "merged": merged, "total": len(merged)}


@router.post("/remote/push")
def push_local_remotes(req: PullRemoteRequest):
    """Push selected local rclone remotes to remote server (merge)."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == req.server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Load local remotes
    config_path = get_rclone_config_path()
    if not os.path.exists(config_path):
        raise HTTPException(status_code=404, detail="Local config not found")
    
    with open(config_path, 'r') as f:
        local_remotes = parse_rclone_config(f.read())
    
    # Get remote config
    target = server.get('alias') or server.get('host')
    if server.get('user'):
        target = f"{server['user']}@{target}"
    
    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
    if server.get('key_path'):
        ssh_cmd.extend(["-i", server['key_path']])
    
    # Read remote config
    cmd = ssh_cmd + [target, "cat ~/.config/rclone/rclone.conf 2>/dev/null || echo ''"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        remote_remotes = parse_rclone_config(result.stdout)
    except Exception as e:
        remote_remotes = {}
    
    # Merge selected local remotes into remote
    for name in req.remote_names:
        if name in local_remotes:
            remote_remotes[name] = local_remotes[name]
    
    # Write back to remote
    lines = []
    for name, cfg in remote_remotes.items():
        lines.append(f"[{name}]")
        for key, value in cfg.items():
            lines.append(f"{key} = {value}")
        lines.append("")
    
    new_content = '\n'.join(lines)
    
    # Use echo to write (escape for shell)
    escaped = new_content.replace("'", "'\\''")
    write_cmd = ssh_cmd + [target, f"mkdir -p ~/.config/rclone && echo '{escaped}' > ~/.config/rclone/rclone.conf"]
    
    try:
        result = subprocess.run(write_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise HTTPException(500, f"Write failed: {result.stderr}")
        return {"status": "ok", "pushed": req.remote_names}
    except Exception as e:
        raise HTTPException(500, str(e))
