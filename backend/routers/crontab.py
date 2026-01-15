"""
Crontab Router
Handles crontab configuration management for remote servers.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime

from backend.models.batch_groups import (
    CrontabEntry, CrontabConfig, load_crontab_configs, save_crontab_configs
)
from backend.logging_config import get_logger

logger = get_logger("isync.routers.crontab")

router = APIRouter(prefix="/api/crontab", tags=["Crontab"])


# --- Request Models ---
class CrontabEntryCreate(BaseModel):
    command_type: str  # 'batch' or 'group'
    command_name: str
    cron_expression: str
    annotation: str = ""
    enabled: bool = True


class CrontabEntryUpdate(BaseModel):
    command_type: Optional[str] = None
    command_name: Optional[str] = None
    cron_expression: Optional[str] = None
    annotation: Optional[str] = None
    enabled: Optional[bool] = None


# --- Common Presets ---
CRON_PRESETS = {
    "hourly": "0 * * * *",
    "daily": "0 0 * * *",
    "daily_6am": "0 6 * * *",
    "daily_midnight": "0 0 * * *",
    "weekly": "0 0 * * 0",
    "monthly": "0 0 1 * *",
    "every_15min": "*/15 * * * *",
    "every_30min": "*/30 * * * *",
    "weekdays_9am": "0 9 * * 1-5",
}


@router.get("/presets")
def get_cron_presets():
    """Get common cron expression presets."""
    return {
        "presets": [
            {"name": "Hourly", "expression": "0 * * * *"},
            {"name": "Daily (Midnight)", "expression": "0 0 * * *"},
            {"name": "Daily (6am)", "expression": "0 6 * * *"},
            {"name": "Daily (9am)", "expression": "0 9 * * *"},
            {"name": "Weekly (Sunday)", "expression": "0 0 * * 0"},
            {"name": "Monthly (1st)", "expression": "0 0 1 * *"},
            {"name": "Every 15 min", "expression": "*/15 * * * *"},
            {"name": "Every 30 min", "expression": "*/30 * * * *"},
            {"name": "Weekdays 9am", "expression": "0 9 * * 1-5"},
        ]
    }


# --- Server Config Endpoints ---
@router.get("/servers")
def list_crontab_servers():
    """List all servers with crontab configurations."""
    configs = load_crontab_configs()
    return [{"server_id": c.server_id, "server_name": c.server_name, "entry_count": len(c.entries)} 
            for c in configs.values()]


@router.get("/servers/{server_id}")
def get_server_crontab(server_id: str):
    """Get crontab configuration for a server."""
    configs = load_crontab_configs()
    if server_id not in configs:
        return {"server_id": server_id, "entries": [], "message": "No configuration found"}
    return configs[server_id].dict()


@router.post("/servers/{server_id}/init")
def init_server_crontab(server_id: str, server_name: str):
    """Initialize crontab configuration for a server."""
    configs = load_crontab_configs()
    if server_id in configs:
        return {"status": "exists", "config": configs[server_id].dict()}
    
    new_config = CrontabConfig(
        server_id=server_id,
        server_name=server_name,
        entries=[]
    )
    configs[server_id] = new_config
    save_crontab_configs(configs)
    
    return {"status": "ok", "config": new_config.dict()}


@router.post("/servers/{server_id}/entries")
def add_crontab_entry(server_id: str, req: CrontabEntryCreate):
    """Add a crontab entry for a server."""
    configs = load_crontab_configs()
    if server_id not in configs:
        raise HTTPException(status_code=404, detail="Server crontab not initialized")
    
    new_entry = CrontabEntry(
        id=str(uuid.uuid4())[:8],
        command_type=req.command_type,
        command_name=req.command_name,
        cron_expression=req.cron_expression,
        annotation=req.annotation,
        enabled=req.enabled
    )
    
    configs[server_id].entries.append(new_entry)
    save_crontab_configs(configs)
    
    return {"status": "ok", "entry": new_entry.dict()}


@router.put("/servers/{server_id}/entries/{entry_id}")
def update_crontab_entry(server_id: str, entry_id: str, req: CrontabEntryUpdate):
    """Update a crontab entry."""
    configs = load_crontab_configs()
    if server_id not in configs:
        raise HTTPException(status_code=404, detail="Server crontab not found")
    
    entry_idx = None
    for i, e in enumerate(configs[server_id].entries):
        if e.id == entry_id:
            entry_idx = i
            break
    
    if entry_idx is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    entry = configs[server_id].entries[entry_idx]
    updated = entry.dict()
    
    if req.command_type is not None:
        updated["command_type"] = req.command_type
    if req.command_name is not None:
        updated["command_name"] = req.command_name
    if req.cron_expression is not None:
        updated["cron_expression"] = req.cron_expression
    if req.annotation is not None:
        updated["annotation"] = req.annotation
    if req.enabled is not None:
        updated["enabled"] = req.enabled
    
    configs[server_id].entries[entry_idx] = CrontabEntry(**updated)
    save_crontab_configs(configs)
    
    return {"status": "ok", "entry": configs[server_id].entries[entry_idx].dict()}


@router.delete("/servers/{server_id}/entries/{entry_id}")
def delete_crontab_entry(server_id: str, entry_id: str):
    """Delete a crontab entry."""
    configs = load_crontab_configs()
    if server_id not in configs:
        raise HTTPException(status_code=404, detail="Server crontab not found")
    
    original_len = len(configs[server_id].entries)
    configs[server_id].entries = [e for e in configs[server_id].entries if e.id != entry_id]
    
    if len(configs[server_id].entries) == original_len:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    save_crontab_configs(configs)
    return {"status": "ok", "deleted": entry_id}


@router.post("/servers/{server_id}/generate")
def generate_crontab_file(server_id: str):
    """Generate a crontab file content for a server."""
    configs = load_crontab_configs()
    if server_id not in configs:
        raise HTTPException(status_code=404, detail="Server crontab not found")
    
    config = configs[server_id]
    
    
    content = _generate_crontab_content(config)
    
    return {
        "status": "ok",
        "server_id": server_id,
        "server_name": config.server_name,
        "content": content,
        "entry_count": len([e for e in config.entries if e.enabled])
    }

def _generate_crontab_content(config: CrontabConfig) -> str:
    lines = [
        "# ISync Crontab Configuration",
        f"# Server: {config.server_name}",
        f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"# Entries: {len(config.entries)}",
        "#",
        "# Format: minute hour day month weekday command",
        "",
    ]
    
    for entry in config.entries:
        if not entry.enabled:
            lines.append(f"# [DISABLED] {entry.annotation}")
            lines.append(f"# {entry.cron_expression} <command>")
            lines.append("")
            continue
        
        # Generate the command based on type
        if entry.command_type == "batch":
            cmd = f"cd /opt/isync && bash batch/{entry.command_name}"
        elif entry.command_type == "group":
            cmd = f"cd /opt/isync && bash batch/groups/{entry.command_name}"
        else:
            cmd = f"cd /opt/isync && {entry.command_name}"
        
        if entry.annotation:
            lines.append(f"# {entry.annotation}")
        lines.append(f"{entry.cron_expression} {cmd}")
        lines.append("")
    
    return "\n".join(lines)


@router.post("/servers/{server_id}/install")
def install_server_crontab(server_id: str):
    """Install the generated crontab on the remote server via SSH."""
    # Internal imports to avoid circular deps
    from backend.ops import exec_remote_command, copy_file_to_remote, SSHBaseRequest
    from backend.store import store
    import tempfile
    import os

    configs = load_crontab_configs()
    if server_id not in configs:
        raise HTTPException(status_code=404, detail="Server crontab not found")
    
    # Get Server Details
    app_config = store.get_config()
    server = next((s for s in app_config.get('remote_servers', []) if s['id'] == server_id), None)
    if not server:
         raise HTTPException(404, "SSH Server configuration not found")

    content = _generate_crontab_content(configs[server_id])

    # Write temp file
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        req = SSHBaseRequest(
            host=server['host'],
            user=server.get('user'),
            key_path=server.get('key_path'),
            timeout=20
        )
        
        # Push file
        remote_tmp = f"/tmp/isync_crontab_{server_id}"
        
        res = copy_file_to_remote(req, tmp_path, remote_tmp)
        if res['status'] != 'success':
            raise HTTPException(500, f"Failed to copy crontab: {res.get('message')}")

        # Install
        res = exec_remote_command(req, f"crontab {remote_tmp} && rm {remote_tmp}")
        if res['status'] != 'success':
             raise HTTPException(500, f"Failed to install crontab: {res.get('message')}")
             
        return {"status": "success", "message": "Crontab installed successfully"}
        
    except Exception as e:
        logger.error(f"Install failed: {e}")
        raise HTTPException(500, str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.delete("/servers/{server_id}")
def delete_server_crontab(server_id: str):
    """Delete all crontab configuration for a server."""
    configs = load_crontab_configs()
    if server_id not in configs:
        raise HTTPException(status_code=404, detail="Server crontab not found")
    
    del configs[server_id]
    save_crontab_configs(configs)
    
    return {"status": "ok", "deleted": server_id}
