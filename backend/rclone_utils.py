import os
import re
from typing import Dict, Any, List, Optional

def get_rclone_config_path() -> str:
    """Get the path to rclone.conf from environment or standard locations."""
    # Check environment variable first
    env_path = os.environ.get("RCLONE_CONFIG")
    if env_path:
        return env_path

    # Check common locations
    home = os.path.expanduser("~")
    paths = [
        os.path.join(home, ".config", "rclone", "rclone.conf"),
        os.path.join(home, ".rclone.conf"),
        "/etc/rclone/rclone.conf"
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    # Default to standard location
    return os.path.join(home, ".config", "rclone", "rclone.conf")

def parse_rclone_config(content: str) -> Dict[str, Dict[str, str]]:
    """Parse rclone.conf content into a dict of remotes."""
    remotes = {}
    current_remote = None
    current_config = {}
    
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#') or line.startswith(';'):
            continue
        
        # Section header [remote_name]
        match = re.match(r'^\[(.+)\]$', line)
        if match:
            if current_remote:
                remotes[current_remote] = current_config
            current_remote = match.group(1).rstrip(':') # Handle cases where people put colons in brackets
            current_config = {}
        elif '=' in line and current_remote:
            key, value = line.split('=', 1)
            current_config[key.strip()] = value.strip()
    
    if current_remote:
        remotes[current_remote] = current_config
    
    return remotes

def write_rclone_config(remotes: Dict[str, Dict[str, str]], config_path: str):
    """Write remotes dict back to rclone.conf."""
    lines = []
    # Sort remotes by name for consistent file structure
    sorted_names = sorted(remotes.keys())
    
    for name in sorted_names:
        config = remotes[name]
        lines.append(f"[{name}]")
        # Sort keys as well, putting 'type' first
        keys = sorted(config.keys())
        if 'type' in keys:
            keys.remove('type')
            keys.insert(0, 'type')
            
        for key in keys:
            lines.append(f"{key} = {config[key]}")
        lines.append("")
    
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, 'w') as f:
        f.write('\n'.join(lines))

def add_or_update_remote(name: str, config: Dict[str, str], config_path: Optional[str] = None):
    """Add or update a remote in the config file."""
    if not config_path:
        config_path = get_rclone_config_path()
        
    remotes = {}
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            remotes = parse_rclone_config(f.read())
            
    name = name.rstrip(':')
    remotes[name] = config
    write_rclone_config(remotes, config_path)
    return True
