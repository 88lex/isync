"""
SyncPair Repository
Database repository for sync pair operations.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session

from backend.models.models import SyncPair as SyncPairModel
from backend.logging_config import get_logger

logger = get_logger("isync.repositories.sync_pairs")


class SyncPairRepository:
    """Repository for SyncPair database operations."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def list_all(self) -> List[dict]:
        """Get all sync pairs."""
        pairs = self.db.query(SyncPairModel).all()
        return [self._to_dict(p) for p in pairs]
    
    def get_by_id(self, pair_id: int | str) -> Optional[dict]:
        """Get a sync pair by ID. Accepts int or string representation of int."""
        # Normalize to int
        try:
            int_id = int(pair_id)
        except (ValueError, TypeError):
            logger.warning(f"Invalid pair_id format: {pair_id}")
            return None
        
        pair = self.db.query(SyncPairModel).filter(SyncPairModel.id == int_id).first()
        return self._to_dict(pair) if pair else None
    
    def find_by_source_dest(self, source: str, dest: str) -> Optional[dict]:
        """Find a sync pair by source and destination."""
        pair = self.db.query(SyncPairModel).filter(
            SyncPairModel.source == source,
            SyncPairModel.dest == dest
        ).first()
        return self._to_dict(pair) if pair else None
    
    def create(self, source: str, dest: str, domain_reference: str = None,
               source_type: str = "LOCAL", source_server_id: str = None,
               dest_type: str = "LOCAL", dest_server_id: str = None,
               meta_server_id: str = None, meta_execution_mode: str = "local",
               description: str = None,
               scan_source_server_id: str = None,
               scan_dest_server_id: str = None) -> dict:
        """Create a new sync pair."""
        pair = SyncPairModel(
            source=source,
            dest=dest,
            domain_reference=domain_reference,
            source_type=source_type,
            source_server_id=source_server_id,
            dest_type=dest_type,
            dest_server_id=dest_server_id,
            meta_server_id=meta_server_id,
            meta_execution_mode=meta_execution_mode,
            description=description,
            scan_source_server_id=scan_source_server_id,
            scan_dest_server_id=scan_dest_server_id
        )
        self.db.add(pair)
        self.db.commit()
        self.db.refresh(pair)
        return self._to_dict(pair)
    
    def update(self, pair_id: int, **kwargs) -> Optional[dict]:
        """Update a sync pair."""
        pair = self.db.query(SyncPairModel).filter(SyncPairModel.id == pair_id).first()
        if not pair:
            return None
        
        for key, value in kwargs.items():
            if hasattr(pair, key) and value is not None:
                setattr(pair, key, value)
        
        self.db.commit()
        self.db.refresh(pair)
        return self._to_dict(pair)
    
    def delete(self, pair_id: int) -> bool:
        """Delete a sync pair."""
        pair = self.db.query(SyncPairModel).filter(SyncPairModel.id == pair_id).first()
        if not pair:
            return False
        
        self.db.delete(pair)
        self.db.commit()
        return True
    
    def update_last_run(self, pair_id: int) -> Optional[dict]:
        """Update the last_run timestamp for a sync pair."""
        pair = self.db.query(SyncPairModel).filter(SyncPairModel.id == pair_id).first()
        if not pair:
            return None
        
        pair.last_run = datetime.utcnow()
        self.db.commit()
        self.db.refresh(pair)
        return self._to_dict(pair)
    
    def count(self) -> int:
        """Count total sync pairs."""
        return self.db.query(SyncPairModel).count()
    
    def _to_dict(self, pair: SyncPairModel) -> dict:
        """Convert a SyncPair model to a dictionary."""
        if not pair:
            return {}
        
        return {
            "id": str(pair.id),
            "source": pair.source,
            "dest": pair.dest,
            "domain_reference": pair.domain_reference,
            "source_type": pair.source_type or "LOCAL",
            "source_server_id": pair.source_server_id,
            "dest_type": pair.dest_type or "LOCAL",
            "dest_server_id": pair.dest_server_id,
            "meta_server_id": pair.meta_server_id,
            "meta_execution_mode": pair.meta_execution_mode or "local",
            "description": pair.description,
            "last_run": pair.last_run.isoformat() if pair.last_run else None,
            "scan_source_server_id": pair.scan_source_server_id,
            "scan_dest_server_id": pair.scan_dest_server_id,
            "source_size_bytes": pair.source_size_bytes,
            "source_file_count": pair.source_file_count,
            "source_scanned_at": pair.source_scanned_at.isoformat() if pair.source_scanned_at else None,
            "dest_size_bytes": pair.dest_size_bytes,
            "dest_file_count": pair.dest_file_count,
            "dest_scanned_at": pair.dest_scanned_at.isoformat() if pair.dest_scanned_at else None
        }
