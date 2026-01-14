"""
Database models for ISync job history and logging.
Uses SQLAlchemy with SQLite for persistence.
"""
import os
from datetime import datetime
from typing import Optional, List
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

# Database file path
DB_PATH = os.environ.get("ISYNC_DB_PATH", "isync_history.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Create engine and session
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class JobRun(Base):
    """
    Represents a single job execution.
    """
    __tablename__ = "job_runs"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Job identification
    source = Column(String(500), nullable=False)
    dest = Column(String(500), nullable=False)
    domain_reference = Column(String(255), nullable=True)
    
    # Timing
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    
    # Status
    status = Column(String(50), default="RUNNING", nullable=False)  # RUNNING, SUCCESS, ERROR, STOPPED
    error_message = Column(Text, nullable=True)
    
    # Statistics
    total_bytes_transferred = Column(Float, default=0.0)
    users_processed = Column(Integer, default=0)
    dry_run = Column(Boolean, default=False)
    
    # Relationships
    logs = relationship("JobLog", back_populates="job_run", cascade="all, delete-orphan")
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "dest": self.dest,
            "domain_reference": self.domain_reference,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "status": self.status,
            "error_message": self.error_message,
            "total_bytes_transferred": self.total_bytes_transferred,
            "users_processed": self.users_processed,
            "dry_run": self.dry_run,
        }


class JobLog(Base):
    """
    Log entries for a job run.
    """
    __tablename__ = "job_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    job_run_id = Column(Integer, ForeignKey("job_runs.id"), nullable=False)
    
    # Log entry
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    level = Column(String(20), default="INFO", nullable=False)  # INFO, WARNING, ERROR, DEBUG
    message = Column(Text, nullable=False)
    
    # Optional context
    user_email = Column(String(255), nullable=True)
    
    # Relationship
    job_run = relationship("JobRun", back_populates="logs")
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "job_run_id": self.job_run_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "level": self.level,
            "message": self.message,
            "user_email": self.user_email,
        }


# --- Repository Functions ---

def init_db():
    """Initialize the database tables."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Get a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class JobHistoryRepository:
    """
    Repository for managing job history records.
    """
    
    def __init__(self, session):
        self.session = session
    
    def create_run(
        self,
        source: str,
        dest: str,
        domain_reference: Optional[str] = None,
        dry_run: bool = False
    ) -> JobRun:
        """Create a new job run record."""
        run = JobRun(
            source=source,
            dest=dest,
            domain_reference=domain_reference,
            dry_run=dry_run,
            status="RUNNING"
        )
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run
    
    def complete_run(
        self,
        run_id: int,
        status: str,
        error_message: Optional[str] = None,
        total_bytes: float = 0.0,
        users_processed: int = 0
    ) -> Optional[JobRun]:
        """Mark a job run as complete."""
        run = self.session.query(JobRun).filter(JobRun.id == run_id).first()
        if run:
            run.ended_at = datetime.utcnow()
            run.status = status
            run.error_message = error_message
            run.total_bytes_transferred = total_bytes
            run.users_processed = users_processed
            self.session.commit()
        return run
    
    def add_log(
        self,
        run_id: int,
        message: str,
        level: str = "INFO",
        user_email: Optional[str] = None
    ) -> JobLog:
        """Add a log entry to a job run."""
        log = JobLog(
            job_run_id=run_id,
            message=message,
            level=level,
            user_email=user_email
        )
        self.session.add(log)
        self.session.commit()
        return log
    
    def get_run(self, run_id: int) -> Optional[JobRun]:
        """Get a job run by ID."""
        return self.session.query(JobRun).filter(JobRun.id == run_id).first()
    
    def get_runs(
        self,
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None
    ) -> List[JobRun]:
        """Get job runs with optional filtering."""
        query = self.session.query(JobRun).order_by(JobRun.started_at.desc())
        
        if status:
            query = query.filter(JobRun.status == status)
        
        return query.offset(offset).limit(limit).all()
    
    def get_logs(self, run_id: int, limit: int = 500) -> List[JobLog]:
        """Get logs for a job run."""
        return (
            self.session.query(JobLog)
            .filter(JobLog.job_run_id == run_id)
            .order_by(JobLog.timestamp.asc())
            .limit(limit)
            .all()
        )
    
    def delete_old_runs(self, days: int = 30) -> int:
        """Delete job runs older than specified days."""
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        deleted = (
            self.session.query(JobRun)
            .filter(JobRun.started_at < cutoff)
            .delete()
        )
        self.session.commit()
        return deleted


# Initialize database on import
init_db()
