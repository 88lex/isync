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

class BackupConfigRequest(BaseModel):
    server_id: str
    dry_run: bool = False

@router.post("/backup")
def api_backup_config(req: BackupConfigRequest):
    """Create a dated backup of rclone.conf on a server."""
    import datetime
    
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    cmd_prefix = []
    target_desc = "Local"
    
    if req.server_id != 'local':
        server = next((s for s in servers if s.get('id') == req.server_id), None)
        if not server:
            raise HTTPException(404, "Server not found")
            
        target = server.get('alias') or server.get('host')
        if server.get('user'): target = f"{server['user']}@{target}"
        target_desc = server.get('name', req.server_id)
        
        cmd_prefix = ["ssh", "-o", "StrictHostKeyChecking=no"]
        if server.get('key_path'): cmd_prefix.extend(["-i", server['key_path']])
        cmd_prefix.append(target)
    
    # 1. Find config path
    find_cmd = cmd_prefix + ["rclone config file"]
    path = ""
    try:
        res = subprocess.run(find_cmd, capture_output=True, text=True, timeout=10)
        # Output: "Configuration file is stored at: /path/to/rclone.conf"
        match = re.search(r'is stored at:\s*(.+)', res.stdout)
        if not match:
            # Fallback
            if req.server_id == 'local':
                path = get_rclone_config_path()
            else:
                check_cmd = cmd_prefix + ["ls ~/.config/rclone/rclone.conf 2>/dev/null || ls ~/.rclone.conf 2>/dev/null"]
                cres = subprocess.run(check_cmd, capture_output=True, text=True, timeout=5)
                path = cres.stdout.strip()
        else:
            path = match.group(1).strip()
    except Exception as e:
        if not req.dry_run: raise HTTPException(500, f"Failed to locate config: {e}")
        path = "Unknown (Error locating)"

    if not path:
        if req.dry_run: path = "Not Found"
        else: raise HTTPException(404, "Could not locate rclone.conf")

    # 2. Calculate Backup Path
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{path}.{timestamp}.bak"

    if req.dry_run:
        return {
            "status": "preview",
            "source": path,
            "destination": backup_path,
            "server": target_desc
        }
    
    # Execute Backup
    cp_cmd = "cp"
    if req.server_id != 'local':
        copy_cmd = cmd_prefix + [f"cp \\\"{path}\\\" \\\"{backup_path}\\\""]
    else:
        copy_cmd = ["cp", path, backup_path]
        
    try:
        res = subprocess.run(copy_cmd, capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            raise HTTPException(500, f"Backup failed: {res.stderr}")
        return {"status": "ok", "message": f"Backup created at {backup_path}", "backup_path": backup_path, "server": target_desc}
    except Exception as e:
        raise HTTPException(500, f"Backup command failed: {e}")


class CopyConfigRequest(BaseModel):
    source_server_id: str
    dest_server_id: str
    mode: str = 'backup' # 'backup' or 'replace'
    source_path: Optional[str] = None # Full path to source file
    dest_path: Optional[str] = None   # Target directory
    custom_name: Optional[str] = None # Target filename
    dry_run: bool = False

@router.post("/copy-config")
def api_copy_config(req: CopyConfigRequest):
    """Copy rclone.conf from one server to another with path customization."""
    import datetime
    
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    # --- Helper: Get SSH Command Prefix ---
    def get_ssh_cmd(server_id):
        if server_id == 'local': return []
        s = next((srv for srv in servers if srv['id'] == server_id), None)
        if not s: raise HTTPException(404, f"Server {server_id} not found")
        tgt = s.get('alias') or s.get('host')
        if s.get('user'): tgt = f"{s['user']}@{tgt}"
        cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
        if s.get('key_path'): cmd.extend(["-i", s['key_path']])
        cmd.append(tgt)
        return cmd

    # --- Helper: Resolve Paths Only ---
    def resolve_source_path(server_id, path=None):
        import os
        cmd_prefix = get_ssh_cmd(server_id)
        if path:
            if server_id == 'local': return os.path.expanduser(path)
            if path.startswith('~/'): return f"$HOME/{path[2:]}"
            return path
        
        # Auto-detect
        if server_id == 'local': return get_rclone_config_path()
        try:
             find = cmd_prefix + ["rclone config file"]
             r = subprocess.run(find, capture_output=True, text=True, timeout=10)
             m = re.search(r'is stored at:\s*(.+)', r.stdout)
             val = m.group(1).strip() if m else "~/.config/rclone/rclone.conf"
             if val.startswith('~/'): val = f"$HOME/{val[2:]}"
             return val
        except: return "~/.config/rclone/rclone.conf"

    def resolve_dest_path(server_id, directory=None, filename=None):
        import os
        cmd_prefix = get_ssh_cmd(server_id)
        
        target_dir = directory
        if target_dir:
            if server_id == 'local': target_dir = os.path.expanduser(target_dir)
            elif target_dir.startswith('~/'): target_dir = f"$HOME/{target_dir[2:]}"
            
        if not target_dir:
            if server_id == 'local':
                 target_dir = os.path.dirname(get_rclone_config_path())
            else:
                 try:
                     find = cmd_prefix + ["rclone config file"]
                     r = subprocess.run(find, capture_output=True, text=True, timeout=10)
                     m = re.search(r'is stored at:\s*(.+)', r.stdout)
                     if m: target_dir = os.path.dirname(m.group(1).strip())
                     else: target_dir = "~/.config/rclone" # default
                 except: target_dir = "~/.config/rclone"
                 
                 # Clean up auto-detected remote path
                 if target_dir.startswith('~/'): target_dir = f"$HOME/{target_dir[2:]}"
        
        target_name = filename or "rclone.conf"
        return f"{target_dir}/{target_name}".replace("//", "/")

    # --- Execution Logic ---
    try:
        # Pre-calculation for Dry Run or Exec
        src_final = resolve_source_path(req.source_server_id, req.source_path)
        
        dest_filename = req.custom_name
        if req.mode == 'backup' and not dest_filename:
             ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
             dest_filename = f"rclone.conf.{ts}.bak"
        elif req.mode == 'replace' and not dest_filename:
             dest_filename = "rclone.conf"

        dest_final = resolve_dest_path(req.dest_server_id, req.dest_path, dest_filename)
        
        # DRY RUN RETURN
        if req.dry_run:
            return {
                "status": "preview",
                "source": src_final,
                "destination": dest_final,
                "mode": req.mode
            }

        # ACTUAL EXECUTION
        # Re-using internal helpers for reading/writing which do resolution again? 
        # Ideally we pass resolved paths to read/write enabled functions.
        # Let's adapt read/write methods slightly or just use the resolved paths.
        
        # Read Source
        content = ""
        cmd_prefix = get_ssh_cmd(req.source_server_id)
        if req.source_server_id == 'local':
             if not os.path.exists(src_final): raise Exception(f"Source file not found: {src_final}")
             with open(src_final, 'r') as f: content = f.read()
        else:
             cat = cmd_prefix + [f"cat \\\"{src_final}\\\""]
             r = subprocess.run(cat, capture_output=True, text=True, timeout=15)
             if r.returncode != 0: raise Exception(f"Failed to read source {src_final}")
             content = r.stdout
             
        if not content: raise HTTPException(400, "Source config is empty")

        # Handle Replace Mode Backup
        bkp_path_str = ""
        if req.mode == 'replace':
             # Need to backup destination if it exists
             cmd_dest = get_ssh_cmd(req.dest_server_id)
             ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
             bkp_path = f"{dest_final}.{ts}.bak"
             
             exists = False
             if req.dest_server_id == 'local':
                  if os.path.exists(os.path.expanduser(dest_final)): exists = True
             else:
                  check = cmd_dest + [f"test -f \\\"{dest_final}\\\""]
                  if subprocess.run(check, capture_output=True).returncode == 0: exists = True
                  
             if exists:
                  # Copy dest_final to bkp_path
                  if req.dest_server_id == 'local':
                       import shutil
                       shutil.copy2(os.path.expanduser(dest_final), os.path.expanduser(bkp_path))
                  else:
                       cp = cmd_dest + [f"cp \\\"{dest_final}\\\" \\\"{bkp_path}\\\""]
                       subprocess.run(cp, check=True, timeout=10)
                  bkp_path_str = bkp_path

        # Write Destination
        cmd_dest = get_ssh_cmd(req.dest_server_id)
        target_dir = os.path.dirname(dest_final)
        
        if req.dest_server_id == 'local':
             final_p = os.path.expanduser(dest_final)
             os.makedirs(os.path.dirname(final_p), exist_ok=True)
             with open(final_p, 'w') as f: f.write(content)
        else:
             mkdir = cmd_dest + [f"mkdir -p \\\"{target_dir}\\\""]
             subprocess.run(mkdir, check=True, timeout=10)
             write = cmd_dest + [f"cat > \\\"{dest_final}\\\""]
             r = subprocess.run(write, input=content, capture_output=True, text=True, timeout=20)
             if r.returncode != 0: raise Exception(f"Write failed: {r.stderr}")

        msg = f"Config copied to {dest_final}"
        if bkp_path_str: msg += f" (Backup: {bkp_path_str})"
        
        return {"status": "ok", "message": msg, "source": src_final, "destination": dest_final}
            
    except Exception as e:
        logger.error(f"Copy failed: {e}")
        raise HTTPException(500, f"Copy failed: {str(e)}")


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


class PushRemoteRequest(BaseModel):
    server_id: str
    remote_names: List[str]
    overwrite: bool = True  # If True, overwrite existing remotes. If False, skip them.


@router.post("/remote/push")
def push_local_remotes(req: PushRemoteRequest):
    """Push selected local rclone remotes to remote server (merge) using simplified standard path detection."""
    import datetime

    debug_log = []
    try:
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
        
        # Get remote connection info
        target = server.get('alias') or server.get('host')
        if server.get('user'):
            target = f"{server['user']}@{target}"
        
        ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
        if server.get('key_path'):
            ssh_cmd.extend(["-i", server['key_path']])
        
        # 1. DETERMINE PATH (Unified/Simplified Logic)
        # Check standard locations in order. Use the first one that allows reading.
        # If none exist, fallback to default.
        possible_paths = ["~/.config/rclone/rclone.conf", "~/.rclone.conf"]
        conf_path = possible_paths[0] # Default
        remote_remotes = {}
        found_existing = False
        
        for p in possible_paths:
            debug_log.append(f"Checking path: {p}")
            # Try to cat the file. If successful, we use this path.
            read_res = subprocess.run(ssh_cmd + [target, f"cat {p}"], capture_output=True, text=True, timeout=15)
            
            if read_res.returncode == 0:
                debug_log.append(f"Found config at {p}")
                conf_path = p
                remote_remotes = parse_rclone_config(read_res.stdout)
                found_existing = True
                break
        
        if not found_existing:
            debug_log.append(f"No existing config found. Will create at default: {conf_path}")

        # 2. BACKUP (only if it existed)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = f"{conf_path}.{ts}.bak"
        if found_existing:
             subprocess.run(ssh_cmd + [target, f"cp {conf_path} {backup_path}"], capture_output=True, timeout=20)

        # 3. MERGE
        pushed_list = []
        skipped_list = []
        
        for name in req.remote_names:
            if name in local_remotes:
                if name in remote_remotes and not req.overwrite:
                    skipped_list.append(name)
                else:
                    remote_remotes[name] = local_remotes[name]
                    pushed_list.append(name)
        
        # 4. WRITE
        lines = []
        for name, cfg in remote_remotes.items():
            lines.append(f"[{name}]")
            for key, value in cfg.items():
                lines.append(f"{key} = {value}")
            lines.append("")
        
        new_content = '\n'.join(lines)
        
        # Ensure dir exists (handling ~ expansion in remote shell by using $HOME substitution or just relying on shell expansion)
        # We use a trick: `dirname path` on remote.
        write_cmd = ssh_cmd + [target, f"mkdir -p $(dirname {conf_path}) && cat > {conf_path}"]
        
        result = subprocess.run(write_cmd, input=new_content, capture_output=True, text=True, timeout=45)
        
        if result.returncode != 0:
            raise Exception(f"Write failed: {result.stderr}")
            
        debug_log.append("Write successful.")

        return {
            "status": "ok", 
            "pushed": pushed_list, 
            "skipped": skipped_list, 
            "overwrite": req.overwrite,
            "backup": backup_path if found_existing else None,
            "target_path": conf_path,
            "debug_trace": debug_log
        }
        
    except Exception as e:
        logger.error(f"Push failed: {e}")
        return {
            "status": "error",
            "message": str(e),
            "debug_trace": debug_log
        }

class CheckDuplicatesRequest(BaseModel):
    server_id: str

@router.post("/duplicates")
def check_rclone_duplicates(req: CheckDuplicatesRequest):
    """Check a specific rclone.conf for duplicate sections (corruption check)."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    content = ""
    # Read raw content
    if req.server_id == 'local':
        path = get_rclone_config_path()
        if os.path.exists(path):
            with open(path, 'r') as f: content = f.read()
    else:
        server = next((s for s in servers if s.get('id') == req.server_id), None)
        if not server: raise HTTPException(404, "Server not found")
        
        target = server.get('alias') or server.get('host')
        if server.get('user'): target = f"{server['user']}@{target}"
        
        cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
        if server.get('key_path'): cmd.extend(["-i", server['key_path']])
        cmd.extend([target, "cat ~/.config/rclone/rclone.conf 2>/dev/null || cat ~/.rclone.conf 2>/dev/null"])
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            content = res.stdout
        except: content = ""

    # Parse manually to find duplicates
    duplicates = []
    seen = set()
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        match = re.match(r'^\[(.+)\]$', line)
        if match:
            name = match.group(1)
            if name in seen:
                duplicates.append(name)
            seen.add(name)
            
    return {
        "status": "ok",
        "has_duplicates": len(duplicates) > 0,
        "duplicates": list(set(duplicates)),
        "server_id": req.server_id
    }


class SearchRemotesRequest(BaseModel):
    query: str
    server_id: Optional[str] = None


@router.post("/search-config")
def search_rclone_remotes(req: SearchRemotesRequest):
    """Search for remotes in a config (local or remote) by name."""
    remotes_dict = {}
    
    if req.server_id and req.server_id != 'local':
        # Remote Fetch
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        server = next((s for s in servers if s.get('id') == req.server_id), None)
        
        if server:
            target = server.get('alias') or server.get('host')
            if server.get('user'): target = f"{server['user']}@{target}"
            
            cmd = ["ssh", "-o", "StrictHostKeyChecking=no"]
            if server.get('key_path'): cmd.extend(["-i", server['key_path']])
            cmd.extend([target, "cat ~/.config/rclone/rclone.conf 2>/dev/null || cat ~/.rclone.conf 2>/dev/null || echo ''"])
            
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
                remotes_dict = parse_rclone_config(result.stdout)
            except Exception as e:
                logger.error(f"Search fetch failed: {e}")
                remotes_dict = {}
    else:
        # Local Fetch
        config_path = get_rclone_config_path()
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                remotes_dict = parse_rclone_config(f.read())
    
    # Filter
    query = req.query.lower()
    matches = [
        {"name": name, "type": cfg.get('type', 'unknown')}
        for name, cfg in remotes_dict.items()
        if query in name.lower()
    ]
    
    return {"matches": matches, "count": len(matches)}


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

class RcloneBrowseRequest(BaseModel):
    server_id: str = "local"
    remote_name: str
    path: str = ""


@router.post("/browse")
def browse_rclone_content(req: RcloneBrowseRequest):
    """List directories in an rclone remote path."""
    import json
    
    # 1. Resolve Command Prefix (SSH or Local)
    cmd_prefix = []
    store = get_store()
    
    if req.server_id != 'local':
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        server = next((s for s in servers if s.get('id') == req.server_id), None)
        if not server:
            raise HTTPException(404, "Server not found")
            
        target = server.get('alias') or server.get('host')
        if server.get('user'): target = f"{server['user']}@{target}"
        
        cmd_prefix = ["ssh", "-o", "StrictHostKeyChecking=no"]
        if server.get('key_path'): cmd_prefix.extend(["-i", server['key_path']])
        cmd_prefix.append(target)
        
    # 2. Build Rclone Command (lsjson for parsing)
    # path should end with / or be empty? lsjson handles it.
    remote_path = f"{req.remote_name}:{req.path}"
    
    # We use 'lsjson' to get detailed list including IsDir
    rclone_cmd = ["rclone", "lsjson", remote_path, "--dirs-only"] 
    # --dirs-only to browse folders only? User might want to pick files?
    # "The source can be a Local folder... paste partial path... navigate"
    # Usually we pick Folders for Sync pair. But Rclone source can be file?
    # Usually sync pair matches folder to folder.
    # I'll enable folders only if browsing for folder selection.
    # But lsjson returns both?
    # Let's return both but client filters?
    # Or just return directories. "New Sync Pair" usually implies syncing FOLDERS.
    # I'll stick to dirs-only for cleaner navigation unless user wants file.
    # User requirement: "Local folder... Remote SSH folder".
    # So we browse folders.
    
    # Wrapping command
    if cmd_prefix:
        # Remote execution wrapping
        # Need to quote the rclone command
        rclone_str = " ".join(rclone_cmd)
        full_cmd = cmd_prefix + [rclone_str]
    else:
        full_cmd = rclone_cmd

    try:
        res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=15)
        if res.returncode != 0:
             # If path doesn't exist, rclone might fail
             return {"status": "error", "message": res.stderr, "dirs": []}
             
        items = json.loads(res.stdout)
        # Filter for dirs just in case, though --dirs-only should handle it
        dirs = [i['Name'] for i in items if i.get('IsDir', False)]
        return {"status": "success", "dirs": dirs, "path": req.path}
    except Exception as e:
        return {"status": "error", "message": str(e), "dirs": []}
