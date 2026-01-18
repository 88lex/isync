"""
Tests for the new iSync refactor modules:
- Database models
- ConfigManager
- MonitorService (mocked)
"""
import sys
sys.path.insert(0, "/opt/isync")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models.models import AppConfig, UnionGroup, SharedDrive, CapacityAlert, SyncPair, WorkspaceUser
from backend.config_manager import ConfigManager


@pytest.fixture
def test_db():
    """Create an in-memory database for testing."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestSession()
    yield db
    db.close()


class TestDatabaseModels:
    """Test SQLAlchemy models."""
    
    def test_create_app_config(self, test_db):
        """Test creating AppConfig entries."""
        config = AppConfig(key="test_key", value="test_value", description="A test setting")
        test_db.add(config)
        test_db.commit()
        
        retrieved = test_db.query(AppConfig).filter_by(key="test_key").first()
        assert retrieved is not None
        assert retrieved.value == "test_value"
    
    def test_create_union_group_with_drives(self, test_db):
        """Test UnionGroup with related SharedDrives."""
        # Create union group
        ug = UnionGroup(name="test-union", remote_name="test-union-remote")
        test_db.add(ug)
        test_db.commit()
        
        # Create drives linked to union
        drive1 = SharedDrive(drive_id="abc123", name="test-drive-01", union_group_id=ug.id)
        drive2 = SharedDrive(drive_id="def456", name="test-drive-02", union_group_id=ug.id)
        test_db.add_all([drive1, drive2])
        test_db.commit()
        
        # Verify relationship
        test_db.refresh(ug)
        assert len(ug.drives) == 2
        assert ug.drives[0].name in ["test-drive-01", "test-drive-02"]
    
    def test_create_capacity_alert(self, test_db):
        """Test CapacityAlert creation."""
        # First create a drive
        drive = SharedDrive(drive_id="xyz789", name="full-drive")
        test_db.add(drive)
        test_db.commit()
        
        # Create alert
        alert = CapacityAlert(
            drive_id=drive.id,
            alert_type="FILE_COUNT",
            message="CRITICAL: Drive is full!"
        )
        test_db.add(alert)
        test_db.commit()
        
        # Verify
        retrieved = test_db.query(CapacityAlert).filter_by(drive_id=drive.id).first()
        assert retrieved is not None
        assert "CRITICAL" in retrieved.message
        assert retrieved.is_resolved == False
    
    def test_create_sync_pair(self, test_db):
        """Test SyncPair creation."""
        pair = SyncPair(
            source="/local/path",
            dest="remote:path",
            domain_reference="example.com",
            description="Test sync pair"
        )
        test_db.add(pair)
        test_db.commit()
        
        retrieved = test_db.query(SyncPair).first()
        assert retrieved.source == "/local/path"
        assert retrieved.dest == "remote:path"
    
    def test_create_workspace_user(self, test_db):
        """Test WorkspaceUser creation."""
        user = WorkspaceUser(
            email="test@example.com",
            domain_name="example.com",
            status="ACTIVE"
        )
        test_db.add(user)
        test_db.commit()
        
        retrieved = test_db.query(WorkspaceUser).filter_by(email="test@example.com").first()
        assert retrieved is not None
        assert retrieved.status == "ACTIVE"


class TestConfigManager:
    """Test ConfigManager singleton behavior."""
    
    def test_singleton_pattern(self):
        """Verify ConfigManager is a singleton."""
        cm1 = ConfigManager()
        cm2 = ConfigManager()
        assert cm1 is cm2


# Run standalone
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
