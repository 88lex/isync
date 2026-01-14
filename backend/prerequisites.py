"""
Prerequisites Checker Module
Validates system readiness for ISync operation.
Checks local and remote prerequisites and offers installation assistance.
"""
import subprocess
import shutil
import os
import sys
import json
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

logger = logging.getLogger("uvicorn")


class PrerequisiteStatus:
    """Status constants for prerequisites."""
    OK = "ok"
    WARNING = "warning"
    ERROR = "error"
    MISSING = "missing"


def run_cmd(cmd: List[str], timeout: int = 30) -> Dict[str, Any]:
    """Run a command and return result."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode
        }
    except FileNotFoundError:
        return {"success": False, "stdout": "", "stderr": "Command not found", "returncode": -1}
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": "Timeout", "returncode": -1}
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e), "returncode": -1}


def check_python_version() -> Dict[str, Any]:
    """Check Python version (requires 3.9+)."""
    version = sys.version_info
    version_str = f"{version.major}.{version.minor}.{version.micro}"
    is_ok = version.major == 3 and version.minor >= 9
    
    return {
        "name": "Python",
        "status": PrerequisiteStatus.OK if is_ok else PrerequisiteStatus.ERROR,
        "version": version_str,
        "required": "3.9+",
        "message": f"Python {version_str}" if is_ok else f"Python {version_str} - Upgrade required (3.9+)",
        "suggestion": None if is_ok else "Install Python 3.9 or higher"
    }


def check_pip_packages() -> Dict[str, Any]:
    """Check if required pip packages are installed."""
    required = [
        "fastapi", "uvicorn", "google-api-python-client", "google-auth",
        "pyyaml", "requests", "sqlalchemy", "apscheduler", "websockets"
    ]
    
    installed = []
    missing = []
    
    for pkg in required:
        result = run_cmd([sys.executable, "-m", "pip", "show", pkg])
        if result["success"]:
            installed.append(pkg)
        else:
            missing.append(pkg)
    
    status = PrerequisiteStatus.OK if not missing else PrerequisiteStatus.ERROR
    
    return {
        "name": "Pip Packages",
        "status": status,
        "installed": len(installed),
        "missing": missing,
        "total_required": len(required),
        "message": f"{len(installed)}/{len(required)} packages installed" + (f" (missing: {', '.join(missing[:3])}{'...' if len(missing) > 3 else ''})" if missing else ""),
        "suggestion": f"Run: pip install {' '.join(missing)}" if missing else None,
        "auto_fix": "install_pip_packages" if missing else None
    }


def check_rclone() -> Dict[str, Any]:
    """Check if rclone is installed."""
    result = run_cmd(["rclone", "version"])
    
    if result["success"]:
        # Extract version from output
        lines = result["stdout"].split("\n")
        version = lines[0] if lines else "unknown"
        return {
            "name": "rclone",
            "status": PrerequisiteStatus.OK,
            "version": version,
            "message": version,
            "suggestion": None
        }
    else:
        return {
            "name": "rclone",
            "status": PrerequisiteStatus.ERROR,
            "version": None,
            "message": "Not installed",
            "suggestion": "Install: sudo apt install rclone (Linux) or brew install rclone (macOS)",
            "docs_url": "https://rclone.org/install/"
        }


def check_fclone() -> Dict[str, Any]:
    """Check if fclone is installed (optional, for Shared Drive creation)."""
    result = run_cmd(["fclone", "version"])
    
    if result["success"]:
        lines = result["stdout"].split("\n")
        version = lines[0] if lines else "unknown"
        return {
            "name": "fclone",
            "status": PrerequisiteStatus.OK,
            "version": version,
            "message": version,
            "required": False,
            "suggestion": None
        }
    else:
        return {
            "name": "fclone",
            "status": PrerequisiteStatus.WARNING,
            "version": None,
            "required": False,
            "message": "Not installed (optional - needed for Drive Manager fclone method)",
            "suggestion": "Download from: https://github.com/mawaya/rclone/releases",
            "docs_url": "https://github.com/mawaya/rclone"
        }


def check_google_api_libs() -> Dict[str, Any]:
    """Check if Google API libraries are available."""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        return {
            "name": "Google API Libraries",
            "status": PrerequisiteStatus.OK,
            "message": "Available",
            "suggestion": None
        }
    except ImportError as e:
        return {
            "name": "Google API Libraries",
            "status": PrerequisiteStatus.WARNING,
            "message": "Not installed (needed for Google API drive creation method)",
            "suggestion": "Run: pip install google-api-python-client google-auth",
            "auto_fix": "install_google_api"
        }


def check_ssh_client() -> Dict[str, Any]:
    """Check if SSH client is available."""
    ssh_path = shutil.which("ssh")
    
    if ssh_path:
        result = run_cmd(["ssh", "-V"])
        # SSH -V outputs to stderr
        version = result["stderr"] or result["stdout"] or "unknown"
        return {
            "name": "SSH Client",
            "status": PrerequisiteStatus.OK,
            "version": version.split("\n")[0],
            "message": version.split("\n")[0],
            "suggestion": None
        }
    else:
        return {
            "name": "SSH Client",
            "status": PrerequisiteStatus.WARNING,
            "version": None,
            "message": "Not found (needed for remote execution)",
            "suggestion": "Install: sudo apt install openssh-client"
        }


def check_node_npm() -> Dict[str, Any]:
    """Check Node.js and npm for frontend development."""
    node_result = run_cmd(["node", "--version"])
    npm_result = run_cmd(["npm", "--version"])
    
    if node_result["success"] and npm_result["success"]:
        node_version = node_result["stdout"]
        npm_version = npm_result["stdout"]
        # Check Node >= 18
        try:
            major = int(node_version.lstrip("v").split(".")[0])
            is_ok = major >= 18
        except:
            is_ok = True
        
        return {
            "name": "Node.js & npm",
            "status": PrerequisiteStatus.OK if is_ok else PrerequisiteStatus.WARNING,
            "node_version": node_version,
            "npm_version": npm_version,
            "message": f"Node {node_version}, npm {npm_version}" + ("" if is_ok else " (Node 18+ recommended)"),
            "suggestion": None if is_ok else "Upgrade Node.js to version 18+"
        }
    else:
        return {
            "name": "Node.js & npm",
            "status": PrerequisiteStatus.WARNING,
            "message": "Not installed (needed for frontend development)",
            "suggestion": "Install: https://nodejs.org/"
        }


def check_config_files(base_path: str = None) -> Dict[str, Any]:
    """Check if required config files exist."""
    if base_path is None:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    files = {
        "config.yaml": os.path.join(base_path, "config.yaml"),
        "synclist.yaml": os.path.join(base_path, "synclist.yaml"),
    }
    
    found = {}
    missing = []
    
    for name, path in files.items():
        if os.path.exists(path):
            found[name] = {"path": path, "size": os.path.getsize(path)}
        else:
            missing.append(name)
    
    if not missing:
        return {
            "name": "Config Files",
            "status": PrerequisiteStatus.OK,
            "files": found,
            "message": f"All config files present ({len(found)})",
            "suggestion": None
        }
    else:
        return {
            "name": "Config Files",
            "status": PrerequisiteStatus.ERROR if "config.yaml" in missing else PrerequisiteStatus.WARNING,
            "files": found,
            "missing": missing,
            "message": f"Missing: {', '.join(missing)}",
            "suggestion": f"Create missing files from examples: {', '.join(f'{f}.example' for f in missing)}"
        }


def check_sa_keys(base_path: str = None) -> Dict[str, Any]:
    """Check for service account JSON keys."""
    if base_path is None:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    keys_dir = os.path.join(base_path, "keys")
    
    if not os.path.exists(keys_dir):
        return {
            "name": "Service Account Keys",
            "status": PrerequisiteStatus.WARNING,
            "count": 0,
            "path": keys_dir,
            "message": "Keys directory not found",
            "suggestion": f"Create directory: mkdir {keys_dir}"
        }
    
    keys = [f for f in os.listdir(keys_dir) if f.endswith(".json")]
    
    if keys:
        return {
            "name": "Service Account Keys",
            "status": PrerequisiteStatus.OK,
            "count": len(keys),
            "path": keys_dir,
            "keys": keys[:5],  # First 5 for preview
            "message": f"{len(keys)} key(s) found in {keys_dir}",
            "suggestion": None
        }
    else:
        return {
            "name": "Service Account Keys",
            "status": PrerequisiteStatus.WARNING,
            "count": 0,
            "path": keys_dir,
            "message": "No JSON keys found (needed for Google API auth)",
            "suggestion": "Add service account JSON files to the keys/ folder"
        }


def check_domain_config(base_path: str = None) -> Dict[str, Any]:
    """Check if domains are configured in config.yaml."""
    if base_path is None:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    config_path = os.path.join(base_path, "config.yaml")
    
    if not os.path.exists(config_path):
        return {
            "name": "Domain Configuration",
            "status": PrerequisiteStatus.ERROR,
            "domains": [],
            "message": "config.yaml not found",
            "suggestion": "Create config.yaml from config.example.yaml"
        }
    
    try:
        import yaml
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f) or {}
        
        domains = config.get("domains", [])
        
        if domains:
            valid = []
            issues = []
            for d in domains:
                name = d.get("domain_name", "unnamed")
                if d.get("admin_email") and d.get("sa_json_path"):
                    valid.append(name)
                else:
                    issues.append(f"{name}: missing admin_email or sa_json_path")
            
            if issues:
                return {
                    "name": "Domain Configuration",
                    "status": PrerequisiteStatus.WARNING,
                    "domains": [d.get("domain_name") for d in domains],
                    "valid": len(valid),
                    "message": f"{len(domains)} domain(s), {len(issues)} with issues",
                    "issues": issues,
                    "suggestion": "Complete domain configuration in config.yaml"
                }
            else:
                return {
                    "name": "Domain Configuration",
                    "status": PrerequisiteStatus.OK,
                    "domains": [d.get("domain_name") for d in domains],
                    "message": f"{len(domains)} domain(s) configured",
                    "suggestion": None
                }
        else:
            return {
                "name": "Domain Configuration",
                "status": PrerequisiteStatus.WARNING,
                "domains": [],
                "message": "No domains configured",
                "suggestion": "Add domain configuration to config.yaml"
            }
    except Exception as e:
        return {
            "name": "Domain Configuration",
            "status": PrerequisiteStatus.ERROR,
            "message": f"Failed to read config: {e}",
            "suggestion": "Check config.yaml syntax"
        }


def check_rclone_remotes() -> Dict[str, Any]:
    """Check configured rclone remotes."""
    result = run_cmd(["rclone", "listremotes"])
    
    if result["success"]:
        remotes = [r.strip() for r in result["stdout"].split("\n") if r.strip()]
        return {
            "name": "Rclone Remotes",
            "status": PrerequisiteStatus.OK if remotes else PrerequisiteStatus.WARNING,
            "count": len(remotes),
            "remotes": remotes[:10],  # First 10
            "message": f"{len(remotes)} remote(s) configured" if remotes else "No remotes configured",
            "suggestion": None if remotes else "Configure rclone remotes: rclone config"
        }
    else:
        return {
            "name": "Rclone Remotes",
            "status": PrerequisiteStatus.ERROR,
            "message": "Failed to list remotes (rclone not working?)",
            "suggestion": "Check rclone installation"
        }


# --- Auto-fix Functions ---

def install_pip_packages(packages: List[str] = None) -> Dict[str, Any]:
    """Install missing pip packages."""
    if packages is None:
        # Get from check
        check = check_pip_packages()
        packages = check.get("missing", [])
    
    if not packages:
        return {"status": "ok", "message": "No packages to install"}
    
    result = run_cmd([sys.executable, "-m", "pip", "install"] + packages, timeout=120)
    
    if result["success"]:
        return {
            "status": "ok",
            "message": f"Installed: {', '.join(packages)}",
            "packages": packages
        }
    else:
        return {
            "status": "error",
            "message": f"Failed to install: {result['stderr']}",
            "packages": packages
        }


def install_google_api_libs() -> Dict[str, Any]:
    """Install Google API libraries."""
    return install_pip_packages(["google-api-python-client", "google-auth"])


# --- Remote Server Checks ---

def check_remote_server(ssh_cmd: List[str]) -> Dict[str, Any]:
    """Check prerequisites on a remote server via SSH."""
    checks = []
    
    # Check rclone
    result = run_cmd(ssh_cmd + ["rclone", "version"], timeout=30)
    if result["success"]:
        checks.append({
            "name": "rclone",
            "status": PrerequisiteStatus.OK,
            "message": result["stdout"].split("\n")[0] if result["stdout"] else "Installed"
        })
    else:
        checks.append({
            "name": "rclone",
            "status": PrerequisiteStatus.ERROR,
            "message": "Not installed"
        })
    
    # Check rclone remotes
    result = run_cmd(ssh_cmd + ["rclone", "listremotes"], timeout=30)
    if result["success"]:
        remotes = [r.strip() for r in result["stdout"].split("\n") if r.strip()]
        checks.append({
            "name": "Rclone Remotes",
            "status": PrerequisiteStatus.OK if remotes else PrerequisiteStatus.WARNING,
            "count": len(remotes),
            "message": f"{len(remotes)} remote(s)"
        })
    
    # Check tmux
    result = run_cmd(ssh_cmd + ["which", "tmux"], timeout=10)
    checks.append({
        "name": "tmux",
        "status": PrerequisiteStatus.OK if result["success"] else PrerequisiteStatus.WARNING,
        "message": "Installed" if result["success"] else "Not installed (optional)"
    })
    
    # Check SA keys directory
    result = run_cmd(ssh_cmd + ["ls", "/opt/sa/"], timeout=10)
    if result["success"]:
        keys = [f for f in result["stdout"].split("\n") if f.endswith(".json")]
        checks.append({
            "name": "Service Accounts",
            "status": PrerequisiteStatus.OK if keys else PrerequisiteStatus.WARNING,
            "count": len(keys),
            "message": f"{len(keys)} key(s) in /opt/sa/"
        })
    else:
        checks.append({
            "name": "Service Accounts",
            "status": PrerequisiteStatus.WARNING,
            "message": "/opt/sa/ not accessible"
        })
    
    return {"checks": checks}


# --- Main Check Function ---

def run_full_check(base_path: str = None, include_remote: bool = False) -> Dict[str, Any]:
    """Run all prerequisite checks."""
    local_checks = [
        check_python_version(),
        check_pip_packages(),
        check_rclone(),
        check_fclone(),
        check_google_api_libs(),
        check_ssh_client(),
        check_node_npm(),
        check_config_files(base_path),
        check_sa_keys(base_path),
        check_domain_config(base_path),
        check_rclone_remotes(),
    ]
    
    # Collect issues
    issues = []
    for check in local_checks:
        if check["status"] in [PrerequisiteStatus.ERROR, PrerequisiteStatus.WARNING]:
            issues.append({
                "id": check["name"].lower().replace(" ", "_"),
                "severity": check["status"],
                "name": check["name"],
                "message": check.get("message", ""),
                "suggestion": check.get("suggestion"),
                "auto_fix": check.get("auto_fix")
            })
    
    # Determine overall status
    has_errors = any(c["status"] == PrerequisiteStatus.ERROR for c in local_checks)
    has_warnings = any(c["status"] == PrerequisiteStatus.WARNING for c in local_checks)
    
    if has_errors:
        overall_status = "error"
    elif has_warnings:
        overall_status = "warning"
    else:
        overall_status = "ok"
    
    # Ready to run if no errors in critical items
    critical_items = ["Python", "Pip Packages", "rclone", "Config Files"]
    ready_to_run = not any(
        c["status"] == PrerequisiteStatus.ERROR 
        for c in local_checks 
        if c["name"] in critical_items
    )
    
    return {
        "status": overall_status,
        "ready_to_run": ready_to_run,
        "local": {c["name"].lower().replace(" ", "_"): c for c in local_checks},
        "remote": [],
        "issues": issues,
        "summary": {
            "total": len(local_checks),
            "ok": sum(1 for c in local_checks if c["status"] == PrerequisiteStatus.OK),
            "warnings": sum(1 for c in local_checks if c["status"] == PrerequisiteStatus.WARNING),
            "errors": sum(1 for c in local_checks if c["status"] == PrerequisiteStatus.ERROR)
        }
    }
