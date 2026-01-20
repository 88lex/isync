"""
Drives Router
API endpoints for Shared Drive and rclone remote management.
"""
from fastapi import APIRouter
from typing import Optional, List, Dict
import os

from backend.drive_manager import (
    create_shared_drives as dm_create_shared_drives,
    list_drives as dm_list_drives,
    create_rclone_remotes as dm_create_rclone_remotes,
    create_union_remote as dm_create_union_remote,
    generate_suffixes,
    create_drives_unified,
    list_drives_unified,
    check_methods_available
)
from backend.models.requests import (
    CreateDrivesRequest,
    CreateRemotesRequest,
    CreateUnionRequest,
    GenerateSuffixesRequest,
    CreateDrivesUnifiedRequest,
    ListDrivesUnifiedRequest,
    AddManagersRequest,
    CreateDriveRemoteRequest,
    RenameDriveRequest,
    DeleteDriveRequest
)

router = APIRouter(prefix="/api/drives", tags=["Drive Manager"])

# ... existing code ...

@router.post("/rename")
async def api_rename_drive(request: RenameDriveRequest):
    """Rename a Shared Drive."""
    from backend.drive_manager import rename_drive_unified
    result = await rename_drive_unified(
        method=request.method,
        drive_id=request.drive_id,
        new_name=request.new_name,
        service_account_file=request.service_account_file,
        impersonate_email=request.impersonate_email
    )
    return result


@router.delete("/{drive_id}")
async def api_delete_drive(
    drive_id: str, 
    method: str = "google_api",
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
):
    """Delete a Shared Drive."""
    from backend.drive_manager import delete_drive_unified
    # Delete requests typically don't have body in some clients, but here we can use query params or body.
    # Let's support DELETE method with query params.
    result = await delete_drive_unified(
        method=method,
        drive_id=drive_id,
        service_account_file=service_account_file,
        impersonate_email=impersonate_email
    )
    return result


@router.get("/{drive_id}/details")
async def api_get_drive_details(
    drive_id: str,
    method: str = "google_api",
    service_account_file: Optional[str] = None,
    impersonate_email: Optional[str] = None
):
    """Get detailed stats and permissions for a drive."""
    from backend.drive_manager import get_drive_details_unified
    return await get_drive_details_unified(method, drive_id, service_account_file, impersonate_email)

# Alternative POST endpoint for delete if body is needed (for robust params)
@router.post("/delete")
async def api_delete_drive_post(request: DeleteDriveRequest):
    """Delete a Shared Drive (POST)."""
    from backend.drive_manager import delete_drive_unified
    result = await delete_drive_unified(
        method=request.method,
        drive_id=request.drive_id,
        service_account_file=request.service_account_file,
        impersonate_email=request.impersonate_email
    )
    return result


@router.post("/shared")
async def api_create_shared_drives(request: CreateDrivesRequest):
    """Create new Shared Drives via fclone."""
    result = await dm_create_shared_drives(
        gdrive_remote=request.gdrive_remote,
        member_template=request.member_template,
        base_name=request.base_name,
        suffixes=request.suffixes,
        delay_seconds=request.delay_seconds
    )
    return result


@router.get("/list")
async def api_list_drives(gdrive_remote: str, prefix: Optional[str] = None):
    """List existing Shared Drives."""
    result = await dm_list_drives(gdrive_remote, prefix)
    return result


@router.post("/remotes")
async def api_create_rclone_remotes(request: CreateRemotesRequest):
    """Create rclone remotes for Shared Drives."""
    result = await dm_create_rclone_remotes(
        remotes=request.remotes,
        sa_dir=request.sa_dir,
        start_count=request.start_count
    )
    return result


@router.post("/union")
async def api_create_union_remote(request: CreateUnionRequest):
    """Create an rclone union remote."""
    result = await dm_create_union_remote(
        name=request.name,
        upstreams=request.upstreams,
        action_policy=request.action_policy,
        create_policy=request.create_policy
    )
    return result


@router.post("/generate-suffixes")
def api_generate_suffixes(request: GenerateSuffixesRequest):
    """Generate suffixes for drive names."""
    suffixes = generate_suffixes(
        start=request.start,
        count=request.count,
        increment=request.increment,
        padding=request.padding,
        prefix=request.prefix
    )
    preview = [f"example{s}" for s in suffixes]
    return {"suffixes": suffixes, "preview": preview}


@router.get("/keys")
def api_list_keys():
    """List available service account key files."""
    # Correct path: /opt/isync/keys
    # __file__ is /opt/isync/backend/routers/drives.py
    # dirname(__file__) -> /opt/isync/backend/routers
    # dirname(dirname(__file__)) -> /opt/isync/backend
    # dirname(dirname(dirname(__file__))) -> /opt/isync
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    keys_dir = os.path.join(base_dir, "keys")
    if not os.path.exists(keys_dir):
        return {"keys": [], "path": keys_dir}
    
    keys = []
    for f in os.listdir(keys_dir):
        if f.endswith('.json'):
            filepath = os.path.join(keys_dir, f)
            keys.append({
                "name": f,
                "path": filepath,
                "size": os.path.getsize(filepath)
            })
    
    return {"keys": keys, "path": keys_dir}


@router.post("/create")
async def api_create_drives_unified(request: CreateDrivesUnifiedRequest):
    """Create Shared Drives using selected method (fclone or google_api)."""
    # Save member template if it looks like an email
    if request.member_template and '@' in request.member_template:
        from backend.dependencies import get_store
        try:
            get_store().add_known_email(request.member_template)
        except Exception:
            pass

    result = await create_drives_unified(
        method=request.method,
        base_name=request.base_name,
        suffixes=request.suffixes,
        delay_seconds=request.delay_seconds,
        gdrive_remote=request.gdrive_remote,
        member_template=request.member_template,
        service_account_file=request.service_account_file,
        impersonate_email=request.impersonate_email,
        default_managers=request.default_managers
    )
    return result


@router.post("/list-unified")
async def api_list_drives_unified(request: ListDrivesUnifiedRequest):
    """List Shared Drives using selected method."""
    result = await list_drives_unified(
        method=request.method,
        prefix=request.prefix,
        gdrive_remote=request.gdrive_remote,
        service_account_file=request.service_account_file,
        impersonate_email=request.impersonate_email,
        limit=request.limit
    )
    return result


@router.get("/methods")
def api_check_methods():
    """Check which drive creation methods are available."""
    return check_methods_available()


@router.post("/add-managers")
async def api_add_drive_managers(request: AddManagersRequest):
    """Add managers to a Shared Drive."""
    from backend.drive_manager import add_drive_managers
    
    # Save group emails
    if request.group_emails:
        from backend.dependencies import get_store
        try:
            store = get_store()
            for email in request.group_emails:
                if '@' in email:
                    store.add_known_email(email)
        except Exception:
            pass

    result = await add_drive_managers(
        drive_id=request.drive_id,
        service_account_file=request.service_account_file,
        impersonate_email=request.impersonate_email,
        group_emails=request.group_emails,
        role=request.role
    )
    return result


@router.post("/remote/create")
async def api_create_drive_remote(request: CreateDriveRemoteRequest):
    """Create a single rclone remote for a drive."""
    from backend.drive_manager import create_single_drive_remote
    result = await create_single_drive_remote(
        name=request.name,
        team_drive_id=request.drive_id,
        sa_file=request.service_account_file
    )
    return result


@router.get("/groups")
def api_list_known_groups():
    """List known groups from configuration."""
    from backend.dependencies import get_store
    
    try:
        store = get_store()
        config = store.get_config()
        domains = config.get('domains', [])
        
        # Merge saved known emails with domain groups
        groups = set(config.get('known_emails', []))
        
        for d in domains:
            if d.get('group_email'):
                groups.add(d['group_email'])
                
        return {"groups": sorted(list(groups))}
    except Exception:
        return {"groups": []}
