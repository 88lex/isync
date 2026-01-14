"""
SSH Router
Handles SSH server management and remote browser functionality.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import uuid

from backend.dependencies import get_store
from backend.logging_config import get_logger
from backend.remote_browser import list_remote_folders, list_rclone_remotes, list_shared_drives, list_remote_path

logger = get_logger("isync.routers.ssh")

router = APIRouter(prefix="/api/ssh", tags=["SSH"])


# --- Pydantic Models ---
class SSHServerCreate(BaseModel):
    name: str
    alias: Optional[str] = None
    host: Optional[str] = None
    port: int = 22
    user: Optional[str] = None
    key_path: Optional[str] = None
    remote_path: str = "/opt/isync_refactor"
    is_default: bool = False


class SSHServerUpdate(BaseModel):
    name: Optional[str] = None
    alias: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    user: Optional[str] = None
    key_path: Optional[str] = None
    remote_path: Optional[str] = None
    is_default: Optional[bool] = None


# --- SSH Server CRUD ---
@router.get("/servers")
def list_ssh_servers():
    """List all configured SSH servers."""
    store = get_store()
    config = store.get_config()
    return config.get('ssh_servers', [])


@router.post("/servers")
def create_ssh_server(server: SSHServerCreate):
    """Create a new SSH server configuration."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    # Check for duplicate name
    for s in servers:
        if s.get('name') == server.name:
            raise HTTPException(status_code=409, detail="Server with this name already exists")
    
    new_server = server.dict()
    new_server['id'] = str(uuid.uuid4())[:8]
    
    # Handle is_default
    if server.is_default:
        for s in servers:
            s['is_default'] = False
    
    servers.append(new_server)
    config['ssh_servers'] = servers
    store.save_config(config)
    
    return {"status": "ok", "server": new_server}


@router.put("/servers/{server_id}")
def update_ssh_server(server_id: str, update: SSHServerUpdate):
    """Update an SSH server configuration."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server_idx = None
    for i, s in enumerate(servers):
        if s.get('id') == server_id:
            server_idx = i
            break
    
    if server_idx is None:
        raise HTTPException(status_code=404, detail="Server not found")
    
    update_dict = {k: v for k, v in update.dict().items() if v is not None}
    
    # Handle is_default
    if update_dict.get('is_default'):
        for s in servers:
            s['is_default'] = False
    
    servers[server_idx].update(update_dict)
    config['ssh_servers'] = servers
    store.save_config(config)
    
    return {"status": "ok", "server": servers[server_idx]}


@router.delete("/servers/{server_id}")
def delete_ssh_server(server_id: str):
    """Delete an SSH server configuration."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server_idx = None
    for i, s in enumerate(servers):
        if s.get('id') == server_id:
            server_idx = i
            break
    
    if server_idx is None:
        raise HTTPException(status_code=404, detail="Server not found")
    
    removed = servers.pop(server_idx)
    config['ssh_servers'] = servers
    store.save_config(config)
    
    return {"status": "ok", "removed": removed}


# --- Remote Browser Endpoints ---
@router.get("/servers/{server_id}/folders")
def api_list_server_folders(server_id: str, path: str = "/", depth: int = 2):
    """List folders on a remote server."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    result = list_remote_folders(server, path, depth)
    return result


@router.get("/servers/{server_id}/remotes")
def api_list_server_remotes(server_id: str):
    """List rclone remotes on a remote server."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    result = list_rclone_remotes(server)
    return result


@router.get("/servers/{server_id}/remotes/{remote_name}/drives")
def api_list_shared_drives(server_id: str, remote_name: str):
    """List Shared Drives for an rclone remote."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    result = list_shared_drives(server, remote_name)
    return result


@router.get("/servers/{server_id}/remotes/{remote_name}/ls")
def api_list_remote_path(server_id: str, remote_name: str, path: str = ""):
    """List contents of an rclone remote path."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    result = list_remote_path(server, remote_name, path)
    return result
