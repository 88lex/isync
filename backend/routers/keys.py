from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import json
import glob
from google.oauth2 import service_account
from googleapiclient import discovery
from google.auth.transport.requests import Request as GoogleRequest
from backend.logging_config import get_logger

router = APIRouter(prefix="/api/keys", tags=["keys"])
logger = get_logger("isync.keys")

KEYS_DIR = "/opt/isync/keys"

class KeyInfo(BaseModel):
    filename: str
    path: str
    project_id: Optional[str] = None
    client_email: Optional[str] = None
    private_key_id: Optional[str] = None
    client_id: Optional[str] = None
    admin_email: Optional[str] = None
    valid_json: bool = False
    error: Optional[str] = None

class IAMRole(BaseModel):
    role: str
    title: Optional[str] = None
    description: Optional[str] = None

class KeyInspection(BaseModel):
    filename: str
    roles: List[str] = []
    permissions: List[str] = []
    dwd_enabled: Optional[bool] = None
    dwd_verified: Optional[bool] = None
    dwd_scopes: List[str] = []
    status: str
    details: Optional[str] = None

@router.get("", response_model=List[KeyInfo])
async def list_keys():
    """List all JSON keys from the keys directory and configuration."""
    keys_map = {} # path -> KeyInfo
    
    # Load config for mapping
    path_to_admin = {}
    filename_to_admin = {}
    domains = []
    try:
        from backend.config_manager import config_manager
        domains = config_manager.get_domains()
        for d in domains:
            if d.get('sa_json_path'):
                try:
                    abs_p = os.path.abspath(d['sa_json_path'])
                    path_to_admin[abs_p] = d.get('admin_email')
                    filename_to_admin[os.path.basename(d['sa_json_path'])] = d.get('admin_email')
                except:
                    pass
    except Exception as e:
        logger.error(f"Error loading config for key mapping: {e}")

    # 1. Scan KEYS_DIR
    if os.path.exists(KEYS_DIR):
        for file_path in glob.glob(os.path.join(KEYS_DIR, "*.json")):
            abs_path = os.path.abspath(file_path)
            if abs_path not in keys_map:
                info = KeyInfo(filename=os.path.basename(file_path), path=abs_path)
                
                # Resolving admin_email
                if abs_path in path_to_admin:
                    info.admin_email = path_to_admin[abs_path]
                elif info.filename in filename_to_admin:
                    info.admin_email = filename_to_admin[info.filename]
                
                try:
                    with open(abs_path, 'r') as f:
                        data = json.load(f)
                        info.project_id = data.get('project_id')
                        info.client_email = data.get('client_email')
                        info.private_key_id = data.get('private_key_id')
                        info.client_id = data.get('client_id')
                        info.valid_json = True
                except json.JSONDecodeError:
                    info.error = "Invalid JSON"
                except Exception as e:
                    info.error = str(e)
                keys_map[abs_path] = info

    # 2. Key from Configuration
    try:
        # We already loaded domains above
        for d in domains:
            sa_path = d.get('sa_json_path')
            if sa_path and os.path.exists(sa_path):
                abs_path = os.path.abspath(sa_path)
                if abs_path not in keys_map:
                     info = KeyInfo(filename=os.path.basename(sa_path), path=abs_path)
                     info.admin_email = d.get('admin_email')
                     
                     try:
                        with open(abs_path, 'r') as f:
                            data = json.load(f)
                            info.project_id = data.get('project_id')
                            info.client_email = data.get('client_email')
                            info.private_key_id = data.get('private_key_id')
                            info.client_id = data.get('client_id')
                            info.valid_json = True
                     except json.JSONDecodeError:
                        info.error = "Invalid JSON"
                     except Exception as e:
                        info.error = str(e)
                     keys_map[abs_path] = info
    except Exception as e:
        logger.error(f"Error loading keys from config: {e}")

    return list(keys_map.values())

class InspectRequest(BaseModel):
    admin_email: Optional[str] = None

@router.post("/{filename}/inspect", response_model=KeyInspection)
async def inspect_key(filename: str, req: InspectRequest = None):
    """Inspect a key to determine its IAM roles on the project and check DWD status."""
    # Resolve file path
    file_path = None
    if os.path.exists(os.path.join(KEYS_DIR, filename)):
        file_path = os.path.join(KEYS_DIR, filename)
    else:
         # Try in config
        try:
            from backend.config_manager import config_manager
            domains = config_manager.get_domains()
            for d in domains:
                sa_path = d.get('sa_json_path')
                if sa_path and os.path.basename(sa_path) == filename and os.path.exists(sa_path):
                    file_path = sa_path
                    break
        except Exception:
            pass

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Key file not found")

    roles = []
    dwd_enabled = False
    dwd_scopes_confirmed = []
    
    # 1. Check GCP IAM Roles
    try:
        creds = service_account.Credentials.from_service_account_file(file_path)
        project_id = creds.project_id
        email = creds.service_account_email
        service = discovery.build('cloudresourcemanager', 'v1', credentials=creds, cache_discovery=False)
        policy = service.projects().getIamPolicy(resource=project_id, body={}).execute()
        for binding in policy.get('bindings', []):
            members = binding.get('members', [])
            if f"serviceAccount:{email}" in members:
                roles.append(binding.get('role'))
    except Exception as e:
        logger.warning(f"IAM check failed for {filename}: {e}")
        # Proceed to check DWD even if IAM check fails (permissions issue)

    # 2. Check Domain-Wide Delegation (DWD)
    try:
        # Determine admin email priority:
        # 1. Provided in request
        # 2. Configured in Domains
        admin_email = None
        
        if req and req.admin_email:
             admin_email = req.admin_email
        
        if not admin_email:
            try:
                from backend.config_manager import config_manager
                domains = config_manager.get_domains()
                
                # Match by path first
                for d in domains:
                    if d.get('sa_json_path') and os.path.basename(d['sa_json_path']) == filename: # Relaxed matching to filename
                        admin_email = d.get('admin_email')
                        break
                    # Also try matching absolute path if available
                    if d.get('sa_json_path') and os.path.abspath(d['sa_json_path']) == os.path.abspath(file_path):
                        admin_email = d.get('admin_email')
                        break
            except Exception:
                pass
        
        if admin_email:
            # Test Scopes
            test_scopes = [
                'https://www.googleapis.com/auth/admin.directory.user.readonly',
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/admin.directory.group.readonly'
            ]
            
            # Try to authenticate with subject
            creds_dwd = service_account.Credentials.from_service_account_file(
                file_path, 
                subject=admin_email,
                scopes=test_scopes
            )
            
            # Attempt a lightweight call (refresh token)
            from google.auth.transport.requests import Request
            creds_dwd.refresh(Request())
            
            if creds_dwd.valid:
                dwd_enabled = True
                dwd_scopes_confirmed = test_scopes
    except Exception as e:
         logger.warning(f"DWD check failed for {filename}: {e}")

    return KeyInspection(
        filename=filename,
        roles=roles,
        dwd_enabled=dwd_enabled,
        dwd_verified=True if admin_email else False,
        dwd_scopes=dwd_scopes_confirmed,
        status="success"
    )

@router.delete("/{filename}")
async def delete_key(filename: str):
    file_path = os.path.join(KEYS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Key file not found")
    try:
        os.remove(file_path)
        return {"status": "success", "message": f"Deleted {filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class KeyAttributes(BaseModel):
    filename: str
    attributes: Dict[str, Any]
    status: str
    details: Optional[str] = None

@router.post("/{filename}/attributes", response_model=KeyAttributes)
async def extract_attributes(filename: str):
    """Extract all possible attributes from the JSON key."""
    # Find the file path (first check KEYS_DIR, then config)
    file_path = None
    if os.path.exists(os.path.join(KEYS_DIR, filename)):
        file_path = os.path.join(KEYS_DIR, filename)
    else:
         # Try to find in config
        try:
            from backend.config_manager import config_manager
            domains = config_manager.get_domains()
            for d in domains:
                sa_path = d.get('sa_json_path')
                if sa_path and os.path.basename(sa_path) == filename and os.path.exists(sa_path):
                    file_path = sa_path
                    break
        except Exception:
            pass

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Key file not found")

    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
            
        # Basic attributes
        attributes = {
            "type": data.get("type"),
            "project_id": data.get("project_id"),
            "private_key_id": data.get("private_key_id"),
            "client_email": data.get("client_email"),
            "client_id": data.get("client_id"),
            "auth_uri": data.get("auth_uri"),
            "token_uri": data.get("token_uri"),
            "auth_provider_x509_cert_url": data.get("auth_provider_x509_cert_url"),
            "client_x509_cert_url": data.get("client_x509_cert_url"),
            "universe_domain": data.get("universe_domain")
        }
        
        return KeyAttributes(
            filename=filename,
            attributes={k: v for k, v in attributes.items() if v is not None},
            status="success"
        )

    except Exception as e:
        logger.error(f"Failed to extract attributes for {filename}: {str(e)}")
        return KeyAttributes(
            filename=filename,
            attributes={},
            status="error",
            details=str(e)
        )
