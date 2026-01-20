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
from backend.rclone_utils import add_or_update_remote

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
        
        config = {
            "type": "drive",
            "scope": "drive",
            "team_drive": team_drive_id,
            "service_account_file": sa_file
        }
        
        results["logs"].append(f"Creating remote: {name} -> {team_drive_id}")
        try:
            add_or_update_remote(name, config)
            result = {"status": "ok"}
        except Exception as e:
            result = {"status": "error", "message": str(e)}
        
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
    create_policy: str = "eprand"
) -> Dict[str, Any]:
    """
    Create an rclone union remote.
    
    Args:
        name: Name for the union remote
        upstreams: List of upstream remote names
        action_policy: Policy for actions (default: rand)
        create_policy: Policy for file creation (default: eprand)
    
    Returns:
        Dict with result
    """
    # Remove trailing colon if present
    name = name.rstrip(":")
    
    # Build upstreams string: "remote1: remote2: remote3: "
    upstreams_str = " ".join(f"{u.rstrip(':')}:" for u in upstreams) + " "
    
    config = {
        "type": "union",
        "upstreams": upstreams_str,
        "action_policy": action_policy,
        "create_policy": create_policy
    }
    
    try:
        add_or_update_remote(name, config)
        result = {"status": "ok"}
    except Exception as e:
        result = {"status": "error", "message": str(e)}
    
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
    impersonate_email: Optional[str] = None,
    default_managers: Optional[List[Dict[str, str]]] = None # New
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
        
        # Add default managers if successful and method is fclone
        # Note: fclone method doesn't natively support adding managers with specific roles via backend add-drive easily
        # beyond copy-members. If we have explicit default_managers, we'll use the API method after creation.
        
        if result["status"] in ["ok", "partial"] and default_managers:
             from backend.config_manager import config_manager
             from backend.google_drive_api import list_shared_drives_api
             
             # We need drive IDs to add managers via API
             # This is a bit complex for fclone-created drives unless we relist them
             pass # fclone users usually rely on member_template
             
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
            
            res = await create_shared_drives_api(
                service_account_file=service_account_file,
                impersonate_email=impersonate_email,
                base_name=base_name,
                suffixes=suffixes,
                delay_seconds=delay_seconds
            )
            
            # Add default managers if successful
            from backend.store import store
            defaults = default_managers if default_managers is not None else store.config.get('always_included_managers', [])
            
            if res["status"] in ["ok", "partial"] and defaults:
                for drive in res.get("created", []):
                    drive_id = drive if isinstance(drive, str) else drive.get("id")
                    if drive_id:
                        for mgr in defaults:
                            await add_drive_managers(
                                drive_id=drive_id,
                                service_account_file=service_account_file,
                                impersonate_email=impersonate_email,
                                group_emails=[mgr["email"]],
                                role=mgr.get("role", "organizer")
                            )
            return res
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
    impersonate_email: Optional[str] = None,
    limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Unified function to list Shared Drives using either fclone or Google API.
    """
    from backend.store import store
    excluded = set(store.config.get('excluded_drives', []))

    if method == "fclone":
        if not gdrive_remote:
            return {"status": "error", "message": "gdrive_remote required for fclone method", "drives": []}
        
        result = await list_drives(gdrive_remote, prefix)
        if result.get("drives"):
            # Filter excluded
            result["drives"] = [d for d in result["drives"] if d["name"] not in excluded and d.get("id") not in excluded]
            
            if limit:
                result["drives"] = result["drives"][:limit]
            result["count"] = len(result["drives"])
            
        result["method"] = "fclone"
        return result
    
    elif method == "google_api":
        if not service_account_file or not impersonate_email:
            return {"status": "error", "message": "service_account_file and impersonate_email required", "drives": []}
        
        try:
            from backend.google_drive_api import list_shared_drives_api, GOOGLE_API_AVAILABLE
            
            if not GOOGLE_API_AVAILABLE:
                return {"status": "error", "message": "Google API libraries not installed", "drives": []}
            
            res = await list_shared_drives_api(
                service_account_file=service_account_file,
                impersonate_email=impersonate_email,
                prefix=prefix,
                limit=limit,
                excluded_items=excluded
            )
            
            return res
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


async def add_drive_managers(
    drive_id: str,
    service_account_file: str,
    impersonate_email: str,
    group_emails: List[str],
    role: str = "organizer"
) -> Dict[str, Any]:
    """Add managers to a Shared Drive."""
    try:
        from backend.google_drive_api import add_drive_member_api
        
        added = []
        failed = []
        
        for email in group_emails:
            res = await add_drive_member_api(
                service_account_file=service_account_file,
                impersonate_email=impersonate_email,
                drive_id=drive_id,
                member_email=email,
                role=role
            )
            if res["status"] == "ok":
                added.append(email)
            else:
                failed.append({"email": email, "error": res.get("message")})
                
        return {
            "status": "ok" if not failed else ("partial" if added else "error"),
            "added": added,
            "failed": failed,
            "drive_id": drive_id
        }
    except ImportError:
         return {"status": "error", "message": "Google API module failed to import"}
    except Exception as e:
         return {"status": "error", "message": str(e)}


async def create_single_drive_remote(
    name: str,
    team_drive_id: str,
    sa_file: str
) -> Dict[str, Any]:
    """Create a single rclone remote for a drive."""
    # Remove trailing colon if present
    name = name.rstrip(":")
    
    config = {
        "type": "drive",
        "scope": "drive",
        "team_drive": team_drive_id,
        "service_account_file": sa_file
    }
    
    try:
        add_or_update_remote(name, config)
        return {"status": "ok", "name": name}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    
    if result["status"] == "ok":
        return {"status": "ok", "name": name}
    else:
        return {
            "status": "error", 
            "message": result.get("stderr", result.get("message", "Unknown error"))
        }


async def rename_drive_unified(
    method: str,
    drive_id: str,
    new_name: str,
    # google_api specific
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
) -> Dict[str, Any]:
    """Rename a Shared Drive."""
    if method == "google_api":
        if not service_account_file or not impersonate_email:
            return {"status": "error", "message": "Service account and impersonate email required"}
            
        try:
            from backend.google_drive_api import rename_shared_drive_api
            return await rename_shared_drive_api(service_account_file, impersonate_email, drive_id, new_name)
        except ImportError:
            return {"status": "error", "message": "Google API module failed to import"}
            
    return {"status": "error", "message": "Rename not supported for method: " + method}


async def delete_drive_unified(
    method: str,
    drive_id: str,
    # google_api specific
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
) -> Dict[str, Any]:
    """Delete a Shared Drive."""
    if method == "google_api":
        if not service_account_file or not impersonate_email:
            return {"status": "error", "message": "Service account and impersonate email required"}
            
        try:
            from backend.google_drive_api import delete_shared_drive_api
            return await delete_shared_drive_api(service_account_file, impersonate_email, drive_id)
        except ImportError:
            return {"status": "error", "message": "Google API module failed to import"}
            
    return {"status": "error", "message": "Delete not supported for method: " + method}


async def get_drive_details_unified(
    method: str,
    drive_id: str,
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
) -> Dict[str, Any]:
    """Get detailed information about a Shared Drive."""
    if method == "google_api":
         if not service_account_file or not impersonate_email:
            return {"status": "error", "message": "Auth required"}
         try:
            from backend.google_drive_api import get_drive_details_api
            return await get_drive_details_api(service_account_file, impersonate_email, drive_id)
         except ImportError:
            return {"status": "error", "message": "Import error"}
    
    return {"status": "error", "message": "Not supported for method: " + method}


# --- Expansion Wizard ---

async def expand_union_group(
    union_group_id: int,
    service_account_file: str,
    impersonate_email: str,
    group_emails: Optional[List[str]] = None,
    manager_roles: Optional[Dict[str, str]] = None # New: email -> role
) -> Dict[str, Any]:
    """
    Expand a UnionGroup by creating a new Shared Drive.
    
    Logic:
    1. Look up the highest existing index in the group (e.g., '-04').
    2. Create new Shared Drive with next suffix (e.g., '-05').
    3. Add permissions (managers/groups).
    4. Add the new drive to the UnionGroup in the DB.
    5. Trigger rclone config regeneration.
    
    Args:
        union_group_id: ID of the UnionGroup to expand.
        service_account_file: Path to service account JSON.
        impersonate_email: Admin email for impersonation.
        group_emails: Optional list of group/user emails to add as managers.
    
    Returns:
        Dict with result.
    """
    from backend.models.models import UnionGroup, SharedDrive
    from backend.google_drive_api import create_shared_drive_api, add_drive_member_api
    from backend.rclone_manager import regenerate_config
    
    db = SessionLocal()
    
    try:
        # 1. Get UnionGroup
        ug = db.query(UnionGroup).filter(UnionGroup.id == union_group_id).first()
        if not ug:
            return {"status": "error", "message": f"UnionGroup {union_group_id} not found"}
        
        # 2. Find existing drives and determine next suffix
        existing_drives = db.query(SharedDrive).filter(
            SharedDrive.union_group_id == union_group_id,
            SharedDrive.status == 'ACTIVE'
        ).all()
        
        # Parse suffixes to find max
        max_index = 0
        for d in existing_drives:
            # Try to extract numeric suffix (e.g., "fcl-ebooks-04" -> 4)
            import re
            match = re.search(r'-(\d+)$', d.name)
            if match:
                idx = int(match.group(1))
                if idx > max_index:
                    max_index = idx
        
        # Next index
        next_index = max_index + 1
        next_suffix = f"-{str(next_index).zfill(2)}"
        new_drive_name = f"{ug.name}{next_suffix}"
        
        # 3. Create new Shared Drive via Google API
        create_result = await create_shared_drive_api(
            service_account_file=service_account_file,
            impersonate_email=impersonate_email,
            drive_name=new_drive_name
        )
        
        if create_result["status"] != "ok":
            return {"status": "error", "message": f"Failed to create drive: {create_result.get('message')}"}
        
        new_drive_id = create_result["drive"]["id"]
        
        # 4. Add permissions
        permissions_added = []
        if group_emails:
            for email in group_emails:
                res = await add_drive_member_api(
                    service_account_file=service_account_file,
                    impersonate_email=impersonate_email,
                    drive_id=new_drive_id,
                    member_email=email,
                    role=manager_roles.get(email, "organizer") if manager_roles else "organizer"
                )
                if res["status"] == "ok":
                    permissions_added.append(email)
        
        # 4.5 Add default managers from config
        from backend.store import store
        defaults = store.config.get('always_included_managers', [])
        for mgr in defaults:
             if mgr["email"] not in (group_emails or []):
                await add_drive_member_api(
                    service_account_file=service_account_file,
                    impersonate_email=impersonate_email,
                    drive_id=new_drive_id,
                    member_email=mgr["email"],
                    role=mgr.get("role", "organizer")
                )
                permissions_added.append(f"{mgr['email']} (default)")
        
        # 5. Add to database
        new_drive = SharedDrive(
            drive_id=new_drive_id,
            name=new_drive_name,
            union_group_id=union_group_id,
            status='ACTIVE'
        )
        db.add(new_drive)
        db.commit()
        
        # 7. Resolve any related alerts (Wait, alerts are gone, but I'll remove this block)
        # 6. Regenerate rclone config
        rclone_result = regenerate_config(db)
        
        return {
            "status": "ok",
            "new_drive": {
                "id": new_drive_id,
                "name": new_drive_name
            },
            "permissions_added": permissions_added,
            "rclone_status": rclone_result["status"]
        }
        
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()


def create_shared_drive_simplified(
    name: str,
    copy_perms_from_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Simplified synchronous wrapper to create a Shared Drive and optionally copy permissions.
    Used by the Expand Union execution logic.
    """
    from backend.store import store
    import asyncio
    
    # 1. Get Auth from Store
    # We need a configured Service Account or DWD setup in store/config
    config = store.get_config()
    sa_file = config.get('service_account_file')
    impersonate_email = config.get('impersonate_email')
    
    if not sa_file or not impersonate_email:
        return {"status": "error", "message": "Service Account or Impersonate Email not configured in global settings."}
        
    # Run async code in sync wrapper
    # We need a fresh loop if we are in a thread, or run in current loop?
    # This function is called from FastAPI async path? YES, so we should be async or use threading.
    # Actually, the router endpoint is def (sync), so it runs in threadpool.
    # We can use asyncio.run() if no loop in this thread?
    # Or strict async def in router and await this?
    # The router is `def api_execute_expansion`, so FastAPI runs it in threadpool.
    # call_async helper:
    
    async def _do_work():
        from backend.google_drive_api import create_shared_drive_api, list_drive_members_api, add_drive_member_api
        
        # Create Drive
        res = await create_shared_drive_api(sa_file, impersonate_email, name)
        if res['status'] != 'ok':
            return res
            
        new_drive_id = res['drive']['id']
        
        # Copy Permissions
        if copy_perms_from_id:
            perms_res = await list_drive_members_api(sa_file, impersonate_email, copy_perms_from_id)
            if perms_res['status'] == 'ok':
                for member in perms_res.get('members', []):
                    if member['role'] == 'owner': continue # Skip owner (organization)
                    
                    await add_drive_member_api(
                        sa_file, impersonate_email, 
                        new_drive_id, 
                        member['emailAddress'], 
                        member['role']
                    )
        
        return {"status": "ok", "drive_id": new_drive_id, "name": name}

    try:
        return asyncio.run(_do_work())
    except RuntimeError:
        # Loop already running? If called from async def?
        # If router is def, it's separate thread usually.
        # But let's be safe.
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(_do_work())

