import yaml
import os
import shutil

CURRENT_CONFIG_FILE = "current_config.yaml"
DEFAULT_CONFIG_FILE = "default_config.yaml"
CONFIGS_DIR = "configs"
SYNCLIST_FILE = "synclist.yaml"

# Default Paths & Constants
KEYS_DIR = "keys"
LOGS_DIR = "logs"
DEFAULT_SA_JSON_PATH = os.path.join(KEYS_DIR, "master.json")
LOG_FILE_PATH = os.path.join(LOGS_DIR, "isync.log")

def get_hardcoded_defaults():
    return {
        'upload_limit': '700G',
        'transfers': 8,
        'default_source': '',
        'default_dest': '',
        'max_users_per_cycle': 10,
        'rotation_strategy': 'standard',
        'existing_users_file': 'users.txt',
        'rclone_command': 'copy',
        'rclone_chunk_size': '128M',
        'rclone_stats_interval': '1s',
        'rclone_verbose': True,
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
        'domains': []
    }

def load_config(path=None):
    """Loads configuration from YAML file (defaults to current_config.yaml)."""
    if path is None: path = CURRENT_CONFIG_FILE
    
    defaults = get_hardcoded_defaults()

    # Bootstrap: If current config missing, try default file, else use hardcoded
    if path == CURRENT_CONFIG_FILE and not os.path.exists(path):
        if os.path.exists(DEFAULT_CONFIG_FILE):
            shutil.copy(DEFAULT_CONFIG_FILE, path)
        else:
            save_config(defaults, path)

    if not os.path.exists(path):
        return defaults

    with open(path, 'r') as f:
        loaded = yaml.safe_load(f) or {}
        # Merge defaults for any missing keys
        for k, v in defaults.items():
            if k not in loaded:
                loaded[k] = v
        return loaded

def save_config(data, path=None):
    """Saves configuration to YAML file (defaults to current_config.yaml)."""
    if path is None: path = CURRENT_CONFIG_FILE
    folder = os.path.dirname(path)
    if folder and not os.path.exists(folder): os.makedirs(folder)
    with open(path, 'w') as f:
        yaml.dump(data, f, default_flow_style=False)

def load_synclist():
    """Loads the list of sync jobs from YAML file."""
    if not os.path.exists(SYNCLIST_FILE):
        return []
    with open(SYNCLIST_FILE, 'r') as f:
        data = yaml.safe_load(f) or {}
        return data.get('sync_pairs', [])

def save_synclist(pairs):
    """Saves the list of sync jobs to YAML file."""
    with open(SYNCLIST_FILE, 'w') as f:
        yaml.dump({'sync_pairs': pairs}, f, default_flow_style=False)

def resolve_sa_path(path):
    """Returns the provided path or the default master.json path if empty."""
    if not path:
        return DEFAULT_SA_JSON_PATH
    return path