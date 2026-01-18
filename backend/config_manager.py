from threading import RLock
from typing import Any, Optional, List, Dict
import json
from sqlalchemy.orm import Session
from backend.database import SessionLocal, init_db
from backend.models.models import AppConfig, UnionGroup, SharedDrive, WorkspaceUser

class ConfigManager:
    """
    Singleton for managing application configuration via SQLite.
    Replaces the old file-based ConfigStore.
    """
    _instance = None
    _lock = RLock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(ConfigManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        init_db()  # Ensure tables exist
        self._cache = {} # Optional memory cache for frequenty accessed keys

    def get_db(self) -> Session:
        return SessionLocal()

    def get_setting(self, key: str, default: Any = None) -> Any:
        """Get a global setting from AppConfig."""
        with self.get_db() as db:
            item = db.query(AppConfig).filter(AppConfig.key == key).first()
            if item:
                # Attempt to auto-cast booleans/ints if they look like it
                val = item.value
                if val.lower() == 'true': return True
                if val.lower() == 'false': return False
                try:
                    if val.isdigit(): return int(val)
                except: pass
                return val
            return default

    def set_setting(self, key: str, value: Any, description: str = None):
        """Set a global setting."""
        with self.get_db() as db:
            item = db.query(AppConfig).filter(AppConfig.key == key).first()
            str_val = str(value)
            if item:
                item.value = str_val
                if description: item.description = description
            else:
                db.add(AppConfig(key=key, value=str_val, description=description))
            db.commit()

    def get_all_settings(self) -> Dict[str, Any]:
        """Return all settings as a dict."""
        with self.get_db() as db:
            items = db.query(AppConfig).all()
            return {i.key: i.value for i in items}

    # --- Domain / User Helpers ---

    def get_domains(self) -> List[Dict]:
        """Retrieve domains config (stored as JSON in AppConfig for now)."""
        val = self.get_setting('domains')
        if val and isinstance(val, str):
            try:
                return json.loads(val)
            except:
                return []
        return []

    # --- Union Group Helpers ---
    
    def get_union_group(self, name: str) -> Optional[UnionGroup]:
        with self.get_db() as db:
            return db.query(UnionGroup).filter(UnionGroup.name == name).first()

    def create_union_group(self, name: str, remote_name: str = None) -> UnionGroup:
        with self.get_db() as db:
            ug = UnionGroup(name=name, remote_name=remote_name or f"{name}-union")
            db.add(ug)
            db.commit()
            db.refresh(ug)
            return ug

# Global Instance
config_manager = ConfigManager()
