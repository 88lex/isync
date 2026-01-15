"""
Drive Manager Module
Provides utilities for creating Google Shared Drives and rclone remotes.
Supports two methods:
  - fclone: Uses fclone CLI (rclone fork with add-drive)
  - google_api: Uses Google Drive API directly (requires DWD)
"""
import subprocess
import asyncio
import logging
import re
from typing import Dict, Any, List, Optional, Literal

logger = logging.getLogger("uvicorn")

# Method type
DriveMethod = Literal["fclone", "google_api"]



def run_command(cmd: List[str], timeout: int = 60) -> Dict[str, Any]:
    """Run a shell command and return output."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Command timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def create_shared_drives(
    gdrive_remote: str,
    member_template: str,
    base_name: str,
    suffixes: List[str],
    delay_seconds: int = 10
) -> Dict[str, Any]:
    """
    Create new Shared Drives using fclone.
    
    Args:
        gdrive_remote: Auth remote with admin permissions (e.g., "gdriveO:")
        member_template: Existing drive to copy permissions from (e.g., "00-movies:")
        base_name: Base name for new drives (e.g., "fcl")
        suffixes: List of suffixes (e.g., ["-0010", "-0020"])
        delay_seconds: Delay between drive creations to avoid rate limits
    
    Returns:
        Dict with created drives and any errors
    """
    results = {
        "status": "ok",
        "created": [],
        "failed": [],
        "logs": []
    }
    
    # Ensure remote has colon
    if not gdrive_remote.endswith(":"):
        gdrive_remote += ":"
    if member_template and not member_template.endswith(":"):
        member_template += ":"
    
    for suffix in suffixes:
        drive_name = f"{base_name}{suffix}"
        results["logs"].append(f"Creating Shared Drive: {drive_name}")
        
        # Build fclone command
        cmd = ["fclone", "backend", "add-drive", gdrive_remote, drive_name, "--tpslimit=1"]
        if member_template:
            cmd.extend(["-o", f"copy-members={member_template}"])
        
        result = run_command(cmd, timeout=120)
        
        if result["status"] == "ok":
            results["created"].append(drive_name)
            results["logs"].append(f"  ✓ Created: {drive_name}")
            # Try to extract drive ID from output
            if result.get("stdout"):
                results["logs"].append(f"  Output: {result['stdout'].strip()}")
        else:
            error_msg = result.get("stderr", result.get("message", "Unknown error"))
            results["failed"].append({"name": drive_name, "error": error_msg})
            results["logs"].append(f"  ✗ Failed: {drive_name} - {error_msg}")
        
        # Delay between creations (except after last one)
        if suffix != suffixes[-1]:
            results["logs"].append(f"  Waiting {delay_seconds}s...")
            await asyncio.sleep(delay_seconds)
    
    if results["failed"]:
        results["status"] = "partial" if results["created"] else "error"
    
    return results


async def list_drives(gdrive_remote: str, prefix: Optional[str] = None) -> Dict[str, Any]:
    """
    List Shared Drives available to an account.
    
    Args:
        gdrive_remote: Auth remote (e.g., "gdriveO:")
        prefix: Optional prefix to filter results
    
    Returns:
        Dict with list of drives
    """
    if not gdrive_remote.endswith(":"):
        gdrive_remote += ":"
    
    # Use fclone lsdrives for parseable output
    cmd = ["fclone", "backend", "lsdrives", gdrive_remote]
    result = run_command(cmd, timeout=60)
    
    if result["status"] != "ok":
        return {
            "status": "error",
            "message": result.get("stderr", result.get("message", "Failed to list drives")),
            "drives": []
        }
    
    # Parse output - format is: name\tid
    drives = []
    for line in result["stdout"].strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            name, drive_id = parts[0], parts[1]
            if prefix is None or name.startswith(prefix):
                drives.append({"name": name, "id": drive_id})
    
    return {
        "status": "ok",
        "drives": drives,
        "count": len(drives)
    }


async def create_rclone_remotes(
    remotes: List[Dict[str, str]],
    sa_dir: str,
    start_count: int = 1
) -> Dict[str, Any]:
    """
    Create rclone remotes for Shared Drives.
    
    Args:
        remotes: List of dicts with 'name' and 'team_drive_id'
        sa_dir: Directory containing service account JSON files
        start_count: Starting number for SA file rotation
    
    Returns:
        Dict with created remotes and any errors
    """
    results = {
        "status": "ok",
        "created": [],
        "failed": [],
        "logs": []
    }
    
    count = start_count
    for remote in remotes:
        name = remote.get("name")
        team_drive_id = remote.get("team_drive_id")
        
        if not name or not team_drive_id:
            results["failed"].append({"name": name, "error": "Missing name or team_drive_id"})
            continue
        
        # Remove trailing colon if present
        name = name.rstrip(":")
        
        sa_file = f"{sa_dir}/{count}.json"
        
        cmd = [
            "rclone", "config", "create", name, "drive",
            "scope", "drive",
            "team_drive", team_drive_id,
            "service_account_file", sa_file
        ]
        
        results["logs"].append(f"Creating remote: {name} -> {team_drive_id}")
        result = run_command(cmd, timeout=30)
        
        if result["status"] == "ok":
            results["created"].append(name)
            results["logs"].append(f"  ✓ Created: {name}")
        else:
            error_msg = result.get("stderr", result.get("message", "Unknown error"))
            results["failed"].append({"name": name, "error": error_msg})
            results["logs"].append(f"  ✗ Failed: {name} - {error_msg}")
        
        count += 1
    
    if results["failed"]:
        results["status"] = "partial" if results["created"] else "error"
    
    return results


async def create_union_remote(
    name: str,
    upstreams: List[str],
    action_policy: str = "rand",
    create_policy: str = "eprand",
    sa_file_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create an rclone union remote.
    
    Args:
        name: Name for the union remote
        upstreams: List of upstream remote names
        action_policy: Policy for actions (default: rand)
        create_policy: Policy for file creation (default: eprand)
        sa_file_path: Optional service account file path
    
    Returns:
        Dict with result
    """
    # Remove trailing colon if present
    name = name.rstrip(":")
    
    # Build upstreams string: "remote1: remote2: remote3: "
    upstreams_str = " ".join(f"{u.rstrip(':')}:" for u in upstreams) + " "
    
    cmd = [
        "fclone", "config", "create", name, "union",
        "upstreams", upstreams_str,
        "action_policy", action_policy,
        "create_policy", create_policy
    ]
    
    if sa_file_path:
        cmd.extend(["service_account_file_path", sa_file_path])
    
    result = run_command(cmd, timeout=30)
    
    if result["status"] == "ok":
        return {
            "status": "ok",
            "name": name,
            "upstreams": upstreams,
            "message": f"Union remote '{name}' created successfully"
        }
    else:
        return {
            "status": "error",
            "name": name,
            "message": result.get("stderr", result.get("message", "Failed to create union remote"))
        }


def generate_suffixes(
    start: int,
    count: int,
    increment: int = 10,
    padding: int = 4,
    prefix: str = "-"
) -> List[str]:
    """
    Generate numerical suffixes for drive names.
    
    Args:
        start: Starting number (e.g., 10)
        count: How many suffixes to generate
        increment: Gap between numbers (e.g., 10)
        padding: Zero-padding width (e.g., 4 for "0010")
        prefix: Prefix before number (e.g., "-")
    
    Returns:
        List of suffixes like ["-0010", "-0020", "-0030"]
    """
    suffixes = []
    for i in range(count):
        num = start + (i * increment)
        suffixes.append(f"{prefix}{str(num).zfill(padding)}")
    return suffixes


# --- Unified Interface ---

async def create_drives_unified(
    method: DriveMethod,
    base_name: str,
    suffixes: List[str],
    delay_seconds: int = 10,
    # fclone-specific
    gdrive_remote: Optional[str] = None,
    member_template: Optional[str] = None,
    # google_api-specific
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Unified function to create Shared Drives using either fclone or Google API.
    
    Args:
        method: "fclone" or "google_api"
        base_name: Base name for drives
        suffixes: List of suffixes
        delay_seconds: Delay between creations
        
        For fclone method:
            gdrive_remote: Auth remote (e.g., "gdriveO:")
            member_template: Drive to copy permissions from
        
        For google_api method:
            service_account_file: Path to SA JSON
            impersonate_email: Admin email to impersonate (DWD required)
    
    Returns:
        Dict with created drives and any errors
    """
    if method == "fclone":
        if not gdrive_remote:
            return {"status": "error", "message": "gdrive_remote required for fclone method"}
        
        result = await create_shared_drives(
            gdrive_remote=gdrive_remote,
            member_template=member_template or "",
            base_name=base_name,
            suffixes=suffixes,
            delay_seconds=delay_seconds
        )
        result["method"] = "fclone"
        return result
    
    elif method == "google_api":
        if not service_account_file or not impersonate_email:
            return {"status": "error", "message": "service_account_file and impersonate_email required for google_api method"}
        
        try:
            from backend.google_drive_api import create_shared_drives_api, GOOGLE_API_AVAILABLE
            
            if not GOOGLE_API_AVAILABLE:
                return {
                    "status": "error",
                    "message": "Google API libraries not installed. Run: pip install google-api-python-client google-auth"
                }
            
            return await create_shared_drives_api(
                service_account_file=service_account_file,
                impersonate_email=impersonate_email,
                base_name=base_name,
                suffixes=suffixes,
                delay_seconds=delay_seconds
            )
        except ImportError as e:
            return {"status": "error", "message": f"Failed to import google_drive_api: {e}"}
    
    else:
        return {"status": "error", "message": f"Unknown method: {method}"}


async def list_drives_unified(
    method: DriveMethod,
    prefix: Optional[str] = None,
    # fclone-specific
    gdrive_remote: Optional[str] = None,
    # google_api-specific
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Unified function to list Shared Drives using either fclone or Google API.
    """
    if method == "fclone":
        if not gdrive_remote:
            return {"status": "error", "message": "gdrive_remote required for fclone method", "drives": []}
        
        result = await list_drives(gdrive_remote, prefix)
        result["method"] = "fclone"
        return result
    
    elif method == "google_api":
        if not service_account_file or not impersonate_email:
            return {"status": "error", "message": "service_account_file and impersonate_email required", "drives": []}
        
        try:
            from backend.google_drive_api import list_shared_drives_api, GOOGLE_API_AVAILABLE
            
            if not GOOGLE_API_AVAILABLE:
                return {"status": "error", "message": "Google API libraries not installed", "drives": []}
            
            return await list_shared_drives_api(
                service_account_file=service_account_file,
                impersonate_email=impersonate_email,
                prefix=prefix
            )
        except ImportError as e:
            return {"status": "error", "message": str(e), "drives": []}
    
    return {"status": "error", "message": f"Unknown method: {method}", "drives": []}


def check_methods_available() -> Dict[str, Any]:
    """Check which drive creation methods are available."""
    import shutil
    
    # Check fclone
    fclone_available = shutil.which("fclone") is not None
    
    # Check Google API
    try:
        from backend.google_drive_api import GOOGLE_API_AVAILABLE
        google_api_available = GOOGLE_API_AVAILABLE
    except ImportError:
        google_api_available = False
    
    return {
        "fclone": {
            "available": fclone_available,
            "message": "fclone installed" if fclone_available else "fclone not found in PATH"
        },
        "google_api": {
            "available": google_api_available,
            "message": "Google API ready" if google_api_available else "Install: pip install google-api-python-client google-auth"
        }
    }
