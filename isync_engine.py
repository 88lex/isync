import subprocess
import logging
from logging.handlers import RotatingFileHandler
import time
import os
import threading
import json
import re
import shlex
import requests
from isync_auth import ISyncAuthManager
from isync_config import DEFAULT_SA_JSON_PATH, LOG_FILE_PATH, LOGS_DIR

# Configure logging to file
os.makedirs(LOGS_DIR, exist_ok=True)
logging.basicConfig(
    handlers=[RotatingFileHandler(LOG_FILE_PATH, maxBytes=5*1024*1024, backupCount=5)],
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

STATUS_FILE = "current_status.json"

class ISyncEngine:
    """
    Core Logic Engine:
    - Manages the rclone subprocess
    - Handles user rotation logic
    - Parses rclone stdout for stats
    - Sends notifications
    """
    def __init__(self, config):
        self.config = config
        self.stop_event = threading.Event()
        self.total_bytes_history = 0.0 

    def send_notification(self, message):
        """Sends webhook notification (Discord/Slack)."""
        url = self.config.get('webhook_url')
        if not url: return
        try:
            # Discord format default, adapts for Slack
            payload = {"content": f"**[ISync]** {message}"} 
            if "hooks.slack.com" in url: 
                payload = {"text": f"[ISync] {message}"}
            requests.post(url, json=payload)
        except Exception: 
            pass

    def parse_size(self, size_str):
        """Parses rclone size strings (e.g., '1.5 G') into GB floats."""
        if not size_str: return 0.0
        match = re.search(r"([0-9.]+)\s*([a-zA-Z]+)", size_str)
        if not match: return 0.0
        val = float(match.group(1))
        unit = match.group(2).upper()
        if 'T' in unit: return val * 1024
        if 'G' in unit: return val
        if 'M' in unit: return val / 1024
        return 0.0

    def update_status(self, job_name, user, speed, current_progress, current_bytes_str, is_running=True, mode="Normal", status_msg="Running"):
        """Writes current state to JSON for UI consumption."""
        current_val_gb = self.parse_size(current_bytes_str)
        total_gb = self.total_bytes_history + current_val_gb

        data = {
            "job": job_name,
            "mode": mode,
            "status_msg": status_msg,
            "current_user": user,
            "speed": speed,
            "current_progress": current_progress,
            "total_transferred_gb": round(total_gb, 2),
            "is_running": is_running,
            "last_updated": time.time()
        }
        with open(STATUS_FILE, 'w') as f:
            json.dump(data, f)

    def get_domain_config(self, domain_name):
        """Finds configuration for a specific domain."""
        for d in self.config.get('domains', []):
            if d['domain_name'] == domain_name: return d
        raise ValueError(f"Domain '{domain_name}' config not found.")

    def validate_setup(self):
        """Checks API connectivity for all configured domains."""
        results = []
        for d in self.config.get('domains', []):
            name = d.get('domain_name', 'Unknown')
            
            json_path = d.get('sa_json_path')
            if not json_path:
                json_path = DEFAULT_SA_JSON_PATH

            if not os.path.exists(json_path):
                results.append(f"❌ {name}: JSON file missing ({json_path})")
                continue
            try:
                auth = ISyncAuthManager(json_path, d['admin_email'])
                ok, msg = auth.test_api_connection()
                if ok: results.append(f"✅ {name}: API OK")
                else: results.append(f"❌ {name}: API Error ({msg})")
            except Exception as e:
                results.append(f"❌ {name}: {str(e)}")
        return results

    def build_rclone_cmd(self, source, dest, sa_json_path, impersonate_email, dry_run=False, remote_sa_json_path=None):
        """Generates the full rclone command list (including SSH wrapping if enabled)."""
        command_type = self.config.get('rclone_command', 'copy')
        upload_limit_str = self.config.get('upload_limit', '700G')
        extra_flags = self.config.get('global_rclone_flags', '').split()
        
        if not sa_json_path:
            sa_json_path = DEFAULT_SA_JSON_PATH

        # Determine which JSON path to use for the rclone command
        effective_sa_path = sa_json_path
        if self.config.get('ssh_enabled') and remote_sa_json_path:
            effective_sa_path = remote_sa_json_path

        cmd = [
            "rclone", command_type, source, dest,
            f"--drive-service-account-file={effective_sa_path}",
            f"--drive-impersonate={impersonate_email}",
            f"--drive-stop-on-upload-limit={upload_limit_str}",
            f"--transfers={str(self.config.get('transfers', 8))}",
            "--drive-chunk-size=128M",
            "--stats=1s",
            "--verbose"
        ]
        
        if extra_flags: cmd.extend(extra_flags)
        if dry_run: cmd.append("--dry-run")
        
        # Wrap in SSH if enabled
        if self.config.get('ssh_enabled'):
            ssh_mode = self.config.get('ssh_mode', 'explicit')
            ssh_host = self.config.get('ssh_host')
            
            remote_cmd_str = " ".join(shlex.quote(arg) for arg in cmd)
            
            if ssh_mode == 'alias':
                cmd = ["ssh", ssh_host]
            else:
                ssh_user = self.config.get('ssh_user')
                ssh_key = self.config.get('ssh_key_path')
                target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
                cmd = ["ssh", target]
                if ssh_key: cmd.extend(["-i", ssh_key])
            
            cmd.append(remote_cmd_str)
            
        return cmd

    def run_rclone(self, source, dest, sa_json_path, impersonate_email, job_label, dry_run=False, remote_sa_json_path=None):
        """Runs the rclone command and monitors output."""
        stall_limit = int(self.config.get('stall_timeout_minutes', 10)) * 60
        mode_label = "TEST MODE" if dry_run else "Normal"
        
        cmd = self.build_rclone_cmd(source, dest, sa_json_path, impersonate_email, dry_run, remote_sa_json_path)

        logging.info(f"[ISyncEngine] Starting ({mode_label}): {shlex.join(cmd)}")
        
        # Start subprocess
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)

        current_bytes_str = "0 G"
        last_activity_time = time.time()
        
        # Monitor Loop
        while True:
            # Stall Check
            if time.time() - last_activity_time > stall_limit:
                logging.error(f"[ISyncEngine] STALL DETECTED! No activity for {stall_limit/60} mins.")
                process.terminate()
                self.update_status(job_label, impersonate_email, "0", "STALLED", current_bytes_str, status_msg="Stalled - Restarting")
                return "STALLED"

            output = process.stdout.readline()
            if output == '' and process.poll() is not None: 
                break
            
            if output:
                last_activity_time = time.time()
                output = output.strip()
                # Parse Rclone Stats
                if "Transferred:" in output and "," in output:
                    try:
                        bytes_match = re.search(r"Transferred:\s+([0-9.]+\s?[a-zA-Z]+)", output)
                        if bytes_match: current_bytes_str = bytes_match.group(1)
                        parts = output.split(',')
                        speed, progress = "0", "0%"
                        for p in parts:
                            if "Bytes/s" in p or "bits/s" in p: speed = p.strip()
                            if "%" in p: progress = p.strip()
                        self.update_status(job_label, impersonate_email, speed, progress, current_bytes_str, mode=mode_label)
                    except: pass
                print(output)

        exit_code = process.poll()
        final_bytes_gb = self.parse_size(current_bytes_str)
        self.total_bytes_history += final_bytes_gb
        limit_gb = self.parse_size(upload_limit_str)
        
        if exit_code == 0:
            # If successful and transfer size is significantly less than limit, assume done.
            if final_bytes_gb < (limit_gb * 0.9):
                logging.info(f"[ISyncEngine] Process exited 0 and {final_bytes_gb}G < limit. Job Done.")
                return "DONE"
            else:
                logging.info("[ISyncEngine] Hit Upload Limit. Rotating.")
                return "LIMIT_REACHED"
        else:
            logging.warning(f"[ISyncEngine] Rclone exited code {exit_code}.")
            return "ERROR"

    def execute_job(self, pair, dry_run=False):
        """Orchestrates the full lifecycle of users for one job."""
        source = pair['source']
        dest = pair['dest']
        target_domain = pair['domain_reference']
        job_label = f"{source} -> {dest}"
        mode_label = "TEST" if dry_run else "Normal"
        
        logging.info(f"[ISyncEngine] Job Started ({mode_label}): {job_label}")
        self.send_notification(f"🚀 Job Started: `{job_label}` ({mode_label})")
        
        domain_cfg = self.get_domain_config(target_domain)
        
        json_path = domain_cfg.get('sa_json_path')
        if not json_path:
            json_path = DEFAULT_SA_JSON_PATH
            
        auth_mgr = ISyncAuthManager(json_path, domain_cfg['admin_email'])
        max_users = 1 if dry_run else int(self.config.get('max_users_per_cycle', 10))
        
        current_user = auth_mgr.provision_uploader(domain_cfg['domain_name'], domain_cfg['group_email'])
        next_user = None

        for i in range(1, max_users + 1):
            if self.stop_event.is_set(): break
            
            logging.info(f"--- Cycle {i}/{max_users} ---")
            self.update_status(job_label, current_user, "0", "0%", "0", mode=mode_label, status_msg=f"Cycle {i}/{max_users}")

            # Pre-provision next user
            if i < max_users and not dry_run:
                def prepare_next():
                    nonlocal next_user
                    next_user = auth_mgr.provision_uploader(domain_cfg['domain_name'], domain_cfg['group_email'])
                t = threading.Thread(target=prepare_next)
                t.start()

            # Run transfer
            status = self.run_rclone(source, dest, json_path, current_user, job_label, dry_run=dry_run, remote_sa_json_path=domain_cfg.get('remote_sa_json_path'))

            if i < max_users and not dry_run: t.join()

            # Cleanup old user
            threading.Thread(target=auth_mgr.delete_user, args=(current_user,)).start()

            if status == "DONE":
                self.send_notification(f"✅ Job Complete: `{job_label}`")
                self.update_status(job_label, "None", "-", "100%", "0", is_running=False, status_msg="Success")
                break
            
            if status == "ERROR":
                self.send_notification(f"⚠️ Rclone Error: `{job_label}`")

            current_user = next_user

        if status != "DONE" and i == max_users:
             self.update_status(job_label, "None", "-", "-", "0", is_running=False, status_msg="Max Users Reached")
        
        # Final cleanup
        if current_user: auth_mgr.delete_user(current_user)
        if next_user: auth_mgr.delete_user(next_user)