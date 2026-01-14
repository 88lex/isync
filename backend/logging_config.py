"""
Unified Logging Configuration
Centralized logging setup for all ISync modules.
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from typing import Optional

# Log directory
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# Log format
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Log level from environment
LOG_LEVEL = os.environ.get("ISYNC_LOG_LEVEL", "INFO").upper()


def get_logger(name: str, log_file: Optional[str] = None) -> logging.Logger:
    """
    Get a configured logger instance.
    
    Args:
        name: Logger name (typically __name__ or module name)
        log_file: Optional specific log file (defaults to isync.log)
    
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Avoid adding handlers multiple times
    if logger.handlers:
        return logger
    
    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))
    logger.addHandler(console_handler)
    
    # File handler with rotation
    log_filename = log_file or "isync.log"
    file_path = os.path.join(LOG_DIR, log_filename)
    file_handler = RotatingFileHandler(
        file_path,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))
    logger.addHandler(file_handler)
    
    return logger


# Pre-configured loggers for common modules
api_logger = get_logger("isync.api")
engine_logger = get_logger("isync.engine")
scheduler_logger = get_logger("isync.scheduler", "scheduler.log")
ops_logger = get_logger("isync.ops")
