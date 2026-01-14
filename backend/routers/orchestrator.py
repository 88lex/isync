"""
Orchestrator Router
Handles file push/pull, cron management, and multi-server operations.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os

from backend.dependencies import get_store
from backend.logging_config import get_logger

logger = get_logger("isync.routers.orchestrator")

router = APIRouter(prefix="/api/orchestrator", tags=["Orchestrator"])


# --- Pydantic Models ---
class PushFilesRequest(BaseModel):
    server_ids: List[str]
    file_types: List[str]
    dry_run: bool = False


class PullFilesRequest(BaseModel):
    server_ids: List[str]
    file_types: List[str]
    backup_name: Optional[str] = None


class CronTemplateRequest(BaseModel):
    content: str
    is_default: bool = False


# --- File Push/Pull Endpoints ---
@router.post("/files/push")
def api_push_files(request: PushFilesRequest):
    """Push files to selected servers."""
    try:
        from backend.orchestrator import push_files_to_server
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        
        results = []
        for server_id in request.server_ids:
            server = next((s for s in servers if s.get('id') == server_id), None)
            if server:
                result = push_files_to_server(server, request.file_types, request.dry_run)
                results.append(result)
        
        success_count = sum(1 for r in results if r.get('success'))
        return {
            "status": "ok" if success_count == len(results) else "partial",
            "total": len(results),
            "success": success_count,
            "results": results
        }
    except ImportError:
        raise HTTPException(status_code=503, detail="Orchestrator not available")


@router.post("/files/pull")
def api_pull_files(request: PullFilesRequest):
    """Pull files from selected servers to local backup."""
    try:
        from backend.orchestrator import pull_files_from_server
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        
        results = []
        for server_id in request.server_ids:
            server = next((s for s in servers if s.get('id') == server_id), None)
            if server:
                result = pull_files_from_server(server, request.file_types, request.backup_name)
                results.append(result)
        
        success_count = sum(1 for r in results if r.get('success'))
        return {
            "status": "ok" if success_count == len(results) else "partial",
            "total": len(results),
            "success": success_count,
            "results": results
        }
    except ImportError:
        raise HTTPException(status_code=503, detail="Orchestrator not available")


@router.get("/backups")
def api_list_backups():
    """List all pulled backups."""
    try:
        from backend.orchestrator import list_pulled_backups
        backups = list_pulled_backups()
        return {"backups": backups}
    except ImportError:
        return {"backups": [], "error": "Orchestrator not available"}


# --- Cron Template Management ---
@router.get("/cron/templates")
def api_list_cron_templates():
    """List all crontab templates."""
    try:
        from backend.orchestrator import CRON_DIR
    except ImportError:
        return {"templates": []}
    
    templates = []
    
    # Default template
    default_path = os.path.join(CRON_DIR, "default.crontab")
    if os.path.exists(default_path):
        templates.append({
            "id": "default",
            "name": "Default Template",
            "path": default_path,
            "server_specific": False
        })
    
    # Server-specific templates
    specific_dir = os.path.join(CRON_DIR, "server_specific")
    if os.path.exists(specific_dir):
        for f in os.listdir(specific_dir):
            if f.endswith('.crontab'):
                server_id = f.replace('.crontab', '')
                templates.append({
                    "id": server_id,
                    "name": f"Server: {server_id}",
                    "path": os.path.join(specific_dir, f),
                    "server_specific": True
                })
    
    return {"templates": templates}


@router.get("/cron/templates/{template_id}")
def api_get_cron_template(template_id: str):
    """Get a crontab template content."""
    try:
        from backend.orchestrator import get_crontab_for_server
        content, source = get_crontab_for_server(template_id)
        return {"id": template_id, "content": content, "source": source}
    except ImportError:
        raise HTTPException(status_code=503, detail="Orchestrator not available")


@router.post("/cron/templates/{template_id}")
def api_save_cron_template(template_id: str, request: CronTemplateRequest):
    """Save a crontab template."""
    try:
        from backend.orchestrator import save_crontab_for_server
        if save_crontab_for_server(template_id, request.content, use_default=request.is_default):
            return {"status": "ok", "id": template_id}
        else:
            raise HTTPException(status_code=500, detail="Failed to save template")
    except ImportError:
        raise HTTPException(status_code=503, detail="Orchestrator not available")


# --- Multi-Server Batch Operations ---
@router.post("/batch-status")
def api_batch_server_status(server_ids: List[str]):
    """Get status of multiple servers at once."""
    try:
        from backend.orchestrator import check_batch_running
        store = get_store()
        config = store.get_config()
        servers = config.get('ssh_servers', [])
        
        results = []
        for server_id in server_ids:
            server = next((s for s in servers if s.get('id') == server_id), None)
            if server:
                batch_status = check_batch_running(server)
                results.append({
                    "server_id": server_id,
                    "server_name": server.get('name'),
                    "batch_running": batch_status.get('running', False),
                    "processes": batch_status.get('processes', [])
                })
        
        return {"results": results}
    except ImportError:
        return {"results": [], "error": "Orchestrator not available"}
