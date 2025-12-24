import streamlit as st
import threading
import os
import time
import json
import subprocess
import socket
import platform
import shutil
import difflib
import shlex
from datetime import datetime
from isync_config import load_config, save_config, load_synclist, save_synclist, get_default_config, resolve_sa_path, LOG_FILE_PATH
from isync_engine import ISyncEngine
from isync_auth import ISyncAuthManager

st.set_page_config(page_title="ISync Manager", layout="wide", initial_sidebar_state="expanded")

def start_isync_thread(selected_pairs, config, is_dry_run):
    """Starts the backend engine in a separate thread."""
    engine = ISyncEngine(config)
    for pair in selected_pairs:
        engine.execute_job(pair, dry_run=is_dry_run)

def get_live_status():
    """Reads the JSON status file updated by the engine."""
    if os.path.exists("current_status.json"):
        try:
            with open("current_status.json", "r") as f: return json.load(f)
        except: return None
    return None

if 'manual_email' not in st.session_state:
    st.session_state['manual_email'] = ''

def validate_config_health(conf):
    """Checks for missing mandatory fields and file path validity."""
    issues = []
    
    # 1. Global Settings
    if not conf.get('upload_limit'): 
        issues.append("Global: 'Upload Limit' is empty. (e.g., 700G)")
    if not conf.get('transfers'): 
        issues.append("Global: 'Rclone Transfers' is missing.")
    if not conf.get('max_users_per_cycle'): 
        issues.append("Global: 'Max Users/Cycle' is missing.")
        
    # 2. Domain Settings
    domains = conf.get('domains', [])
    if not domains:
        issues.append("Domains: No domains configured. Please fill in Domain Config #1.")
    else:
        for i, d in enumerate(domains):
            name = d.get('domain_name', f"Domain #{i+1}")
            if not d.get('domain_name'): issues.append(f"Domain #{i+1}: Missing 'Domain Name'.")
            if not d.get('admin_email'): issues.append(f"{name}: Missing 'Admin Email'.")
            
            json_path = resolve_sa_path(d.get('sa_json_path'))
            if not os.path.exists(json_path): issues.append(f"{name}: JSON file not found at '{json_path}'.")
                
            if not d.get('group_email'): issues.append(f"{name}: Missing 'Group Email'.")
    return issues

st.title("🔄 ISync: Impersonate Sync")

config = load_config()

# --- COMMAND PREVIEW ---
with st.expander("👁️ Rclone Command Preview", expanded=False):
    st.caption("This is how the command will look based on current saved settings.")
    dummy_eng = ISyncEngine(config)
    # Get first domain for context or use defaults
    d_preview = config.get('domains', [{}])[0] if config.get('domains') else {}
    p_src = "/local/source" if not config.get('ssh_enabled') else "/remote/source"
    p_dst = "drive:SharedDrive/Dest"
    
    cmd_preview = dummy_eng.build_rclone_cmd(p_src, p_dst, d_preview.get('sa_json_path'), d_preview.get('admin_email', 'admin@example.com'), dry_run=False, remote_sa_json_path=d_preview.get('remote_sa_json_path'))
    st.code(shlex.join(cmd_preview), language="bash")

# --- SIDEBAR: SYSTEM CONTEXT ---
with st.sidebar:
    st.header("Environment")
    st.info(f"**Host:** `{socket.gethostname()}`\n\n**OS:** `{platform.system()} {platform.release()}`")
    st.caption("Verify the Host above matches your intended execution environment (Local vs Remote).")

tab1, tab2, tab3, tab4 = st.tabs(["⚙️ Configuration", "📂 Sync Jobs", "📺 Live Console", "🛠️ Manual Ops"])

# --- TAB 1: CONFIGURATION ---
with tab1:
    st.header("Configuration Health")
    
    issues = validate_config_health(config)
    if issues:
        st.error(f"⚠️ Found {len(issues)} configuration issues:")
        for issue in issues:
            st.write(f"- {issue}")
        st.info("👇 Please correct these in the editor below.")
    else:
        st.success("✅ Configuration looks good! All mandatory fields are present.")
    
    st.divider()
    
    with st.expander("📝 Edit Configuration", expanded=True):
        st.caption("Fields marked with * are mandatory.")
        with st.form("global_config"):
            c1, c2, c3 = st.columns(3)
            upload_limit = c1.text_input("Upload Limit *", value=config.get('upload_limit', '700G'), help="Stop transfer and rotate user after this amount (e.g. 700G).")
            transfers = c2.number_input("Rclone Transfers *", value=int(config.get('transfers', 8)), help="Number of parallel file transfers.")
            max_users = c3.number_input("Max Users/Cycle *", value=int(config.get('max_users_per_cycle', 10)), help="Maximum number of temporary users to create per job run.")
            
            c4, c5 = st.columns(2)
            cmd_type = c4.selectbox("Rclone Command *", ["copy", "sync"], index=0 if config.get('rclone_command', 'copy') == 'copy' else 1, help="'copy' adds files; 'sync' makes dest identical to source (deletes files!).")
            stall_time = c5.number_input("Stall Timeout (Mins) *", value=int(config.get('stall_timeout_minutes', 10)), help="Restart rclone if no output is received for this many minutes.")
            
            c6, c7 = st.columns(2)
            webhook = c6.text_input("Webhook URL (Optional)", value=config.get('webhook_url', ''), help="Discord or Slack webhook URL for notifications.")
            flags = c7.text_input("Global Flags (Optional)", value=config.get('global_rclone_flags', ''), help="Extra flags passed to rclone (e.g. --drive-use-trash=false).")

            st.subheader("Remote Execution (SSH)")
            ssh_enabled = st.checkbox("Enable SSH Remote Execution", value=config.get('ssh_enabled', False), help="Enable this to run ISync logic locally while executing Rclone commands on a remote server (Hybrid Mode).")
            
            ssh_mode = config.get('ssh_mode', 'explicit')
            ssh_host = config.get('ssh_host', '')
            ssh_user = config.get('ssh_user', '')
            ssh_key = config.get('ssh_key_path', '')
            ssh_remote_path = config.get('ssh_remote_path', '~/isync')

            if ssh_enabled:
                ssh_mode_sel = st.radio("Connection Type", ["Explicit (User/Host/Key)", "System Alias / Config"], 
                                        index=0 if ssh_mode == 'explicit' else 1, horizontal=True)
                ssh_mode = "explicit" if ssh_mode_sel.startswith("Explicit") else "alias"

                c_ssh1, c_ssh2, c_ssh3 = st.columns(3)
                if ssh_mode == "explicit":
                    ssh_host = c_ssh1.text_input("SSH Host", value=ssh_host, help="e.g. 192.168.1.50")
                    ssh_user = c_ssh2.text_input("SSH User", value=ssh_user, help="e.g. root or ubuntu")
                    ssh_key = c_ssh3.text_input("SSH Key Path (Optional)", value=ssh_key, help="Absolute path to private key file.")
                else:
                    ssh_host = c_ssh1.text_input("SSH Alias", value=ssh_host, help="e.g. 'zfbak' (must be configured in ~/.ssh/config)")
                
                ssh_remote_path = st.text_input("Remote ISync Path", value=ssh_remote_path, help="Directory on remote server where isync is installed (e.g. /home/user/isync). Required for Sync features.")

                if st.button("Test SSH Connection"):
                    cmd = ["ssh"]
                    if ssh_mode == "explicit":
                        if ssh_key: cmd.extend(["-i", ssh_key])
                        target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
                        cmd.append(target)
                    else:
                        cmd.append(ssh_host)
                    cmd.extend(["echo", "SSH_SUCCESS"])
                    try:
                        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                        if "SSH_SUCCESS" in res.stdout: st.success(f"✅ Connected to {ssh_host}!")
                        else: st.error(f"❌ Failed: {res.stderr or res.stdout}")
                    except Exception as e: st.error(f"❌ Error: {e}")

            st.divider()
            st.subheader("Workspace Domains")
            domains = config.get('domains', [])
            if not domains: domains = [{'domain_name': '', 'admin_email': '', 'sa_json_path': '', 'group_email': ''}]
            
            updated_domains = []
            for i in range(5): 
                d = domains[i] if i < len(domains) else {}
                st.markdown(f"**Domain Config #{i+1}**")
                col_a, col_b, col_c, col_d, col_e = st.columns(5)
                d_name = col_a.text_input(f"Domain Name *", value=d.get('domain_name', ''), key=f"dn_{i}", help="Your Google Workspace domain (e.g. example.com).")
                d_admin = col_b.text_input(f"Admin Email *", value=d.get('admin_email', ''), key=f"da_{i}", help="Super Admin email to impersonate.")
                d_json = col_c.text_input(f"Local JSON Path", value=d.get('sa_json_path', ''), key=f"dj_{i}", help="Local path to SA JSON. Defaults to keys/master.json.")
                d_group = col_d.text_input(f"Group Email *", value=d.get('group_email', ''), key=f"dg_{i}", help="Google Group email that has Shared Drive access.")
                d_remote_json = col_e.text_input(f"Remote JSON Path", value=d.get('remote_sa_json_path', ''), key=f"drj_{i}", help="Path to SA JSON on the REMOTE server (required if SSH enabled).")
                
                if d_name: updated_domains.append({'domain_name': d_name, 'admin_email': d_admin, 'sa_json_path': d_json, 'group_email': d_group, 'remote_sa_json_path': d_remote_json})
            
            if st.form_submit_button("💾 Save Settings"):
                new_conf = {
                    'upload_limit': upload_limit, 'transfers': transfers, 'max_users_per_cycle': max_users,
                    'rclone_command': cmd_type, 'stall_timeout_minutes': stall_time,
                    'webhook_url': webhook, 'global_rclone_flags': flags,
                    'ssh_enabled': ssh_enabled, 'ssh_mode': ssh_mode, 'ssh_host': ssh_host, 'ssh_user': ssh_user, 'ssh_key_path': ssh_key, 'ssh_remote_path': ssh_remote_path,
                    'domains': updated_domains
                }
                save_config(new_conf)
                st.success("Settings Saved!")
                time.sleep(1)
                st.rerun()

    with st.expander("📚 Configuration Library (Import/Export)", expanded=False):
        st.caption("Save current settings to a named JSON file or load a previous configuration.")
        
        lib_dir = "config_library"
        if not os.path.exists(lib_dir): os.makedirs(lib_dir)
        
        c_ex, c_im = st.columns(2)
        
        with c_ex:
            st.markdown("**Export Current**")
            export_name = st.text_input("Config Name", placeholder="e.g. production_v1", help="Save as .json in config_library/")
            if st.button("💾 Export to Library"):
                if export_name:
                    fname = f"{export_name}.json" if not export_name.endswith('.json') else export_name
                    fpath = os.path.join(lib_dir, fname)
                    with open(fpath, 'w') as f:
                        json.dump(config, f, indent=4)
                    st.success(f"Saved: {fname}")
                else:
                    st.error("Enter a name.")

        with c_im:
            st.markdown("**Import from Library**")
            files = [f for f in os.listdir(lib_dir) if f.endswith('.json')]
            if files:
                sel_file = st.selectbox("Select Config", files, label_visibility="collapsed")
                if st.button("📂 Load Selected"):
                    try:
                        with open(os.path.join(lib_dir, sel_file), 'r') as f:
                            new_conf = json.load(f)
                        save_config(new_conf)
                        st.success(f"Loaded {sel_file}! Reloading...")
                        time.sleep(1)
                        st.rerun()
                    except Exception as e:
                        st.error(f"Error: {e}")
            else:
                st.info("No saved configs.")

        if st.button("⚠️ Reset to Defaults", help="Resets all configuration settings to their original defaults. Warning: This clears configured domains."):
            st.session_state['confirm_reset'] = True

        if st.session_state.get('confirm_reset', False):
            st.warning("⚠️ Are you sure? This will delete all domain configurations.")
            rc1, rc2 = st.columns(2)
            if rc1.button("✅ Yes, Reset"):
                save_config(get_default_config())
                st.session_state['confirm_reset'] = False
                st.success("Configuration reset to defaults!")
                time.sleep(1)
                st.rerun()
            if rc2.button("❌ Cancel"):
                st.session_state['confirm_reset'] = False
                st.rerun()

    if st.button("Test Config & Connectivity"):
        with st.spinner("Checking..."):
            engine = ISyncEngine(config)
            results = engine.validate_setup()
            for res in results:
                if "❌" in res: st.error(res)
                else: st.success(res)

    st.divider()
    with st.expander("💾 Backup & Remote Sync", expanded=False):
        st.caption("Manage local backups and sync configuration with the remote server.")
        
        # Backup Section
        st.subheader("Local Backup")
        if st.button("📦 Create Backup (Config + Keys)"):
            try:
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                bk_dir = "backups"
                if not os.path.exists(bk_dir): os.makedirs(bk_dir)
                
                # Prepare temp folder for zip
                tmp_name = f"isync_backup_{ts}"
                tmp_path = os.path.join(bk_dir, tmp_name)
                os.makedirs(tmp_path)
                
                # Copy files
                files_to_copy = ["config.yaml", "synclist.yaml"]
                for d in config.get('domains', []):
                    json_path = resolve_sa_path(d.get('sa_json_path'))
                    if json_path and os.path.exists(json_path):
                        shutil.copy(json_path, tmp_path)
                
                for f in files_to_copy:
                    if os.path.exists(f): shutil.copy(f, tmp_path)
                
                # Zip
                shutil.make_archive(os.path.join(bk_dir, tmp_name), 'zip', tmp_path)
                shutil.rmtree(tmp_path)
                st.success(f"✅ Backup created: backups/{tmp_name}.zip")
            except Exception as e:
                st.error(f"Backup failed: {e}")

        # Sync Section
        st.subheader("Remote Sync (SSH)")
        if not config.get('ssh_enabled'):
            st.warning("Enable SSH in settings to use Remote Sync.")
        else:
            c_sync1, c_sync2 = st.columns(2)
            
            def exec_scp(src, dest, recursive=False):
                cmd = ["scp"]
                if recursive: cmd.append("-r")
                if config.get('ssh_mode') == 'explicit' and config.get('ssh_key_path'):
                     cmd.extend(["-i", config.get('ssh_key_path')])
                cmd.extend([src, dest])
                return subprocess.run(cmd, capture_output=True, text=True)

            remote_base = config.get('ssh_remote_path', '.')
            ssh_target = config.get('ssh_host')
            if config.get('ssh_mode') == 'explicit' and config.get('ssh_user'):
                ssh_target = f"{config.get('ssh_user')}@{ssh_target}"

            with c_sync1:
                if st.button("⬆️ Push Config to Remote"):
                    st.info(f"Pushing files to {ssh_target}:{remote_base} ...")
                    
                    # Push Configs
                    r1 = exec_scp("config.yaml", f"{ssh_target}:{remote_base}/config.yaml")
                    r2 = exec_scp("synclist.yaml", f"{ssh_target}:{remote_base}/synclist.yaml")
                    
                    # Push Config Library (Backup JSONs)
                    r_lib = subprocess.CompletedProcess(args=[], returncode=0)
                    if os.path.exists("config_library"):
                        r_lib = exec_scp("config_library", f"{ssh_target}:{remote_base}/", recursive=True)

                    # Push JSON Keys
                    json_errs = []
                    for d in config.get('domains', []):
                        local_json = resolve_sa_path(d.get('sa_json_path'))
                        if local_json and os.path.exists(local_json):
                            fname = os.path.basename(local_json)
                            # Target keys/ folder on remote
                            rj = exec_scp(local_json, f"{ssh_target}:{remote_base}/keys/{fname}")
                            if rj.returncode != 0: json_errs.append(rj.stderr)

                    if r1.returncode == 0 and r2.returncode == 0 and r_lib.returncode == 0 and not json_errs:
                        st.success("✅ Push Complete! (Note: Remote paths in config.yaml might need adjustment)")
                    else:
                        st.error(f"❌ Push Failed. \nConfig: {r1.stderr}\nSyncList: {r2.stderr}\nLib: {r_lib.stderr}\nKeys: {json_errs}")

            with c_sync2:
                if st.button("⬇️ Pull Config from Remote"):
                    st.info(f"Pulling files from {ssh_target}:{remote_base} ...")
                    r1 = exec_scp(f"{ssh_target}:{remote_base}/config.yaml", ".")
                    r2 = exec_scp(f"{ssh_target}:{remote_base}/synclist.yaml", ".")
                    r_lib = exec_scp(f"{ssh_target}:{remote_base}/config_library", ".", recursive=True)
                    
                    if r1.returncode == 0 and r2.returncode == 0:
                        st.success("✅ Pull Complete. Refreshing...")
                        time.sleep(1)
                        st.rerun()
                    else: st.error(f"❌ Pull Failed: {r1.stderr} {r2.stderr}")
            
            st.divider()
            if st.button("🔍 Compare Local vs Remote Configs"):
                st.info("Fetching remote files for comparison...")
                
                def get_remote_content(filename):
                    cmd = ["ssh"]
                    if config.get('ssh_mode') == 'explicit' and config.get('ssh_key_path'):
                         cmd.extend(["-i", config.get('ssh_key_path')])
                    
                    target = ssh_target
                    cmd.append(target)
                    cmd.append(f"cat {remote_base}/{filename}")
                    
                    return subprocess.run(cmd, capture_output=True, text=True)

                for fname in ["config.yaml", "synclist.yaml"]:
                    # Read Local
                    local_content = []
                    if os.path.exists(fname):
                        with open(fname, "r") as f: local_content = f.readlines()
                    
                    # Read Remote
                    res = get_remote_content(fname)
                    if res.returncode != 0:
                        st.error(f"❌ Failed to read remote {fname}: {res.stderr}")
                        continue
                        
                    remote_content = res.stdout.splitlines(keepends=True)
                    
                    # Diff
                    diff = list(difflib.unified_diff(
                        local_content, remote_content,
                        fromfile=f"Local {fname}", tofile=f"Remote {fname}"
                    ))
                    
                    if diff:
                        st.warning(f"⚠️ {fname} differs:")
                        st.code("".join(diff), language="diff")
                    else:
                        st.success(f"✅ {fname} is identical.")

# --- TAB 2: JOBS ---
with tab2:
    st.header("Job Manager")
    sync_pairs = load_synclist()
    with st.expander("➕ Add Job", expanded=False):
        with st.form("add_pair_form"):
            c1, c2, c3 = st.columns(3)
            src = c1.text_input("Source", help="Local path or rclone remote:path.")
            dst = c2.text_input("Destination", help="Target path (usually remote:path).")
            dom_opts = [d['domain_name'] for d in config.get('domains', [])]
            dom_ref = c3.selectbox("Target Domain", dom_opts if dom_opts else ["No Domains"], help="Domain config to use for creating users.")
            if st.form_submit_button("Add Job"):
                if src and dst and dom_ref:
                    sync_pairs.append({'source': src, 'dest': dst, 'domain_reference': dom_ref})
                    save_synclist(sync_pairs)
                    st.success("Added")
                    st.rerun()

    if sync_pairs:
        st.write("### Queue")
        c_opt1, c_opt2 = st.columns(2)
        is_dry_run = c_opt1.checkbox("🧪 Test Mode (Dry Run)", help="Simulate run without copying files")
        use_ssh = c_opt2.checkbox("Run via SSH", value=config.get('ssh_enabled', False), help="Execute rclone on the configured SSH host.")
        with st.form("job_runner"):
            selected_indices = []
            for idx, row in enumerate(sync_pairs):
                label = f"**{row['source']}** ➡️ **{row['dest']}** _({row['domain_reference']})_"
                if st.checkbox(label, value=False, key=f"pair_{idx}"): selected_indices.append(idx)
            
            if st.form_submit_button("🚀 Launch ISync"):
                if selected_indices:
                    selected_jobs = [sync_pairs[i] for i in selected_indices]
                    run_config = config.copy()
                    run_config['ssh_enabled'] = use_ssh
                    t = threading.Thread(target=start_isync_thread, args=(selected_jobs, run_config, is_dry_run))
                    t.start()
                    st.success("Started! Check Live Console.")

# --- TAB 3: MONITOR ---
with tab3:
    st.header("Live Monitor")
    if st.button("Refresh"): st.rerun()
    status = get_live_status()
    m1, m2, m3, m4 = st.columns(4)
    if status:
        m1.metric("Status", status.get("status_msg", "Idle"))
        m2.metric("User", status.get("current_user", "-"))
        m3.metric("Speed", status.get("speed", "-"))
        m4.metric("Total Transferred", f"{status.get('total_transferred_gb', 0)} GB")
        if status.get("is_running"): st.progress(0, text=f"Job: {status.get('job')} | {status.get('current_progress')}")
    else: st.info("No active job status.")
    
    st.divider()
    st.subheader("Log")
    
    lc1, lc2 = st.columns([1, 4])
    if lc1.button("🗑️ Clear Log"):
        with open(LOG_FILE_PATH, "w") as f: f.write("")
        st.rerun()

    log_filter = lc2.text_input("Filter Log", help="Show only lines containing this text.")

    if os.path.exists(LOG_FILE_PATH):
        with open(LOG_FILE_PATH, "r") as f: lines = f.readlines()
        
        if log_filter:
            lines = [l for l in lines if log_filter.lower() in l.lower()]
        else:
            lines = lines[-20:]
            
        st.text_area("Output", "".join(lines), height=300)

# --- TAB 4: MANUAL OPS ---
with tab4:
    st.header("Manual Operations")
    
    domains = config.get('domains', [])
    dom_names = [d['domain_name'] for d in domains]
    selected_dom = st.selectbox("Select Domain Context", dom_names, help="Choose which domain credentials to use.") if dom_names else None
    
    sel_conf = next((d for d in domains if d['domain_name'] == selected_dom), None)
    
    manual_test_mode = st.checkbox("🧪 Test Mode (Verify Only)", value=False, help="Simulate actions to check for errors without making permanent changes.")
    
    if sel_conf:
        sa_path = sel_conf.get('sa_json_path', '')
        admin = sel_conf.get('admin_email', '')
        group = sel_conf.get('group_email', '')
        
        if st.button("Check Auth Connection"):
            try:
                mgr = ISyncAuthManager(sa_path, admin)
                ok, msg = mgr.test_api_connection()
                if ok: st.success(msg)
                else: st.error(msg)
            except Exception as e: st.error(f"Error: {e}")

        st.divider()
        
        c1, c2 = st.columns(2)
        with c1:
            btn_create_text = "Test User Creation" if manual_test_mode else "Create New User"
            if st.button(btn_create_text):
                with st.spinner("Creating..."):
                    try:
                        mgr = ISyncAuthManager(sa_path, admin)
                        if manual_test_mode:
                            # Test Cycle: Create then Delete
                            email = mgr.provision_uploader(sel_conf['domain_name'], group)
                            mgr.delete_user(email)
                            st.success(f"✅ Test Passed: User {email} created and deleted successfully.")
                        else:
                            email = mgr.provision_uploader(sel_conf['domain_name'], group)
                            st.session_state['manual_email'] = email
                            st.success(f"Created: {email}")
                    except Exception as e: st.error(f"Failed: {e}")
        
        target_user = st.text_input("Target User Email", value=st.session_state['manual_email'], help="The temporary user email to operate on.")
        
        with c2:
            btn_del_text = "Verify User Exists" if manual_test_mode else "Delete User"
            if st.button(btn_del_text):
                if target_user:
                    try:
                        mgr = ISyncAuthManager(sa_path, admin)
                        if manual_test_mode:
                            if mgr.user_exists(target_user): st.success(f"✅ User {target_user} exists.")
                            else: st.warning(f"User {target_user} not found.")
                        else:
                            mgr.delete_user(target_user)
                            st.success(f"Deleted: {target_user}")
                    except Exception as e: st.error(f"Failed: {e}")

        st.divider()
        st.subheader("Run Single Rclone Job")
        m_src = st.text_input("Source Path", help="Source for manual run.")
        m_dst = st.text_input("Destination Path", help="Destination for manual run.")
        
        c_man1, c_man2 = st.columns(2)
        m_dry_check = c_man1.checkbox("Dry Run", value=True, key="man_dry")
        man_use_ssh = c_man2.checkbox("Run via SSH", value=config.get('ssh_enabled', False), key="man_ssh")
        
        is_dry = True if manual_test_mode else m_dry_check
        if manual_test_mode: st.caption("ℹ️ Test Mode: Dry Run is enforced.")
        
        if st.button("🚀 Run Once"):
            if m_src and m_dst and target_user:
                remote_path = sel_conf.get('remote_sa_json_path')
                run_config = config.copy()
                run_config['ssh_enabled'] = man_use_ssh
                eng = ISyncEngine(run_config)
                t = threading.Thread(target=eng.run_rclone, args=(m_src, m_dst, sa_path, target_user, "Manual Job", is_dry, remote_path))
                t.start()
                st.success("Job started! Check Live Console.")
            else: st.error("Missing Source, Destination, or User.")