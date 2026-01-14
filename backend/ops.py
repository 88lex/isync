import os
import shutil
import subprocess
import json
import logging
from datetime import datetime
from fastapi import HTTPException
from pydantic import BaseModel
from typing import List, Optional
import difflib

# Internal imports
from .store import store, CURRENT_CONFIG_FILE, SYNCLIST_FILE, CONFIGS_DIR, KEYS_DIR

logger = logging.getLogger("uvicorn")

class SSHBaseRequest(BaseModel):
    host: str
    user: Optional[str] = None
    key_path: Optional[str] = None
    remote_path: str = "~/isync"
    timeout: int = 10

class PushPullRequest(SSHBaseRequest):
    pass

def _build_ssh_cmd(req: SSHBaseRequest, extra_args: List[str], strict_host_checking: bool = False) -> List[str]:
    cmd = ["ssh"]
    if strict_host_checking:
        # BatchMode prevents interactive prompts, ensuring we fail fast if verification is needed
        cmd.extend(["-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes"])
    else:
        cmd.extend(["-o", "StrictHostKeyChecking=no"])
        
    if req.key_path:
        cmd.extend(["-i", req.key_path])
    
    target = req.host
    if req.user:
        target = f"{req.user}@{req.host}"
    
    cmd.append(target)
    cmd.extend(extra_args)
    return cmd

def _build_scp_cmd(req: SSHBaseRequest, src: str, dest: str, recursive: bool = False) -> List[str]:
    cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
    if recursive:
        cmd.append("-r")
    if req.key_path:
        cmd.extend(["-i", req.key_path])
        
    # Build target string for remote paths logic? 
    # Actually scp syntax is [user@]host:[path]
    # The caller passes formatted src/dest strings
    cmd.extend([src, dest])
    return cmd

def test_ssh_connection(req: SSHBaseRequest):
    """
    Tests SSH connectivity using the exact method from legacy isync_ui.py.
    Legacy Logic:
        cmd = ["ssh"]
        if ssh_key: cmd.extend(["-i", ssh_key])
        target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
        cmd.extend([target, "echo", "SSH_SUCCESS"])
    """
    cmd = ["ssh"]
    if req.key_path:
        cmd.extend(["-i", req.key_path])
    
    target = req.host
    if req.user:
        target = f"{req.user}@{req.host}"
    
    cmd.append(target)
    cmd.extend(["echo", "SSH_SUCCESS"])

    try:
        # Legacy UI used timeout=ssh_timeout (default 10)
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=req.timeout)
        if "SSH_SUCCESS" in res.stdout:
            return {"status": "success", "message": f"Connected to {req.host}"}
        else:
            return {"status": "error", "message": res.stderr or res.stdout or "Unknown failure"}
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def approve_ssh_host_key(req: SSHBaseRequest):
    """Adds the host key to known_hosts."""
    try:
        # We rely on ssh-keyscan to append to known_hosts
        # Ideally we should verify the key matches what we showed the user, 
        # but for this generic implementation re-scanning is the standard approach.
        home = os.path.expanduser("~")
        known_hosts = os.path.join(home, ".ssh", "known_hosts")
        ssh_dir = os.path.dirname(known_hosts)
        if not os.path.exists(ssh_dir): os.makedirs(ssh_dir)
        
        target_host, target_port = _resolve_ssh_alias(req.host)
        
        cmd = ["ssh-keyscan", "-p", str(target_port), "-t", "ecdsa,ed25519,rsa", target_host]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0 and res.stdout:
            with open(known_hosts, "a") as f:
                f.write(res.stdout)
            return {"status": "success", "message": "Host key added."}
        else:
             raise Exception(f"Failed to scan keys: {res.stderr}")
    except Exception as e:
        logger.error(f"Approve key failed: {e}")
        raise HTTPException(500, str(e))

def create_local_backup():
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        bk_dir = "backups"
        if not os.path.exists(bk_dir): os.makedirs(bk_dir)
        
        tmp_name = f"isync_backup_{ts}"
        tmp_path = os.path.join(bk_dir, tmp_name)
        os.makedirs(tmp_path)
        
        # Files to copy
        config = store.get_config()
        
        # 1. Configs
        for f in [CURRENT_CONFIG_FILE, SYNCLIST_FILE]:
            if os.path.exists(f): shutil.copy(f, tmp_path)
            
        # 2. JSON Keys
        domains = config.get('domains', [])
        for d in domains:
            kp = d.get('sa_json_path')
            if kp and os.path.exists(kp):
                shutil.copy(kp, tmp_path)
        
        # 3. Configs Dir
        if os.path.exists(CONFIGS_DIR):
             shutil.copytree(CONFIGS_DIR, os.path.join(tmp_path, CONFIGS_DIR))

        # Zip
        zip_path = shutil.make_archive(os.path.join(bk_dir, tmp_name), 'zip', tmp_path)
        shutil.rmtree(tmp_path)
        
        return {"status": "success", "file": os.path.basename(zip_path)}
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def push_config_to_remote(req: PushPullRequest):
    """Pushes config.yaml, synclist.yaml, configs/, and keys/ to remote."""
    
    ssh_target = req.host
    if req.user: ssh_target = f"{req.user}@{req.host}"
    
    remote_base = req.remote_path
    
    # Helper to run SCP
    def run_scp(src, dst_suffix, recursive=False):
        # Allow Windows paths to be converted? No, we are in WSL.
        # But we need to handle the scp target format: user@host:/path
        dest = f"{ssh_target}:{remote_base}/{dst_suffix}"
        cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
        if recursive: cmd.append("-r")
        if req.key_path: cmd.extend(["-i", req.key_path])
        cmd.extend([src, dest])
        
        return subprocess.run(cmd, capture_output=True, text=True)

    results = []
    
    # 1. Main files
    r1 = run_scp(CURRENT_CONFIG_FILE, CURRENT_CONFIG_FILE)
    results.append(f"Config: {'OK' if r1.returncode == 0 else r1.stderr}")
    
    r2 = run_scp(SYNCLIST_FILE, SYNCLIST_FILE)
    results.append(f"SyncList: {'OK' if r2.returncode == 0 else r2.stderr}")
    
    # 2. Configs Library
    if os.path.exists(CONFIGS_DIR):
        r3 = run_scp(CONFIGS_DIR, "", recursive=True) # scp -r configs target:base/
        results.append(f"ConfigsLib: {'OK' if r3.returncode == 0 else r3.stderr}")
        
    # 3. Keys
    # We need to make sure keys dir exists remotely or scp might fail if copying file to non-existent dir?
    # Usually scp file target:dir/file works if dir exists.
    # Let's verify remote dir existence?
    # For now, simplistic push of individual key files
    config = store.get_config()
    for d in config.get('domains', []):
        kp = d.get('sa_json_path')
        if kp and os.path.exists(kp):
            fname = os.path.basename(kp)
            # Assuming 'keys' dir exists on remote or is relative config
            # Original UI did: exec_scp(local_json, f"{ssh_target}:{remote_base}/keys/{fname}")
            rk = run_scp(kp, f"keys/{fname}")
            if rk.returncode != 0:
                results.append(f"Key {fname}: {rk.stderr}")
    
    return {"status": "completed", "details": results}

def pull_config_from_remote(req: PushPullRequest):
    """Pulls config.yaml, synclist.yaml from remote to local."""
    ssh_target = req.host
    if req.user: ssh_target = f"{req.user}@{req.host}"
    remote_base = req.remote_path
    
    def run_scp_pull(remote_src_suffix, local_dest, recursive=False):
        src = f"{ssh_target}:{remote_base}/{remote_src_suffix}"
        cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
        if recursive: cmd.append("-r")
        if req.key_path: cmd.extend(["-i", req.key_path])
        cmd.extend([src, local_dest])
        return subprocess.run(cmd, capture_output=True, text=True)

    r1 = run_scp_pull(CURRENT_CONFIG_FILE, ".")
    r2 = run_scp_pull(SYNCLIST_FILE, ".")
    r3 = run_scp_pull(CONFIGS_DIR, ".", recursive=True)
    
    if r1.returncode == 0 and r2.returncode == 0:
        store.load_all() # Reload in memory
        return {"status": "success", "message": "Configs pulled and reloaded."}
    else:
        return {"status": "error", "message": f"Pull failed. {r1.stderr} {r2.stderr}"}

def diff_configs(req: SSHBaseRequest):
    """Returns diff between local and remote config."""
    ssh_target = req.host
    if req.user: ssh_target = f"{req.user}@{req.host}"
    
    files = [CURRENT_CONFIG_FILE, SYNCLIST_FILE]
    diffs = {}
    
    for fname in files:
        # Read Local
        local_lines = []
        if os.path.exists(fname):
            with open(fname, 'r') as f: local_lines = f.readlines()
            
        # Read Remote
        cmd = _build_ssh_cmd(req, ["cat", f"{req.remote_path}/{fname}"])
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=req.timeout)
        
        if res.returncode != 0:
            diffs[fname] = f"Error reading remote: {res.stderr}"
            continue
            
        remote_lines = res.stdout.splitlines(keepends=True)
        
        diff = list(difflib.unified_diff(
            local_lines, remote_lines,
            fromfile=f"Local {fname}", tofile=f"Remote {fname}"
        ))
        
        diffs[fname] = "".join(diff) if diff else "Identical"
        
    return {"diffs": diffs}

# --- Manual User Ops ---
from isync_engine import ISyncEngine # Helper import

class UserOpRequest(BaseModel):
    user: str

def manual_create_user(req: UserOpRequest):
    # We need an engine instance. 
    # Use config from store.
    cfg = store.get_config()
    # We need to find a domain config that matches... or does creating a user require a domain?
    # ISyncEngine.create_user takes (user_email, domain_config).
    # We need to infer the domain from the user email.
    
    user_email = req.user
    domain_part = user_email.split('@')[-1]
    
    # Find domain in config
    domains = cfg.get('domains', [])
    matched = next((d for d in domains if d['domain_name'] == domain_part), None)
    
    if not matched:
        # Fallback: try to see if user_email is partial or we use first domain?
        # If user just typed "user1", we can't guess domain cleanly unless we default to first.
        # Original UI usually forced full email or prepended defaults.
        if domains:
            matched = domains[0]
            # If input was just "user", append domain?
            if '@' not in user_email:
                user_email = f"{user_email}@{matched['domain_name']}"
        else:
            raise HTTPException(400, "No domains configured.")
    
    # Instantiate Engine
    engine = ISyncEngine(cfg)
    try:
        # We need to access the auth manager. Engine initializes it.
        # engine.auth_manager.create_user(user_email, ...)
        # Engine execution usually handles this but we want raw access.
        # Use engine helper if available or access auth manager directly.
        # ISyncEngine doesn't expose public "create_user" easily without "execute_step".
        # But we can use `engine.auth_manager`
        
        # Check if auth manager is ready
        if not engine.auth_manager:
            engine._init_auth()
            
        # We need the 'service' object for the specific domain
        # AuthManager manages services by domain.
        res = engine.auth_manager.create_user(user_email, matched, cfg.get('company_name', 'Internal Ops'))
        return {"status": "success", "message": f"Created {res}"}
        
    except Exception as e:
        logger.error(f"Manual create failed: {e}")
        raise HTTPException(500, str(e))

def manual_delete_user(req: UserOpRequest):
    cfg = store.get_config()
    user_email = req.user
    domain_part = user_email.split('@')[-1]
    domains = cfg.get('domains', [])
    matched = next((d for d in domains if d['domain_name'] == domain_part), None)
    
    if not matched:
        if domains:
            matched = domains[0]
            if '@' not in user_email:
                user_email = f"{user_email}@{matched['domain_name']}"
        else:
             raise HTTPException(400, "No domains configured.")

    engine = ISyncEngine(cfg)
    try:
        if not engine.auth_manager: engine._init_auth()
        # Pass group_email to ensure removal
        group_email = matched.get('group_email')
        engine.auth_manager.delete_user(user_email, group_email)
        return {"status": "success", "message": f"Deleted {user_email}"}
    except Exception as e:
        logger.error(f"Manual delete failed: {e}")
        raise HTTPException(500, str(e))
class BulkOpRequest(BaseModel):
    action: str  # 'verify', 'unsuspend', 'delete', 'protect'
    domain: str
    users: List[str]

def test_domain_auth():
    cfg = store.get_config()
    engine = ISyncEngine(cfg)
    return engine.validate_setup()

def list_domain_users(domain_name: str):
    cfg = store.get_config()
    # Find domain config
    d_cfg = next((d for d in cfg.get('domains', []) if d['domain_name'] == domain_name), None)
    if not d_cfg:
        raise HTTPException(404, f"Domain {domain_name} not configured")

    json_path = d_cfg.get('sa_json_path')
    if not json_path or not os.path.exists(json_path):
        raise HTTPException(400, "Service Account JSON missing")

    try:
        from isync_auth import ISyncAuthManager
        mgr = ISyncAuthManager(json_path, d_cfg['admin_email'])
        users = mgr.list_users(domain_name, return_detailed=True)
        
        # Check Group Membership
        group_email = d_cfg.get('group_email')
        member_set = set()
        if group_email:
            try:
                ms = mgr.list_group_members(group_email)
                member_set = set(m.lower() for m in ms if m)
            except Exception:
                pass # Fail verification silently or log?

        # Annotate users
        annotated = []
        for u in users:
            email = u['primaryEmail']
            u['in_group'] = email.lower() in member_set
            annotated.append(u)
            
        return {
            "domain": domain_name, 
            "count": len(annotated), 
            "group_email": group_email,
            "json_filename": os.path.basename(json_path) if json_path else "N/A",
            "users": annotated
        }
    except Exception as e:
        logger.error(f"List users failed: {e}")
        raise HTTPException(500, str(e))

def process_bulk_ops(req: BulkOpRequest):
    from isync_auth import ISyncAuthManager
    cfg = store.get_config()
    engine = ISyncEngine(cfg)
    
    results = {}
    
    if req.action == 'verify':
        results = engine.batch_check_suspension(req.domain, req.users)
        
    elif req.action == 'unsuspend':
        results = engine.batch_unsuspend_users(req.domain, req.users)
        
    elif req.action == 'delete':
        try:
            d_cfg = engine.get_domain_config(req.domain)
        except ValueError:
            raise HTTPException(404, "Domain not found")
            
        # Check protection
        protected = set(u.lower() for u in cfg.get('protected_users', []) or [])
        
        # Initialize direct manager
        mgr = ISyncAuthManager(d_cfg['sa_json_path'], d_cfg['admin_email'])
        
        for u in req.users:
            if u.lower() in protected:
                results[u] = "Skipped (Protected)"
                continue
            try:
                # Pass group_email
                mgr.delete_user(u, group_email=d_cfg.get('group_email')) 
                results[u] = "Deleted"
            except Exception as e:
                results[u] = f"Error: {str(e)}"

    elif req.action == 'add_to_group':
        try:
            d_cfg = engine.get_domain_config(req.domain)
        except ValueError:
            raise HTTPException(404, "Domain not found")
            
        mgr = ISyncAuthManager(d_cfg['sa_json_path'], d_cfg['admin_email'])
        group_email = d_cfg.get('group_email')
        
        if not group_email:
             raise HTTPException(400, "Group email not configured for this domain.")

        for u in req.users:
            try:
                mgr.add_to_group(u, group_email)
                results[u] = f"Added to {group_email}"
            except Exception as e:
                 results[u] = f"Error: {str(e)}"

    elif req.action == 'protect':
        current_protected = set(cfg.get('protected_users', []) or [])
        added = []
        for u in req.users:
            if u not in current_protected:
                current_protected.add(u)
                added.append(u)
        
        # update config
        cfg['protected_users'] = list(current_protected)
        store.save_config(cfg)
        results = {"added": added, "total_protected": len(current_protected)}

    else:
        raise HTTPException(400, f"Unknown action: {req.action}")
        
    return results
