from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float, Index
from sqlalchemy.orm import relationship
from backend.database import Base

class AppConfig(Base):
    """
    Key-Value store for global application settings.
    Replaces most of config.yaml.
    """
    __tablename__ = "app_config"

    key = Column(String(100), primary_key=True)
    value = Column(String(500), nullable=True)
    description = Column(String(200), nullable=True)

class UnionGroup(Base):
    """
    Logical grouping of Storage Nodes (e.g., 'fcl-ebooks').
    """
    __tablename__ = "union_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    description = Column(String(200), nullable=True)
    
    # rclone remote name (e.g., 'fcl-ebooks-union')
    remote_name = Column(String(100), nullable=True)

    nodes = relationship("SharedDrive", back_populates="union_group", cascade="all, delete-orphan")

class SharedDrive(Base):
    """
    Represents a specific Google Shared Drive.
    """
    __tablename__ = "shared_drives"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(200), nullable=False)
    
    # Foreign Key to UnionGroup (Optional)
    union_group_id = Column(Integer, ForeignKey("union_groups.id"), nullable=True)
    
    # Stats
    file_count = Column(Integer, default=0)
    size_bytes = Column(Float, default=0.0)
    last_scanned = Column(DateTime, nullable=True)
    
    # Status
    status = Column(String(50), default="ACTIVE") # ACTIVE, ARCHIVED, DELETED

    union_group = relationship("UnionGroup", back_populates="nodes")

class WorkspaceUser(Base):
    """
    Inventory of Service Accounts or Domain Users.
    """
    __tablename__ = "workspace_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    domain_name = Column(String(100), nullable=False)
    
    # Status
    status = Column(String(50), default="ACTIVE") # ACTIVE, SUSPENDED, UNKNOWN
    last_active = Column(DateTime, nullable=True)
    
    # For Service Accounts
    sa_json_path = Column(String(500), nullable=True)

class SyncPair(Base):
    """
    Saved source/dest pairs for jobs (replaces synclist.yaml).
    """
    __tablename__ = "sync_pairs"
    
    # Add composite indices for common queries
    __table_args__ = (
        Index('ix_sync_pair_source_dest', 'source', 'dest'),
        Index('ix_sync_pair_domain', 'domain_reference'),
    )

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(500), nullable=False)
    dest = Column(String(500), nullable=False)
    domain_reference = Column(String(100), nullable=True)
    
    # Advanced association fields
    source_type = Column(String(20), default="LOCAL") # LOCAL, SSH, RCLONE
    source_server_id = Column(String(100), nullable=True)
    dest_type = Column(String(20), default="LOCAL") # LOCAL, SSH, RCLONE
    dest_server_id = Column(String(100), nullable=True)

    meta_server_id = Column(String(50), nullable=True)
    meta_execution_mode = Column(String(20), default="local")
    description = Column(String(200), nullable=True)
    last_run = Column(DateTime, nullable=True)

    # Dashboard Stats & Scan Config
    scan_source_server_id = Column(String(50), nullable=True) # ID of server to scan source on
    scan_dest_server_id = Column(String(50), nullable=True)   # ID of server to scan dest on
    
    source_size_bytes = Column(Float, default=0.0) # Using Float for large numbers consistency
    source_file_count = Column(Integer, default=0)
    source_scanned_at = Column(DateTime, nullable=True)
    
    dest_size_bytes = Column(Float, default=0.0)
    dest_file_count = Column(Integer, default=0)
    dest_scanned_at = Column(DateTime, nullable=True)

class NodeStats(Base):
    """
    Cache for file system statistics of a specific path (Source or Dest).
    """
    __tablename__ = "node_stats"

    id = Column(Integer, primary_key=True, index=True)
    path = Column(String(500), unique=True, index=True, nullable=False)
    
    # Classification
    location_label = Column(String(100), nullable=True) # e.g. "Local Server", "SSH:zfbak"
    location_type = Column(String(50), default="UNKNOWN") # LOCAL, SSH, GOOGLE, RCLONE
    
    # Stats
    size_bytes = Column(Float, default=0.0)
    file_count = Column(Integer, default=0)
    folder_count = Column(Integer, default=0)
    
    last_updated = Column(DateTime, nullable=True)
    is_calculating = Column(Boolean, default=False)


class DataCache(Base):
    """
    Generic cache for storing fetched data with timestamps.
    Enables local-first data access with manual refresh control.
    """
    __tablename__ = "data_cache"
    
    # Composite index for common query pattern
    __table_args__ = (
        Index('ix_data_cache_type_key', 'data_type', 'context_key'),
    )

    id = Column(String(200), primary_key=True)  # e.g., 'users_domain_example.com'
    data_type = Column(String(50), nullable=False, index=True)  # 'users', 'remotes', 'drives', etc.
    context_key = Column(String(100), nullable=False, index=True)  # 'domain_example.com', 'server_abc123', 'local'
    payload = Column(Text, nullable=False)  # JSON blob of the data
    fetched_at = Column(DateTime, default=datetime.utcnow)
    source_info = Column(String(200), nullable=True)  # Optional: origin info

class DomainStats(Base):
    """
    Relational cache for domain-wide statistics.
    Enables rapid overview of multiple domains without hitting external APIs.
    """
    __tablename__ = "domain_stats"

    domain = Column(String(100), primary_key=True)
    
    # Storage (in GB)
    total_quota_gb = Column(Float, default=0.0)
    total_used_gb = Column(Float, default=0.0)
    
    # Inventory
    user_count = Column(Integer, default=0)
    group_count = Column(Integer, default=0)
    
    last_updated = Column(DateTime, default=datetime.utcnow)


# =============================================================================
# Phase 1: Database Schema Consolidation - New Models
# =============================================================================

class SSHServer(Base):
    """
    SSH Server configuration.
    Replaces ssh_servers list in config.yaml.
    """
    __tablename__ = "ssh_servers"

    id = Column(String(20), primary_key=True)  # Short UUID like '07a3e081'
    name = Column(String(100), unique=True, index=True, nullable=False)
    alias = Column(String(100), nullable=True)  # SSH config alias
    host = Column(String(255), nullable=True)   # IP or hostname
    port = Column(Integer, default=22)
    user = Column(String(100), nullable=True)
    key_path = Column(String(500), nullable=True)
    remote_path = Column(String(500), default="/opt/isync")
    is_default = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    last_connected_at = Column(DateTime, nullable=True)
    
    # Relationships
    schedules = relationship("Schedule", back_populates="target_server", cascade="all, delete-orphan")


class BatchGroup(Base):
    """
    Named group of batch files that execute in order.
    Replaces .batch_groups.json file.
    """
    __tablename__ = "batch_groups"

    id = Column(String(50), primary_key=True)  # UUID
    name = Column(String(100), unique=True, index=True, nullable=False)
    description = Column(String(500), nullable=True)
    batch_files = Column(Text, nullable=False)  # JSON array of filenames
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Schedule(Base):
    """
    Unified schedule for local APScheduler jobs and remote crontab entries.
    Replaces scheduled_jobs.json and .crontab_configs.json.
    """
    __tablename__ = "schedules"

    id = Column(String(50), primary_key=True)  # e.g., 'schedule_abc123'
    name = Column(String(200), nullable=False)
    cron_expression = Column(String(100), nullable=False)  # e.g., '0 2 * * *'
    
    # What to run
    command_type = Column(String(20), nullable=False)  # 'sync', 'batch', 'group', 'task'
    command = Column(Text, nullable=True)  # JSON with details (source, dest, task_args, etc.)
    
    # Where to run
    execution_context = Column(String(20), default="LOCAL")  # LOCAL, SSH
    target_server_id = Column(String(20), ForeignKey("ssh_servers.id"), nullable=True)
    
    # Status
    enabled = Column(Boolean, default=True)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    last_result = Column(String(50), nullable=True)  # 'success', 'error', 'skipped'
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    target_server = relationship("SSHServer", back_populates="schedules")
