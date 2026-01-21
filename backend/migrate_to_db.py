"""
Migration Utility: YAML/JSON to SQLite Database
Migrates SSH servers, Batch Groups, Sync Pairs, and Schedules from file-based storage to the database.

Run with:
    python -m backend.migrate_to_db
"""
import os
import json
import uuid
from datetime import datetime
from sqlalchemy.orm import Session

from backend.database import engine, SessionLocal, init_db, Base
from backend.models.models import SSHServer, BatchGroup, Schedule, SyncPair
from backend.store import store
from backend.logging_config import get_logger

logger = get_logger("isync.migration")

# Paths for JSON files
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH_GROUPS_FILE = os.path.join(BASE_DIR, "batch", ".batch_groups.json")
CRONTAB_CONFIGS_FILE = os.path.join(BASE_DIR, "server_files", "cron", ".crontab_configs.json")
SCHEDULED_JOBS_FILE = os.path.join(BASE_DIR, "scheduled_jobs.json")
SYNCLIST_FILE = os.path.join(BASE_DIR, "synclist.yaml")


def migrate_ssh_servers(db: Session) -> dict:
    """Migrate SSH servers from config.yaml to database."""
    results = {"migrated": 0, "skipped": 0, "errors": []}
    
    config = store.get_config()
    servers = config.get("ssh_servers", [])
    
    if not servers:
        logger.info("[Migration] No SSH servers found in config.yaml")
        return results
    
    for srv in servers:
        try:
            # Check if already exists
            existing = db.query(SSHServer).filter(SSHServer.id == srv.get("id")).first()
            if existing:
                logger.info(f"[Migration] SSH Server '{srv.get('name')}' already exists, skipping")
                results["skipped"] += 1
                continue
            
            # Create new record
            new_server = SSHServer(
                id=srv.get("id") or str(uuid.uuid4())[:8],
                name=srv.get("name"),
                alias=srv.get("alias"),
                host=srv.get("host"),
                port=srv.get("port", 22),
                user=srv.get("user"),
                key_path=srv.get("key_path"),
                remote_path=srv.get("remote_path", "/opt/isync"),
                is_default=srv.get("is_default", False),
                created_at=datetime.utcnow()
            )
            db.add(new_server)
            db.commit()
            logger.info(f"[Migration] Migrated SSH Server: {new_server.name}")
            results["migrated"] += 1
            
        except Exception as e:
            db.rollback()
            logger.error(f"[Migration] Failed to migrate SSH server {srv.get('name')}: {e}")
            results["errors"].append({"server": srv.get("name"), "error": str(e)})
    
    return results


def migrate_batch_groups(db: Session) -> dict:
    """Migrate batch groups from .batch_groups.json to database."""
    results = {"migrated": 0, "skipped": 0, "errors": []}
    
    if not os.path.exists(BATCH_GROUPS_FILE):
        logger.info("[Migration] No batch_groups.json found")
        return results
    
    try:
        with open(BATCH_GROUPS_FILE, "r") as f:
            groups = json.load(f)
    except Exception as e:
        logger.error(f"[Migration] Failed to read batch_groups.json: {e}")
        results["errors"].append({"file": BATCH_GROUPS_FILE, "error": str(e)})
        return results
    
    for grp in groups:
        try:
            # Check if already exists
            existing = db.query(BatchGroup).filter(BatchGroup.id == grp.get("id")).first()
            if existing:
                logger.info(f"[Migration] BatchGroup '{grp.get('name')}' already exists, skipping")
                results["skipped"] += 1
                continue
            
            # Create new record
            new_group = BatchGroup(
                id=grp.get("id") or str(uuid.uuid4()),
                name=grp.get("name"),
                description=grp.get("description", ""),
                batch_files=json.dumps(grp.get("batch_files", [])),
                created_at=datetime.fromisoformat(grp.get("created_at")) if grp.get("created_at") else datetime.utcnow(),
                updated_at=datetime.fromisoformat(grp.get("updated_at")) if grp.get("updated_at") else datetime.utcnow()
            )
            db.add(new_group)
            db.commit()
            logger.info(f"[Migration] Migrated BatchGroup: {new_group.name}")
            results["migrated"] += 1
            
        except Exception as e:
            db.rollback()
            logger.error(f"[Migration] Failed to migrate BatchGroup {grp.get('name')}: {e}")
            results["errors"].append({"group": grp.get("name"), "error": str(e)})
    
    return results


def migrate_schedules(db: Session) -> dict:
    """Migrate scheduled jobs and crontab configs to unified Schedule table."""
    results = {"migrated": 0, "skipped": 0, "errors": []}
    
    # 1. Migrate local scheduled_jobs.json (APScheduler metadata)
    if os.path.exists(SCHEDULED_JOBS_FILE):
        try:
            with open(SCHEDULED_JOBS_FILE, "r") as f:
                jobs = json.load(f)
            
            for job_id, job_data in jobs.items():
                try:
                    existing = db.query(Schedule).filter(Schedule.id == job_id).first()
                    if existing:
                        results["skipped"] += 1
                        continue
                    
                    new_schedule = Schedule(
                        id=job_id,
                        name=job_data.get("name", "Unnamed Job"),
                        cron_expression=job_data.get("cron_expression", "0 * * * *"),
                        command_type=job_data.get("job_type", "sync"),
                        command=json.dumps({
                            "source": job_data.get("source"),
                            "dest": job_data.get("dest"),
                            "domain_reference": job_data.get("domain_reference"),
                            "dry_run": job_data.get("dry_run", False),
                            "task_name": job_data.get("task_name"),
                            "task_args": job_data.get("task_args", {})
                        }),
                        execution_context="LOCAL",
                        target_server_id=None,
                        enabled=job_data.get("enabled", True),
                        last_run=datetime.fromisoformat(job_data["last_run"]) if job_data.get("last_run") else None,
                        created_at=datetime.utcnow()
                    )
                    db.add(new_schedule)
                    db.commit()
                    logger.info(f"[Migration] Migrated Schedule (local): {new_schedule.name}")
                    results["migrated"] += 1
                    
                except Exception as e:
                    db.rollback()
                    logger.error(f"[Migration] Failed to migrate schedule {job_id}: {e}")
                    results["errors"].append({"schedule": job_id, "error": str(e)})
                    
        except Exception as e:
            logger.error(f"[Migration] Failed to read scheduled_jobs.json: {e}")
            results["errors"].append({"file": SCHEDULED_JOBS_FILE, "error": str(e)})
    
    # 2. Migrate remote crontab configs
    if os.path.exists(CRONTAB_CONFIGS_FILE):
        try:
            with open(CRONTAB_CONFIGS_FILE, "r") as f:
                cron_configs = json.load(f)
            
            for cfg in cron_configs:
                server_id = cfg.get("server_id")
                entries = cfg.get("entries", [])
                
                for entry in entries:
                    try:
                        entry_id = entry.get("id") or f"cron_{server_id}_{str(uuid.uuid4())[:8]}"
                        
                        existing = db.query(Schedule).filter(Schedule.id == entry_id).first()
                        if existing:
                            results["skipped"] += 1
                            continue
                        
                        new_schedule = Schedule(
                            id=entry_id,
                            name=entry.get("annotation") or f"Cron: {entry.get('command_name')}",
                            cron_expression=entry.get("cron_expression", "0 * * * *"),
                            command_type=entry.get("command_type", "batch"),
                            command=json.dumps({
                                "command_name": entry.get("command_name"),
                                "annotation": entry.get("annotation", "")
                            }),
                            execution_context="SSH",
                            target_server_id=server_id,
                            enabled=entry.get("enabled", True),
                            created_at=datetime.utcnow()
                        )
                        db.add(new_schedule)
                        db.commit()
                        logger.info(f"[Migration] Migrated Schedule (cron): {new_schedule.name} -> {server_id}")
                        results["migrated"] += 1
                        
                    except Exception as e:
                        db.rollback()
                        logger.error(f"[Migration] Failed to migrate cron entry: {e}")
                        results["errors"].append({"entry": entry.get("id"), "error": str(e)})
                        
        except Exception as e:
            logger.error(f"[Migration] Failed to read crontab_configs.json: {e}")
            results["errors"].append({"file": CRONTAB_CONFIGS_FILE, "error": str(e)})
    
    return results


def migrate_sync_pairs(db: Session) -> dict:
    """Migrate sync pairs from synclist.yaml to database."""
    results = {"migrated": 0, "skipped": 0, "errors": []}
    
    # Get sync pairs from store (which reads from synclist.yaml)
    pairs = store.get_sync_pairs()
    
    if not pairs:
        logger.info("[Migration] No sync pairs found in synclist.yaml")
        return results
    
    for pair in pairs:
        try:
            # Check if already exists by source/dest
            existing = db.query(SyncPair).filter(
                SyncPair.source == pair.get("source"),
                SyncPair.dest == pair.get("dest")
            ).first()
            
            if existing:
                logger.info(f"[Migration] SyncPair '{pair.get('source')} -> {pair.get('dest')}' already exists, skipping")
                results["skipped"] += 1
                continue
            
            new_pair = SyncPair(
                source=pair.get("source"),
                dest=pair.get("dest"),
                domain_reference=pair.get("domain_reference"),
                source_type=pair.get("source_type", "LOCAL"),
                source_server_id=pair.get("source_server_id"),
                dest_type=pair.get("dest_type", "LOCAL"),
                dest_server_id=pair.get("dest_server_id"),
                meta_server_id=pair.get("meta_server_id"),
                meta_execution_mode=pair.get("meta_execution_mode", "local"),
                description=pair.get("description")
            )
            db.add(new_pair)
            db.commit()
            logger.info(f"[Migration] Migrated SyncPair: {new_pair.source} -> {new_pair.dest}")
            results["migrated"] += 1
            
        except Exception as e:
            db.rollback()
            logger.error(f"[Migration] Failed to migrate SyncPair: {e}")
            results["errors"].append({"pair": f"{pair.get('source')} -> {pair.get('dest')}", "error": str(e)})
    
    return results


def run_migration():
    """Run the full migration."""
    logger.info("=" * 60)
    logger.info("[Migration] Starting database migration...")
    logger.info("=" * 60)
    
    # Ensure tables exist
    init_db()
    
    db = SessionLocal()
    try:
        # 1. Migrate SSH Servers
        logger.info("\n[Migration] Phase 1: SSH Servers")
        ssh_results = migrate_ssh_servers(db)
        logger.info(f"[Migration] SSH Servers: {ssh_results['migrated']} migrated, {ssh_results['skipped']} skipped, {len(ssh_results['errors'])} errors")
        
        # 2. Migrate Batch Groups
        logger.info("\n[Migration] Phase 2: Batch Groups")
        batch_results = migrate_batch_groups(db)
        logger.info(f"[Migration] Batch Groups: {batch_results['migrated']} migrated, {batch_results['skipped']} skipped, {len(batch_results['errors'])} errors")
        
        # 3. Migrate Sync Pairs
        logger.info("\n[Migration] Phase 3: Sync Pairs")
        sync_results = migrate_sync_pairs(db)
        logger.info(f"[Migration] Sync Pairs: {sync_results['migrated']} migrated, {sync_results['skipped']} skipped, {len(sync_results['errors'])} errors")
        
        # 4. Migrate Schedules
        logger.info("\n[Migration] Phase 4: Schedules")
        schedule_results = migrate_schedules(db)
        logger.info(f"[Migration] Schedules: {schedule_results['migrated']} migrated, {schedule_results['skipped']} skipped, {len(schedule_results['errors'])} errors")
        
        # Summary
        total_migrated = ssh_results["migrated"] + batch_results["migrated"] + sync_results["migrated"] + schedule_results["migrated"]
        total_errors = len(ssh_results["errors"]) + len(batch_results["errors"]) + len(sync_results["errors"]) + len(schedule_results["errors"])
        
        logger.info("\n" + "=" * 60)
        logger.info(f"[Migration] COMPLETE: {total_migrated} records migrated, {total_errors} errors")
        logger.info("=" * 60)
        
        return {
            "ssh_servers": ssh_results,
            "batch_groups": batch_results,
            "sync_pairs": sync_results,
            "schedules": schedule_results,
            "summary": {"total_migrated": total_migrated, "total_errors": total_errors}
        }
        
    finally:
        db.close()


if __name__ == "__main__":
    run_migration()

