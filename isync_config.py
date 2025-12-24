import yaml
import os

CONFIG_FILE = "config.yaml"
SYNCLIST_FILE = "synclist.yaml"

def get_default_config():
    return {
        'upload_limit': '700G',
        'transfers': 8,
        'max_users_per_cycle': 10,
        'rclone_command': 'copy',
        'stall_timeout_minutes': 10,
        'webhook_url': '',
        'global_rclone_flags': '',
        'ssh_enabled': False,
        'ssh_mode': 'explicit',
        'ssh_host': '',
        'ssh_user': '',
        'ssh_key_path': '',
        'ssh_remote_path': '~/isync',
        'domains': []
    }

def load_config():
    """Loads global configuration from YAML file."""
    defaults = get_default_config()

    if not os.path.exists(CONFIG_FILE):
        return defaults

    with open(CONFIG_FILE, 'r') as f:
        loaded = yaml.safe_load(f) or {}
        # Merge defaults for any missing keys
        for k, v in defaults.items():
            if k not in loaded:
                loaded[k] = v
        return loaded

def save_config(data):
    """Saves global configuration to YAML file."""
    with open(CONFIG_FILE, 'w') as f:
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