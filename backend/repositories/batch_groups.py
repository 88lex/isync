"""
Batch Groups Repository
Database repository for batch group operations.
"""
import json
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session

from backend.models.models import BatchGroup as BatchGroupModel
from backend.logging_config import get_logger

logger = get_logger("isync.repositories.batch_groups")


class BatchGroupRepository:
    """Repository for BatchGroup database operations."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def list_all(self) -> List[dict]:
        """Get all batch groups."""
        groups = self.db.query(BatchGroupModel).all()
        return [self._to_dict(g) for g in groups]
    
    def get_by_id(self, group_id: str) -> Optional[dict]:
        """Get a batch group by ID."""
        group = self.db.query(BatchGroupModel).filter(BatchGroupModel.id == group_id).first()
        return self._to_dict(group) if group else None
    
    def get_by_name(self, name: str) -> Optional[dict]:
        """Get a batch group by name (case-insensitive)."""
        groups = self.db.query(BatchGroupModel).all()
        for g in groups:
            if g.name.lower() == name.lower():
                return self._to_dict(g)
        return None
    
    def create(self, id: str, name: str, description: str, batch_files: List[str]) -> dict:
        """Create a new batch group."""
        now = datetime.utcnow()
        group = BatchGroupModel(
            id=id,
            name=name,
            description=description,
            batch_files=json.dumps(batch_files),
            created_at=now,
            updated_at=now
        )
        self.db.add(group)
        self.db.commit()
        self.db.refresh(group)
        return self._to_dict(group)
    
    def update(self, group_id: str, name: Optional[str] = None, 
               description: Optional[str] = None, 
               batch_files: Optional[List[str]] = None) -> Optional[dict]:
        """Update a batch group."""
        group = self.db.query(BatchGroupModel).filter(BatchGroupModel.id == group_id).first()
        if not group:
            return None
        
        if name is not None:
            group.name = name
        if description is not None:
            group.description = description
        if batch_files is not None:
            group.batch_files = json.dumps(batch_files)
        
        group.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(group)
        return self._to_dict(group)
    
    def delete(self, group_id: str) -> bool:
        """Delete a batch group."""
        group = self.db.query(BatchGroupModel).filter(BatchGroupModel.id == group_id).first()
        if not group:
            return False
        
        self.db.delete(group)
        self.db.commit()
        return True
    
    def _to_dict(self, group: BatchGroupModel) -> dict:
        """Convert a BatchGroup model to a dictionary."""
        if not group:
            return {}
        
        batch_files = []
        try:
            batch_files = json.loads(group.batch_files) if group.batch_files else []
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse batch_files for group {group.id}")
        
        return {
            "id": group.id,
            "name": group.name,
            "description": group.description or "",
            "batch_files": batch_files,
            "created_at": group.created_at.isoformat() if group.created_at else None,
            "updated_at": group.updated_at.isoformat() if group.updated_at else None
        }


# Helper function to get server by ID from database
def get_ssh_server_by_id(db: Session, server_id: str) -> Optional[dict]:
    """Get SSH server from database by ID."""
    from backend.models.models import SSHServer
    server = db.query(SSHServer).filter(SSHServer.id == server_id).first()
    if not server:
        return None
    return {
        "id": server.id,
        "name": server.name,
        "alias": server.alias,
        "host": server.host,
        "port": server.port,
        "user": server.user,
        "key_path": server.key_path,
        "remote_path": server.remote_path,
        "is_default": server.is_default
    }
