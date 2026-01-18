"""
Monitor Service Module
On-Demand capacity checks for Shared Drives and Workspace quotas.
Runs only when triggered (via UI button, API call, or cron).
"""
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from backend.database import SessionLocal, init_db
from backend.models.models import SharedDrive, CapacityAlert, UnionGroup, AppConfig
from backend.config_manager import config_manager

logger = logging.getLogger("monitor_service")

# Thresholds
FILE_COUNT_WARNING = 320000  # 80% of 400k limit
FILE_COUNT_CRITICAL = 380000  # 95% of 400k limit

# Optional import for Google API
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False
    logger.warning("Google API libraries not installed.")


def get_drive_service(service_account_file: str, impersonate_email: str):
    """Create a Google Drive API service."""
    if not GOOGLE_API_AVAILABLE:
        raise RuntimeError("Google API libraries not installed.")
    
    credentials = service_account.Credentials.from_service_account_file(
        service_account_file,
        scopes=['https://www.googleapis.com/auth/drive']
    )
    delegated_credentials = credentials.with_subject(impersonate_email)
    return build('drive', 'v3', credentials=delegated_credentials)


def get_drive_file_count(service, drive_id: str) -> Optional[int]:
    """
    Get the file count for a Shared Drive.
    Uses the 'about' API with a driveId filter if possible,
    or falls back to counting files via list.
    """
    try:
        # Method 1: Use files().list with corpora=drive and count results
        # This is more accurate but slower for large drives
        # For speed, we'll use a simpler approach: get first page and check if there's more
        
        # Actually, Google Drive API has a 'storageQuota' field in about().get()
        # but that's per-user, not per-drive. For shared drives, we need to count files.
        
        # More efficient: use drives().get with fields for usage stats
        # But Google doesn't provide file count directly in drives().get
        
        # Best approach: use files().list with q filter and count
        # But this can be slow for very large drives.
        
        # Compromise: Paginate up to a reasonable limit to estimate
        total = 0
        page_token = None
        max_pages = 10  # Limit to avoid excessive API calls
        page_count = 0
        
        while page_count < max_pages:
            result = service.files().list(
                corpora='drive',
                driveId=drive_id,
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
                fields="nextPageToken, files(id)",
                pageSize=1000
            ).execute()
            
            files = result.get('files', [])
            total += len(files)
            
            page_token = result.get('nextPageToken')
            if not page_token:
                break
            page_count += 1
        
        # If we hit max pages, indicate estimate
        if page_token:
            logger.warning(f"Drive {drive_id}: File count capped at {total}+ (max pages reached)")
        
        return total
        
    except HttpError as e:
        logger.error(f"Failed to get file count for drive {drive_id}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error getting file count: {e}")
        return None


def check_google_capacity(db: Optional[Session] = None) -> Dict[str, Any]:
    """
    Check capacity for all SharedDrives in the database.
    
    - Fetches current file counts from Google Drive API.
    - Updates SharedDrive records in DB.
    - Creates CapacityAlert if thresholds are exceeded.
    
    Returns:
        Dict with scan results and alerts created.
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    results = {
        "status": "ok",
        "drives_scanned": 0,
        "alerts_created": 0,
        "errors": [],
        "details": []
    }
    
    try:
        # Get domains config from AppConfig
        import json
        domains_json = db.query(AppConfig).filter(AppConfig.key == 'domains').first()
        if not domains_json or not domains_json.value:
            results["status"] = "error"
            results["errors"].append("No domains configured. Cannot authenticate.")
            return results
        
        domains = json.loads(domains_json.value)
        if not domains:
            results["status"] = "error"
            results["errors"].append("Domains config is empty.")
            return results
        
        # Use first domain for authentication (or could be configurable)
        primary_domain = domains[0]
        sa_file = primary_domain.get('sa_json_path')
        admin_email = primary_domain.get('admin_email')
        
        if not sa_file or not admin_email:
            results["status"] = "error"
            results["errors"].append("Primary domain missing sa_json_path or admin_email.")
            return results
        
        # Get all SharedDrives from DB
        drives = db.query(SharedDrive).filter(SharedDrive.status == 'ACTIVE').all()
        
        if not drives:
            results["details"].append("No active SharedDrives in database to scan.")
            return results
        
        # Initialize Google API service
        try:
            service = get_drive_service(sa_file, admin_email)
        except Exception as e:
            results["status"] = "error"
            results["errors"].append(f"Failed to initialize Google API: {e}")
            return results
        
        # Scan each drive
        for drive in drives:
            results["drives_scanned"] += 1
            
            file_count = get_drive_file_count(service, drive.drive_id)
            
            if file_count is None:
                results["errors"].append(f"Failed to get count for {drive.name}")
                continue
            
            # Update drive record
            drive.file_count = file_count
            drive.last_scanned = datetime.utcnow()
            
            detail = {
                "name": drive.name,
                "drive_id": drive.drive_id,
                "file_count": file_count,
                "alert_level": None
            }
            
            # Check thresholds and create alerts
            if file_count >= FILE_COUNT_CRITICAL:
                detail["alert_level"] = "CRITICAL"
                drive.is_full = True
                
                # Check if unresolved alert already exists
                existing = db.query(CapacityAlert).filter(
                    CapacityAlert.drive_id == drive.id,
                    CapacityAlert.is_resolved == False,
                    CapacityAlert.alert_type == 'FILE_COUNT'
                ).first()
                
                if not existing:
                    alert = CapacityAlert(
                        drive_id=drive.id,
                        alert_type='FILE_COUNT',
                        message=f"CRITICAL: {drive.name} has {file_count:,} files (>{FILE_COUNT_CRITICAL:,}). Expansion required!"
                    )
                    db.add(alert)
                    results["alerts_created"] += 1
                    
            elif file_count >= FILE_COUNT_WARNING:
                detail["alert_level"] = "WARNING"
                
                existing = db.query(CapacityAlert).filter(
                    CapacityAlert.drive_id == drive.id,
                    CapacityAlert.is_resolved == False,
                    CapacityAlert.alert_type == 'FILE_COUNT'
                ).first()
                
                if not existing:
                    alert = CapacityAlert(
                        drive_id=drive.id,
                        alert_type='FILE_COUNT',
                        message=f"WARNING: {drive.name} has {file_count:,} files (>{FILE_COUNT_WARNING:,}). Plan expansion soon."
                    )
                    db.add(alert)
                    results["alerts_created"] += 1
            
            results["details"].append(detail)
        
        db.commit()
        
    except Exception as e:
        results["status"] = "error"
        results["errors"].append(f"Scan failed: {e}")
        db.rollback()
    finally:
        if close_db:
            db.close()
    
    return results


def check_workspace_quota(db: Optional[Session] = None) -> Dict[str, Any]:
    """
    Check aggregate storage quota for configured Workspace domains.
    
    Note: This requires Admin SDK Reports API, which is separate from Drive API.
    For now, this is a placeholder/stub that can be expanded.
    
    Returns:
        Dict with quota information.
    """
    # TODO: Implement using Admin SDK Reports API
    # https://developers.google.com/admin-sdk/reports/v1/reference/usage/get
    
    return {
        "status": "not_implemented",
        "message": "Workspace quota check requires Admin SDK Reports API. Coming soon."
    }


def get_active_alerts(db: Optional[Session] = None) -> List[Dict[str, Any]]:
    """Get all unresolved capacity alerts."""
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        alerts = db.query(CapacityAlert).filter(
            CapacityAlert.is_resolved == False
        ).order_by(CapacityAlert.created_at.desc()).all()
        
        result = []
        for a in alerts:
            drive = db.query(SharedDrive).filter(SharedDrive.id == a.drive_id).first()
            result.append({
                "id": a.id,
                "drive_name": drive.name if drive else "Unknown",
                "drive_id": drive.drive_id if drive else None,
                "alert_type": a.alert_type,
                "message": a.message,
                "created_at": a.created_at.isoformat() if a.created_at else None
            })
        
        return result
    finally:
        if close_db:
            db.close()


def resolve_alert(alert_id: int, db: Optional[Session] = None) -> bool:
    """Mark an alert as resolved."""
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        alert = db.query(CapacityAlert).filter(CapacityAlert.id == alert_id).first()
        if alert:
            alert.is_resolved = True
            alert.resolved_at = datetime.utcnow()
            db.commit()
            return True
        return False
    finally:
        if close_db:
            db.close()


# CLI entry point for cron/manual execution
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    
    print("Running capacity check...")
    result = check_google_capacity()
    
    print(f"\nScan Complete:")
    print(f"  Drives Scanned: {result['drives_scanned']}")
    print(f"  Alerts Created: {result['alerts_created']}")
    
    if result['errors']:
        print(f"  Errors: {len(result['errors'])}")
        for e in result['errors']:
            print(f"    - {e}")
    
    if result['details']:
        print("\nDrive Details:")
        for d in result['details']:
            alert_str = f" [{d['alert_level']}]" if d.get('alert_level') else ""
            print(f"  - {d['name']}: {d['file_count']:,} files{alert_str}")
