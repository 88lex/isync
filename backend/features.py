"""
Feature flags for optional dependencies.
Centralizes try/except import logic for scheduler and history modules.
"""
import logging

logger = logging.getLogger("isync_api")

# Scheduler feature
SCHEDULER_AVAILABLE = False
scheduler = None

try:
    from backend.scheduler import scheduler as _scheduler
    scheduler = _scheduler
    SCHEDULER_AVAILABLE = True
except ImportError as e:
    logger.info(f"[Features] Scheduler not available: {e}")

# History feature (requires SQLAlchemy)
HISTORY_AVAILABLE = False
SessionLocal = None
JobHistoryRepository = None

try:
    from backend.models.db import SessionLocal as _SessionLocal, JobHistoryRepository as _JobHistoryRepository
    SessionLocal = _SessionLocal
    JobHistoryRepository = _JobHistoryRepository
    HISTORY_AVAILABLE = True
except ImportError as e:
    logger.info(f"[Features] Job history not available: {e}")
