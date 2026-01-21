"""
FastAPI Dependencies Module
Provides dependency injection for shared resources across routers.
"""
from typing import Generator, Optional
from functools import lru_cache

from backend.store import store
from backend.job_manager import job_manager
from backend.logging_config import get_logger
from backend.database import get_db

logger = get_logger("isync.dependencies")


# --- Shared State Dependencies ---

def get_store():
    """Dependency to get the configuration store."""
    return store


def get_job_manager():
    """Dependency to get the job manager instance."""
    return job_manager


# --- Engine Dependencies ---

_engine_instance = None

def get_engine():
    """
    Dependency to get or create the ISync engine.
    Lazily instantiates to avoid circular imports.
    """
    global _engine_instance
    if _engine_instance is None:
        from isync_engine import ISyncEngine
        config = store.config
        _engine_instance = ISyncEngine(config)
    return _engine_instance


def reset_engine():
    """Reset the engine instance (e.g., after config change)."""
    global _engine_instance
    _engine_instance = None


# --- Database Session Dependencies ---

def get_db_session() -> Generator:
    """
    Dependency for database session with proper cleanup.
    For use with job history if SQLAlchemy is available.
    """
    try:
        from backend.features import SessionLocal, HISTORY_AVAILABLE
        if not HISTORY_AVAILABLE:
            yield None
            return
        
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
    except ImportError:
        yield None


# --- Scheduler Dependencies ---

_scheduler_instance = None

def get_scheduler():
    """Dependency to get the scheduler instance."""
    global _scheduler_instance
    if _scheduler_instance is None:
        try:
            from backend.scheduler import scheduler
            _scheduler_instance = scheduler
        except ImportError:
            logger.warning("Scheduler not available")
            return None
    return _scheduler_instance


# --- Config Helpers ---

@lru_cache()
def get_base_path() -> str:
    """Get the base path of the ISync installation."""
    import os
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_config():
    """Get the current configuration dict."""
    return store.config


def reload_config():
    """Reload configuration from disk."""
    store.reload()
    reset_engine()
    return store.config
