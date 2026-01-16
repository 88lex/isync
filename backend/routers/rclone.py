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


class RenameRemoteRequest(BaseModel):
    new_name: str


class PullRemoteRequest(BaseModel):
    server_id: str
    remote_names: List[str]


class ExpandUnionRequest(BaseModel):
    new_upstreams: List[str]


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


@router.post("/remotes/{name}/rename")
def rename_local_remote(name: str, req: RenameRemoteRequest):
    """Rename an rclone remote."""
    config_path = get_rclone_config_path()
    if not os.path.exists(config_path):
        raise HTTPException(status_code=404, detail="Config file not found")
    
    with open(config_path, 'r') as f:
        remotes_dict = parse_rclone_config(f.read())
    
    if name not in remotes_dict:
        raise HTTPException(status_code=404, detail="Remote not found")
    
    if req.new_name in remotes_dict:
        raise HTTPException(status_code=409, detail="New name already exists")
    
    # Rename
    remotes_dict[req.new_name] = remotes_dict.pop(name)
    write_rclone_config(remotes_dict, config_path)
    
    return {"status": "ok", "old_name": name, "new_name": req.new_name}


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
    write_cmd = ssh_cmd + [target, "mkdir -p ~/.config/rclone && cat > ~/.config/rclone/rclone.conf.tmp && mv -f ~/.config/rclone/rclone.conf.tmp ~/.config/rclone/rclone.conf"]
    
    try:
        result = subprocess.run(write_cmd, input=new_content, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise HTTPException(500, f"Write failed: {result.stderr}")
        return {"status": "ok", "pushed": req.remote_names}
    except Exception as e:
        logger.error(f"Push failed: {e}")
        raise HTTPException(500, f"Push failed: {str(e)}")


class BatchTestRequest(BaseModel):
    remote_names: List[str]
    server_id: Optional[str] = None


@router.post("/test-batch")
def test_batch_connections(req: BatchTestRequest):
    """Test connectivity for a batch of rclone remotes."""
    results = []
    
    # helper for one test
    def test_one(name, server_cmd_prefix=None):
        import time
        start = time.time()
        
        rclone_args = ["lsd", f"{name}:", "--max-depth", "1", "--fast-list"]
        
        if server_cmd_prefix:
            # Build full remote command
            # rclone must be in path on remote
            # We wrap the rclone command
            rclone_cmd = f"rclone {' '.join(rclone_args)}"
            full_cmd = server_cmd_prefix + [rclone_cmd]
            try:
                res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=10)
                duration = int((time.time() - start) * 1000)
                if res.returncode == 0:
                     return {"remote": name, "success": True, "duration_ms": duration}
                else:
                     return {"remote": name, "success": False, "duration_ms": duration, "message": res.stderr[:100] or "Failed"}
            except Exception as e:
                 return {"remote": name, "success": False, "duration_ms": 0, "message": str(e)}
        else:
            # Local
            cmd = ["rclone"] + rclone_args
            try:
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                duration = int((time.time() - start) * 1000)
                if res.returncode == 0:
                    return {"remote": name, "success": True, "duration_ms": duration}
                else:
                    return {"remote": name, "success": False, "duration_ms": duration, "message": res.stderr or "Exit code " + str(res.returncode)}
            except Exception as e:
                return {"remote": name, "success": False, "duration_ms": 0, "message": str(e)}

    # Prepare context
    server_prefix = None
    if req.server_id:
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        server = next((s for s in servers if s.get('id') == req.server_id), None)
        if not server:
            raise HTTPException(404, "Server not found")
        
        target = server.get('alias') or server.get('host')
        if server.get('user'):
            target = f"{server['user']}@{target}"
        
        server_prefix = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5"]
        if server.get('key_path'):
            server_prefix.extend(["-i", server['key_path']])
        server_prefix.append(target)
    
    # Run tests
    results = []
    for name in req.remote_names:
        results.append(test_one(name, server_prefix))
        
    return {
        "status": "ok",
        "total": len(results),
        "ok": len([r for r in results if r['success']]),
        "failed": len([r for r in results if not r['success']]),
        "results": results
    }


# --- Flag Management ---

class RemoteFlagRequest(BaseModel):
    name: str
    flag: str  # active, ignored, protected


@router.post("/flags")
def set_remote_flag(req: RemoteFlagRequest):
    """Set flag for a remote (local metadata only)."""
    store = get_store()
    config = store.get_config()
    
    ignored = set(config.get('rclone_ignored_remotes', []))
    protected = set(config.get('rclone_protected_remotes', []))
    
    # Remove from both first to clear
    ignored.discard(req.name)
    protected.discard(req.name)
    
    if req.flag == 'ignored':
        ignored.add(req.name)
    elif req.flag == 'protected':
        protected.add(req.name)
        
    store.save_config({
        'rclone_ignored_remotes': list(ignored),
        'rclone_protected_remotes': list(protected)
    })
    return {"status": "ok", "name": req.name, "flag": req.flag}


@router.get("/remotes/list-with-flags")
def list_remotes_with_flags(server_id: Optional[str] = None):
    """List remotes (local or remote) with their flags."""
    
    # Fetch remotes
    remotes = []
    if server_id:
        # Remote Server
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        server = next((s for s in servers if s.get('id') == server_id), None)
        if not server:
            raise HTTPException(404, "Server not found")
            
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
        except Exception as e:
            logger.error(f"Failed to fetch remote remotes: {e}")
            remotes = []
    else:
        # Local
        config_path = get_rclone_config_path()
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    content = f.read()
                remotes_dict = parse_rclone_config(content)
                remotes = [
                    {"name": name, "type": config.get("type", "unknown"), "config": config}
                    for name, config in remotes_dict.items()
                ]
            except Exception as e:
                logger.error(f"Failed to fetch local remotes: {e}")
                remotes = []

    # Apply Flags
    store = get_store()
    config = store.get_config()
    ignored = set(config.get('rclone_ignored_remotes', []))
    protected = set(config.get('rclone_protected_remotes', []))
    
    results = []
    for r in remotes:
        status = 'active'
        if r['name'] in ignored:
            status = 'ignored'
        elif r['name'] in protected:
            status = 'protected'
        
        r['status'] = status
        results.append(r)
        
    return {"remotes": results}


# --- Union Remote Management ---
@router.get("/unions")
def list_union_remotes_endpoint():
    """List all union remotes."""
    config_path = get_rclone_config_path()
    if not os.path.exists(config_path):
        return {"unions": []}
    
    with open(config_path, 'r') as f:
        remotes = parse_rclone_config(f.read())
    
    unions = []
    for name, cfg in remotes.items():
        if cfg.get('type') == 'union':
            upstreams = cfg.get('upstreams', '').split()
            unions.append({
                "name": name,
                "upstream_count": len(upstreams),
                "upstreams": upstreams
            })
    return {"unions": unions}


@router.get("/union/{name}/details")
def get_union_details_endpoint(name: str):
    """Get details of a union remote including its upstreams."""
    config_path = get_rclone_config_path()
    if not os.path.exists(config_path):
        raise HTTPException(404, "Config not found")
        
    with open(config_path, 'r') as f:
        remotes = parse_rclone_config(f.read())
        
    if name not in remotes:
        raise HTTPException(404, "Union remote not found")
        
    union_cfg = remotes[name]
    if union_cfg.get('type') != 'union':
        raise HTTPException(400, "Remote is not a union")
        
    upstreams = union_cfg.get('upstreams', '').split()
    
    drives = []
    for up_name in upstreams:
        # Resolve upstream config
        # Upstreams might include paths like "remote:path". We need just "remote".
        # Handle cases where upstream is just "remote" or "remote:/subdir"
        # We assume the remote name is the part before the first colon, OR the whole string if no colon?
        # Check if up_name is a remote name directly.
        
        parts = up_name.split(':', 1)
        remote_name = parts[0]
        
        # Verify if remote_name exists in config. If not, maybe the whole string is the name?
        # Rclone syntax is Remote: for root, Remote:path for path.
        # If I have a remote named "MyRemote", upstreams="MyRemote:sub"
        
        if remote_name in remotes:
            rc = remotes[remote_name]
            drives.append({
                "remote_name": up_name,
                "type": rc.get('type', 'unknown'),
                "team_drive": rc.get('team_drive', ''),
                "scope": rc.get('scope', ''),
                "service_account_file": rc.get('service_account_file', '')
            })
        else:
            drives.append({
                "remote_name": up_name,
                "type": "unknown",
                "team_drive": "",
                "scope": "",
                "service_account_file": ""
            })
            
    return {
        "name": name,
        "type": "union",
        "upstreams": upstreams,
        "action_policy": union_cfg.get('action_policy', ''),
        "create_policy": union_cfg.get('create_policy', ''),
        "search_policy": union_cfg.get('search_policy', ''),
        "drives": drives
    }


@router.put("/union/{name}/expand")
def expand_union_endpoint(name: str, req: ExpandUnionRequest):
    """Add new upstreams to a union remote."""
    config_path = get_rclone_config_path()
    if not os.path.exists(config_path):
         raise HTTPException(404, "Config not found")

    with open(config_path, 'r') as f:
        remotes = parse_rclone_config(f.read())
        
    if name not in remotes:
        raise HTTPException(404, "Remote not found")
        
    cfg = remotes[name]
    if cfg.get('type') != 'union':
         raise HTTPException(400, "Not a union")
         
    current_upstreams = cfg.get('upstreams', '').split()
    updated_upstreams = current_upstreams + req.new_upstreams
    
    cfg['upstreams'] = " ".join(updated_upstreams)
    
    write_rclone_config(remotes, config_path)
    
    return {
        "status": "ok",
        "name": name,
        "previous_upstreams": current_upstreams,
        "new_upstreams": req.new_upstreams,
        "updated_upstreams": updated_upstreams
    }
