"""
Ops Router
Handles user operations, domain auth, SSH operations, and step control.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import os
import json

from backend.dependencies import get_store
from backend.logging_config import get_logger
from backend.ops import (
    test_ssh_connection, create_local_backup,
    push_config_to_remote, pull_config_from_remote, diff_configs,
    test_domain_auth, list_domain_users, process_bulk_ops,
    manual_create_user, manual_delete_user,
    SSHBaseRequest, PushPullRequest, BulkOpRequest, UserOpRequest,
    approve_ssh_host_key
)
from isync_engine import STEP_STATUS_FILE, STEP_ACTION_FILE

logger = get_logger("isync.routers.ops")

router = APIRouter(prefix="/api/ops", tags=["Operations"])


# --- Pydantic Models ---
class StepStatusResponse(BaseModel):
    step: str
    detail: str
    status: str
    error: Optional[str] = None
    timestamp: float


class StepActionRequest(BaseModel):
    action: str  # CONTINUE, ABORT


# --- Step Control Endpoints ---
@router.get("/step_status")
def get_step_status():
    """Get current step status for interactive mode."""
    if os.path.exists(STEP_STATUS_FILE):
        try:
            with open(STEP_STATUS_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Failed to read step status file: {e}")
    return {"step": "", "detail": "", "status": "IDLE", "timestamp": 0}


@router.post("/step_action")
def post_step_action(req: StepActionRequest):
    """Post step action for interactive mode."""
    with open(STEP_ACTION_FILE, 'w') as f:
        json.dump(req.dict(), f)
    return {"status": "ok"}


# --- SSH Operations ---
@router.post("/ssh/test")
def api_test_ssh(req: SSHBaseRequest):
    """Test SSH connection."""
    return test_ssh_connection(req)


@router.post("/ssh/approve")
def api_approve_ssh(req: SSHBaseRequest):
    """Approve SSH host key."""
    return approve_ssh_host_key(req)


# --- Backup Operations ---
@router.post("/backup")
def api_backup():
    """Create local backup."""
    return create_local_backup()


# --- Sync Operations ---
@router.post("/sync/push")
def api_sync_push(req: PushPullRequest):
    """Push config to remote server."""
    return push_config_to_remote(req)


@router.post("/sync/pull")
def api_sync_pull(req: PushPullRequest):
    """Pull config from remote server."""
    return pull_config_from_remote(req)


@router.post("/sync/diff")
def api_sync_diff(req: SSHBaseRequest):
    """Diff configs with remote server."""
    return diff_configs(req)


# --- Domain Auth ---
@router.post("/auth/test")
def api_test_domain_auth():
    """Test domain authentication."""
    return test_domain_auth()


# --- User Operations ---
@router.get("/users/{domain}")
def api_list_domain_users(domain: str):
    """List users in a domain."""
    return list_domain_users(domain)


@router.post("/users/bulk")
def api_bulk_ops(req: BulkOpRequest):
    """Perform bulk user operations."""
    return process_bulk_ops(req)


@router.post("/user/create")
def api_man_create_user(req: UserOpRequest):
    """Manually create a user."""
    return manual_create_user(req)


@router.post("/user/delete")
def api_man_delete_user(req: UserOpRequest):
    """Manually delete a user."""
    return manual_delete_user(req)


# --- SSH Session Management ---
@router.get("/ssh/sessions")
def api_list_ssh_sessions():
    """List orphaned ISync tmux sessions on the remote server."""
    try:
        from utils.ssh_client import create_ssh_client_from_config
        store = get_store()
        config = store.get_config()
        ssh_client = create_ssh_client_from_config(config)
        
        if not ssh_client:
            return {"enabled": False, "sessions": [], "message": "SSH not enabled"}
        
        sessions = ssh_client.list_isync_sessions()
        return {"enabled": True, "sessions": sessions}
    except Exception as e:
        logger.error(f"Failed to list SSH sessions: {e}")
        return {"enabled": False, "sessions": [], "error": str(e)}


@router.delete("/ssh/sessions/{session_name}")
def api_kill_ssh_session(session_name: str):
    """Kill an orphaned SSH session."""
    try:
        from utils.ssh_client import create_ssh_client_from_config
        store = get_store()
        config = store.get_config()
        ssh_client = create_ssh_client_from_config(config)
        
        if not ssh_client:
            raise HTTPException(status_code=503, detail="SSH not enabled")
        
        success = ssh_client.kill_session(session_name)
        return {"status": "ok" if success else "failed", "session": session_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
