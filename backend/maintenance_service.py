"""
Database Maintenance Service
Provides health checks, cleanup, and integrity verification for the ISync database.
"""
import os
from datetime import datetime, timedelta
from typing import Dict, Any, List
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import engine, SessionLocal, init_db
from backend.models.models import (
    DataCache, NodeStats, SSHServer, Schedule, BatchGroup, DomainStats, SyncPair
)
from backend.logging_config import get_logger

logger = get_logger("isync.maintenance")


class DatabaseMaintenanceService:
    """Service for database maintenance operations."""
    
    @staticmethod
    def run_integrity_check() -> Dict[str, Any]:
        """
        Run SQLite PRAGMA integrity_check.
        Returns status and any issues found.
        """
        try:
            with engine.connect() as conn:
                result = conn.execute(text("PRAGMA integrity_check"))
                rows = result.fetchall()
                
                if rows and rows[0][0] == "ok":
                    return {
                        "status": "healthy",
                        "message": "Database integrity check passed",
                        "details": []
                    }
                else:
                    issues = [row[0] for row in rows]
                    logger.warning(f"[Maintenance] Integrity check found issues: {issues}")
                    return {
                        "status": "issues_found",
                        "message": f"Found {len(issues)} integrity issues",
                        "details": issues
                    }
        except Exception as e:
            logger.error(f"[Maintenance] Integrity check failed: {e}")
            return {
                "status": "error",
                "message": str(e),
                "details": []
            }
    
    @staticmethod
    def run_vacuum() -> Dict[str, Any]:
        """
        Run VACUUM to reclaim disk space and optimize database.
        """
        try:
            # Get size before
            db_path = os.environ.get("ISYNC_DB_PATH", "isync.db")
            size_before = os.path.getsize(db_path) if os.path.exists(db_path) else 0
            
            with engine.connect() as conn:
                conn.execute(text("VACUUM"))
                conn.commit()
            
            # Get size after
            size_after = os.path.getsize(db_path) if os.path.exists(db_path) else 0
            saved = size_before - size_after
            
            logger.info(f"[Maintenance] VACUUM complete. Saved {saved} bytes")
            return {
                "status": "success",
                "size_before": size_before,
                "size_after": size_after,
                "bytes_saved": saved
            }
        except Exception as e:
            logger.error(f"[Maintenance] VACUUM failed: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    @staticmethod
    def clean_old_logs(days: int = 30) -> Dict[str, Any]:
        """
        Clean job logs older than specified days.
        Uses the separate job history database.
        """
        try:
            from backend.models.db import SessionLocal as HistorySession, JobRun, JobLog
            
            cutoff = datetime.utcnow() - timedelta(days=days)
            
            db = HistorySession()
            try:
                # Count before
                count_before = db.query(JobRun).count()
                
                # Delete old runs (cascades to logs)
                deleted = db.query(JobRun).filter(JobRun.started_at < cutoff).delete()
                db.commit()
                
                logger.info(f"[Maintenance] Cleaned {deleted} job runs older than {days} days")
                return {
                    "status": "success",
                    "deleted_runs": deleted,
                    "cutoff_date": cutoff.isoformat(),
                    "remaining_runs": count_before - deleted
                }
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"[Maintenance] Log cleanup failed: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    @staticmethod
    def clean_orphaned_cache(db: Session) -> Dict[str, Any]:
        """
        Remove DataCache entries for resources that are stale.
        Entries older than 7 days with no recent access are considered orphaned.
        """
        try:
            cutoff = datetime.utcnow() - timedelta(days=7)
            
            # Count stale cache entries
            stale_entries = db.query(DataCache).filter(DataCache.fetched_at < cutoff).all()
            deleted_count = 0
            
            for entry in stale_entries:
                db.delete(entry)
                deleted_count += 1
            
            db.commit()
            
            logger.info(f"[Maintenance] Cleaned {deleted_count} stale cache entries")
            return {
                "status": "success",
                "deleted_entries": deleted_count,
                "cutoff_date": cutoff.isoformat()
            }
        except Exception as e:
            db.rollback()
            logger.error(f"[Maintenance] Cache cleanup failed: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    @staticmethod
    def validate_references(db: Session) -> Dict[str, Any]:
        """
        Check for referential integrity issues.
        - Schedules pointing to non-existent SSH servers
        - SyncPairs pointing to non-existent SSH servers
        """
        issues = []
        
        try:
            # Check schedules with invalid server references
            schedules = db.query(Schedule).filter(
                Schedule.execution_context == "SSH",
                Schedule.target_server_id.isnot(None)
            ).all()
            
            for schedule in schedules:
                server = db.query(SSHServer).filter(SSHServer.id == schedule.target_server_id).first()
                if not server:
                    issues.append({
                        "type": "orphaned_schedule",
                        "schedule_id": schedule.id,
                        "schedule_name": schedule.name,
                        "missing_server_id": schedule.target_server_id
                    })
            
            # Check sync pairs with invalid server references
            sync_pairs = db.query(SyncPair).filter(
                SyncPair.meta_server_id.isnot(None)
            ).all()
            
            for pair in sync_pairs:
                server = db.query(SSHServer).filter(SSHServer.id == pair.meta_server_id).first()
                if not server:
                    issues.append({
                        "type": "orphaned_sync_pair",
                        "sync_pair_id": pair.id,
                        "source": pair.source,
                        "dest": pair.dest,
                        "missing_server_id": pair.meta_server_id
                    })
            
            status = "healthy" if not issues else "issues_found"
            logger.info(f"[Maintenance] Reference validation: {len(issues)} issues found")
            
            return {
                "status": status,
                "issues_count": len(issues),
                "issues": issues
            }
        except Exception as e:
            logger.error(f"[Maintenance] Reference validation failed: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
    
    @staticmethod
    def get_database_stats(db: Session) -> Dict[str, Any]:
        """
        Get statistics about the database.
        """
        try:
            db_path = os.environ.get("ISYNC_DB_PATH", "isync.db")
            
            stats = {
                "database_file": db_path,
                "file_size_bytes": os.path.getsize(db_path) if os.path.exists(db_path) else 0,
                "tables": {}
            }
            
            # Count records in each table
            stats["tables"]["ssh_servers"] = db.query(SSHServer).count()
            stats["tables"]["batch_groups"] = db.query(BatchGroup).count()
            stats["tables"]["sync_pairs"] = db.query(SyncPair).count()
            stats["tables"]["schedules"] = db.query(Schedule).count()
            stats["tables"]["data_cache"] = db.query(DataCache).count()
            stats["tables"]["node_stats"] = db.query(NodeStats).count()
            stats["tables"]["domain_stats"] = db.query(DomainStats).count()

            
            # Get last modified time
            if os.path.exists(db_path):
                stats["last_modified"] = datetime.fromtimestamp(os.path.getmtime(db_path)).isoformat()
            
            return stats
            
        except Exception as e:
            logger.error(f"[Maintenance] Failed to get stats: {e}")
            return {"status": "error", "message": str(e)}
    
    @staticmethod
    def run_full_maintenance(clean_logs_days: int = 30) -> Dict[str, Any]:
        """
        Run a complete maintenance cycle.
        """
        logger.info("[Maintenance] Starting full maintenance cycle...")
        
        db = SessionLocal()
        try:
            results = {
                "timestamp": datetime.utcnow().isoformat(),
                "integrity_check": DatabaseMaintenanceService.run_integrity_check(),
                "validate_references": DatabaseMaintenanceService.validate_references(db),
                "clean_cache": DatabaseMaintenanceService.clean_orphaned_cache(db),
                "clean_logs": DatabaseMaintenanceService.clean_old_logs(clean_logs_days),
                "vacuum": DatabaseMaintenanceService.run_vacuum(),
                "stats": DatabaseMaintenanceService.get_database_stats(db)
            }
            
            # Overall status
            all_ok = all(
                r.get("status") in ["success", "healthy"] 
                for r in [
                    results["integrity_check"],
                    results["validate_references"],
                    results["vacuum"]
                ]
            )
            results["overall_status"] = "healthy" if all_ok else "attention_needed"
            
            logger.info(f"[Maintenance] Full maintenance complete. Status: {results['overall_status']}")
            return results
            
        finally:
            db.close()


# Convenience function for CLI
def run_maintenance():
    """Run maintenance from command line."""
    result = DatabaseMaintenanceService.run_full_maintenance()
    import json
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    run_maintenance()
