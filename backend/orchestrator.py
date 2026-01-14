"""
ISync Orchestrator Module
Handles multi-server file deployment, verification, and cronjob management.
"""
import os
import subprocess
import logging
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path

logger = logging.getLogger("uvicorn")

# Base directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_FILES_DIR = os.path.join(BASE_DIR, "server_files")

# Server files subdirectories
RCLONE_DIR = os.path.join(SERVER_FILES_DIR, "rclone")
KEYS_DIR = os.path.join(SERVER_FILES_DIR, "keys")
BATCH_DIR = os.path.join(SERVER_FILES_DIR, "batch")
CRON_DIR = os.path.join(SERVER_FILES_DIR, "cron")
SCRIPTS_DIR = os.path.join(SERVER_FILES_DIR, "scripts")


def ensure_server_files_dirs():
    """Ensure all server_files directories exist."""
    for d in [SERVER_FILES_DIR, RCLONE_DIR, KEYS_DIR, BATCH_DIR, CRON_DIR, SCRIPTS_DIR]:
        os.makedirs(d, exist_ok=True)
    os.makedirs(os.path.join(CRON_DIR, "server_specific"), exist_ok=True)


def list_server_files() -> Dict[str, List[Dict[str, Any]]]:
    """
    List all files in server_files/ directory.
    
    Returns:
        Dict with keys: rclone, keys, batch, cron, scripts
        Each value is a list of file info dicts
    """
    ensure_server_files_dirs()
    result = {
        "rclone": [],
        "keys": [],
        "batch": [],
        "cron": [],
        "scripts": []
    }
    
    def list_dir_files(directory: str, category: str):
        if not os.path.exists(directory):
            return
        for item in os.listdir(directory):
            path = os.path.join(directory, item)
            if os.path.isfile(path):
                stat = os.stat(path)
                result[category].append({
                    "name": item,
                    "path": path,
                    "size": stat.st_size,
                    "modified": stat.st_mtime
                })
    
    list_dir_files(RCLONE_DIR, "rclone")
    list_dir_files(KEYS_DIR, "keys")
    list_dir_files(BATCH_DIR, "batch")
    list_dir_files(CRON_DIR, "cron")
    list_dir_files(SCRIPTS_DIR, "scripts")
    
    # Also list server-specific crons
    specific_dir = os.path.join(CRON_DIR, "server_specific")
    if os.path.exists(specific_dir):
        for item in os.listdir(specific_dir):
            path = os.path.join(specific_dir, item)
            if os.path.isfile(path):
                stat = os.stat(path)
                result["cron"].append({
                    "name": f"server_specific/{item}",
                    "path": path,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "server_specific": True
                })
    
    return result


def get_file_content(file_path: str) -> str:
    """Read file content."""
    with open(file_path, 'r') as f:
        return f.read()


def save_file_content(file_path: str, content: str) -> bool:
    """Save content to file."""
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w') as f:
            f.write(content)
        return True
    except Exception as e:
        logger.error(f"[Orchestrator] Failed to save file {file_path}: {e}")
        return False


def get_crontab_for_server(server_id: str) -> Tuple[str, str]:
    """
    Get crontab content for a specific server.
    Returns (content, source) where source is 'server_specific' or 'default'.
    """
    # Check for server-specific crontab first
    specific_path = os.path.join(CRON_DIR, "server_specific", f"{server_id}.crontab")
    if os.path.exists(specific_path):
        return get_file_content(specific_path), "server_specific"
    
    # Fall back to default
    default_path = os.path.join(CRON_DIR, "default.crontab")
    if os.path.exists(default_path):
        return get_file_content(default_path), "default"
    
    return "", "none"


def save_crontab_for_server(server_id: str, content: str, use_default: bool = False) -> bool:
    """
    Save crontab for a specific server.
    If use_default=True, saves to default.crontab instead.
    """
    if use_default:
        path = os.path.join(CRON_DIR, "default.crontab")
    else:
        path = os.path.join(CRON_DIR, "server_specific", f"{server_id}.crontab")
    
    return save_file_content(path, content)


def build_ssh_command(server: Dict[str, Any]) -> List[str]:
    """Build SSH command from server config."""
    if server.get('alias'):
        return ['ssh', server['alias']]
    
    cmd = ['ssh']
    if server.get('key_path'):
        cmd.extend(['-i', os.path.expanduser(server['key_path'])])
    if server.get('port') and server['port'] != 22:
        cmd.extend(['-p', str(server['port'])])
    
    host = server.get('host', '')
    if server.get('user'):
        host = f"{server['user']}@{host}"
    cmd.append(host)
    
    return cmd


def run_ssh_command(server: Dict[str, Any], remote_cmd: str, timeout: int = 30) -> Dict[str, Any]:
    """Run a command on remote server via SSH."""
    ssh_cmd = build_ssh_command(server)
    ssh_cmd.append(remote_cmd)
    
    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def verify_remote_rclone(server: Dict[str, Any]) -> Dict[str, Any]:
    """
    Verify rclone configuration on remote server.
    Returns list of configured remotes and their status.
    """
    remote_path = server.get('remote_path', '~/isync')
    
    # Check if rclone exists and list remotes
    cmd = f"""
        which rclone >/dev/null 2>&1 && echo 'RCLONE_FOUND' || echo 'RCLONE_NOT_FOUND';
        rclone listremotes 2>/dev/null || true;
    """
    
    result = run_ssh_command(server, cmd, timeout=20)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'SSH failed'),
            "remotes": []
        }
    
    output = result.get('stdout', '')
    rclone_found = 'RCLONE_FOUND' in output
    
    # Parse remotes (each line ending with :)
    lines = output.strip().split('\n')
    remotes = [line.strip().rstrip(':') for line in lines if line.strip().endswith(':')]
    
    return {
        "status": "ok" if rclone_found else "rclone_missing",
        "rclone_installed": rclone_found,
        "remotes": remotes,
        "count": len(remotes)
    }


def verify_remote_mounts(server: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check mount points on remote server.
    Returns list of mounted filesystems (excluding system mounts).
    """
    # Get mount points, filter for common data mount patterns
    cmd = """
        mount | grep -E '^/dev/|fuse|nfs|cifs|rclone' | awk '{print $1, $3, $5}' || true;
        df -h 2>/dev/null | grep -vE '^Filesystem|tmpfs|udev|loop' | awk '{print $1, $6, $2, $5}' || true;
    """
    
    result = run_ssh_command(server, cmd, timeout=20)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'SSH failed'),
            "mounts": []
        }
    
    output = result.get('stdout', '')
    lines = output.strip().split('\n')
    
    mounts = []
    seen = set()
    for line in lines:
        parts = line.strip().split()
        if len(parts) >= 2 and parts[1] not in seen:
            seen.add(parts[1])
            mounts.append({
                "device": parts[0],
                "mountpoint": parts[1],
                "type": parts[2] if len(parts) > 2 else "unknown"
            })
    
    return {
        "status": "ok",
        "mounts": mounts,
        "count": len(mounts)
    }


def verify_remote_files(server: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check which server_files exist on the remote server.
    """
    remote_path = server.get('remote_path', '~/isync')
    
    cmd = f"""
        cd {remote_path} 2>/dev/null || echo 'PATH_NOT_FOUND';
        test -f {remote_path}/rclone.conf && echo 'RCLONE_CONF_EXISTS' || echo 'RCLONE_CONF_MISSING';
        test -d {remote_path}/keys && ls {remote_path}/keys/*.json 2>/dev/null | wc -l || echo '0';
        test -d {remote_path}/batch && ls {remote_path}/batch/*.sh 2>/dev/null | wc -l || echo '0';
        test -f {remote_path}/scripts/isync_runner.sh && echo 'RUNNER_EXISTS' || echo 'RUNNER_MISSING';
        crontab -l 2>/dev/null | grep -v '^#' | grep -c . || echo '0';
    """
    
    result = run_ssh_command(server, cmd, timeout=20)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'SSH failed')
        }
    
    output = result.get('stdout', '')
    
    # Parse outputs
    lines = output.strip().split('\n')
    
    return {
        "status": "ok",
        "path_exists": 'PATH_NOT_FOUND' not in output,
        "rclone_conf": 'RCLONE_CONF_EXISTS' in output,
        "keys_count": int(lines[2]) if len(lines) > 2 and lines[2].isdigit() else 0,
        "batch_count": int(lines[3]) if len(lines) > 3 and lines[3].isdigit() else 0,
        "runner_exists": 'RUNNER_EXISTS' in output,
        "cron_entries": int(lines[5]) if len(lines) > 5 and lines[5].isdigit() else 0
    }


def check_batch_running(server: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check if any batch job is currently running on the remote server.
    """
    cmd = """
        pgrep -f 'isync_runner.sh' -a 2>/dev/null && echo 'BATCH_RUNNING' || echo 'BATCH_IDLE';
        pgrep -f 'rclone.*copy|rclone.*sync' -a 2>/dev/null | head -3 || true;
    """
    
    result = run_ssh_command(server, cmd, timeout=15)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'SSH failed'),
            "running": False
        }
    
    output = result.get('stdout', '')
    is_running = 'BATCH_RUNNING' in output or 'rclone' in output.lower()
    
    # Extract running process info
    processes = []
    for line in output.strip().split('\n'):
        if 'rclone' in line.lower() or 'isync_runner' in line.lower():
            if 'BATCH_RUNNING' not in line and 'BATCH_IDLE' not in line:
                processes.append(line.strip()[:100])  # Truncate long lines
    
    return {
        "status": "ok",
        "running": is_running,
        "processes": processes[:5]  # Max 5 processes
    }


def get_remote_crontab(server: Dict[str, Any]) -> Dict[str, Any]:
    """Get current crontab from remote server."""
    result = run_ssh_command(server, "crontab -l 2>/dev/null || echo 'NO_CRONTAB'", timeout=15)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'SSH failed'),
            "content": ""
        }
    
    output = result.get('stdout', '').strip()
    
    return {
        "status": "ok",
        "has_crontab": 'NO_CRONTAB' not in output,
        "content": "" if 'NO_CRONTAB' in output else output
    }


def deploy_crontab(server: Dict[str, Any], content: str) -> Dict[str, Any]:
    """Deploy crontab to remote server."""
    # Escape content for shell
    escaped = content.replace("'", "'\\''")
    
    cmd = f"echo '{escaped}' | crontab -"
    result = run_ssh_command(server, cmd, timeout=15)
    
    if result.get('success'):
        return {"status": "ok", "message": "Crontab deployed successfully"}
    else:
        return {"status": "error", "message": result.get('error') or result.get('stderr', 'Failed')}


def clear_crontab(server: Dict[str, Any]) -> Dict[str, Any]:
    """Clear crontab on remote server."""
    result = run_ssh_command(server, "crontab -r 2>/dev/null || true; echo 'CLEARED'", timeout=15)
    
    if 'CLEARED' in result.get('stdout', ''):
        return {"status": "ok", "message": "Crontab cleared"}
    else:
        return {"status": "error", "message": "Failed to clear crontab"}


def get_push_preview(server: Dict[str, Any], file_types: List[str]) -> Dict[str, Any]:
    """
    Generate a preview of files that would be pushed to a server.
    
    Args:
        server: Server config dict
        file_types: List of types to include: 'rclone', 'keys', 'batch', 'cron', 'scripts'
    
    Returns:
        Dict with files to push and their status
    """
    local_files = list_server_files()
    preview = {
        "server_id": server.get('id'),
        "server_name": server.get('name'),
        "files": [],
        "total_size": 0
    }
    
    for ftype in file_types:
        if ftype in local_files:
            for f in local_files[ftype]:
                preview["files"].append({
                    "type": ftype,
                    "name": f["name"],
                    "size": f["size"],
                    "local_path": f["path"]
                })
                preview["total_size"] += f["size"]
    
    return preview


def push_files_to_server(
    server: Dict[str, Any], 
    file_types: List[str],
    dry_run: bool = False
) -> Dict[str, Any]:
    """
    Push server_files to a remote server.
    
    Args:
        server: Server config dict
        file_types: List of types to push
        dry_run: If True, only show what would be done
    
    Returns:
        Dict with results
    """
    remote_path = server.get('remote_path', '~/isync')
    
    # Build SSH destination
    if server.get('alias'):
        ssh_dest = server['alias']
    else:
        ssh_dest = server.get('host', '')
        if server.get('user'):
            ssh_dest = f"{server['user']}@{ssh_dest}"
    
    results = {
        "server_id": server.get('id'),
        "server_name": server.get('name'),
        "files_pushed": [],
        "errors": [],
        "dry_run": dry_run
    }
    
    # Map file types to local and remote paths
    type_paths = {
        "rclone": (RCLONE_DIR, f"{remote_path}"),
        "keys": (KEYS_DIR, f"{remote_path}/keys"),
        "batch": (BATCH_DIR, f"{remote_path}/batch"),
        "scripts": (SCRIPTS_DIR, f"{remote_path}/scripts"),
    }
    
    for ftype in file_types:
        if ftype not in type_paths:
            continue
            
        local_dir, remote_dir = type_paths[ftype]
        
        if not os.path.exists(local_dir) or not os.listdir(local_dir):
            continue
        
        # Build rsync command
        rsync_cmd = ['rsync', '-avz']
        if dry_run:
            rsync_cmd.append('--dry-run')
        
        # Add SSH options if not using alias
        if not server.get('alias'):
            ssh_opts = []
            if server.get('key_path'):
                ssh_opts.append(f"-i {os.path.expanduser(server['key_path'])}")
            if server.get('port') and server['port'] != 22:
                ssh_opts.append(f"-p {server['port']}")
            if ssh_opts:
                rsync_cmd.extend(['-e', f"ssh {' '.join(ssh_opts)}"])
        
        rsync_cmd.extend([
            f"{local_dir}/",
            f"{ssh_dest}:{remote_dir}/"
        ])
        
        try:
            result = subprocess.run(rsync_cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                results["files_pushed"].append({
                    "type": ftype,
                    "local": local_dir,
                    "remote": remote_dir,
                    "output": result.stdout[:500] if result.stdout else "OK"
                })
            else:
                results["errors"].append({
                    "type": ftype,
                    "error": result.stderr[:200]
                })
        except subprocess.TimeoutExpired:
            results["errors"].append({
                "type": ftype,
                "error": "Rsync timed out"
            })
        except Exception as e:
            results["errors"].append({
                "type": ftype,
                "error": str(e)
            })
    
    # Handle cron separately - deploy to crontab
    if "cron" in file_types and not dry_run:
        content, source = get_crontab_for_server(server.get('id', ''))
        if content:
            cron_result = deploy_crontab(server, content)
            if cron_result["status"] == "ok":
                results["files_pushed"].append({
                    "type": "cron",
                    "source": source,
                    "output": "Crontab deployed"
                })
            else:
                results["errors"].append({
                    "type": "cron",
                    "error": cron_result["message"]
                })
    
    results["success"] = len(results["errors"]) == 0
    return results


def full_server_verify(server: Dict[str, Any]) -> Dict[str, Any]:
    """
    Complete verification of a remote server.
    Combines rclone, mounts, files, and batch status checks.
    """
    results = {
        "server_id": server.get('id'),
        "server_name": server.get('name'),
        "connected": False
    }
    
    # Test basic connectivity first
    ssh_result = run_ssh_command(server, "echo 'OK'", timeout=10)
    if not ssh_result.get('success') or 'OK' not in ssh_result.get('stdout', ''):
        results["status"] = "connection_failed"
        results["message"] = ssh_result.get('error', 'SSH connection failed')
        return results
    
    results["connected"] = True
    
    # Run all checks
    results["rclone"] = verify_remote_rclone(server)
    results["mounts"] = verify_remote_mounts(server)
    results["files"] = verify_remote_files(server)
    results["batch"] = check_batch_running(server)
    results["cron"] = get_remote_crontab(server)
    
    results["status"] = "ok"
    return results


# Directory for pulled backups
PULLED_DIR = os.path.join(BASE_DIR, "pulled_backups")


def pull_files_from_server(
    server: Dict[str, Any],
    file_types: List[str],
    backup_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Pull files from a remote server to local backup directory.
    
    Args:
        server: Server config dict
        file_types: List of types to pull: 'rclone', 'keys', 'batch', 'scripts', 'cron'
        backup_name: Optional name for backup folder, defaults to server name + timestamp
    
    Returns:
        Dict with results
    """
    import time
    
    remote_path = server.get('remote_path', '~/isync')
    server_id = server.get('id', 'unknown')
    server_name = server.get('name', 'unknown')
    
    # Create backup directory
    if not backup_name:
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        backup_name = f"{server_name}_{timestamp}"
    
    backup_dir = os.path.join(PULLED_DIR, backup_name)
    os.makedirs(backup_dir, exist_ok=True)
    
    # Build SSH source
    if server.get('alias'):
        ssh_src = server['alias']
    else:
        ssh_src = server.get('host', '')
        if server.get('user'):
            ssh_src = f"{server['user']}@{ssh_src}"
    
    results = {
        "server_id": server_id,
        "server_name": server_name,
        "backup_name": backup_name,
        "backup_dir": backup_dir,
        "files_pulled": [],
        "errors": []
    }
    
    # Map file types to remote and local paths
    type_paths = {
        "rclone": (f"{remote_path}/rclone.conf", os.path.join(backup_dir, "rclone")),
        "keys": (f"{remote_path}/keys/", os.path.join(backup_dir, "keys")),
        "batch": (f"{remote_path}/batch/", os.path.join(backup_dir, "batch")),
        "scripts": (f"{remote_path}/scripts/", os.path.join(backup_dir, "scripts")),
    }
    
    for ftype in file_types:
        if ftype not in type_paths and ftype != "cron":
            continue
        
        if ftype == "cron":
            # Pull crontab content directly
            cron_result = get_remote_crontab(server)
            if cron_result.get("has_crontab"):
                cron_dir = os.path.join(backup_dir, "cron")
                os.makedirs(cron_dir, exist_ok=True)
                cron_file = os.path.join(cron_dir, "crontab.txt")
                try:
                    with open(cron_file, 'w') as f:
                        f.write(cron_result.get("content", ""))
                    results["files_pulled"].append({
                        "type": "cron",
                        "local": cron_file,
                        "output": "Crontab saved"
                    })
                except Exception as e:
                    results["errors"].append({
                        "type": "cron",
                        "error": str(e)
                    })
            continue
        
        remote_src, local_dest = type_paths[ftype]
        os.makedirs(local_dest, exist_ok=True)
        
        # Build rsync command
        rsync_cmd = ['rsync', '-avz']
        
        # Add SSH options if not using alias
        if not server.get('alias'):
            ssh_opts = []
            if server.get('key_path'):
                ssh_opts.append(f"-i {os.path.expanduser(server['key_path'])}")
            if server.get('port') and server['port'] != 22:
                ssh_opts.append(f"-p {server['port']}")
            if ssh_opts:
                rsync_cmd.extend(['-e', f"ssh {' '.join(ssh_opts)}"])
        
        rsync_cmd.extend([
            f"{ssh_src}:{remote_src}",
            f"{local_dest}/"
        ])
        
        try:
            result = subprocess.run(rsync_cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                results["files_pulled"].append({
                    "type": ftype,
                    "remote": remote_src,
                    "local": local_dest,
                    "output": result.stdout[:300] if result.stdout else "OK"
                })
            else:
                # Check if it's just "file not found" which is okay
                if "No such file" in result.stderr or "does not exist" in result.stderr.lower():
                    results["files_pulled"].append({
                        "type": ftype,
                        "remote": remote_src,
                        "local": local_dest,
                        "output": "No files to pull"
                    })
                else:
                    results["errors"].append({
                        "type": ftype,
                        "error": result.stderr[:200]
                    })
        except subprocess.TimeoutExpired:
            results["errors"].append({
                "type": ftype,
                "error": "Rsync timed out"
            })
        except Exception as e:
            results["errors"].append({
                "type": ftype,
                "error": str(e)
            })
    
    results["success"] = len(results["errors"]) == 0
    return results


def list_pulled_backups() -> List[Dict[str, Any]]:
    """List all pulled backups."""
    if not os.path.exists(PULLED_DIR):
        return []
    
    backups = []
    for name in os.listdir(PULLED_DIR):
        path = os.path.join(PULLED_DIR, name)
        if os.path.isdir(path):
            stat = os.stat(path)
            # Count files
            file_count = sum(len(files) for _, _, files in os.walk(path))
            backups.append({
                "name": name,
                "path": path,
                "modified": stat.st_mtime,
                "file_count": file_count
            })
    
    backups.sort(key=lambda x: x['modified'], reverse=True)
    return backups

