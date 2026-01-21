import yaml
import os
import shutil
import logging
import json
from threading import RLock
from datetime import datetime
from typing import Optional, Dict, Any, List

logger = logging.getLogger("isync_store")

# Constants - absolute paths based on this file's location
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURRENT_CONFIG_FILE = os.path.join(BASE_DIR, "config.yaml")
DEFAULT_CONFIG_FILE = os.path.join(BASE_DIR, "default_config.yaml")
CONFIGS_DIR = os.path.join(BASE_DIR, "configs")
SYNCLIST_FILE = os.path.join(BASE_DIR, "synclist.yaml")
KEYS_DIR = os.path.join(BASE_DIR, "keys")
LOGS_DIR = os.path.join(BASE_DIR, "logs")
BACKUPS_DIR = os.path.join(BASE_DIR, "backups")
DEFAULT_SA_JSON_PATH = os.path.join(KEYS_DIR, "master.json")
LOG_FILE_PATH = os.path.join(LOGS_DIR, "isync.log")

# Auto-backup settings
MAX_AUTO_BACKUPS = 10
BACKUP_PREFIX = "config_autobackup_"


class ConfigStore:
    """
    DB-Backed Configuration Manager.
    Replaces legacy YAML file storage.
    """
    _instance = None
    _lock = RLock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(ConfigStore, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._ensure_directories()
        # No initial load needed, getters fetch from DB
        logger.info("[ConfigStore] Initialized (DB-Backed).")

    def _ensure_directories(self):
        """Ensure required directories exist (for logs, keys, etc)."""
        for dir_path in [KEYS_DIR, LOGS_DIR, BACKUPS_DIR]:
            os.makedirs(dir_path, exist_ok=True)

    def get_hardcoded_defaults(self) -> Dict[str, Any]:
        """Returns default configuration values."""
        return {
            'upload_limit': '700G',
            'transfers': 8,
            'default_source': '',
            'default_dest': '',
            'max_users_per_cycle': 10,
            'company_name': 'Internal Ops',
            'rotation_strategy': 'existing', 
            'existing_users_file': 'users.txt',
            'rclone_command': 'copy',
            'rclone_chunk_size': '128M',
            'rclone_stats_interval': '1s',
            'stall_timeout_minutes': 10,
            'webhook_url': '',
            'global_rclone_flags': '',
            'ssh_enabled': False,
            'ssh_mode': 'explicit',
            'ssh_host': '',
            'ssh_user': '',
            'ssh_key_path': '',
            'ssh_alias': '',
            'ssh_remote_path': '~/isync',
            'ssh_connect_timeout': 10,
            'protected_users': [],
            'include_protected_users': False,
            'step_check': False,
            'domains': [],
            'ssh_servers': [],
            'known_emails': [],
            'always_included_managers': [],
            'excluded_drives': [],
            'excluded_remotes': []
        }

    def load_all(self):
        """No-op for compatibility."""
        pass

    def get_config(self) -> Dict[str, Any]:
        """Get current config from DB."""
        from backend.database import SessionLocal
        from backend.models.models import AppConfig, SSHServer
        
        db = SessionLocal()
        try:
            # 1. Fetch Scalars/Lists from AppConfig
            rows = db.query(AppConfig).all()
            db_conf = {r.key: r.value for r in rows}
            
            defaults = self.get_hardcoded_defaults()
            final_conf = defaults.copy()
            
            # Merge and Type Cast
            for k, v in db_conf.items():
                if k not in defaults:
                    final_conf[k] = v # Unknown key, keep as string
                    continue
                    
                target_type = type(defaults[k])
                
                try:
                    if target_type == bool:
                        final_conf[k] = v.lower() == 'true'
                    elif target_type == int:
                        final_conf[k] = int(v)
                    elif target_type == float:
                        final_conf[k] = float(v)
                    elif target_type == list or target_type == dict:
                        final_conf[k] = json.loads(v)
                    else:
                        final_conf[k] = v
                except Exception:
                    # Fallback to raw string or default
                    final_conf[k] = v

            # 2. Fetch SSH Servers
            servers = db.query(SSHServer).all()
            server_list = []
            for s in servers:
                s_dict = {c.name: getattr(s, c.name) for c in s.__table__.columns}
                if 'created_at' in s_dict and s_dict['created_at']:
                    s_dict['created_at'] = s_dict['created_at'].isoformat()
                if 'last_connected_at' in s_dict and s_dict['last_connected_at']:
                    s_dict['last_connected_at'] = s_dict['last_connected_at'].isoformat()
                server_list.append(s_dict)
            
            final_conf['ssh_servers'] = server_list
            
            return final_conf
        except Exception as e:
            logger.error(f"[ConfigStore] Failed to fetch config from DB: {e}")
            return self.get_hardcoded_defaults()
        finally:
            db.close()

    def get_sync_pairs(self) -> List[Dict]:
        """Get sync pairs from DB."""
        from backend.repositories.sync_pairs import SyncPairRepository
        from backend.database import SessionLocal
        
        db = SessionLocal()
        try:
            return SyncPairRepository(db).list_all()
        finally:
            db.close()

    def save_config(self, new_config: Optional[Dict[str, Any]] = None) -> bool:
        """Save config updates to DB."""
        if not new_config:
            return True
            
        from backend.database import SessionLocal
        from backend.models.models import AppConfig
        
        db = SessionLocal()
        try:
            for k, v in new_config.items():
                if k == 'ssh_servers': continue # Handle separately via SSH Router/Repo
                
                val_str = ""
                if isinstance(v, (dict, list, bool, int, float)):
                    if isinstance(v, bool):
                        val_str = str(v) # "True" / "False"
                    elif isinstance(v, (dict, list)):
                        val_str = json.dumps(v)
                    else:
                        val_str = str(v)
                else:
                    val_str = str(v)
                    
                # Upsert
                entry = db.query(AppConfig).filter(AppConfig.key == k).first()
                if entry:
                    entry.value = val_str
                else:
                    db.add(AppConfig(key=k, value=val_str))
            
            db.commit()
            return True
        except Exception as e:
            logger.error(f"[ConfigStore] Failed to save config to DB: {e}")
            return False
        finally:
            db.close()

    def save_synclist(self, new_pairs: Optional[List[Dict]] = None) -> bool:
        """Sync Pairs are managed via Repository. Legacy shim."""
        if new_pairs is None:
            return True

        from backend.database import SessionLocal
        from backend.repositories.sync_pairs import SyncPairRepository
        
        db = SessionLocal()
        try:
            # We assume new_pairs is the complete list desired.
            # But SyncPairRepo mostly handles item operations.
            # Implementing full replace logic is risky but matches legacy behavior.
            # For now, we trust specialized Endpoints for Pair management.
            # This method acts as a NO-OP or Partial Warning.
            logger.warning("[ConfigStore] save_synclist called. This method is deprecated by DB migration.")
            return True
        finally:
            db.close()

    def add_known_email(self, email: str):
        """Adds an email to known_emails and saves."""
        # TODO: Implement DB update
        pass

    def reload(self):
        pass

    def get_config_path(self) -> str:
        return CURRENT_CONFIG_FILE

    def get_synclist_path(self) -> str:
        return SYNCLIST_FILE


# Singleton instance
store = ConfigStore()
