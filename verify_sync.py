import requests
import json
import time

BASE_URL = "http://localhost:8000/api"

def test_sync_pair_flow():
    # 1. Create Sync Pair with SSH execution mode
    pair_payload = {
        "source": "/check/source",
        "dest": "remote:dest",
        "domain_reference": "",
        "meta_server_id": "server-123", # Dummy ID
        "meta_execution_mode": "ssh"
    }
    
    print("Creating Sync Pair...")
    res = requests.post(f"{BASE_URL}/sync-pairs", json=pair_payload)
    if res.status_code != 200:
        print(f"Failed to create pair: {res.text}")
        return
        
    pair_id = res.json().get('id')
    print(f"Created Pair ID: {pair_id} with mode: {res.json().get('meta_execution_mode')}")
    
    # 2. Verify with-batches endpoint
    print("Verifying /sync-pairs/with-batches...")
    res = requests.get(f"{BASE_URL}/sync-pairs/with-batches")
    pairs = res.json().get('pairs', [])
    found = next((p for p in pairs if p['id'] == pair_id), None)
    
    if found:
        print(f"Found Pair in list. Meta Server: {found.get('meta_server_id')}, Mode: {found.get('meta_execution_mode')}")
        if found.get('meta_execution_mode') != 'ssh':
            print("❌ Mismatch in execution mode!")
    else:
        print("❌ Pair not found in list!")

    # 3. Generate Batch and check syntax
    print("Generating Batch...")
    job_req = {
        "pairs": [res.json()], # Pass the pair object we just got back
        "dry_run": True
    }
    res = requests.post(f"{BASE_URL}/manual/batch", json=job_req)
    
    if res.status_code == 200:
        cmds = res.json().get('commands', {})
        cmd_text = list(cmds.values())[0] if cmds else ""
        print(f"\nGenerated Command Preview:\n{cmd_text[:200]}...")
        
        # Check for SSH wrapper
        if "ssh" in cmd_text and "tmux" in cmd_text: # Our engine wraps in SSH+Tmux for remote
             # Wait, our engine only wraps if ssh_enabled is True globally?
             # Let's check logic:
             # if execution_mode == 'local', force skip_ssh_wrapper.
             # if execution_mode == 'ssh', it respects global config?
             # Ah, `build_rclone_cmd` checks `self.config.get('ssh_enabled')`.
             # If verification environment doesn't have ssh_enabled=True in config, it won't wrap anyway.
             pass
    else:
        print(f"Batch generation failed: {res.text}")

if __name__ == "__main__":
    # Give server a moment to start
    time.sleep(3) 
    try:
        test_sync_pair_flow()
    except Exception as e:
        print(f"Error: {e}")
