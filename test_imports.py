#!/usr/bin/env python3
"""Test backend imports"""
import sys
sys.path.insert(0, '/opt/isync')

try:
    from backend.main import app
    print("Backend imports OK")
    
    # Test isync_auth
    from isync_auth import ISyncAuthManager
    print("isync_auth imports OK")
    
    # Test ops
    from backend.ops import list_domain_users
    print("ops imports OK")
    
    print("\nALL IMPORTS PASS")
except Exception as e:
    print(f"IMPORT ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
