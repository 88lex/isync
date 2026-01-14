"""
API Authentication middleware for ISync.
Provides optional API key authentication.
"""
import os
import logging
from typing import Optional
from fastapi import Request, HTTPException
from fastapi.security import APIKeyHeader
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# API Key header name
API_KEY_HEADER = "X-API-Key"

# Environment variable for API key
API_KEY_ENV = "ISYNC_API_KEY"


def get_api_key() -> Optional[str]:
    """
    Gets the API key from environment or returns None if auth is disabled.
    If no key is set, authentication is disabled (development mode).
    """
    return os.environ.get(API_KEY_ENV)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """
    Middleware that validates API key if one is configured.
    If ISYNC_API_KEY env var is not set, all requests are allowed (dev mode).
    """
    
    # Paths that don't require authentication
    EXEMPT_PATHS = {
        "/docs",
        "/redoc", 
        "/openapi.json",
        "/health",
    }
    
    # Prefixes that don't require authentication
    EXEMPT_PREFIXES = (
        "/docs",
        "/redoc",
    )
    
    async def dispatch(self, request: Request, call_next):
        api_key = get_api_key()
        
        # If no API key configured, allow all requests (dev mode)
        if not api_key:
            return await call_next(request)
        
        # Check if path is exempt
        path = request.url.path
        if path in self.EXEMPT_PATHS or path.startswith(self.EXEMPT_PREFIXES):
            return await call_next(request)
        
        # Allow WebSocket upgrades with key in query param
        if request.scope.get("type") == "websocket":
            query_key = request.query_params.get("api_key")
            if query_key == api_key:
                return await call_next(request)
            # Also check header for WebSocket
            header_key = request.headers.get(API_KEY_HEADER)
            if header_key == api_key:
                return await call_next(request)
            logger.warning(f"[Auth] WebSocket connection rejected - invalid API key")
            raise HTTPException(status_code=401, detail="Invalid API key")
        
        # Validate API key from header
        provided_key = request.headers.get(API_KEY_HEADER)
        
        if not provided_key:
            logger.warning(f"[Auth] Request rejected - missing API key: {path}")
            raise HTTPException(
                status_code=401, 
                detail="API key required. Set X-API-Key header."
            )
        
        if provided_key != api_key:
            logger.warning(f"[Auth] Request rejected - invalid API key: {path}")
            raise HTTPException(status_code=401, detail="Invalid API key")
        
        return await call_next(request)


def validate_api_key(request: Request) -> bool:
    """
    Dependency function for routes that need explicit auth check.
    Returns True if valid, raises HTTPException otherwise.
    """
    api_key = get_api_key()
    
    if not api_key:
        return True  # Auth disabled
    
    provided_key = request.headers.get(API_KEY_HEADER)
    
    if not provided_key or provided_key != api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return True
