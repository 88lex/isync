"""
Routers Package
Contains API route handlers organized by domain.
"""
from backend.routers.prep import router as prep_router
from backend.routers.drives import router as drives_router
from backend.routers.jobs import router as jobs_router
from backend.routers.config import router as config_router
from backend.routers.ssh import router as ssh_router
from backend.routers.ops import router as ops_router
from backend.routers.schedules import router as schedules_router
from backend.routers.orchestrator import router as orchestrator_router
from backend.routers.admin import router as admin_router
from backend.routers.batch_groups import router as batch_groups_router
from backend.routers.crontab import router as crontab_router
from backend.routers.rclone import router as rclone_router
from backend.routers.keys import router as keys_router
from backend.routers.cache import router as cache_router
from backend.routers.backup import router as backup_router

# Export all routers for easy import in main.py
__all__ = [
    "prep_router",
    "drives_router",
    "jobs_router",
    "config_router",
    "ssh_router",
    "ops_router",
    "schedules_router",
    "orchestrator_router",
    "admin_router",
    "batch_groups_router",
    "crontab_router",
    "rclone_router",
    "keys_router",
    "cache_router",
    "backup_router",
]
