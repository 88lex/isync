"""
Schedule Repository
Database repository for unified schedule operations.
Supports both local (APScheduler) and remote (SSH crontab) schedules.
"""
import json
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session

from backend.models.models import Schedule as ScheduleModel
from backend.logging_config import get_logger

logger = get_logger("isync.repositories.schedules")


class ScheduleRepository:
    """Repository for Schedule database operations."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def list_all(self) -> List[dict]:
        """Get all schedules."""
        schedules = self.db.query(ScheduleModel).all()
        return [self._to_dict(s) for s in schedules]
    
    def list_by_context(self, context: str) -> List[dict]:
        """Get schedules by execution context (LOCAL or SSH)."""
        schedules = self.db.query(ScheduleModel).filter(
            ScheduleModel.execution_context == context
        ).all()
        return [self._to_dict(s) for s in schedules]
    
    def list_by_server(self, server_id: str) -> List[dict]:
        """Get schedules for a specific SSH server."""
        schedules = self.db.query(ScheduleModel).filter(
            ScheduleModel.target_server_id == server_id
        ).all()
        return [self._to_dict(s) for s in schedules]
    
    def list_enabled(self) -> List[dict]:
        """Get all enabled schedules."""
        schedules = self.db.query(ScheduleModel).filter(
            ScheduleModel.enabled == True
        ).all()
        return [self._to_dict(s) for s in schedules]
    
    def get_by_id(self, schedule_id: str) -> Optional[dict]:
        """Get a schedule by ID."""
        schedule = self.db.query(ScheduleModel).filter(
            ScheduleModel.id == schedule_id
        ).first()
        return self._to_dict(schedule) if schedule else None
    
    def create(self, 
               id: str,
               name: str,
               cron_expression: str,
               command_type: str = "sync",
               command: Dict[str, Any] = None,
               execution_context: str = "LOCAL",
               target_server_id: str = None,
               enabled: bool = True) -> dict:
        """Create a new schedule."""
        now = datetime.utcnow()
        schedule = ScheduleModel(
            id=id,
            name=name,
            cron_expression=cron_expression,
            command_type=command_type,
            command=json.dumps(command) if command else "{}",
            execution_context=execution_context,
            target_server_id=target_server_id,
            enabled=enabled,
            created_at=now,
            updated_at=now
        )
        self.db.add(schedule)
        self.db.commit()
        self.db.refresh(schedule)
        return self._to_dict(schedule)
    
    def update(self, schedule_id: str, **kwargs) -> Optional[dict]:
        """Update a schedule."""
        schedule = self.db.query(ScheduleModel).filter(
            ScheduleModel.id == schedule_id
        ).first()
        if not schedule:
            return None
        
        # Handle command dict -> JSON string conversion
        if 'command' in kwargs and isinstance(kwargs['command'], dict):
            kwargs['command'] = json.dumps(kwargs['command'])
        
        for key, value in kwargs.items():
            if hasattr(schedule, key) and value is not None:
                setattr(schedule, key, value)
        
        schedule.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(schedule)
        return self._to_dict(schedule)
    
    def update_last_run(self, schedule_id: str, result: str = None) -> Optional[dict]:
        """Update the last_run timestamp and result for a schedule."""
        schedule = self.db.query(ScheduleModel).filter(
            ScheduleModel.id == schedule_id
        ).first()
        if not schedule:
            return None
        
        schedule.last_run = datetime.utcnow()
        if result:
            schedule.last_result = result
        
        self.db.commit()
        self.db.refresh(schedule)
        return self._to_dict(schedule)
    
    def update_next_run(self, schedule_id: str, next_run: datetime) -> Optional[dict]:
        """Update the next_run timestamp for a schedule."""
        schedule = self.db.query(ScheduleModel).filter(
            ScheduleModel.id == schedule_id
        ).first()
        if not schedule:
            return None
        
        schedule.next_run = next_run
        self.db.commit()
        self.db.refresh(schedule)
        return self._to_dict(schedule)
    
    def set_enabled(self, schedule_id: str, enabled: bool) -> Optional[dict]:
        """Enable or disable a schedule."""
        return self.update(schedule_id, enabled=enabled)
    
    def delete(self, schedule_id: str) -> bool:
        """Delete a schedule."""
        schedule = self.db.query(ScheduleModel).filter(
            ScheduleModel.id == schedule_id
        ).first()
        if not schedule:
            return False
        
        self.db.delete(schedule)
        self.db.commit()
        return True
    
    def count(self) -> int:
        """Count total schedules."""
        return self.db.query(ScheduleModel).count()
    
    def count_by_context(self, context: str) -> int:
        """Count schedules by execution context."""
        return self.db.query(ScheduleModel).filter(
            ScheduleModel.execution_context == context
        ).count()
    
    def _to_dict(self, schedule: ScheduleModel) -> dict:
        """Convert a Schedule model to a dictionary."""
        if not schedule:
            return {}
        
        command = {}
        try:
            command = json.loads(schedule.command) if schedule.command else {}
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse command for schedule {schedule.id}")
        
        return {
            "id": schedule.id,
            "name": schedule.name,
            "cron_expression": schedule.cron_expression,
            "command_type": schedule.command_type,
            "command": command,
            "execution_context": schedule.execution_context,
            "target_server_id": schedule.target_server_id,
            "enabled": schedule.enabled,
            "last_run": schedule.last_run.isoformat() if schedule.last_run else None,
            "next_run": schedule.next_run.isoformat() if schedule.next_run else None,
            "last_result": schedule.last_result,
            "created_at": schedule.created_at.isoformat() if schedule.created_at else None,
            "updated_at": schedule.updated_at.isoformat() if schedule.updated_at else None
        }
    
    def generate_crontab_entries(self, server_id: str) -> str:
        """
        Generate crontab file content for a specific SSH server.
        Returns formatted crontab entries for all schedules targeting that server.
        """
        schedules = self.list_by_server(server_id)
        lines = [
            "# ISync Generated Crontab",
            f"# Server ID: {server_id}",
            f"# Generated: {datetime.utcnow().isoformat()}",
            ""
        ]
        
        for sched in schedules:
            if not sched.get("enabled", True):
                continue
            
            command = sched.get("command", {})
            command_str = command.get("command_name", "")
            annotation = command.get("annotation", sched.get("name", ""))
            
            if command_str:
                lines.append(f"# {annotation}")
                lines.append(f"{sched['cron_expression']} {command_str}")
                lines.append("")
        
        return "\n".join(lines)
