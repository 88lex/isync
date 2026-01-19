"""
Rclone Manager Module
Dynamically generates rclone.conf from the database.
"""
import os
import logging
import subprocess
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models.models import UnionGroup, SharedDrive, AppConfig

logger = logging.getLogger("rclone_manager")

# Default rclone config path (can be overridden via environment)
RCLONE_CONFIG_PATH = os.environ.get("RCLONE_CONFIG", os.path.expanduser("~/.config/rclone/rclone.conf"))


def get_rclone_config_path() -> str:
    """Get the path to rclone.conf."""
    return RCLONE_CONFIG_PATH


def run_rclone_command(args: List[str], timeout: int = 30) -> Dict[str, Any]:
    """Run an rclone command."""
    cmd = ["rclone"] + args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Command timed out"}
    except FileNotFoundError:
        return {"status": "error", "message": "rclone not found in PATH"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def create_drive_remote(name: str, drive_id: str, sa_file: str) -> Dict[str, Any]:
    """Create or update an rclone remote for a Shared Drive."""
    # Remove trailing colon if present
    name = name.rstrip(":")
    
    # Use rclone config create (idempotent)
    args = [
        "config", "create", name, "drive",
        "scope", "drive",
        "team_drive", drive_id,
        "service_account_file", sa_file
    ]
    
    return run_rclone_command(args)


def create_union_remote(name: str, upstreams: List[str], 
                        action_policy: str = "rand",
                        create_policy: str = "eprand") -> Dict[str, Any]:
    """Create or update an rclone union remote."""
    name = name.rstrip(":")
    
    # Build upstreams string: "remote1: remote2: remote3:"
    upstreams_str = " ".join(f"{u.rstrip(':')}:" for u in upstreams)
    
    args = [
        "config", "create", name, "union",
        "upstreams", upstreams_str,
        "action_policy", action_policy,
        "create_policy", create_policy
    ]
    
    return run_rclone_command(args)


def regenerate_config(db: Optional[Session] = None) -> Dict[str, Any]:
    """
    Regenerate rclone configuration from database.
    
    This function:
    1. Reads all UnionGroups and their SharedDrives from the DB.
    2. Creates/updates rclone remotes for each SharedDrive.
    3. Creates/updates union remotes for each UnionGroup.
    
    Returns:
        Dict with results.
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    results = {
        "status": "ok",
        "drives_configured": 0,
        "unions_configured": 0,
        "errors": []
    }
    
    try:
        import json
        
        # Get default SA file from domains config
        domains_config = db.query(AppConfig).filter(AppConfig.key == 'domains').first()
        default_sa_file = None
        if domains_config and domains_config.value:
            domains = json.loads(domains_config.value)
            if domains:
                default_sa_file = domains[0].get('sa_json_path')
        
        if not default_sa_file:
            results["errors"].append("No default SA file found in domains config")
            # Continue anyway, individual drives may have their own SA paths
        
        # Get all UnionGroups
        union_groups = db.query(UnionGroup).all()
        
        for ug in union_groups:
            # Get all drives in this union
            drives = db.query(SharedDrive).filter(
                SharedDrive.union_group_id == ug.id,
                SharedDrive.status == 'ACTIVE'
            ).all()
            
            if not drives:
                continue
            
            upstream_names = []
            
            for drive in drives:
                # Determine SA file for this drive
                # For now, use default. Could extend SharedDrive model to store per-drive SA path.
                sa_file = default_sa_file
                
                if not sa_file:
                    results["errors"].append(f"No SA file for drive {drive.name}")
                    continue
                
                # Create remote for this drive
                remote_name = drive.name.replace(" ", "-").lower()
                result = create_drive_remote(remote_name, drive.drive_id, sa_file)
                
                if result["status"] == "ok":
                    results["drives_configured"] += 1
                    upstream_names.append(remote_name)
                else:
                    results["errors"].append(f"Failed to configure {drive.name}: {result.get('stderr', result.get('message'))}")
            
            # Create union remote for this group
            if upstream_names:
                union_name = ug.remote_name or f"{ug.name}-union"
                result = create_union_remote(union_name, upstream_names)
                
                if result["status"] == "ok":
                    results["unions_configured"] += 1
                else:
                    results["errors"].append(f"Failed to configure union {union_name}: {result.get('stderr', result.get('message'))}")
        
        if results["errors"]:
            results["status"] = "partial"
        
    except Exception as e:
        results["status"] = "error"
        results["errors"].append(f"Regeneration failed: {e}")
    finally:
        if close_db:
            db.close()
    
    return results


def list_remotes() -> Dict[str, Any]:
    """List all configured rclone remotes."""
    result = run_rclone_command(["listremotes"])
    
    if result["status"] == "ok":
        remotes = [r.strip() for r in result["stdout"].strip().split("\n") if r.strip()]
        
        # Filter excluded
        from backend.store import store
        excluded = set(store.config.get('excluded_remotes', []))
        remotes = [r for r in remotes if r.rstrip(':') not in excluded]
        
        return {"status": "ok", "remotes": remotes, "count": len(remotes)}
    
    return {"status": "error", "message": result.get("stderr", result.get("message")), "remotes": []}


def delete_remote(name: str) -> Dict[str, Any]:
    """Delete an rclone remote."""
    name = name.rstrip(":")
    return run_rclone_command(["config", "delete", name])


# CLI entry point
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    print("Regenerating rclone config from database...")
    from backend.database import init_db
    init_db()
    
    result = regenerate_config()
    
    print(f"\nRegeneration Complete:")
    print(f"  Drives Configured: {result['drives_configured']}")
    print(f"  Unions Configured: {result['unions_configured']}")
    
    if result['errors']:
        print(f"  Errors: {len(result['errors'])}")
        for e in result['errors']:
            print(f"    - {e}")
