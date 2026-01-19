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
        
    ssh_target = req.host
    if req.user:
        ssh_target = f"{req.user}@{req.host}"
        
    # Check if dest is remote (contains :) or we assume dest is remote path on target
    # Ideally checking if src/dest strings already have user@host: prefix is complex.
    # We will assume this function builds common scp args, but the caller specifies full src/dest args.
    # update: refactoring to separate helpers for push/pull
    return cmd

def exec_remote_command(req: SSHBaseRequest, command: str) -> dict:
    """Executes a command on the remote server."""
    cmd = _build_ssh_cmd(req, [command])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=req.timeout)
        if res.returncode == 0:
            return {"status": "success", "stdout": res.stdout, "stderr": res.stderr}
        else:
            return {"status": "error", "message": res.stderr or res.stdout, "code": res.returncode}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def copy_file_to_remote(req: SSHBaseRequest, local_path: str, remote_dest: str) -> dict:
    """Copies a local file to the remote server using SCP."""
    ssh_target = req.host
    if req.user:
        ssh_target = f"{req.user}@{req.host}"
    
    dest_str = f"{ssh_target}:{remote_dest}"
    
    cmd = ["scp", "-o", "StrictHostKeyChecking=no"]
    if req.key_path:
        cmd.extend(["-i", req.key_path])
    
    cmd.extend([local_path, dest_str])
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=req.timeout)
        if res.returncode == 0:
            return {"status": "success"}
        else:
            return {"status": "error", "message": res.stderr or res.stdout}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def test_ssh_connection(req: SSHBaseRequest):
    """
    Tests SSH connectivity using the exact method from legacy isync_ui.py.
    Legacy Logic:
        cmd = ["ssh"]
        if ssh_key: cmd.extend(["-i", ssh_key])
        target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
        cmd.extend([target, "echo", "SSH_SUCCESS"])
    """
    cmd = _build_ssh_cmd(req, ["echo", "SSH_SUCCESS"])

    try:
        # Legacy UI used timeout=ssh_timeout (default 10)
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=req.timeout)
        if "SSH_SUCCESS" in res.stdout:
            return {"status": "ok", "message": f"Connected to {req.host}"}
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


def check_remote_status(req: SSHBaseRequest):
    """Checks detailed status of ISync on remote server."""
    # We check:
    # 1. SSH Connectivity
    # 2. Uvicorn backend process
    # 3. Vite/Frontend process
    # 4. Tmux session (isync_remote)
    
    cmd_str = (
        "echo 'SSH_OK'; "
        "pgrep -f 'uvicorn.*backend.main' >/dev/null && echo 'BACKEND_OK' || echo 'BACKEND_NO'; "
        "pgrep -f 'vite' >/dev/null && echo 'FRONTEND_OK' || echo 'FRONTEND_NO'; "
        "tmux has-session -t isync_remote 2>/dev/null && echo 'TMUX_OK' || echo 'TMUX_NO'"
    )
    
    cmd = _build_ssh_cmd(req, [cmd_str])
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=req.timeout)
        output = res.stdout.strip()
        
        connected = "SSH_OK" in output
        backend_running = "BACKEND_OK" in output
        frontend_running = "FRONTEND_OK" in output
        tmux_session = "TMUX_OK" in output
        
        # Overall status
        status = "error"
        if not connected:
            status = "error"
        elif backend_running:
            status = "ok" # "Running"
        else:
            status = "stopped"
            
        return {
            "status": status,
            "connected": connected,
            "isync_running": backend_running, # simplified
            "backend_running": backend_running,
            "frontend_running": frontend_running,
            "tmux_session": tmux_session,
            "message": "Connected" if connected else "Failed to connect"
        }
        
    except subprocess.TimeoutExpired:
        return {"status": "error", "connected": False, "message": "Timeout"}
    except Exception as e:
        return {"status": "error", "connected": False, "message": str(e)}

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

        # Annotate users and check for admins to auto-protect
        annotated = []
        protected_list = cfg.get('protected_users', [])
        protected_set = set(u.lower() for u in protected_list)
        config_changed = False
        admin_count = 0

        for u in users:
            email = u['email']
            u['in_group'] = email.lower() in member_set
            
            # Auto-protect Admins
            if u.get('isAdmin'):
                admin_count += 1
                if email.lower() not in protected_set:
                    protected_list.append(email)
                    protected_set.add(email.lower())
                    config_changed = True
                    logger.info(f"Auto-protecting Admin user: {email}")

            annotated.append(u)
        
        logger.info(f"Domain {domain_name}: Found {admin_count} admins out of {len(users)} users.")
            
        if config_changed:
            cfg['protected_users'] = protected_list
            store.save_config(cfg)
            
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
        # engine.batch_check_suspension needs to be updated too if we want isAdmin there, 
        # but list_domain_users already identifies them.
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

# --- Remote Verification Helpers ---

def list_remote_batches_op(req: SSHBaseRequest) -> List[str]:
    remote_path = f"{req.remote_path}/batch"
    cmd = _build_ssh_cmd(req, [f"ls {remote_path} 2>/dev/null | grep -v '^d' | grep -v '^\\.git'"])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return [l.split()[-1] for l in res.stdout.split('\n') if l.strip()]
    except: return []

def list_remote_groups_op(req: SSHBaseRequest) -> List[str]:
    remote_path = f"{req.remote_path}/batch/groups"
    cmd = _build_ssh_cmd(req, [f"ls {remote_path}/*.sh 2>/dev/null"])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return [os.path.basename(l.strip()) for l in res.stdout.split('\n') if l.strip()]
    except: return []

def list_remote_keys_op(req: SSHBaseRequest) -> List[str]:
    remote_path = f"{req.remote_path}/keys"
    cmd = _build_ssh_cmd(req, [f"ls {remote_path}/*.json 2>/dev/null"])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return [os.path.basename(l.strip()) for l in res.stdout.split('\n') if l.strip()]
    except: return []

def list_remote_crons_op(req: SSHBaseRequest) -> List[str]:
    cmd = _build_ssh_cmd(req, ["crontab -l 2>/dev/null"])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return [l.strip() for l in res.stdout.split('\n') if l.strip() and not l.strip().startswith('#')]
    except: return []

def verify_full_server_status(req: SSHBaseRequest, server_name: str, server_id: str):
    # Base check
    base = check_remote_status(req)
    
    full = {
        "server_id": server_id,
        "server_name": server_name,
        "connected": base["connected"],
        "status": base["status"],
        "rclone": {"status": "unknown", "remotes": [], "count": 0, "rclone_installed": False},
        "files": {"status": "unknown", "keys_list": [], "keys_count": 0, "groups_list": [], "groups_count": 0, "path_exists": False},
        "batch": {"status": "unknown", "batch_files_list": [], "batch_count": 0, "processes": [], "running": False},
        "cron": {"status": "unknown", "entries_list": [], "entries_count": 0, "has_crontab": False, "content": ""}
    }
    
    if not base["connected"]:
        return full
        
    # Rclone
    try:
        rcv = subprocess.run(_build_ssh_cmd(req, ["rclone listremotes"]), capture_output=True, text=True, timeout=10)
        remotes = [l.strip() for l in rcv.stdout.split('\n') if l.strip()]
        full["rclone"] = {
            "status": "ok",
            "rclone_installed": rcv.returncode == 0,
            "remotes": remotes,
            "count": len(remotes)
        }
    except Exception as e:
        full["rclone"]["status"] = "error"

    # Files
    keys = list_remote_keys_op(req)
    groups = list_remote_groups_op(req)
    # Check path existence
    try:
        chk = subprocess.run(_build_ssh_cmd(req, [f"test -d {req.remote_path} && echo YES"]), capture_output=True, text=True, timeout=5)
        path_exists = "YES" in chk.stdout
    except: path_exists = False
    
    full["files"].update({
        "status": "ok",
        "keys_list": keys,
        "keys_count": len(keys),
        "groups_list": groups,
        "groups_count": len(groups),
        "path_exists": path_exists
    })

    # Batch
    batches = list_remote_batches_op(req)
    # Check processes
    try:
        psr = subprocess.run(_build_ssh_cmd(req, ["pgrep -a -f 'bash.*batch'"]), capture_output=True, text=True, timeout=5)
        procs = [l.strip() for l in psr.stdout.split('\n') if l.strip()]
        running = len(procs) > 0
    except: 
        procs = []
        running = False
        
    full["batch"].update({
        "status": "ok",
        "batch_files_list": batches,
        "batch_count": len(batches),
        "processes": procs,
        "running": running
    })
    
    # Cron
    crons = list_remote_crons_op(req)
    full["cron"].update({
        "status": "ok",
        "entries_list": crons,
        "entries_count": len(crons),
        "has_crontab": len(crons) > 0,
        "content": "\n".join(crons)
    })
    
    return full
