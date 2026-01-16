import yaml
import os
import shutil
import logging
import json
from threading import Lock
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
    Thread-safe singleton for configuration management.
    
    Features:
    - Atomic writes (write to temp, then rename)
    - Auto-backup before each save
    - Validation before save
    - Graceful degradation with defaults
    """
    _instance = None
    _lock = Lock()

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
        self.config: Dict[str, Any] = {}
        self.sync_pairs: List[Dict] = []
        self._ensure_directories()
        self.load_all()
        logger.info(f"[ConfigStore] Initialized. Config path: {CURRENT_CONFIG_FILE}")

    def _ensure_directories(self):
        """Ensure all required directories exist."""
        for dir_path in [CONFIGS_DIR, KEYS_DIR, LOGS_DIR, BACKUPS_DIR]:
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
            'known_emails': []  # List of known user/group emails
        }

    def load_all(self):
        """Loads both main config and sync list from disk."""
        with self._lock:
            self._load_config()
            self._load_synclist()

    def _load_config(self):
        """Load config from disk, with fallback to defaults."""
        path = CURRENT_CONFIG_FILE
        defaults = self.get_hardcoded_defaults()

        # Bootstrap: copy default_config.yaml if config.yaml doesn't exist
        if not os.path.exists(path):
            if os.path.exists(DEFAULT_CONFIG_FILE):
                logger.info(f"[ConfigStore] Bootstrapping from {DEFAULT_CONFIG_FILE}")
                shutil.copy(DEFAULT_CONFIG_FILE, path)
            else:
                logger.info("[ConfigStore] No config found, creating with defaults")
                self.config = defaults.copy()
                self._atomic_write_yaml(path, self.config)
                return

        # Load from disk
        try:
            with open(path, 'r') as f:
                loaded = yaml.safe_load(f) or {}
            
            # Validate it's a dict
            if not isinstance(loaded, dict):
                logger.warning("[ConfigStore] Config file is not a dict, using defaults")
                loaded = {}
            
            # Merge with defaults (add missing keys)
            for k, v in defaults.items():
                if k not in loaded:
                    loaded[k] = v
            
            self.config = loaded
            logger.info(f"[ConfigStore] Loaded config with {len(self.config)} keys")
            
        except yaml.YAMLError as e:
            logger.error(f"[ConfigStore] YAML parse error in config: {e}")
            self._restore_from_backup()
        except Exception as e:
            logger.error(f"[ConfigStore] Failed to load config: {e}")
            self.config = defaults.copy()

    def _load_synclist(self):
        """Load sync pairs from disk."""
        if not os.path.exists(SYNCLIST_FILE):
            self.sync_pairs = []
            return
            
        try:
            with open(SYNCLIST_FILE, 'r') as f:
                data = yaml.safe_load(f) or {}
            
            pairs = data.get('sync_pairs', [])
            if not isinstance(pairs, list):
                logger.warning("[ConfigStore] sync_pairs is not a list, using empty")
                pairs = []
            
            self.sync_pairs = pairs
            logger.info(f"[ConfigStore] Loaded {len(self.sync_pairs)} sync pairs")
            
        except Exception as e:
            logger.error(f"[ConfigStore] Failed to load synclist: {e}")
            self.sync_pairs = []

    def save_config(self, new_config: Optional[Dict[str, Any]] = None) -> bool:
        """
        Save config to disk with atomic write and auto-backup.
        Returns True on success, False on failure.
        """
        with self._lock:
            try:
                # Update in-memory config if new values provided
                if new_config:
                    self.config.update(new_config)
                
                # Validate before saving
                if not self._validate_config(self.config):
                    logger.error("[ConfigStore] Config validation failed, not saving")
                    return False
                
                # Create auto-backup of current file
                if os.path.exists(CURRENT_CONFIG_FILE):
                    self._create_auto_backup(CURRENT_CONFIG_FILE)
                
                # Atomic write
                success = self._atomic_write_yaml(CURRENT_CONFIG_FILE, self.config)
                if success:
                    logger.info(f"[ConfigStore] Saved config ({len(self.config)} keys)")
                return success
                
            except Exception as e:
                logger.error(f"[ConfigStore] Failed to save config: {e}")
                return False

    def add_known_email(self, email: str):
        """Adds an email to known_emails and saves."""
        if not email or not isinstance(email, str):
            return

        with self._lock:
            # Check defaults
            if 'known_emails' not in self.config:
                self.config['known_emails'] = []

            known = self.config['known_emails']
            if email not in known:
                known.append(email)
                known.sort()
                
                # Save directly
                try:
                    self._atomic_write_yaml(CURRENT_CONFIG_FILE, self.config)
                    logger.info(f"[ConfigStore] Added known email: {email}")
                except Exception as e:
                    logger.error(f"[ConfigStore] Failed to save known email: {e}")

    def save_synclist(self, new_pairs: Optional[List[Dict]] = None) -> bool:
        """
        Save sync pairs to disk with atomic write and auto-backup.
        Returns True on success, False on failure.
        """
        with self._lock:
            try:
                if new_pairs is not None:
                    self.sync_pairs = new_pairs
                
                # Create auto-backup
                if os.path.exists(SYNCLIST_FILE):
                    self._create_auto_backup(SYNCLIST_FILE)
                
                # Atomic write
                data = {'sync_pairs': self.sync_pairs}
                success = self._atomic_write_yaml(SYNCLIST_FILE, data)
                if success:
                    logger.info(f"[ConfigStore] Saved {len(self.sync_pairs)} sync pairs")
                return success
                
            except Exception as e:
                logger.error(f"[ConfigStore] Failed to save synclist: {e}")
                return False

    def _atomic_write_yaml(self, filepath: str, data: Any) -> bool:
        """
        Write YAML atomically: write to temp file, then rename.
        This prevents corruption if the process is killed mid-write.
        """
        temp_path = filepath + ".tmp"
        try:
            # Ensure directory exists
            os.makedirs(os.path.dirname(filepath) or '.', exist_ok=True)
            
            # Write to temp file
            with open(temp_path, 'w') as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
            
            # Atomic rename (on POSIX, this is atomic within same filesystem)
            shutil.move(temp_path, filepath)
            return True
            
        except Exception as e:
            logger.error(f"[ConfigStore] Atomic write failed: {e}")
            # Clean up temp file if it exists
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass
            return False

    def _create_auto_backup(self, filepath: str):
        """Create a timestamped backup of the given file."""
        try:
            filename = os.path.basename(filepath)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{BACKUP_PREFIX}{filename}_{timestamp}"
            backup_path = os.path.join(BACKUPS_DIR, backup_name)
            
            shutil.copy2(filepath, backup_path)
            logger.debug(f"[ConfigStore] Created backup: {backup_name}")
            
            # Cleanup old backups
            self._cleanup_old_backups(filename)
            
        except Exception as e:
            logger.warning(f"[ConfigStore] Failed to create backup: {e}")

    def _cleanup_old_backups(self, original_filename: str):
        """Keep only the most recent MAX_AUTO_BACKUPS backups."""
        try:
            pattern = f"{BACKUP_PREFIX}{original_filename}_"
            backups = []
            
            for f in os.listdir(BACKUPS_DIR):
                if f.startswith(pattern):
                    backups.append(os.path.join(BACKUPS_DIR, f))
            
            # Sort by modification time, newest first
            backups.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            
            # Remove old backups
            for old_backup in backups[MAX_AUTO_BACKUPS:]:
                os.remove(old_backup)
                logger.debug(f"[ConfigStore] Removed old backup: {old_backup}")
                
        except Exception as e:
            logger.warning(f"[ConfigStore] Failed to cleanup backups: {e}")

    def _restore_from_backup(self):
        """Attempt to restore config from most recent backup."""
        try:
            pattern = f"{BACKUP_PREFIX}config.yaml_"
            backups = []
            
            for f in os.listdir(BACKUPS_DIR):
                if f.startswith(pattern):
                    backups.append(os.path.join(BACKUPS_DIR, f))
            
            if not backups:
                logger.warning("[ConfigStore] No backups found, using defaults")
                self.config = self.get_hardcoded_defaults()
                return
            
            # Get most recent
            backups.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            latest = backups[0]
            
            logger.info(f"[ConfigStore] Restoring from backup: {latest}")
            shutil.copy2(latest, CURRENT_CONFIG_FILE)
            
            # Reload
            self._load_config()
            
        except Exception as e:
            logger.error(f"[ConfigStore] Failed to restore from backup: {e}")
            self.config = self.get_hardcoded_defaults()

    def _validate_config(self, config: Dict) -> bool:
        """Basic validation of config structure."""
        if not isinstance(config, dict):
            return False
        
        # Check domains is a list if present
        if 'domains' in config and not isinstance(config['domains'], list):
            logger.warning("[ConfigStore] 'domains' is not a list")
            return False
        
        # Check protected_users is a list if present
        if 'protected_users' in config and not isinstance(config['protected_users'], list):
            logger.warning("[ConfigStore] 'protected_users' is not a list")
            return False
        
        return True

    def get_config(self) -> Dict[str, Any]:
        """Get current config (returns reference, not copy)."""
        return self.config

    def get_sync_pairs(self) -> List[Dict]:
        """Get current sync pairs."""
        return self.sync_pairs

    def reload(self):
        """Force reload from disk."""
        logger.info("[ConfigStore] Force reloading from disk")
        self.load_all()

    def get_config_path(self) -> str:
        """Return the path to the config file."""
        return CURRENT_CONFIG_FILE

    def get_synclist_path(self) -> str:
        """Return the path to the synclist file."""
        return SYNCLIST_FILE


# Singleton instance
store = ConfigStore()
