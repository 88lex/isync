"""
SSH Transfer Utilities
Optimized file transfer functions using rsync and connection pooling.
"""
import os
import subprocess
import tempfile
from typing import List, Optional, Dict
from concurrent.futures import ThreadPoolExecutor, as_completed

from backend.logging_config import get_logger

logger = get_logger("isync.ssh_transfer")


def build_ssh_options(key_path: Optional[str] = None, timeout: int = 30) -> List[str]:
    """Build common SSH options for connection reuse and speed."""
    opts = [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=yes",
        "-o", "Compression=yes",  # Enable compression for faster transfer of text files
    ]
    if key_path:
        opts.extend(["-i", key_path])
    return opts


def build_rsync_options(key_path: Optional[str] = None) -> List[str]:
    """Build rsync options for fast, compressed transfers."""
    ssh_opts = " ".join(build_ssh_options(key_path))
    return [
        "-avz",  # Archive mode, verbose, compress
        "--compress-level=9",  # Maximum compression
        "--progress",
        "-e", f"ssh {ssh_opts}",
    ]


def rsync_push_files(
    local_paths: List[str],
    remote_host: str,
    remote_dir: str,
    user: Optional[str] = None,
    key_path: Optional[str] = None,
    timeout: int = 120
) -> Dict:
    """
    Push multiple local files to a remote directory using rsync.
    Much faster than individual scp calls due to:
    - Single SSH connection for all files
    - Delta transfer (only changed bytes)
    - Compression
    """
    if not local_paths:
        return {"status": "error", "message": "No files to push"}
    
    # Build remote target
    target = f"{user}@{remote_host}" if user else remote_host
    remote_target = f"{target}:{remote_dir}/"
    
    # Build rsync command
    cmd = ["rsync"] + build_rsync_options(key_path)
    
    # Create a temp file list for rsync --files-from
    # This is more efficient for many scattered files
    existing_files = [p for p in local_paths if os.path.exists(p)]
    
    if not existing_files:
        return {"status": "error", "message": "None of the specified files exist locally"}
    
    cmd.extend(existing_files)
    cmd.append(remote_target)
    
    logger.info(f"[rsync_push] Pushing {len(existing_files)} files to {remote_target}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.returncode == 0:
            return {
                "status": "success",
                "files_pushed": len(existing_files),
                "stdout": result.stdout[-500:] if len(result.stdout) > 500 else result.stdout,
                "target": remote_target
            }
        else:
            return {
                "status": "error",
                "message": result.stderr.strip(),
                "returncode": result.returncode
            }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": f"Timeout after {timeout}s"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def rsync_push_directory(
    local_dir: str,
    remote_host: str,
    remote_dir: str,
    user: Optional[str] = None,
    key_path: Optional[str] = None,
    include_patterns: Optional[List[str]] = None,
    exclude_patterns: Optional[List[str]] = None,
    timeout: int = 300
) -> Dict:
    """
    Push an entire directory to remote using rsync.
    Supports include/exclude patterns for filtering.
    """
    if not os.path.isdir(local_dir):
        return {"status": "error", "message": f"Local directory not found: {local_dir}"}
    
    target = f"{user}@{remote_host}" if user else remote_host
    remote_target = f"{target}:{remote_dir}/"
    
    cmd = ["rsync"] + build_rsync_options(key_path)
    
    # Add include patterns
    if include_patterns:
        for pattern in include_patterns:
            cmd.extend(["--include", pattern])
    
    # Add exclude patterns
    if exclude_patterns:
        for pattern in exclude_patterns:
            cmd.extend(["--exclude", pattern])
    
    # Ensure trailing slash on source for correct rsync behavior
    source = local_dir.rstrip('/') + '/'
    cmd.extend([source, remote_target])
    
    logger.info(f"[rsync_push_dir] Syncing {source} -> {remote_target}")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        
        if result.returncode == 0:
            # Parse rsync output for stats
            lines = result.stdout.strip().split('\n')
            return {
                "status": "success",
                "source": source,
                "target": remote_target,
                "output_lines": len(lines)
            }
        else:
            return {"status": "error", "message": result.stderr.strip()}
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": f"Timeout after {timeout}s"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def parallel_push_to_servers(
    local_paths: List[str],
    servers: List[Dict],
    remote_subdir: str,
    max_workers: int = 4
) -> Dict:
    """
    Push files to multiple servers in parallel.
    Each server gets its own rsync connection.
    """
    results = {}
    
    def push_to_server(server: Dict) -> tuple:
        server_id = server.get('id', 'unknown')
        host = server.get('alias') or server.get('host')
        user = server.get('user')
        key_path = server.get('key_path')
        remote_base = server.get('remote_path', '/opt/isync')
        remote_dir = f"{remote_base}/{remote_subdir}"
        
        result = rsync_push_files(
            local_paths=local_paths,
            remote_host=host,
            remote_dir=remote_dir,
            user=user,
            key_path=key_path
        )
        return (server_id, result)
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(push_to_server, s): s for s in servers}
        
        for future in as_completed(futures):
            server_id, result = future.result()
            results[server_id] = result
    
    success_count = sum(1 for r in results.values() if r.get('status') == 'success')
    
    return {
        "results": results,
        "total_servers": len(servers),
        "success_count": success_count,
        "failed_count": len(servers) - success_count
    }


def ensure_remote_directory(
    remote_host: str,
    remote_dir: str,
    user: Optional[str] = None,
    key_path: Optional[str] = None
) -> bool:
    """Ensure a remote directory exists, creating it if necessary."""
    target = f"{user}@{remote_host}" if user else remote_host
    
    ssh_cmd = ["ssh"] + build_ssh_options(key_path)
    ssh_cmd.append(target)
    ssh_cmd.append(f"mkdir -p {remote_dir}")
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            # Try with sudo
            ssh_cmd[-1] = f"sudo mkdir -p {remote_dir} && sudo chown -R $(whoami) {remote_dir}"
            result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
        return result.returncode == 0
    except Exception:
        return False
