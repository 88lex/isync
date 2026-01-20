"""
Pydantic Request/Response Models
Extracted from main.py for better organization.
"""
from pydantic import BaseModel
from typing import List, Optional, Dict, Any


# --- Config Models ---
class DomainConfig(BaseModel):
    domain_name: str
    admin_email: str
    sa_json_path: str
    group_email: str
    remote_sa_json_path: Optional[str] = ""


class ConfigUpdate(BaseModel):
    upload_limit: Optional[str] = None
    transfers: Optional[int] = None
    default_source: Optional[str] = None
    default_dest: Optional[str] = None
    max_users_per_cycle: Optional[int] = None
    company_name: Optional[str] = None
    existing_users_file: Optional[str] = None
    rclone_command: Optional[str] = None
    rclone_chunk_size: Optional[str] = None
    rclone_stats_interval: Optional[str] = None
    stall_timeout_minutes: Optional[int] = None
    global_rclone_flags: Optional[str] = None
    webhook_url: Optional[str] = None
    rotation_strategy: Optional[str] = None
    ssh_enabled: Optional[bool] = None
    ssh_host: Optional[str] = None
    ssh_user: Optional[str] = None
    ssh_key_path: Optional[str] = None
    ssh_remote_path: Optional[str] = None
    ssh_connect_timeout: Optional[int] = None
    protected_users: Optional[List[str]] = None
    include_protected_users: Optional[bool] = None
    step_check: Optional[bool] = None
    domains: Optional[List[DomainConfig]] = None


# --- Sync Models ---
class SyncPair(BaseModel):
    source: str
    dest: str
    domain_reference: Optional[str] = ""
    source_type: Optional[str] = "LOCAL"
    source_server_id: Optional[str] = None
    dest_type: Optional[str] = "LOCAL"
    dest_server_id: Optional[str] = None
    meta_server_id: Optional[str] = None
    meta_execution_mode: Optional[str] = "local"
    
    class Config:
        extra = "ignore"


class SyncListUpdate(BaseModel):
    pairs: List[SyncPair]


# --- Job Models ---
class JobRequest(BaseModel):
    pairs: List[SyncPair]
    dry_run: bool = False
    selected_users: Optional[List[str]] = None
    
    class Config:
        extra = "ignore"


class SaveBatchRequest(BaseModel):
    filename: str
    commands: Dict[str, str]
    include_header: bool = True


class BatchCompareRequest(BaseModel):
    filename: str
    domain: Optional[str] = None
    compare_users: Optional[List[str]] = None


# --- SSH Models ---
class SSHServerCreate(BaseModel):
    name: str
    alias: Optional[str] = None
    host: Optional[str] = None
    port: int = 22
    user: Optional[str] = None
    key_path: Optional[str] = None
    remote_path: str = "/opt/isync_refactor"
    is_default: bool = False


class SSHServerUpdate(BaseModel):
    name: Optional[str] = None
    alias: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    user: Optional[str] = None
    key_path: Optional[str] = None
    remote_path: Optional[str] = None
    is_default: Optional[bool] = None


# --- Schedule Models ---
class ScheduleCreate(BaseModel):
    name: str
    source: str
    dest: str
    cron_expression: str
    dry_run: bool = False


# --- Ops Models ---
class SSHRequest(BaseModel):
    host: str
    user: Optional[str] = None
    key_path: Optional[str] = None
    remote_path: Optional[str] = None
    timeout: Optional[int] = None


class BulkOpRequest(BaseModel):
    action: str  # 'verify' | 'unsuspend' | 'delete' | 'protect' | 'add_to_group'
    domain: str
    users: List[str]


# --- Drive Manager Models ---
class CreateDrivesRequest(BaseModel):
    gdrive_remote: str
    member_template: Optional[str] = None
    base_name: str
    suffixes: List[str]
    delay_seconds: int = 10


class CreateRemotesRequest(BaseModel):
    remotes: List[Dict[str, str]]  # [{name, team_drive_id}, ...]
    sa_dir: str
    start_count: int = 1


class CreateUnionRequest(BaseModel):
    name: str
    upstreams: List[str]
    action_policy: str = "rand"
    create_policy: str = "eprand"


class GenerateSuffixesRequest(BaseModel):
    start: int = 10
    count: int = 5
    increment: int = 10
    padding: int = 4
    prefix: str = "-"


class CreateDrivesUnifiedRequest(BaseModel):
    method: str = "fclone"  # "fclone" or "google_api"
    base_name: str
    suffixes: List[str]
    delay_seconds: int = 10
    # fclone-specific
    gdrive_remote: Optional[str] = None
    member_template: Optional[str] = None
    # google_api-specific
    service_account_file: Optional[str] = None
    impersonate_email: Optional[str] = None
    # New: allow passing managers during creation
    default_managers: Optional[List[Dict[str, str]]] = None # [{"email": "...", "role": "..."}]


class ListDrivesUnifiedRequest(BaseModel):
    method: str = "fclone"
    prefix: Optional[str] = None
    gdrive_remote: Optional[str] = None
    service_account_file: Optional[str] = None
    impersonate_email: Optional[str] = None
    limit: Optional[int] = None


class AddManagersRequest(BaseModel):
    drive_id: str
    service_account_file: str
    impersonate_email: str
    group_emails: List[str]
    role: str = "organizer"


class CreateDriveRemoteRequest(BaseModel):
    name: str
    drive_id: str
    service_account_file: str


class RenameDriveRequest(BaseModel):
    drive_id: str
    new_name: str
    method: str = "google_api"
    service_account_file: Optional[str] = None
    impersonate_email: Optional[str] = None


class DeleteDriveRequest(BaseModel):
    drive_id: str
    method: str = "google_api"
    service_account_file: Optional[str] = None
    impersonate_email: Optional[str] = None


# --- Orchestrator Models ---
class FilePushRequest(BaseModel):
    server_ids: List[str]
    file_types: List[str]
    dry_run: bool = False


class FilePullRequest(BaseModel):
    server_ids: List[str]
    file_types: List[str]
    backup_name: Optional[str] = None


class DeployCronRequest(BaseModel):
    content: str
    save_as_template: bool = False


class SaveCronTemplateRequest(BaseModel):
    content: str
    is_default: bool = False


# --- Profile Models ---
class ProfileLoadRequest(BaseModel):
    filename: str


class ProfileSaveRequest(BaseModel):
    filename: str


# --- Prep Check Models ---
class InstallPackagesRequest(BaseModel):
    packages: Optional[List[str]] = None


class FixIssueRequest(BaseModel):
    issue_id: str
