import yaml
import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from backend.models.models import SyncPair, AppConfig
from backend.database import DATABASE_URL, Base

# Setup DB connection
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

def verify():
    print("--- Verifying Sync Pairs ---")
    yaml_pairs = []
    if os.path.exists("synclist.yaml"):
        with open("synclist.yaml", 'r') as f:
            data = yaml.safe_load(f) or {}
            yaml_pairs = data.get('sync_pairs', [])
    
    db_pairs = db.query(SyncPair).all()
    
    print(f"YAML Count: {len(yaml_pairs)}")
    print(f"DB Count:   {len(db_pairs)}")
    
    if len(yaml_pairs) != len(db_pairs):
        print("MISMATCH IN COUNT!")
    
    # Check Sample
    if yaml_pairs and db_pairs:
        print(f"Sample YAML: {yaml_pairs[0].get('source')} -> {yaml_pairs[0].get('dest')}")
        print(f"Sample DB:   {db_pairs[0].source} -> {db_pairs[0].dest}")

    print("\n--- Verifying Config ---")
    yaml_config = {}
    if os.path.exists("config.yaml"):
        with open("config.yaml", 'r') as f:
            yaml_config = yaml.safe_load(f) or {}
            
    db_rows = db.query(AppConfig).all()
    db_config = {row.key: row.value for row in db_rows}
        
    # Compare key extraction
    keys_yaml = set(yaml_config.keys())
    keys_db = set(db_config.keys())
    
    # Filter out complex keys migrated to other tables
    keys_yaml.discard('ssh_servers') # Migrated to SSHServer table
    
    print(f"YAML Keys: {len(keys_yaml)}")
    print(f"DB Keys:   {len(keys_db)}")
    
    missing = keys_yaml - keys_db
    if missing:
        print(f"Keys in YAML but missing in DB: {missing}")
    else:
        print("All scalar YAML keys present in DB.")
        
    # Check value sample
    if 'company_name' in db_config:
         print(f"Company: {db_config['company_name']}")

    db.close()

if __name__ == "__main__":
    verify()
