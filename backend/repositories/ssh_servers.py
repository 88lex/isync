"""
SSH Server Repository
Database repository for SSH server operations.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session

from backend.models.models import SSHServer
from backend.logging_config import get_logger

logger = get_logger("isync.repositories.ssh_servers")


class SSHServerRepository:
    """Repository for SSHServer database operations."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def list_all(self) -> List[dict]:
        """Get all SSH servers."""
        servers = self.db.query(SSHServer).all()
        return [self._to_dict(s) for s in servers]
    
    def get_by_id(self, server_id: str) -> Optional[dict]:
        """Get an SSH server by ID."""
        server = self.db.query(SSHServer).filter(SSHServer.id == server_id).first()
        return self._to_dict(server) if server else None
    
    def get_by_name(self, name: str) -> Optional[dict]:
        """Get an SSH server by name."""
        server = self.db.query(SSHServer).filter(SSHServer.name == name).first()
        return self._to_dict(server) if server else None
    
    def get_default(self) -> Optional[dict]:
        """Get the default SSH server."""
        server = self.db.query(SSHServer).filter(SSHServer.is_default == True).first()
        return self._to_dict(server) if server else None
    
    def create(self, server_id: str, name: str, alias: str = None, host: str = None,
               port: int = 22, user: str = None, key_path: str = None,
               remote_path: str = "/opt/isync", is_default: bool = False) -> dict:
        """Create a new SSH server."""
        # Clear existing default if this is being set as default
        if is_default:
            self.db.query(SSHServer).update({SSHServer.is_default: False})
        
        server = SSHServer(
            id=server_id,
            name=name,
            alias=alias,
            host=host,
            port=port,
            user=user,
            key_path=key_path,
            remote_path=remote_path,
            is_default=is_default,
            created_at=datetime.utcnow()
        )
        self.db.add(server)
        self.db.commit()
        self.db.refresh(server)
        return self._to_dict(server)
    
    def update(self, server_id: str, **kwargs) -> Optional[dict]:
        """Update an SSH server."""
        server = self.db.query(SSHServer).filter(SSHServer.id == server_id).first()
        if not server:
            return None
        
        # Handle is_default special case
        if kwargs.get('is_default') == True:
            self.db.query(SSHServer).update({SSHServer.is_default: False})
        
        for key, value in kwargs.items():
            if hasattr(server, key) and value is not None:
                setattr(server, key, value)
        
        self.db.commit()
        self.db.refresh(server)
        return self._to_dict(server)
    
    def delete(self, server_id: str) -> bool:
        """Delete an SSH server."""
        server = self.db.query(SSHServer).filter(SSHServer.id == server_id).first()
        if not server:
            return False
        
        self.db.delete(server)
        self.db.commit()
        return True
    
    def update_last_connected(self, server_id: str) -> Optional[dict]:
        """Update the last_connected_at timestamp."""
        server = self.db.query(SSHServer).filter(SSHServer.id == server_id).first()
        if not server:
            return None
        
        server.last_connected_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(server)
        return self._to_dict(server)
    
    def count(self) -> int:
        """Count total SSH servers."""
        return self.db.query(SSHServer).count()
    
    def _to_dict(self, server: SSHServer) -> dict:
        """Convert an SSHServer model to a dictionary."""
        if not server:
            return {}
        
        return {
            "id": server.id,
            "name": server.name,
            "alias": server.alias,
            "host": server.host,
            "port": server.port,
            "user": server.user,
            "key_path": server.key_path,
            "remote_path": server.remote_path,
            "is_default": server.is_default,
            "created_at": server.created_at.isoformat() if server.created_at else None,
            "last_connected_at": server.last_connected_at.isoformat() if server.last_connected_at else None
        }
