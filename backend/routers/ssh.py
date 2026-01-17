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


@router.post("/servers/{server_id}/test")
def api_test_ssh_server(server_id: str):
    """Test SSH connection to a server."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    from backend.ops import test_ssh_connection, SSHBaseRequest
    
    req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        remote_path=server.get('remote_path', '~/isync')
    )
    
    return test_ssh_connection(req)


@router.get("/servers/{server_id}/status")
def api_get_ssh_server_status(server_id: str):
    """Get detailed status of SSH server."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    from backend.ops import check_remote_status, SSHBaseRequest
    
    req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        remote_path=server.get('remote_path', '~/isync')
    )
    
    return check_remote_status(req)


@router.get("/servers/{server_id}/verify")
def api_verify_ssh_server(server_id: str):
    """Deep verification of SSH server configuration."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    from backend.ops import verify_full_server_status, SSHBaseRequest
    
    req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        remote_path=server.get('remote_path', '~/isync')
    )
    
    return verify_full_server_status(req, server.get('name'), server_id)


# --- Remote Browser Endpoints ---
@router.get("/servers/{server_id}/folders")
def api_list_server_folders(server_id: str, path: str = "/", depth: int = 2):
    """List folders on a remote server."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    
    if server_id == 'local':
        server = None
    else:
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


# --- Remote Sync Endpoints ---

class RemoteSyncRequest(BaseModel):
    server_id: str


class RemoteSyncItemsRequest(BaseModel):
    server_id: str
    items: List[str]
    item_type: str  # 'batch', 'group', 'key', 'remote', 'cron'


def get_server_by_id(server_id: str):
    """Helper to get server config by ID."""
    store = get_store()
    config = store.get_config()
    servers = config.get('ssh_servers', [])
    server = next((s for s in servers if s.get('id') == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


def get_ssh_command(server):
    """Build SSH command prefix for a server."""
    target = server.get('alias') or server.get('host')
    if server.get('user'):
        target = f"{server['user']}@{target}"
    
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]
    if server.get('key_path'):
        cmd.extend(["-i", server['key_path']])
    cmd.append(target)
    return cmd


@router.post("/remote/list-batches")
def list_remote_batches(req: RemoteSyncRequest):
    """List batch files on remote server."""
    import subprocess
    server = get_server_by_id(req.server_id)
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch"
    
    ssh_cmd = get_ssh_command(server)
    ssh_cmd.append(f"ls -la {remote_path} 2>/dev/null | grep -v '^d' | grep -v '^\\.git' | awk '{{print $NF, $5}}'")
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            return {"items": [], "error": result.stderr.strip()}
        
        items = []
        for line in result.stdout.strip().split('\n'):
            if line and not line.startswith('.'):
                parts = line.split()
                if len(parts) >= 2:
                    name = parts[0]
                    size = int(parts[1]) if parts[1].isdigit() else 0
                    if name and not name.startswith('.'):
                        items.append({"name": name, "size": size})
        return {"items": items, "path": remote_path}
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.post("/remote/list-groups")
def list_remote_groups(req: RemoteSyncRequest):
    """List batch group scripts on remote server."""
    import subprocess
    server = get_server_by_id(req.server_id)
    remote_path = f"{server.get('remote_path', '/opt/isync')}/batch/groups"
    
    ssh_cmd = get_ssh_command(server)
    ssh_cmd.append(f"ls -la {remote_path} 2>/dev/null | grep -v '^d' | grep '\\.sh$' | awk '{{print $NF, $5}}'")
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
        items = []
        for line in result.stdout.strip().split('\n'):
            if line:
                parts = line.split()
                if len(parts) >= 2:
                    name = parts[0]
                    size = int(parts[1]) if parts[1].isdigit() else 0
                    if name.endswith('.sh'):
                        items.append({"name": name, "size": size})
        return {"items": items, "path": remote_path}
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.post("/remote/list-keys")
def list_remote_keys(req: RemoteSyncRequest):
    """List JSON key files on remote server."""
    import subprocess
    server = get_server_by_id(req.server_id)
    remote_path = f"{server.get('remote_path', '/opt/isync')}/keys"
    
    ssh_cmd = get_ssh_command(server)
    ssh_cmd.append(f"ls -la {remote_path} 2>/dev/null | grep '\\.json$' | awk '{{print $NF, $5}}'")
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
        items = []
        for line in result.stdout.strip().split('\n'):
            if line:
                parts = line.split()
                if len(parts) >= 2:
                    name = parts[0]
                    size = int(parts[1]) if parts[1].isdigit() else 0
                    if name.endswith('.json'):
                        items.append({"name": name, "size": size})
        return {"items": items, "path": remote_path}
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.post("/remote/list-crons")
def list_remote_crons(req: RemoteSyncRequest):
    """List crontab entries on remote server."""
    import subprocess
    server = get_server_by_id(req.server_id)
    
    ssh_cmd = get_ssh_command(server)
    ssh_cmd.append("crontab -l 2>/dev/null || echo ''")
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
        lines = [l for l in result.stdout.strip().split('\n') if l and not l.startswith('#')]
        return {"items": [{"entry": l, "index": i} for i, l in enumerate(lines)], "raw": result.stdout}
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.post("/remote/pull-items")
def pull_remote_items(req: RemoteSyncItemsRequest):
    """Pull selected items from remote server to local."""
    import subprocess
    import os
    
    server = get_server_by_id(req.server_id)
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    ssh_target = server.get('alias') or server.get('host')
    if server.get('user'):
        ssh_target = f"{server['user']}@{ssh_target}"
    
    results = []
    
    for item in req.items:
        if req.item_type == 'batch':
            remote = f"{server.get('remote_path', '/opt/isync')}/batch/{item}"
            local = os.path.join(base_path, "batch", item)
        elif req.item_type == 'group':
            remote = f"{server.get('remote_path', '/opt/isync')}/batch/groups/{item}"
            local = os.path.join(base_path, "batch", "groups", item)
            os.makedirs(os.path.dirname(local), exist_ok=True)
        elif req.item_type == 'key':
            remote = f"{server.get('remote_path', '/opt/isync')}/keys/{item}"
            local = os.path.join(base_path, "keys", item)
            os.makedirs(os.path.dirname(local), exist_ok=True)
        else:
            results.append({"item": item, "status": "error", "message": "Unknown type"})
            continue
        
        cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
        if server.get('key_path'):
            cmd.extend(["-i", server['key_path']])
        cmd.extend([f"{ssh_target}:{remote}", local])
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if res.returncode == 0:
                results.append({"item": item, "status": "success"})
            else:
                results.append({"item": item, "status": "error", "message": res.stderr.strip()})
        except Exception as e:
            results.append({"item": item, "status": "error", "message": str(e)})
    
    return {"results": results, "pulled": len([r for r in results if r['status'] == 'success'])}


@router.post("/remote/push-items")
def push_remote_items(req: RemoteSyncItemsRequest):
    """Push selected local items to remote server."""
    import subprocess
    import os
    from backend.ops import exec_remote_command, SSHBaseRequest
    
    server = get_server_by_id(req.server_id)
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    ssh_target = server.get('alias') or server.get('host')
    if server.get('user'):
        ssh_target = f"{server['user']}@{ssh_target}"
    
    ssh_req = SSHBaseRequest(
        host=server.get('alias') or server.get('host'),
        user=server.get('user'),
        key_path=server.get('key_path'),
        timeout=30
    )
    
    # Get remote path from server config - default to /opt/isync
    remote_base = server.get('remote_path', '/opt/isync')
    
    # Ensure remote directories exist with sudo fallback
    mkdir_cmd = f"mkdir -p {remote_base}/batch/groups {remote_base}/keys"
    mkdir_res = exec_remote_command(ssh_req, mkdir_cmd)
    if mkdir_res['status'] != 'success':
        # Try with sudo
        mkdir_res = exec_remote_command(ssh_req, f"sudo {mkdir_cmd} && sudo chown -R $(whoami) {remote_base}/batch {remote_base}/keys")
    
    logger.info(f"[push_remote_items] Pushing {len(req.items)} {req.item_type} items to {ssh_target}:{remote_base}")
    
    results = []
    
    for item in req.items:
        if req.item_type == 'batch':
            local = os.path.join(base_path, "batch", item)
            remote = f"{remote_base}/batch/{item}"
        elif req.item_type == 'group':
            local = os.path.join(base_path, "batch", "groups", item)
            remote = f"{remote_base}/batch/groups/{item}"
        elif req.item_type == 'key':
            local = os.path.join(base_path, "keys", item)
            remote = f"{remote_base}/keys/{item}"
        else:
            results.append({"item": item, "status": "error", "message": "Unknown type"})
            continue
        
        if not os.path.exists(local):
            logger.warning(f"[push_remote_items] Local file not found: {local}")
            results.append({"item": item, "status": "error", "message": f"Local file not found: {local}"})
            continue
        
        logger.info(f"[push_remote_items] Pushing {local} -> {ssh_target}:{remote}")
        
        # Try direct SCP first
        cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
        if server.get('key_path'):
            cmd.extend(["-i", server['key_path']])
        cmd.extend([local, f"{ssh_target}:{remote}"])
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if res.returncode == 0:
                # Verify file exists on remote
                verify_res = exec_remote_command(ssh_req, f"test -f {remote} && stat --printf='%s' {remote}")
                if verify_res['status'] == 'success' and verify_res.get('stdout'):
                    remote_size = verify_res.get('stdout', '').strip()
                    local_size = os.path.getsize(local)
                    results.append({
                        "item": item, 
                        "status": "success",
                        "source": local,
                        "destination": f"{ssh_target}:{remote}",
                        "local_size": local_size,
                        "remote_size": int(remote_size) if remote_size.isdigit() else 0
                    })
                    logger.info(f"[push_remote_items] Successfully pushed {item} ({local_size} bytes)")
                else:
                    # SCP reported success but file not found - try sudo fallback
                    logger.warning(f"[push_remote_items] SCP succeeded but file not found, trying sudo fallback")
                    tmp_remote = f"/tmp/{item}"
                    cmd2 = ["scp", "-o", "StrictHostKeyChecking=no"]
                    if server.get('key_path'):
                        cmd2.extend(["-i", server['key_path']])
                    cmd2.extend([local, f"{ssh_target}:{tmp_remote}"])
                    res2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=60)
                    if res2.returncode == 0:
                        mv_res = exec_remote_command(ssh_req, f"sudo mv {tmp_remote} {remote} && sudo chmod 644 {remote}")
                        if mv_res['status'] == 'success':
                            results.append({"item": item, "status": "success", "source": local, "destination": f"{ssh_target}:{remote}", "via_sudo": True})
                        else:
                            results.append({"item": item, "status": "error", "message": f"sudo mv failed: {mv_res.get('message')}"})
                    else:
                        results.append({"item": item, "status": "error", "message": f"Fallback SCP failed: {res2.stderr}"})
            else:
                logger.error(f"[push_remote_items] SCP failed for {item}: {res.stderr}")
                results.append({"item": item, "status": "error", "message": res.stderr.strip()})
        except subprocess.TimeoutExpired:
            results.append({"item": item, "status": "error", "message": "Timeout"})
        except Exception as e:
            results.append({"item": item, "status": "error", "message": str(e)})
    
    success_count = len([r for r in results if r['status'] == 'success'])
    logger.info(f"[push_remote_items] Complete: {success_count}/{len(req.items)} items pushed successfully")
    
    return {
        "results": results, 
        "pushed": success_count,
        "total": len(req.items),
        "remote_base": remote_base,
        "server": server.get('name') or server.get('alias')
    }


class SyncAllRequest(BaseModel):
    server_id: str
    include_batches: bool = True
    include_groups: bool = True
    include_keys: bool = True
    direction: str = "push"  # "push" or "pull"


@router.post("/remote/sync-all")
def sync_all_items(req: SyncAllRequest):
    """Sync all items of selected types between local and remote."""
    import os
    
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    results = {"batches": [], "groups": [], "keys": []}
    
    if req.direction == "push":
        # Get local items and push
        if req.include_batches:
            batch_dir = os.path.join(base_path, "batch")
            if os.path.exists(batch_dir):
                items = [f for f in os.listdir(batch_dir) if os.path.isfile(os.path.join(batch_dir, f)) and not f.startswith('.')]
                if items:
                    res = push_remote_items(RemoteSyncItemsRequest(server_id=req.server_id, items=items, item_type='batch'))
                    results['batches'] = res.get('results', [])
        
        if req.include_groups:
            groups_dir = os.path.join(base_path, "batch", "groups")
            if os.path.exists(groups_dir):
                items = [f for f in os.listdir(groups_dir) if f.endswith('.sh')]
                if items:
                    res = push_remote_items(RemoteSyncItemsRequest(server_id=req.server_id, items=items, item_type='group'))
                    results['groups'] = res.get('results', [])
        
        if req.include_keys:
            keys_dir = os.path.join(base_path, "keys")
            if os.path.exists(keys_dir):
                items = [f for f in os.listdir(keys_dir) if f.endswith('.json')]
                if items:
                    res = push_remote_items(RemoteSyncItemsRequest(server_id=req.server_id, items=items, item_type='key'))
                    results['keys'] = res.get('results', [])
    else:
        # Get remote items and pull
        if req.include_batches:
            remote_batches = list_remote_batches(RemoteSyncRequest(server_id=req.server_id))
            items = [i['name'] for i in remote_batches.get('items', [])]
            if items:
                res = pull_remote_items(RemoteSyncItemsRequest(server_id=req.server_id, items=items, item_type='batch'))
                results['batches'] = res.get('results', [])
        
        if req.include_groups:
            remote_groups = list_remote_groups(RemoteSyncRequest(server_id=req.server_id))
            items = [i['name'] for i in remote_groups.get('items', [])]
            if items:
                res = pull_remote_items(RemoteSyncItemsRequest(server_id=req.server_id, items=items, item_type='group'))
                results['groups'] = res.get('results', [])
        
        if req.include_keys:
            remote_keys = list_remote_keys(RemoteSyncRequest(server_id=req.server_id))
            items = [i['name'] for i in remote_keys.get('items', [])]
            if items:
                res = pull_remote_items(RemoteSyncItemsRequest(server_id=req.server_id, items=items, item_type='key'))
                results['keys'] = res.get('results', [])
    
    total = sum(len(v) for v in results.values())
    success = sum(len([r for r in v if r.get('status') == 'success']) for v in results.values())
    
    return {"results": results, "total": total, "success": success, "direction": req.direction}


class RelaySyncRequest(BaseModel):
    source_id: str
    target_ids: List[str]
    items: List[str]
    item_type: str
    direction: str = "push"


@router.post("/remote/relay-sync")
def api_relay_sync(req: RelaySyncRequest):
    """Relay sync items between remote servers via local temp."""
    import tempfile
    import shutil
    import os
    import subprocess
    from backend.ops import SSHBaseRequest
    
    # Resolve Source
    source_server = None
    if req.source_id != 'local':
        source_server = get_server_by_id(req.source_id)
        
    # Resolve Targets
    target_servers = []
    for tid in req.target_ids:
        if tid == 'local': continue
        srv = get_server_by_id(tid)
        if srv: target_servers.append(srv)
            
    if not source_server and req.source_id != 'local':
        raise HTTPException(404, "Source server not found")
        
    results = []
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    # Helper to resolve paths
    def get_paths(server, item, itype):
        remote_base = server.get('remote_path', '/opt/isync')
        if itype == 'batch': return f"{remote_base}/batch/{item}"
        if itype == 'group': return f"{remote_base}/batch/groups/{item}"
        if itype == 'key': return f"{remote_base}/keys/{item}"
        return f"/tmp/{item}"
        
    def get_local_path(item, itype):
        if itype == 'batch': return os.path.join(base_path, "batch", item)
        if itype == 'group': return os.path.join(base_path, "batch", "groups", item)
        if itype == 'key': return os.path.join(base_path, "keys", item)
        return f"/tmp/{item}"

    # Helper for SCP
    def scp_transfer(src_str, dst_str, key_path):
        cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
        if key_path: cmd.extend(["-i", key_path])
        cmd.extend([src_str, dst_str])
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60)

    # 1. PUSH: Source -> Targets
    if req.direction == "push":
        with tempfile.TemporaryDirectory() as tmpdir:
            for item in req.items:
                item_res = {"item": item, "source": req.source_id, "targets": []}
                
                # A. Pull from Source to Temp
                tmp_path = os.path.join(tmpdir, item)
                
                if req.source_id == 'local':
                    src_path = get_local_path(item, req.item_type)
                    if not os.path.exists(src_path):
                        item_res["status"] = "error"
                        item_res["error"] = "Local file missing"
                        results.append(item_res)
                        continue
                    shutil.copy(src_path, tmp_path)
                else:
                    src_addr = source_server.get('alias') or source_server.get('host')
                    if source_server.get('user'): src_addr = f"{source_server['user']}@{src_addr}"
                    remote_path = get_paths(source_server, item, req.item_type)
                    
                    pull_res = scp_transfer(f"{src_addr}:{remote_path}", tmp_path, source_server.get('key_path'))
                    if pull_res.returncode != 0:
                        item_res["status"] = "error"
                        item_res["error"] = f"Pull failed: {pull_res.stderr}"
                        results.append(item_res)
                        continue
                        
                # B. Push Temp to Targets
                for target in target_servers:
                    tgt_addr = target.get('alias') or target.get('host')
                    if target.get('user'): tgt_addr = f"{target['user']}@{tgt_addr}"
                    dest_path = get_paths(target, item, req.item_type)
                    
                    push_res = scp_transfer(tmp_path, f"{tgt_addr}:{dest_path}", target.get('key_path'))
                    t_status = "success" if push_res.returncode == 0 else "error"
                    t_msg = push_res.stderr if t_status == "error" else ""
                    
                    item_res["targets"].append({
                        "server": target.get('name'), 
                        "status": t_status, 
                        "message": t_msg
                    })
                    
                results.append(item_res)

    # 2. PULL: Targets -> Source
    elif req.direction == "pull":
         with tempfile.TemporaryDirectory() as tmpdir:
             for item in req.items:
                 tmp_path = os.path.join(tmpdir, item)
                 
                 for target in target_servers:
                    tgt_addr = target.get('alias') or target.get('host')
                    if target.get('user'): tgt_addr = f"{target['user']}@{tgt_addr}"
                    src_remote_path = get_paths(target, item, req.item_type)
                    
                    dl_res = scp_transfer(f"{tgt_addr}:{src_remote_path}", tmp_path, target.get('key_path'))
                    if dl_res.returncode == 0:
                        if req.source_id == 'local':
                             dest_local = get_local_path(item, req.item_type)
                             os.makedirs(os.path.dirname(dest_local), exist_ok=True)
                             shutil.copy(tmp_path, dest_local)
                             results.append({"item": item, "status": "success", "from": target.get('name')})
                        else:
                             src_addr = source_server.get('alias') or source_server.get('host')
                             if source_server.get('user'): src_addr = f"{source_server['user']}@{src_addr}"
                             dest_remote = get_paths(source_server, item, req.item_type)
                             
                             up_res = scp_transfer(tmp_path, f"{src_addr}:{dest_remote}", source_server.get('key_path'))
                             if up_res.returncode == 0:
                                 results.append({"item": item, "status": "success", "from": target.get('name')})
                             else:
                                 results.append({"item": item, "status": "error", "message": up_res.stderr})
                    else:
                        results.append({"item": item, "status": "error", "message": f"Pull from {target.get('name')} failed"})

    total = len(req.items)
    pushed = len([r for r in results if r.get('status') != 'error'])
    return {"results": results, "total": total, "pushed": pushed}

# --- Path Verification ---
class VerifyPathRequest(BaseModel):
    type: str  # 'local', 'ssh', 'rclone'
    server_id: Optional[str] = "local"
    path: str
    rclone_remote: Optional[str] = None


@router.post("/verify-path")
def api_verify_path(req: VerifyPathRequest):
    """Verify if a path is accessible."""
    from backend.remote_browser import run_ssh_command
    
    # Resolve Server
    server = None
    if req.server_id != 'local' and req.server_id:
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        server = next((s for s in servers if s.get('id') == req.server_id), None)
        if not server:
            raise HTTPException(404, "Server not found")
    
    # Construct Verification Command
    if req.type == 'rclone':
        # Check if remote path exists using rclone lsjson --stat
        # This works for both files and directories
        target = f"{req.rclone_remote}:{req.path}"
        check_cmd = f"rclone lsjson \"{target}\" --stat"
    else:
        # Check local/ssh path using test -e
        # Quote path to handle spaces
        check_cmd = f"test -e \"{req.path}\""
        
    # Execute via unified runner (handles both local and ssh)
    res = run_ssh_command(server, check_cmd, timeout=10)
    
    if res['success']:
        return {"status": "ok", "message": "Access confirmed"}
    else:
        # Use stderr if available, otherwise generic error
        error_msg = res.get('error') or "Path not found or inaccessible"
        return {"status": "error", "message": error_msg}
