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
import shutil
from google.oauth2 import service_account
from googleapiclient.discovery import build
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
STEP_STATUS_FILE = "step_status.json"
STEP_ACTION_FILE = "step_action.json"

class ISyncEngine:
    """
    Core Logic Engine:
    - Manages the rclone subprocess
    - Handles user rotation logic
    - Parses rclone stdout for stats
    - Sends notifications
    """
    def __init__(self, config, status_callback=None):
        self.config = config
        self.stop_event = threading.Event()
        self.total_bytes_history = 0.0 
        self.status_callback = status_callback
        self.clear_status()

    def clear_status(self, step="Ready", detail="", status="IDLE"):
        """Clears the step status file to remove old errors."""
        data = {
            "step": step,
            "detail": detail,
            "status": status,
            "error": None,
            "timestamp": time.time()
        }
        with open(STEP_STATUS_FILE, 'w') as f:
            json.dump(data, f)

    def announce_step(self, description, detail):
        """
        Announces a step to the UI. 
        If step_check is True, pauses and waits for user approval.
        """
        # 1. Initial State: Running or Waiting
        status = "WAITING_USER" if self.config.get('step_check') else "RUNNING"
        
        data = {
            "step": description,
            "detail": detail,
            "status": status,
            "error": None,
            "timestamp": time.time()
        }
        with open(STEP_STATUS_FILE, 'w') as f:
            json.dump(data, f)
            
        # 2. Pause Logic
        if self.config.get('step_check'):
            logging.info(f"[Step Check] Paused for: {description}")
            while True:
                if self.stop_event.is_set(): raise Exception("Engine Stopped")
                
                if os.path.exists(STEP_ACTION_FILE):
                    try:
                        with open(STEP_ACTION_FILE, 'r') as f: action_data = json.load(f)
                        if action_data.get('action') == 'CONTINUE':
                            # Clear action and proceed
                            os.remove(STEP_ACTION_FILE)
                            break
                        elif action_data.get('action') == 'ABORT':
                            os.remove(STEP_ACTION_FILE)
                            raise Exception("User Aborted via Step Check")
                    except (json.JSONDecodeError, PermissionError): pass
                time.sleep(0.5)
            
            # Update to RUNNING after approval
            data['status'] = "RUNNING"
            with open(STEP_STATUS_FILE, 'w') as f: json.dump(data, f)

    def complete_step(self, description, success=True, error=None):
        """Updates the step status to Success or Failed."""
        status = "SUCCESS" if success else "FAILED"
        data = {
            "step": description,
            "detail": "", # Clear detail on completion to reduce clutter or keep it? Keeping it simple.
            "status": status,
            "error": str(error) if error else None,
            "dismissible": not success,
            "timestamp": time.time()
        }
        with open(STEP_STATUS_FILE, 'w') as f:
            json.dump(data, f)
        
        if not success:
            logging.error(f"[Step Failure] {description}: {error}")

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
            
        if self.status_callback:
            try:
                self.status_callback(data)
            except Exception as e:
                logging.error(f"Callback failed: {e}")

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
                else: 
                    if "unauthorized_client" in str(msg):
                        results.append(f"❌ {name}: DWD Auth Failed (Check Client ID & Scopes)")
                    else:
                        results.append(f"❌ {name}: API Error ({msg})")
            except Exception as e:
                results.append(f"❌ {name}: {str(e)}")
        return results

    def batch_unsuspend_users(self, domain_name, user_emails):
        """
        Reactivates (unsuspends) a list of users for a given domain.
        Returns a dict of {email: status_message}.
        """
        results = {}
        try:
            domain_cfg = self.get_domain_config(domain_name)
            json_path = domain_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
            admin_email = domain_cfg['admin_email']
            
            SCOPES = ['https://www.googleapis.com/auth/admin.directory.user']
            creds = service_account.Credentials.from_service_account_file(
                json_path, scopes=SCOPES, subject=admin_email
            )
            service = build('admin', 'directory_v1', credentials=creds)

            for email in user_emails:
                try:
                    service.users().patch(userKey=email, body={'suspended': False}).execute()
                    results[email] = "Success: Reactivated"
                    logging.info(f"[ISyncEngine] Unsuspended user: {email}")
                except Exception as e:
                    results[email] = f"Failed: {str(e)}"
                    logging.error(f"[ISyncEngine] Failed to unsuspend {email}: {e}")
        except Exception as e:
            logging.error(f"[ISyncEngine] Batch Unsuspend Error: {e}")
            return {"Global Error": str(e)}
            
        return results

    def batch_check_suspension(self, domain_name, user_emails):
        """
        Checks suspension status and reason for a list of users.
        Returns a dict of {email: {'suspended': bool, 'reason': str}}.
        """
        results = {}
        try:
            domain_cfg = self.get_domain_config(domain_name)
            json_path = domain_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
            admin_email = domain_cfg['admin_email']
            
            SCOPES = ['https://www.googleapis.com/auth/admin.directory.user']
            creds = service_account.Credentials.from_service_account_file(
                json_path, scopes=SCOPES, subject=admin_email
            )
            service = build('admin', 'directory_v1', credentials=creds)

            for email in user_emails:
                try:
                    user = service.users().get(userKey=email).execute()
                    is_suspended = user.get('suspended', False)
                    reason = user.get('suspensionReason', 'None')
                    results[email] = {'suspended': is_suspended, 'reason': reason}
                except Exception as e:
                    results[email] = {'error': str(e)}
                    logging.error(f"[ISyncEngine] Failed to check suspension for {email}: {e}")
        except Exception as e:
            logging.error(f"[ISyncEngine] Batch Check Suspension Error: {e}")
            return {"Global Error": str(e)}
            
        return results

    def _get_ssh_base_cmd(self):
        """Helper to build the base SSH command list."""
        ssh_host = self.config.get('ssh_host')
        ssh_user = self.config.get('ssh_user')
        ssh_key = self.config.get('ssh_key_path')
        target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
        cmd = ["ssh", target]
        if ssh_key: cmd.extend(["-i", ssh_key])
        return cmd

    def build_rclone_cmd(self, source, dest, sa_json_path, impersonate_email, dry_run=False, remote_sa_json_path=None, keep_open=True, session_suffix="", skip_ssh_wrapper=False, forced_session_name=None):
        """Generates the full rclone command list (including SSH wrapping if enabled)."""
        command_type = self.config.get('rclone_command', 'copy')
        upload_limit_str = self.config.get('upload_limit', '700G')
        extra_flags = self.config.get('global_rclone_flags', '').split()
        chunk_size = self.config.get('rclone_chunk_size', '128M')
        stats_interval = self.config.get('rclone_stats_interval', '1s')
        
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
            f"--max-transfer={upload_limit_str}",
            f"--transfers={str(self.config.get('transfers', 8))}",
            f"--drive-chunk-size={chunk_size}",
            f"--stats={stats_interval}"
        ]
        
        if extra_flags: cmd.extend(extra_flags)
        if dry_run: cmd.append("--dry-run")
        
        # Wrap in SSH if enabled
        if self.config.get('ssh_enabled') and not skip_ssh_wrapper:
            base_cmd = self._get_ssh_base_cmd()
            base_cmd.append("-t") # Force pseudo-tty for tmux
            
            remote_cmd_str = " ".join(shlex.quote(arg) for arg in cmd)
            
            # Keep tmux session open after command finishes
            if keep_open:
                remote_cmd_str += "; echo 'Remote process finished. Press Enter to close session...'; read line"
            
            # Wrap in Tmux (New Session)
            session_name = forced_session_name if forced_session_name else f"isync_{int(time.time())}{session_suffix}"
            # Pass as separate arguments to avoid over-quoting by SSH/Windows
            cmd = base_cmd + ["tmux", "new-session", "-s", session_name, remote_cmd_str]
            
        return cmd

    def run_rclone(self, source, dest, sa_json_path, impersonate_email, job_label, dry_run=False, remote_sa_json_path=None):
        """Runs the rclone command and monitors output."""
        stall_limit = int(self.config.get('stall_timeout_minutes', 10)) * 60
        upload_limit_str = self.config.get('upload_limit', '700G')
        mode_label = "TEST MODE" if dry_run else "Normal"
        
        # --- SSH CONNECTION CHECK ---
        if self.config.get('ssh_enabled'):
            base_cmd = self._get_ssh_base_cmd()
            check_cmd = base_cmd + ["echo", "SSH_READY"]
            logging.info(f"[ISyncEngine] Verifying SSH connection...")
            try:
                # Wait for connection to be established
                timeout_sec = int(self.config.get('ssh_connect_timeout', 10))
                chk = subprocess.run(check_cmd, capture_output=True, text=True, timeout=timeout_sec)
                if chk.returncode != 0 or "SSH_READY" not in chk.stdout:
                    logging.error(f"[ISyncEngine] SSH Check Failed: {chk.stderr or chk.stdout}")
                    return "ERROR"
            except Exception as e:
                logging.error(f"[ISyncEngine] SSH Check Error: {e}")
                return "ERROR"

                logging.error(f"[ISyncEngine] SSH Check Error: {e}")
                return "ERROR"

        # Generate a deterministic session name for tracking
        session_name = f"isync_{int(time.time())}"
        cmd = self.build_rclone_cmd(source, dest, sa_json_path, impersonate_email, dry_run, remote_sa_json_path, forced_session_name=session_name)

        # Windows Local Execution: Use PowerShell if available
        if os.name == 'nt' and not self.config.get('ssh_enabled'):
            ps_bin = shutil.which("pwsh") or shutil.which("powershell")
            if ps_bin:
                cmd_str = subprocess.list2cmdline(cmd)
                cmd = [ps_bin, "-NoProfile", "-Command", cmd_str]

        # --- STEP CHECK: RCLONE ---
        self.announce_step("Execute Rclone Command", shlex.join(cmd))

        logging.info(f"[ISyncEngine] Starting ({mode_label}): {shlex.join(cmd)}")
        
        # Configure execution flags (Visible Window for SSH/Tmux on Windows)
        creation_flags = 0
        stdout_dest = subprocess.PIPE
        stderr_dest = subprocess.STDOUT
        
        if self.config.get('ssh_enabled') and os.name == 'nt':
            creation_flags = getattr(subprocess, 'CREATE_NEW_CONSOLE', 0)
            stdout_dest = None
            stderr_dest = None
            
            # Keep local window open
            cmd_str = subprocess.list2cmdline(cmd)
            cmd = ["cmd.exe", "/c", f"{cmd_str} & pause"]

        # Start subprocess
        process = subprocess.Popen(cmd, stdout=stdout_dest, stderr=stderr_dest, universal_newlines=True, creationflags=creation_flags)

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

            if stdout_dest is None:
                # External Window Mode: Cannot read stats
                time.sleep(1)
                if process.poll() is not None: break
                self.update_status(job_label, impersonate_email, "-", "Running (External Window)", current_bytes_str, mode=mode_label)
                continue
            else:
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
                    except Exception as parse_err:
                        logging.debug(f"[ISyncEngine] Failed to parse rclone stats: {parse_err}")

                print(output)
            
            # --- STOP CHECK ---
            if self.stop_event.is_set():
                logging.info("[ISyncEngine] Stop Signal Received. Terminating process...")
                
                # 1. Kill Local Process
                try:
                    process.terminate()
                    time.sleep(1)
                    if process.poll() is None: process.kill()
                except Exception as e:
                    logging.error(f"[ISyncEngine] Failed to kill local process: {e}")
                
                # 2. Kill Remote Tmux Session if SSH
                if self.config.get('ssh_enabled'):
                     try:
                         logging.info(f"[ISyncEngine] Killing remote tmux session: {session_name}")
                         base_cmd = self._get_ssh_base_cmd()
                         kill_cmd = base_cmd + ["tmux", "kill-session", "-t", session_name]
                         subprocess.run(kill_cmd, capture_output=True, timeout=10)
                     except Exception as e:
                         logging.error(f"[ISyncEngine] Failed to kill remote tmux: {e}")

                self.update_status(job_label, impersonate_email, "0", "STOPPED", current_bytes_str, status_msg="Stopped by User", is_running=False)
                return "STOPPED"

        exit_code = process.poll()
        final_bytes_gb = self.parse_size(current_bytes_str)
        self.total_bytes_history += final_bytes_gb
        limit_gb = self.parse_size(upload_limit_str)
        
        if exit_code == 0 or exit_code == 8:
            # If external window, we assume Limit Reached to ensure rotation continues (safer)
            if stdout_dest is None:
                 logging.info("[ISyncEngine] External Window Mode: Assuming Limit Reached or Continuing.")
                 self.complete_step("Execute Rclone Command", success=True)
                 return "LIMIT_REACHED"
            
            if exit_code == 8:
                logging.info("[ISyncEngine] Hit Upload Limit (Exit Code 8). Rotating.")
                self.complete_step("Execute Rclone Command", success=True)
                return "LIMIT_REACHED"

            # If successful and transfer size is significantly less than limit, assume done.
            if final_bytes_gb < (limit_gb * 0.9):
                logging.info(f"[ISyncEngine] Process exited 0 and {final_bytes_gb}G < limit. Job Done.")
                self.complete_step("Execute Rclone Command", success=True)
                return "DONE"
            else:
                logging.info("[ISyncEngine] Hit Upload Limit. Rotating.")
                self.complete_step("Execute Rclone Command", success=True)
                return "LIMIT_REACHED"
        else:
            logging.warning(f"[ISyncEngine] Rclone exited code {exit_code}.")
            return "ERROR"

    def _resolve_user_domain_config(self, user_email, default_domain_cfg):
        """
        Resolves the correct domain configuration and JSON path for a specific user.
        Falls back to default_domain_cfg if no specific domain match is found.
        """
        if not user_email or '@' not in user_email:
            return default_domain_cfg # Fallback

        user_domain = user_email.split('@')[1].lower()
        
        # Check if user's domain matches the default setup first (optimization)
        if default_domain_cfg.get('domain_name', '').lower() == user_domain:
            return default_domain_cfg

        # Search in global config
        for d in self.config.get('domains', []):
            if d.get('domain_name', '').lower() == user_domain:
                return d
        
        # If not found, return default (or could log warning)
        return default_domain_cfg

    def generate_batch_command(self, pair, dry_run=False, user_list=None):
        """Generates a single batch command string for all users in the rotation."""
        source = pair['source']
        dest = pair['dest']
        target_domain = pair['domain_reference']
        
        # Default config from SyncPair
        default_domain_cfg = self.get_domain_config(target_domain)
        
        users_to_process = []
        if user_list:
            users_to_process = user_list
        else:
            if self.config.get('rotation_strategy', 'standard') != 'existing':
                return "Batch command generation is only supported in 'Existing Users' mode (or with manually selected users)."
            
            # Use default domain to fetch list if none provided
            json_path = default_domain_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
            try:
                list_mgr = ISyncAuthManager(json_path, default_domain_cfg['admin_email'])
                fetched_users = list_mgr.list_users(default_domain_cfg['domain_name'])
            except Exception as e:
                return f"Error fetching users: {e}"

            if not self.config.get('include_protected_users', False):
                protected_set = set(u.lower().strip() for u in self.config.get('protected_users', []) if u.strip())
                fetched_users = [u for u in fetched_users if u.lower() not in protected_set]

            max_users = int(self.config.get('max_users_per_cycle', 10))
            users_to_process = fetched_users[:max_users]

        commands = []
        for i, user in enumerate(users_to_process):
            # Resolve config per user (handle multi-domain selection)
            user_cfg = self._resolve_user_domain_config(user, default_domain_cfg)
            user_json_path = user_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
            
            cmd_list = self.build_rclone_cmd(
                source, dest, user_json_path, user, 
                dry_run=dry_run, 
                remote_sa_json_path=user_cfg.get('remote_sa_json_path'),
                keep_open=False,
                session_suffix=f"_{i}",
                skip_ssh_wrapper=True
            )
            commands.append(shlex.join(cmd_list))

        return "\n".join(commands)

    def generate_preview(self, pair):
        """Generates a preview of the execution context and the first command."""
        source = pair['source']
        dest = pair['dest']
        target_domain = pair['domain_reference']
        
        # 1. Determine Context
        if self.config.get('ssh_enabled'):
            user = self.config.get('ssh_user')
            host = self.config.get('ssh_host')
            context = f"Remote SSH: {user}@{host}" if user else f"Remote SSH: {host}"
        else:
            hostname = os.environ.get('COMPUTERNAME', 'localhost') if os.name == 'nt' else os.uname()[1]
            context = f"Local Machine: {hostname}"

        # 2. Generate First Command
        default_domain_cfg = self.get_domain_config(target_domain)
        default_json_path = default_domain_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
        
        user_to_preview = "[TEMP_USER]"
        
        strategy = self.config.get('rotation_strategy', 'standard')
        if strategy == 'existing':
             try:
                 # Fetch actual first user if possible
                 list_mgr = ISyncAuthManager(default_json_path, default_domain_cfg['admin_email'])
                 fetched_users = list_mgr.list_users(default_domain_cfg['domain_name'])
                 if fetched_users:
                     user_to_preview = fetched_users[0]
             except Exception as e:
                 logging.debug(f"[ISyncEngine] Could not fetch users for preview: {e}")
        
        # Resolve config for preview user
        user_cfg = self._resolve_user_domain_config(user_to_preview, default_domain_cfg)
        user_json_path = user_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)

        # Build Command (Force dry_run=False to show real command, but we won't execute it)
        # We want to show what WOULD happen.
        cmd_list = self.build_rclone_cmd(
            source, dest, user_json_path, user_to_preview, 
            dry_run=False, 
            remote_sa_json_path=user_cfg.get('remote_sa_json_path'),
            keep_open=False, # Standard flags
            skip_ssh_wrapper=False # We want to show the FULL command including SSH if applicable? 
            # Actually user asked for "first rclone command". 
            # If SSH is enabled, the rclone command runs ON the remote. 
            # So we should probably show the rclone command itself, OR the ssh wrapper?
            # Request says: "first rclone command which would be executed"
            # If wrapped in SSH, the "rclone command" is inside. 
            # Let's show the rclone command mostly, maybe stripping the SSH part if it makes it too long?
            # But the user might want to see the full valid shell command.
            # Let's return the simplified rclone command for clarity if SSH is active?
            # RE-READ: "where (local machine name or remote ssh server name) and ... show the first rclone command"
            # It implies the rclone command running on that machine.
        )
        
        # If SSH is enabled, build_rclone_cmd includes the SSH wrapper. 
        # But for clarity, if the context says "Remote SSH", maybe we just show the rclone part?
        # modify build_rclone_cmd to support skipping wrapper? YES, I added skip_ssh_wrapper earlier.
        
        if self.config.get('ssh_enabled'):
            # Generate the RAW rclone command that runs on the remote
             cmd_list = self.build_rclone_cmd(
                source, dest, user_json_path, user_to_preview, 
                dry_run=False, 
                remote_sa_json_path=user_cfg.get('remote_sa_json_path'),
                skip_ssh_wrapper=True
            )
        
        return {
            "context": context,
            "command": shlex.join(cmd_list)
        }

    def execute_job(self, pair, dry_run=False, user_list=None):
        """Orchestrates the full lifecycle of users for one job."""
        source = pair['source']
        dest = pair['dest']
        target_domain = pair['domain_reference']
        job_label = f"{source} -> {dest}"
        mode_label = "TEST" if dry_run else "Normal"
        
        self.clear_status(step="Initializing", detail=f"Starting {job_label}", status="RUNNING")
        
        logging.info(f"[ISyncEngine] Job Started ({mode_label}): {job_label}")
        self.send_notification(f"🚀 Job Started: `{job_label}` ({mode_label})")
        
        default_domain_cfg = self.get_domain_config(target_domain)
        default_json_path = default_domain_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
            
        strategy = self.config.get('rotation_strategy', 'standard')
        max_users = 1 if dry_run else int(self.config.get('max_users_per_cycle', 10))
        
        if strategy == 'existing':
            # --- EXISTING USERS MODE ---
            # Use user_list if provided (from Manual Batch), otherwise fetch
            if user_list is not None and len(user_list) > 0:
                 logging.info(f"[ISyncEngine] Using provided list of {len(user_list)} users.")
            else:
                try:
                    list_mgr = ISyncAuthManager(default_json_path, default_domain_cfg['admin_email'])
                    user_list = list_mgr.list_users(default_domain_cfg['domain_name'])
                    logging.info(f"[ISyncEngine] Fetched {len(user_list)} users from directory.")
                except Exception as e:
                    logging.error(f"[ISyncEngine] Failed to fetch users: {e}")
                    self.send_notification(f"❌ Job Failed: API Error {str(e)}")
                    return
            
            # Filter Protected Users if Excluded
            if not self.config.get('include_protected_users', False):
                protected_set = set(u.lower().strip() for u in self.config.get('protected_users', []) if u.strip())
                original_count = len(user_list)
                user_list = [u for u in user_list if u.lower() not in protected_set]
                if len(user_list) < original_count:
                    logging.info(f"[ISyncEngine] Excluded {original_count - len(user_list)} protected users from rotation.")

            if not user_list:
                logging.error("[ISyncEngine] User list is empty.")
                return

            count = 0
            status = "START"
            for current_user in user_list:
                if count >= max_users: 
                    self.update_status(job_label, "None", "-", "-", "0", is_running=False, status_msg="Max Users Reached")
                    break
                if self.stop_event.is_set(): break
                
                count += 1
                logging.info(f"--- Cycle {count}/{max_users} (User: {current_user}) ---")
                self.update_status(job_label, current_user, "0", "0%", "0", mode=mode_label, status_msg=f"Cycle {count}/{max_users}")
                
                # Resolve User Config
                user_cfg = self._resolve_user_domain_config(current_user, default_domain_cfg)
                user_json_path = user_cfg.get('sa_json_path', DEFAULT_SA_JSON_PATH)
                
                try:
                    status = self.run_rclone(source, dest, user_json_path, current_user, job_label, dry_run=dry_run, remote_sa_json_path=user_cfg.get('remote_sa_json_path'))
                except Exception as e:
                    self.complete_step("Execute Rclone Command", success=False, error=str(e))
                    self.send_notification(f"❌ Job Aborted: {str(e)}")
                    return
                
                if status == "DONE":
                    self.send_notification(f"✅ Job Complete: `{job_label}`")
                    self.update_status(job_label, "None", "-", "100%", "0", is_running=False, status_msg="Success")
                    break
                
                if status == "ERROR":
                    self.send_notification(f"⚠️ Rclone Error: `{job_label}`")
                    self.complete_step("Execute Rclone Command", success=False, error="Rclone exited with error code.")
                    return

        else:
            # --- STANDARD MODE (Create/Delete) ---
            # NOTE: Standard mode usually creates users in the DEFAULT target domain.
            # We don't need dynamic resolution here because we are creating the user in `domain_cfg`.
            protected = self.config.get('protected_users', [])
            auth_mgr = ISyncAuthManager(default_json_path, default_domain_cfg['admin_email'], protected_users=protected, company_name=self.config.get('company_name', 'Internal Ops'))
            status = "START"
            for i in range(1, max_users + 1):
                if self.stop_event.is_set(): break
                
                logging.info(f"--- Cycle {i}/{max_users} ---")
                self.update_status(job_label, "Creating User...", "0", "0%", "0", mode=mode_label, status_msg=f"Cycle {i}/{max_users}: Provisioning")

                # 1. Create User
                self.announce_step("Provision User", f"Creating temp user in {default_domain_cfg['domain_name']} and adding to {default_domain_cfg['group_email']}")
                current_user = None
                try:
                    current_user = auth_mgr.provision_uploader(default_domain_cfg['domain_name'], default_domain_cfg['group_email'])
                    self.complete_step("Provision User", success=True)
                except Exception as e:
                    self.complete_step("Provision User", success=False, error=str(e))
                    return

                # 2. Run Rclone
                self.update_status(job_label, current_user, "0", "0%", "0", mode=mode_label, status_msg=f"Cycle {i}/{max_users}: Running")
                try:
                    # In Standard Mode, user is created IN default domain, so use default json.
                    status = self.run_rclone(source, dest, default_json_path, current_user, job_label, dry_run=dry_run, remote_sa_json_path=default_domain_cfg.get('remote_sa_json_path'))
                except Exception as e:
                    self.complete_step("Execute Rclone Command", success=False, error=str(e))
                    # Attempt cleanup
                    try: auth_mgr.delete_user(current_user, default_domain_cfg.get('group_email'))
                    except Exception as cleanup_err:
                        logging.warning(f"[ISyncEngine] Failed to cleanup user after error: {cleanup_err}")
                    return

                # 3. Delete User
                self.announce_step("Delete User", f"Deleting user {current_user}")
                try:
                    auth_mgr.delete_user(current_user, default_domain_cfg.get('group_email'))
                    self.complete_step("Delete User", success=True)
                except Exception as e:
                    self.complete_step("Delete User", success=False, error=str(e))
                    return

                if status == "DONE":
                    self.send_notification(f"✅ Job Complete: `{job_label}`")
                    self.update_status(job_label, "None", "-", "100%", "0", is_running=False, status_msg="Success")
                    break
                
                if status == "ERROR":
                    self.send_notification(f"⚠️ Rclone Error: `{job_label}`")
                    self.complete_step("Execute Rclone Command", success=False, error="Rclone Error")
                    return

        if status != "DONE":
             self.update_status(job_label, "None", "-", "-", "0", is_running=False, status_msg="Max Users Reached / List Exhausted")