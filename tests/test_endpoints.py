#!/usr/bin/env python3
"""
Comprehensive API Endpoint Verification Script
Tests all recently touched/critical API endpoints
"""
import requests
import json
import sys

BASE_URL = "http://localhost:8000"

def test_endpoint(method, path, data=None, description=""):
    """Test a single endpoint and return result"""
    url = f"{BASE_URL}{path}"
    try:
        if method == "GET":
            resp = requests.get(url, timeout=10)
        elif method == "POST":
            resp = requests.post(url, json=data, timeout=15)
        elif method == "PUT":
            resp = requests.put(url, json=data, timeout=10)
        else:
            return {"status": "ERROR", "error": f"Unknown method {method}"}
        
        if resp.status_code == 200:
            return {"status": "OK", "code": 200, "response": resp.json() if resp.text else {}}
        elif resp.status_code == 404:
            return {"status": "NOT_FOUND", "code": 404}
        elif resp.status_code == 500:
            return {"status": "SERVER_ERROR", "code": 500, "error": resp.text[:200]}
        else:
            return {"status": "ERROR", "code": resp.status_code, "error": resp.text[:200]}
    except requests.exceptions.Timeout:
        return {"status": "TIMEOUT"}
    except Exception as e:
        return {"status": "EXCEPTION", "error": str(e)[:100]}

# Define all endpoints to test
TESTS = [
    # Health & Status
    ("GET", "/health", None, "Health Check"),
    ("GET", "/api/status", None, "Job Status"),
    
    # Config Router
    ("GET", "/api/config", None, "Get Config"),
    ("GET", "/api/config/status", None, "Config Status"),
    
    # Drives Router
    ("GET", "/api/drives/keys", None, "List Keys"),
    ("GET", "/api/drives/methods", None, "Check Methods"),
    
    # SSH Router
    ("GET", "/api/ssh/servers", None, "List SSH Servers"),
    ("POST", "/api/ssh/servers/07a3e081/test", None, "Test SSH Connection"),
    ("GET", "/api/ssh/servers/07a3e081/status", None, "SSH Server Status"),
    
    # Jobs Router
    ("GET", "/api/manual/batch/list", None, "List Batch Files"),
    
    # Batch Groups Router
    ("GET", "/api/batch-groups", None, "List Batch Groups"),
    
    # Schedules Router
    ("GET", "/api/schedules", None, "List Schedules"),
    
    # Crontab Router
    ("GET", "/api/crontab/presets", None, "Crontab Presets"),
    
    # Rclone Router
    ("GET", "/api/rclone/remotes", None, "List Rclone Remotes"),
    
    # Admin Router
    ("GET", "/api/admin/info", None, "Admin System Info"),
    
    # Ops Router
    ("GET", "/api/ops/step_status", None, "Step Status"),
    
    # Remote Sync Endpoints (SSH Router)
    ("POST", "/api/ssh/remote/list-batches", {"server_id": "07a3e081"}, "Remote: List Batches"),
    ("POST", "/api/ssh/remote/list-keys", {"server_id": "07a3e081"}, "Remote: List Keys"),
    ("POST", "/api/ssh/remote/list-groups", {"server_id": "07a3e081"}, "Remote: List Groups"),
]

def main():
    print("=" * 60)
    print("ISync API Endpoint Verification")
    print("=" * 60)
    
    results = {"OK": [], "FAILED": []}
    
    for method, path, data, desc in TESTS:
        result = test_endpoint(method, path, data, desc)
        status = result.get("status", "UNKNOWN")
        
        if status == "OK":
            print(f"✅ {desc}: OK")
            results["OK"].append(desc)
        else:
            print(f"❌ {desc}: {status} - {result.get('error', result.get('code', ''))}")
            results["FAILED"].append((desc, result))
    
    print("\n" + "=" * 60)
    print(f"SUMMARY: {len(results['OK'])} passed, {len(results['FAILED'])} failed")
    print("=" * 60)
    
    if results["FAILED"]:
        print("\nFailed endpoints:")
        for name, res in results["FAILED"]:
            print(f"  - {name}: {res}")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
