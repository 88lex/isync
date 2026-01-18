import sys
import os
sys.path.append("/opt/isync")

from backend.config_manager import config_manager
from backend.models import AppConfig, SyncPair, WorkspaceUser
from backend.database import SessionLocal

def test_migration():
    print("Verifying Migration...")
    
    # Check Settings
    company = config_manager.get_setting("company_name")
    print(f"Company Name: {company}")
    assert company == "Internal Ops" or company is not None
    
    # Check Sync Pairs
    with SessionLocal() as db:
        pairs = db.query(SyncPair).all()
        print(f"Sync Pairs Found: {len(pairs)}")
        for p in pairs:
            print(f" - {p.source} -> {p.dest} ({p.domain_reference})")
        
        users = db.query(WorkspaceUser).all()
        print(f"Users Found: {len(users)}")
        if len(users) > 0:
            print(f" - First User: {users[0].email} ({users[0].status})")

if __name__ == "__main__":
    test_migration()
