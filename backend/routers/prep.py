"""
Prep Check Router
API endpoints for prerequisites checking and system readiness validation.
"""
from fastapi import APIRouter
from typing import Optional

from backend.prerequisites import (
    run_full_check,
    check_python_version,
    check_pip_packages,
    check_rclone,
    check_fclone,
    check_google_api_libs,
    check_ssh_client,
    check_node_npm,
    check_config_files,
    check_sa_keys,
    check_domain_config,
    check_rclone_remotes,
    install_pip_packages,
    install_google_api_libs,
    check_remote_server
)
from backend.models.requests import InstallPackagesRequest

router = APIRouter(prefix="/api/prep", tags=["Prep Check"])


@router.get("/check")
def prep_check_full():
    """Run full prerequisites check for local system."""
    return run_full_check()


@router.get("/check/local")
def prep_check_local():
    """Run local-only prerequisites check."""
    return run_full_check(include_remote=False)


@router.get("/check/python")
def check_python():
    """Check Python version."""
    return check_python_version()


@router.get("/check/packages")
def check_packages():
    """Check pip packages."""
    return check_pip_packages()


@router.get("/check/rclone")
def check_rclone_status():
    """Check rclone installation."""
    return check_rclone()


@router.get("/check/fclone")
def check_fclone_status():
    """Check fclone installation."""
    return check_fclone()


@router.get("/check/google-api")
def check_google_api():
    """Check Google API libraries."""
    return check_google_api_libs()


@router.get("/check/ssh")
def check_ssh():
    """Check SSH client."""
    return check_ssh_client()


@router.get("/check/node")
def check_node():
    """Check Node.js and npm."""
    return check_node_npm()


@router.get("/check/config")
def check_config():
    """Check config files."""
    return check_config_files()


@router.get("/check/keys")
def check_keys():
    """Check service account keys."""
    return check_sa_keys()


@router.get("/check/domains")
def check_domains():
    """Check domain configuration."""
    return check_domain_config()


@router.get("/check/remotes")
def check_remotes():
    """Check rclone remotes."""
    return check_rclone_remotes()


@router.post("/install/packages")
def install_packages(request: InstallPackagesRequest = None):
    """Install missing pip packages."""
    packages = request.packages if request else None
    return install_pip_packages(packages)


@router.post("/install/google-api")
def install_google_api():
    """Install Google API libraries."""
    return install_google_api_libs()


@router.get("/check/remote/{server_id}")
async def prep_check_remote(server_id: str):
    """Check prerequisites on a remote server."""
    from backend.store import store
    
    servers = store.get("ssh_servers", [])
    server = next((s for s in servers if s.get("id") == server_id), None)
    
    if not server:
        return {"status": "error", "message": f"Server {server_id} not found"}
    
    # Build SSH command
    ssh_cmd = ["ssh"]
    if server.get("key_path"):
        ssh_cmd.extend(["-i", server["key_path"]])
    
    host = server.get("alias") or server.get("host")
    user = server.get("user")
    
    if user and host:
        ssh_cmd.append(f"{user}@{host}")
    elif host:
        ssh_cmd.append(host)
    else:
        return {"status": "error", "message": "No host or alias configured"}
    
    result = check_remote_server(ssh_cmd)
    result["server_id"] = server_id
    result["server_name"] = server.get("name", server_id)
    
    return result
