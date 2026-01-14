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
    ListDrivesUnifiedRequest
)

router = APIRouter(prefix="/api/drives", tags=["Drive Manager"])


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
        create_policy=request.create_policy,
        sa_file_path=request.sa_file_path
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
    keys_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "keys")
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
    result = await create_drives_unified(
        method=request.method,
        base_name=request.base_name,
        suffixes=request.suffixes,
        delay_seconds=request.delay_seconds,
        gdrive_remote=request.gdrive_remote,
        member_template=request.member_template,
        service_account_file=request.service_account_file,
        impersonate_email=request.impersonate_email
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
        impersonate_email=request.impersonate_email
    )
    return result


@router.get("/methods")
def api_check_methods():
    """Check which drive creation methods are available."""
    return check_methods_available()
