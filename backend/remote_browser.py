"""
Remote Browser Module
Provides utilities for browsing remote server folders and rclone configurations.
"""
import subprocess
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("uvicorn")


def build_ssh_command(server: Dict[str, Any]) -> List[str]:
    """Build SSH command from server config."""
    if server.get('alias'):
        return ['ssh', server['alias']]
    
    cmd = ['ssh']
    if server.get('key_path'):
        cmd.extend(['-i', server['key_path']])
    if server.get('port') and server['port'] != 22:
        cmd.extend(['-p', str(server['port'])])
    
    host = server.get('host', '')
    if server.get('user'):
        host = f"{server['user']}@{host}"
    cmd.append(host)
    
    return cmd


def run_ssh_command(server: Optional[Dict[str, Any]], remote_cmd: str, timeout: int = 30) -> Dict[str, Any]:
    """Run a command on remote server via SSH, or locally if server is None/'local'."""
    try:
        if not server or server.get('id') == 'local':
            # Local execution
            # cmd needs to be list for subprocess.run if not shell=True
            # But remote_cmd is string (e.g. "find / ...").
            # We use shell=True for local complex commands
            result = subprocess.run(
                remote_cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                executable='/bin/bash' # Ensure bash
            )
        else:
            # Remote SSH
            ssh_cmd = build_ssh_command(server)
            ssh_cmd.append(remote_cmd)
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


def list_remote_folders(server: Optional[Dict[str, Any]], path: str = "/", depth: int = 2) -> Dict[str, Any]:
    """
    List folders on a remote server via SSH.
    
    Args:
        server: Server config dict
        path: Base path to list (e.g. /zmedia)
        depth: How many levels deep to traverse (1 or 2)
    
    Returns:
        Dict with tree structure of folders
    """
    # Sanitize inputs
    path = path.strip()
    if not path.startswith('/'):
        path = '/' + path
    depth = max(1, min(depth, 3))  # Limit depth to 1-3
    
    # Use find to get directories up to N levels deep
    cmd = f"find {path} -maxdepth {depth} -type d 2>/dev/null | head -200 | sort"
    
    result = run_ssh_command(server, cmd, timeout=20)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'SSH command failed'),
            "folders": []
        }
    
    # Parse output into folder list
    lines = result.get('stdout', '').strip().split('\n')
    folders = [line.strip() for line in lines if line.strip() and line.strip().startswith('/')]
    
    # Build tree structure
    tree = build_folder_tree(folders, path)
    
    return {
        "status": "ok",
        "base_path": path,
        "depth": depth,
        "folders": folders,
        "tree": tree,
        "count": len(folders)
    }


def build_folder_tree(folders: List[str], base_path: str) -> List[Dict]:
    """Convert flat folder list into nested tree structure."""
    tree = []
    base_depth = base_path.rstrip('/').count('/')
    
    for folder in folders:
        if folder == base_path.rstrip('/'):
            continue
        
        folder_depth = folder.rstrip('/').count('/')
        relative_depth = folder_depth - base_depth
        
        # Get folder name (last component)
        name = folder.rstrip('/').split('/')[-1]
        
        tree.append({
            "path": folder,
            "name": name,
            "depth": relative_depth
        })
    
    return tree


def list_rclone_remotes(server: Dict[str, Any]) -> Dict[str, Any]:
    """
    List rclone remotes configured on a remote server.
    
    Returns:
        Dict with list of remote names and types
    """
    # Get remotes list with their types
    cmd = """
        which rclone >/dev/null 2>&1 || (echo 'RCLONE_NOT_FOUND' && exit 1);
        rclone listremotes --long 2>/dev/null || rclone listremotes 2>/dev/null;
    """
    
    result = run_ssh_command(server, cmd, timeout=15)
    
    if not result.get('success') or 'RCLONE_NOT_FOUND' in result.get('stdout', ''):
        return {
            "status": "error",
            "message": "rclone not found on server",
            "remotes": []
        }
    
    # Parse output - format is "remotename:" or "remotename: type"
    lines = result.get('stdout', '').strip().split('\n')
    remotes = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Parse "name: type" or just "name:"
        if ':' in line:
            parts = line.split(':', 1)
            name = parts[0].strip()
            remote_type = parts[1].strip() if len(parts) > 1 and parts[1].strip() else 'unknown'
            
            remotes.append({
                "name": name,
                "type": remote_type
            })
    
    return {
        "status": "ok",
        "remotes": remotes,
        "count": len(remotes)
    }


def list_shared_drives(server: Dict[str, Any], remote_name: str) -> Dict[str, Any]:
    """
    List Shared Drives (Team Drives) for a Google Drive rclone remote.
    
    Args:
        server: Server config dict
        remote_name: Name of the rclone remote (without colon)
    
    Returns:
        Dict with list of Shared Drives
    """
    # Use rclone backend drives command to list Shared Drives
    cmd = f"rclone backend drives {remote_name}: 2>/dev/null | head -50"
    
    result = run_ssh_command(server, cmd, timeout=30)
    
    if not result.get('success'):
        # Try alternative: list root with --drive-shared-with-me
        return {
            "status": "error",
            "message": "Could not list Shared Drives",
            "drives": []
        }
    
    # Parse JSON output from rclone backend drives
    import json
    try:
        stdout = result.get('stdout', '').strip()
        if stdout:
            drives_data = json.loads(stdout)
            drives = []
            for drive in drives_data:
                drives.append({
                    "id": drive.get('id', ''),
                    "name": drive.get('name', 'Unknown'),
                    "kind": drive.get('kind', '')
                })
            return {
                "status": "ok",
                "drives": drives,
                "count": len(drives)
            }
    except json.JSONDecodeError:
        pass
    
    return {
        "status": "ok",
        "drives": [],
        "count": 0,
        "message": "No Shared Drives found or unable to parse"
    }


def list_remote_path(server: Dict[str, Any], remote_name: str, path: str = "") -> Dict[str, Any]:
    """
    List contents of an rclone remote path.
    
    Args:
        server: Server config dict
        remote_name: Name of the rclone remote
        path: Path within the remote (optional)
    
    Returns:
        Dict with list of folders/files
    """
    remote_path = f"{remote_name}:{path}" if path else f"{remote_name}:"
    cmd = f"rclone lsd {remote_path} 2>/dev/null | head -100"
    
    result = run_ssh_command(server, cmd, timeout=30)
    
    if not result.get('success'):
        return {
            "status": "error",
            "message": result.get('error', 'Failed to list remote'),
            "items": []
        }
    
    # Parse lsd output: "     -1 2024-01-01 00:00:00        -1 FolderName"
    lines = result.get('stdout', '').strip().split('\n')
    items = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Extract folder name (last column)
        parts = line.split()
        if len(parts) >= 4:
            folder_name = ' '.join(parts[4:])  # In case folder name has spaces
            items.append({
                "name": folder_name,
                "type": "directory"
            })
    
    return {
        "status": "ok",
        "remote": remote_name,
        "path": path,
        "items": items,
        "count": len(items)
    }
