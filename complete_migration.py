import yaml
import os
import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.models.models import AppConfig
from backend.database import DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
session = SessionLocal()

def migrate():
    if not os.path.exists("config.yaml"):
        print("config.yaml not found.")
        return

    with open("config.yaml", 'r') as f:
        config = yaml.safe_load(f) or {}

    print(f"Loaded {len(config)} keys from config.yaml")
    
    migrated_count = 0
    for key, val in config.items():
        if key in ['sync_pairs', 'ssh_servers']:
            print(f"Skipping specialized key: {key}")
            continue

        # Convert value to string
        val_str = ""
        if isinstance(val, (dict, list)):
            val_str = json.dumps(val)
        else:
            val_str = str(val)

        # Upsert
        existing = session.query(AppConfig).filter(AppConfig.key == key).first()
        if existing:
            if existing.value != val_str:
                existing.value = val_str
                print(f"Updated {key}")
        else:
            new_conf = AppConfig(key=key, value=val_str)
            session.add(new_conf)
            print(f"Added {key}")
            migrated_count += 1
            
    session.commit()
    print(f"Migration complete. Added {migrated_count} new keys.")
    session.close()

if __name__ == "__main__":
    migrate()
