"""
Job Scheduler for ISync.
Provides cron-like scheduling for automated sync jobs using APScheduler.
"""
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.executors.pool import ThreadPoolExecutor
import json
import os

logger = logging.getLogger(__name__)

# Database for persisting scheduled jobs
SCHEDULER_DB = os.environ.get("ISYNC_SCHEDULER_DB", "sqlite:///isync_schedules.db")


class ScheduledJob:
    """Represents a scheduled sync job configuration."""
    
    def __init__(
        self,
        id: str,
        name: str,
        source: str,
        dest: str,
        cron_expression: str,
        domain_reference: Optional[str] = None,
        dry_run: bool = False,
        enabled: bool = True,
        last_run: Optional[datetime] = None,
        next_run: Optional[datetime] = None,
        job_type: str = "sync", # or "task"
        task_name: Optional[str] = None,
        task_args: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.name = name
        self.source = source
        self.dest = dest
        self.cron_expression = cron_expression
        self.domain_reference = domain_reference
        self.dry_run = dry_run
        self.enabled = enabled
        self.created_at = created_at or datetime.utcnow()
        self.last_run = last_run
        self.next_run = next_run
        self.job_type = job_type
        self.task_name = task_name
        self.task_args = task_args or {}
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "dest": self.dest,
            "cron_expression": self.cron_expression,
            "domain_reference": self.domain_reference,
            "dry_run": self.dry_run,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "next_run": self.next_run.isoformat() if self.next_run else None,
            "job_type": self.job_type,
            "task_name": self.task_name,
            "task_args": self.task_args,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ScheduledJob":
        return cls(
            id=data["id"],
            name=data["name"],
            source=data["source"],
            dest=data["dest"],
            cron_expression=data["cron_expression"],
            domain_reference=data.get("domain_reference"),
            dry_run=data.get("dry_run", False),
            enabled=data.get("enabled", True),
        )


class ISyncScheduler:
    """
    Manages scheduled sync jobs using APScheduler.
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        
        # Configure job stores and executors
        jobstores = {
            'default': SQLAlchemyJobStore(url=SCHEDULER_DB)
        }
        executors = {
            'default': ThreadPoolExecutor(max_workers=2)
        }
        job_defaults = {
            'coalesce': True,  # Combine missed runs into one
            'max_instances': 1,  # Only one instance of each job at a time
            'misfire_grace_time': 3600  # 1 hour grace period for missed jobs
        }
        
        self.scheduler = BackgroundScheduler(
            jobstores=jobstores,
            executors=executors,
            job_defaults=job_defaults,
            timezone='UTC'
        )
        
        # Store for job metadata (APScheduler doesn't store custom data well)
        self.job_metadata_file = "scheduled_jobs.json"
        self.job_metadata: Dict[str, ScheduledJob] = {}
        self._load_metadata()
        
        # Reference to job manager (set externally)
        self.job_manager = None
        
        logger.info("[Scheduler] Initialized")
    
    def _load_metadata(self):
        """Load job metadata from file."""
        if os.path.exists(self.job_metadata_file):
            try:
                with open(self.job_metadata_file, 'r') as f:
                    data = json.load(f)
                    for job_id, job_data in data.items():
                        self.job_metadata[job_id] = ScheduledJob.from_dict(job_data)
            except Exception as e:
                logger.error(f"[Scheduler] Failed to load metadata: {e}")
    
    def _save_metadata(self):
        """Save job metadata to file."""
        try:
            data = {job_id: job.to_dict() for job_id, job in self.job_metadata.items()}
            with open(self.job_metadata_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"[Scheduler] Failed to save metadata: {e}")
    
    def start(self):
        """Start the scheduler."""
        if not self.scheduler.running:
            self.scheduler.start()
            logger.info("[Scheduler] Started")
    
    def stop(self):
        """Stop the scheduler."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("[Scheduler] Stopped")
    
    def _execute_scheduled_job(self, job_id: str):
        """Execute a scheduled job."""
        job = self.job_metadata.get(job_id)
        if not job:
            logger.error(f"[Scheduler] Job {job_id} not found in metadata")
            return
        
        if not job.enabled:
            logger.info(f"[Scheduler] Job {job_id} is disabled, skipping")
            return
        
        logger.info(f"[Scheduler] Executing scheduled job: {job.name}")
        
        # Update last run time
        job.last_run = datetime.utcnow()
        self._save_metadata()
        
        if job.job_type == "task":
            if job.task_name == "storage_audit":
                from backend.storage_service import StorageAuditService
                logger.info(f"[Scheduler] Executing Storage Audit task for {job.domain_reference}")
                try:
                    # Run the async audit in a synchronous wrapper since APScheduler uses threads
                    import asyncio
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    loop.run_until_complete(
                        StorageAuditService.audit_all_drives_for_domain(
                            job.domain_reference or "all", 
                            job.task_args.get("server_id", "local")
                        )
                    )
                    loop.close()
                except Exception as e:
                    logger.error(f"[Scheduler] Storage Audit failed: {e}")
            else:
                logger.warning(f"[Scheduler] Unknown task type: {job.task_name}")
        
        elif self.job_manager:
            try:
                pair = {
                    "source": job.source,
                    "dest": job.dest,
                    "domain_reference": job.domain_reference
                }
                self.job_manager.start_job([pair], dry_run=job.dry_run)
            except Exception as e:
                logger.error(f"[Scheduler] Failed to execute job {job_id}: {e}")
        else:
            logger.warning("[Scheduler] No job manager available")
    
    def add_job(
        self,
        name: str,
        source: str,
        dest: str,
        cron_expression: str,
        domain_reference: Optional[str] = None,
        dry_run: bool = False,
        job_type: str = "sync",
        task_name: Optional[str] = None,
        task_args: Optional[Dict[str, Any]] = None
    ) -> ScheduledJob:
        """
        Add a new scheduled job.
        
        Args:
            name: Human-readable job name
            source: Source path for sync
            dest: Destination path for sync
            cron_expression: Cron expression (e.g., "0 2 * * *" for 2 AM daily)
            domain_reference: Optional domain reference
            dry_run: Whether to run in dry-run mode
            
        Returns:
            The created ScheduledJob
        """
        import uuid
        job_id = f"schedule_{uuid.uuid4().hex[:8]}"
        
        # Parse cron expression
        try:
            trigger = CronTrigger.from_crontab(cron_expression)
        except Exception as e:
            raise ValueError(f"Invalid cron expression: {e}")
        
        # Create metadata
        job = ScheduledJob(
            id=job_id,
            name=name,
            source=source,
            dest=dest,
            cron_expression=cron_expression,
            domain_reference=domain_reference,
            dry_run=dry_run,
            enabled=True,
            job_type=job_type,
            task_name=task_name,
            task_args=task_args
        )
        
        # Add to APScheduler
        self.scheduler.add_job(
            self._execute_scheduled_job,
            trigger=trigger,
            id=job_id,
            args=[job_id],
            replace_existing=True
        )
        
        # Get next run time
        apscheduler_job = self.scheduler.get_job(job_id)
        if apscheduler_job:
            job.next_run = apscheduler_job.next_run_time
        
        # Save metadata
        self.job_metadata[job_id] = job
        self._save_metadata()
        
        logger.info(f"[Scheduler] Added job: {name} ({cron_expression})")
        return job
    
    def remove_job(self, job_id: str) -> bool:
        """Remove a scheduled job."""
        try:
            self.scheduler.remove_job(job_id)
        except Exception:
            pass  # Job might not exist in scheduler
        
        if job_id in self.job_metadata:
            del self.job_metadata[job_id]
            self._save_metadata()
            logger.info(f"[Scheduler] Removed job: {job_id}")
            return True
        return False
    
    def pause_job(self, job_id: str) -> bool:
        """Pause a scheduled job."""
        if job_id in self.job_metadata:
            self.job_metadata[job_id].enabled = False
            self._save_metadata()
            try:
                self.scheduler.pause_job(job_id)
            except Exception:
                pass
            return True
        return False
    
    def resume_job(self, job_id: str) -> bool:
        """Resume a paused job."""
        if job_id in self.job_metadata:
            self.job_metadata[job_id].enabled = True
            self._save_metadata()
            try:
                self.scheduler.resume_job(job_id)
            except Exception:
                pass
            return True
        return False
    
    def list_jobs(self) -> List[ScheduledJob]:
        """List all scheduled jobs."""
        # Update next run times from scheduler
        for job_id, job in self.job_metadata.items():
            try:
                apscheduler_job = self.scheduler.get_job(job_id)
                if apscheduler_job:
                    job.next_run = apscheduler_job.next_run_time
            except Exception:
                pass
        
        return list(self.job_metadata.values())
    
    def get_job(self, job_id: str) -> Optional[ScheduledJob]:
        """Get a specific job by ID."""
        return self.job_metadata.get(job_id)


# Singleton instance
scheduler = ISyncScheduler()
