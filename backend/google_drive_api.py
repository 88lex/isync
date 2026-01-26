import json
import logging
import asyncio
import threading
from typing import Dict, Any, List, Optional, Set
from pathlib import Path

logger = logging.getLogger("uvicorn")

# Optional import - gracefully handle if not installed
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False
    logger.warning("Google API libraries not installed. Install with: pip install google-api-python-client google-auth")

# Module-level thread-local storage for services
_local = threading.local()


SCOPES = ['https://www.googleapis.com/auth/drive']


def get_drive_service(
    service_account_file: str,
    impersonate_email: str
):
    """
    Create a Google Drive API service using service account with domain-wide delegation.
    Thread-local caching is used to avoid repeated discovery doc fetches.
    """
    if not GOOGLE_API_AVAILABLE:
        raise RuntimeError("Google API libraries not installed. Run: pip install google-api-python-client google-auth")
    
    if not impersonate_email:
        raise ValueError("impersonate_email is required for Domain-Wide Delegation authentication.")

    key = f"drive_{service_account_file}_{impersonate_email}"
    if not hasattr(_local, key):
        credentials = service_account.Credentials.from_service_account_file(
            service_account_file,
            scopes=SCOPES
        )
        delegated_credentials = credentials.with_subject(impersonate_email)
        setattr(_local, key, build('drive', 'v3', credentials=delegated_credentials, cache_discovery=False))
    
    return getattr(_local, key)


async def create_shared_drive_api(
    service_account_file: str,
    impersonate_email: str,
    drive_name: str,
    request_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a single Shared Drive using Google Drive API.
    """
    try:
        import uuid
        rid = request_id or str(uuid.uuid4())
        
        drive_metadata = {
            'name': drive_name
        }
        
        result = await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).drives().create(
                requestId=rid,
                body=drive_metadata
            ).execute()
        )
        
        return {
            "status": "ok",
            "drive": {
                "id": result.get('id'),
                "name": result.get('name'),
                "kind": result.get('kind', 'drive#drive')
            }
        }
        
    except HttpError as e:
        error_details = json.loads(e.content.decode('utf-8'))
        error_msg = error_details.get('error', {}).get('message', str(e))
        return {
            "status": "error",
            "message": error_msg,
            "code": e.resp.status
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


async def list_drive_members_api(
    service_account_file: str,
    impersonate_email: str,
    drive_id: str
) -> Dict[str, Any]:
    """
    List members of a Shared Drive.
    """
    try:
        results = await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).permissions().list(
                fileId=drive_id,
                supportsAllDrives=True,
                fields="permissions(id, emailAddress, role, type, displayName)"
            ).execute()
        )
        
        # In this context (copying members), drive_manager expects 'emailAddress' specifically
        # based on my observation of its current implementation.
        return {
            "status": "ok",
            "members": results.get('permissions', [])
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


async def create_shared_drives_api(
    service_account_file: str,
    impersonate_email: str,
    base_name: str,
    suffixes: List[str],
    delay_seconds: int = 5
) -> Dict[str, Any]:
    """
    Create multiple Shared Drives using Google Drive API.
    
    Args:
        service_account_file: Path to service account JSON
        impersonate_email: Admin email for impersonation (DWD required)
        base_name: Base name for drives
        suffixes: List of suffixes to append
        delay_seconds: Delay between creations
    
    Returns:
        Dict with created drives and any errors
    """
    import asyncio
    
    results = {
        "status": "ok",
        "method": "google_api",
        "created": [],
        "failed": [],
        "logs": []
    }
    
    for suffix in suffixes:
        drive_name = f"{base_name}{suffix}"
        results["logs"].append(f"Creating Shared Drive (API): {drive_name}")
        
        result = await create_shared_drive_api(
            service_account_file=service_account_file,
            impersonate_email=impersonate_email,
            drive_name=drive_name
        )
        
        if result["status"] == "ok":
            results["created"].append({
                "name": result["drive"]["name"],
                "id": result["drive"]["id"]
            })
            results["logs"].append(f"  ✓ Created: {drive_name} (ID: {result['drive']['id']})")
        else:
            results["failed"].append({
                "name": drive_name,
                "error": result.get("message", "Unknown error")
            })
            results["logs"].append(f"  ✗ Failed: {drive_name} - {result.get('message')}")
        
        # Delay between creations (except after last one)
        if suffix != suffixes[-1]:
            results["logs"].append(f"  Waiting {delay_seconds}s...")
            await asyncio.sleep(delay_seconds)
    
    if results["failed"]:
        results["status"] = "partial" if results["created"] else "error"
    
    return results


async def list_shared_drives_api(
    service_account_file: str,
    impersonate_email: str,
    prefix: Optional[str] = None,
    page_size: int = 100,
    limit: Optional[int] = None,
    excluded_items: Optional[Set[str]] = None
) -> Dict[str, Any]:
    """
    List Shared Drives using Google Drive API.
    
    Args:
        service_account_file: Path to service account JSON
        impersonate_email: Admin email for impersonation
        prefix: Optional prefix to filter drives
        page_size: Number of results per page
        limit: Maximum number of drives to return
        excluded_items: Set of names or IDs to exclude
    
    Returns:
        Dict with list of drives
    """
    try:
        drives = []
        page_token = None
        
        while True:
            result = await asyncio.to_thread(
                lambda: get_drive_service(service_account_file, impersonate_email).drives().list(
                    pageSize=page_size,
                    pageToken=page_token,
                    fields="nextPageToken, drives(id, name, kind, hidden)"
                ).execute()
            )
            
            for drive in result.get('drives', []):
                if prefix is None or drive['name'].startswith(prefix):
                    # Exclusion check
                    if excluded_items:
                        if drive['id'] in excluded_items or drive['name'] in excluded_items:
                            continue

                    drives.append({
                        "id": drive['id'],
                        "name": drive['name'],
                        "kind": drive.get('kind', 'drive#drive'),
                        "hidden": drive.get('hidden', False)
                    })
                    if limit and len(drives) >= limit:
                        page_token = None
                        break
            
            if limit and len(drives) >= limit:
                break

            page_token = result.get('nextPageToken')
            if not page_token:
                break
        
        return {
            "status": "ok",
            "method": "google_api",
            "drives": drives,
            "count": len(drives)
        }
        
    except HttpError as e:
        error_details = json.loads(e.content.decode('utf-8'))
        error_msg = error_details.get('error', {}).get('message', str(e))
        return {
            "status": "error",
            "message": error_msg,
            "drives": []
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "drives": []
        }


async def add_drive_member_api(
    service_account_file: str,
    impersonate_email: str,
    drive_id: str,
    member_email: str,
    role: str = "organizer"
) -> Dict[str, Any]:
    """
    Add a member to a Shared Drive.
    """
    try:
        # Helper to try adding permission with a specific type
        async def try_add_permission(p_type):
            permission = {
                'type': p_type,
                'role': role,
                'emailAddress': member_email
            }
            return await asyncio.to_thread(
                lambda: get_drive_service(service_account_file, impersonate_email).permissions().create(
                    fileId=drive_id,
                    body=permission,
                    supportsAllDrives=True,
                    sendNotificationEmail=False
                ).execute()
            )

        # Try 'group' first, fallback to 'user'
        try:
            result = await try_add_permission('group')
        except HttpError:
            try:
                result = await try_add_permission('user')
            except HttpError as e:
                # If both fail, re-raise the last error to be caught by outer block
                raise e
        
        return {
            "status": "ok",
            "permission_id": result.get('id'),
            "member": member_email,
            "role": role
        }
        
    except HttpError as e:
        error_details = json.loads(e.content.decode('utf-8'))
        error_msg = error_details.get('error', {}).get('message', str(e))
        return {
            "status": "error",
            "message": error_msg
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


async def copy_drive_members_api(
    service_account_file: str,
    impersonate_email: str,
    source_drive_id: str,
    target_drive_id: str
) -> Dict[str, Any]:
    """
    Copy members from one Shared Drive to another.
    
    Args:
        service_account_file: Path to service account JSON
        impersonate_email: Admin email for impersonation
        source_drive_id: Drive to copy members from
        target_drive_id: Drive to copy members to
    
    Returns:
        Dict with results
    """
    try:
        # Get permissions from source drive
        permissions = await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).permissions().list(
                fileId=source_drive_id,
                supportsAllDrives=True,
                fields="permissions(id, emailAddress, role, type)"
            ).execute()
        )
        
        copied = []
        failed = []
        
        for perm in permissions.get('permissions', []):
            if perm.get('type') == 'user' and perm.get('emailAddress'):
                result = await add_drive_member_api(
                    service_account_file=service_account_file,
                    impersonate_email=impersonate_email,
                    drive_id=target_drive_id,
                    member_email=perm['emailAddress'],
                    role=perm.get('role', 'reader')
                )
                
                if result["status"] == "ok":
                    copied.append(perm['emailAddress'])
                else:
                    failed.append({
                        "email": perm['emailAddress'],
                        "error": result.get("message")
                    })
        
        return {
            "status": "ok" if not failed else "partial",
            "copied": copied,
            "failed": failed
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


def check_api_available() -> Dict[str, Any]:
    """Check if Google API libraries are available."""
    return {
        "available": GOOGLE_API_AVAILABLE,
        "message": "Google API available" if GOOGLE_API_AVAILABLE else "Install: pip install google-api-python-client google-auth"
    }


async def rename_shared_drive_api(
    service_account_file: str,
    impersonate_email: str,
    drive_id: str,
    new_name: str
) -> Dict[str, Any]:
    """Rename a Shared Drive."""
    try:
        result = await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).drives().update(
                driveId=drive_id,
                body={'name': new_name}
            ).execute()
        )
        
        return {
            "status": "ok",
            "id": result.get('id'),
            "name": result.get('name')
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def delete_shared_drive_api(
    service_account_file: str,
    impersonate_email: str,
    drive_id: str
) -> Dict[str, Any]:
    """Delete a Shared Drive."""
    try:
        await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).drives().delete(driveId=drive_id).execute()
        )
        
        return {"status": "ok", "id": drive_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_drive_details_api(
    service_account_file: str,
    impersonate_email: str,
    drive_id: str
) -> Dict[str, Any]:
    """Get detailed information about a Shared Drive."""
    try:
        # Get Drive Metadata
        drive = await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).drives().get(
                driveId=drive_id,
                fields="id, name, createdTime, orgUnitId, restrictions"
            ).execute()
        )

        # Get Permissions
        permissions_res = await asyncio.to_thread(
            lambda: get_drive_service(service_account_file, impersonate_email).permissions().list(
                fileId=drive_id,
                supportsAllDrives=True,
                fields="permissions(id, emailAddress, role, type, displayName)",
                pageSize=100
            ).execute()
        )

        permissions = []
        for p in permissions_res.get('permissions', []):
             permissions.append({
                 "email": p.get('emailAddress'),
                 "role": p.get('role'),
                 "type": p.get('type'),
                 "name": p.get('displayName')
             })

        return {
            "status": "ok",
            "drive": drive,
            "permissions": permissions
        }

    except HttpError as e:
        error_details = json.loads(e.content.decode('utf-8'))
        error_msg = error_details.get('error', {}).get('message', str(e))
        logger.error(f"Google API HttpError in get_drive_details: {error_msg} (Imp={impersonate_email})")
        return {"status": "error", "message": error_msg}
    except Exception as e:
        logger.error(f"Error in get_drive_details: {str(e)} (Imp={impersonate_email})")
        return {"status": "error", "message": str(e)}
