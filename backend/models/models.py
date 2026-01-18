from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
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
    Logical grouping of Shared Drives (e.g., 'fcl-ebooks').
    """
    __tablename__ = "union_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    description = Column(String(200), nullable=True)
    
    # rclone remote name (e.g., 'fcl-ebooks-union')
    remote_name = Column(String(100), nullable=True)

    drives = relationship("SharedDrive", back_populates="union_group", cascade="all, delete-orphan")

class SharedDrive(Base):
    """
    Represents a specific Google Shared Drive.
    """
    __tablename__ = "shared_drives"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(String(100), unique=True, index=True, nullable=False) # Google Drive ID
    name = Column(String(200), nullable=False)
    
    # Foreign Key to UnionGroup
    union_group_id = Column(Integer, ForeignKey("union_groups.id"), nullable=True)
    
    # Capacity Stats
    file_count = Column(Integer, default=0)
    size_bytes = Column(Float, default=0.0)
    last_scanned = Column(DateTime, nullable=True)
    
    # Status
    is_full = Column(Boolean, default=False) # Manually or auto-flagged as full
    status = Column(String(50), default="ACTIVE") # ACTIVE, ARCHIVED, DELETED

    union_group = relationship("UnionGroup", back_populates="drives")
    alerts = relationship("CapacityAlert", back_populates="drive", cascade="all, delete-orphan")

class CapacityAlert(Base):
    """
    Stores "On-Demand" monitoring alerts.
    """
    __tablename__ = "capacity_alerts"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(Integer, ForeignKey("shared_drives.id"), nullable=False)
    
    alert_type = Column(String(50), nullable=False) # e.g., 'FILE_COUNT', 'SIZE_QUOTA'
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime, nullable=True)

    drive = relationship("SharedDrive", back_populates="alerts")

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

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(500), nullable=False)
    dest = Column(String(500), nullable=False)
    domain_reference = Column(String(100), nullable=True)
    description = Column(String(200), nullable=True)
    last_run = Column(DateTime, nullable=True)
