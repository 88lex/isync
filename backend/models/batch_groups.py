"""
Batch Groups Models
Pydantic models for batch group management and crontab configuration.
"""
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import json
import os


class BatchGroup(BaseModel):
    """A named group of batch files that execute in order."""
    id: str
    name: str
    description: str = ""
    batch_files: List[str]  # Ordered list of batch filenames
    created_at: str
    updated_at: str


class BatchGroupCreate(BaseModel):
    """Request to create a new batch group."""
    name: str
    description: str = ""
    batch_files: List[str] = []


class BatchGroupUpdate(BaseModel):
    """Request to update a batch group."""
    name: Optional[str] = None
    description: Optional[str] = None
    batch_files: Optional[List[str]] = None


class ReorderRequest(BaseModel):
    """Request to reorder batches in a group."""
    batch_files: List[str]


class CrontabEntry(BaseModel):
    """A single crontab entry."""
    id: str
    command_type: str  # 'batch' or 'group'
    command_name: str  # Batch filename or group id
    cron_expression: str
    annotation: str = ""
    enabled: bool = True


class CrontabConfig(BaseModel):
    """Crontab configuration for a server."""
    server_id: str
    server_name: str
    entries: List[CrontabEntry] = []
    last_pushed_at: Optional[str] = None
    last_pulled_at: Optional[str] = None


# --- Storage Helpers ---
BATCH_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "batch")
BATCH_GROUPS_FILE = os.path.join(BATCH_DIR, ".batch_groups.json")
CRON_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "server_files", "cron")
CRONTAB_CONFIGS_FILE = os.path.join(CRON_DIR, ".crontab_configs.json")


def load_batch_groups() -> List[BatchGroup]:
    """Load batch groups from disk."""
    if not os.path.exists(BATCH_GROUPS_FILE):
        return []
    try:
        with open(BATCH_GROUPS_FILE, 'r') as f:
            data = json.load(f)
        return [BatchGroup(**g) for g in data]
    except Exception:
        return []


def save_batch_groups(groups: List[BatchGroup]) -> bool:
    """Save batch groups to disk."""
    os.makedirs(BATCH_DIR, exist_ok=True)
    try:
        with open(BATCH_GROUPS_FILE, 'w') as f:
            json.dump([g.dict() for g in groups], f, indent=2)
        return True
    except Exception:
        return False


def load_crontab_configs() -> dict:
    """Load crontab configs from disk. Returns dict keyed by server_id."""
    if not os.path.exists(CRONTAB_CONFIGS_FILE):
        return {}
    try:
        with open(CRONTAB_CONFIGS_FILE, 'r') as f:
            data = json.load(f)
        return {c['server_id']: CrontabConfig(**c) for c in data}
    except Exception:
        return {}


def save_crontab_configs(configs: dict) -> bool:
    """Save crontab configs to disk."""
    os.makedirs(CRON_DIR, exist_ok=True)
    try:
        data = [c.dict() for c in configs.values()]
        with open(CRONTAB_CONFIGS_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception:
        return False
