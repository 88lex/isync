import yaml
import os
import csv
import logging
from sqlalchemy.orm import Session
from backend.database import SessionLocal, init_db, engine
from backend.models.models import AppConfig, SyncPair, WorkspaceUser, UnionGroup

# Setup simple logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migration")

BASE_DIR = "/opt/isync"
CONFIG_FILE = os.path.join(BASE_DIR, "config.yaml")
SYNCLIST_FILE = os.path.join(BASE_DIR, "synclist.yaml")
USERS_TXT = os.path.join(BASE_DIR, "users.txt")
USER_DB_CSV = os.path.join(BASE_DIR, "user_db.csv")

def load_yaml(path):
    if not os.path.exists(path):
        return {}
    with open(path, 'r') as f:
        return yaml.safe_load(f) or {}

def migrate_config(db: Session, config: dict):
    """Migrate scalar values from config.yaml to AppConfig table."""
    logger.info("Migrating Config...")
    
    # Keys to migrate directly
    keys_to_migrate = [
        'upload_limit', 'transfers', 'rclone_command', 'rclone_chunk_size',
        'rclone_stats_interval', 'stall_timeout_minutes', 'webhook_url',
        'global_rclone_flags', 'ssh_enabled', 'ssh_host', 'ssh_user',
        'max_users_per_cycle', 'rotation_strategy', 'company_name'
    ]

    for key in keys_to_migrate:
        val = config.get(key)
        if val is not None:
            # Convert non-strings to strings for storage
            if isinstance(val, (list, dict, bool, int, float)):
                val = str(val)
            
            # Upsert
            existing = db.query(AppConfig).filter_by(key=key).first()
            if not existing:
                db.add(AppConfig(key=key, value=val))
            else:
                existing.value = val
    
    # Migrate Domains (Store as JSON string or separate table? 
    # For now, let's store complex objects as JSON string in AppConfig for simplicity, 
    # or arguably specific tables. The plan didn't specify Domain table, 
    # so we'll store 'domains_config' json for now to preserve structure.)
    import json
    if 'domains' in config:
        val = json.dumps(config['domains'])
        existing = db.query(AppConfig).filter_by(key='domains').first()
        if not existing:
            db.add(AppConfig(key='domains', value=val))
        else:
            existing.value = val

    db.commit()

def migrate_synclist(db: Session):
    """Migrate synclist.yaml to SyncPair table."""
    logger.info("Migrating Sync List...")
    data = load_yaml(SYNCLIST_FILE)
    pairs = data.get('sync_pairs', [])
    
    for p in pairs:
        src = p.get('source')
        dst = p.get('dest')
        if not src or not dst: continue
        
        # Check existence
        exists = db.query(SyncPair).filter_by(source=src, dest=dst).first()
        if not exists:
            db.add(SyncPair(
                source=src,
                dest=dst,
                domain_reference=p.get('domain_reference', ''),
                description=f"Migrated from synclist"
            ))
    db.commit()

def migrate_users(db: Session):
    """Migrate users.txt and user_db.csv to WorkspaceUser table."""
    logger.info("Migrating Users...")
    
    # 1. users.txt (Simple list)
    if os.path.exists(USERS_TXT):
        with open(USERS_TXT, 'r') as f:
            for line in f:
                email = line.strip()
                if not email or '@' not in email: continue
                
                domain = email.split('@')[1]
                exists = db.query(WorkspaceUser).filter_by(email=email).first()
                if not exists:
                    db.add(WorkspaceUser(email=email, domain_name=domain, status='ACTIVE'))
    
    # 2. user_db.csv (Format: Timestamp,Email,Password,Google_ID,ETag,Is_Admin,Org_Unit,Recovery_Email,Status,Suspended)
    if os.path.exists(USER_DB_CSV):
        try:
            with open(USER_DB_CSV, 'r') as f:
                reader = csv.reader(f)
                header = next(reader, None) # Skip header
                for row in reader:
                    if not row or len(row) < 9: continue
                    email = row[1]
                    if '@' not in email: continue
                    
                    domain = email.split('@')[1] if '@' in email else 'unknown'
                    status = row[8] # Status column matches 'Deleted', 'Active' etc
                    
                    exists = db.query(WorkspaceUser).filter_by(email=email).first()
                    if not exists:
                        db.add(WorkspaceUser(email=email, domain_name=domain, status=status))
                    else:
                        existing.status = status 
        except Exception as e:
            logger.error(f"Failed to read CSV: {e}")

    db.commit()

def cleanup_legacy():
    # Optional: Rename old files? For now, we just leave them.
    pass

def run_migration():
    # Ensure tables exist
    init_db()
    
    db = SessionLocal()
    try:
        config = load_yaml(CONFIG_FILE)
        migrate_config(db, config)
        migrate_synclist(db)
        migrate_users(db)
        logger.info("Migration Complete.")
    except Exception as e:
        logger.error(f"Migration Failed: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()
