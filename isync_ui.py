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

# --- CUSTOM CSS ---
st.markdown("""
    <style>
        /* Reduce top padding */
        .block-container {
            padding-top: 1rem !important;
            padding-bottom: 1rem !important;
        }
        /* Reduce vertical spacing between widgets */
        div[data-testid="stVerticalBlock"] {
            gap: 0.5rem !important;
        }
        /* Reduce padding inside expanders */
        div[data-testid="stExpander"] > details > div {
            padding-top: 0.5rem !important;
            padding-bottom: 0.5rem !important;
        }
        /* Reduce padding inside forms */
        div[data-testid="stForm"] {
            padding: 0.75rem !important;
        }
        /* Sticky Command Previews */
        /* Targets expanders only inside the marked container */
        div[data-testid="stVerticalBlock"]:has(.sticky-preview-marker) > div > div[data-testid="stExpander"] {
            position: sticky;
            top: 3.75rem;
            z-index: 999;
            background-color: #0e1117; /* Matches Dark Theme BG. Change to white for light theme. */
            border-bottom: 1px solid #333;
        }
        /* Adjust sticky offset for the second preview (SSH) if present (3rd child: Marker, Expander1, Expander2) */
        div[data-testid="stVerticalBlock"]:has(.sticky-preview-marker) > div:nth-child(3) > div[data-testid="stExpander"] {
            top: 6.75rem; /* Header (3.75) + First Expander (3.0) */
        }
    </style>
""", unsafe_allow_html=True)

def ui_text_input_copy(label, value="", key=None, help=None, type="default"):
    """Renders a text input with a copy button (code block) below it."""
    val = st.text_input(label, value=value, key=key, help=help, type=type)
    if val: st.code(val, language=None)
    return val

def render_step_manager():
    """Reads step status and renders the top-level step UI."""
    if os.path.exists("step_status.json"):
        try:
            with open("step_status.json", "r") as f:
                status = json.load(f)
            
            st_code = status.get('status')
            step_name = status.get('step')
            detail = status.get('detail')
            err = status.get('error')

            if st_code == "WAITING_USER":
                st.warning(f"✋ **Step Check Paused**: {step_name}")
                st.info(f"**Command Detail:**\n`{detail}`")
                c1, c2 = st.columns(2)
                if c1.button("✅ Continue"):
                    with open("step_action.json", "w") as f: json.dump({"action": "CONTINUE"}, f)
                    st.rerun()
                if c2.button("🛑 Abort"):
                    with open("step_action.json", "w") as f: json.dump({"action": "ABORT"}, f)
                    st.rerun()
            elif st_code == "RUNNING":
                st.info(f"⏳ **Executing:** {step_name}\n\n`{detail}`")
            elif st_code == "SUCCESS":
                st.success(f"✅ **Step Completed Successfully:** {step_name}")
            elif st_code == "FAILED":
                st.error(f"❌ **Step Failed:** {step_name}\n\nError: {err}\n\n*isync has stopped.*")
        except: pass

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

# Reduced font size title
st.markdown("<h3 style='position: fixed; top: 0; left: 4rem; z-index: 999999; margin: 0; padding-top: 0.5rem; font-size: 1.2rem;'>🔄 ISync: Impersonate Sync</h3>", unsafe_allow_html=True)

# --- STEP STATUS DISPLAY ---
render_step_manager()

config = load_config()

# --- LIVE CONFIG PATCHING ---
# Override loaded config with live session state values for immediate preview updates
if "ssh_host_input" in st.session_state: config['ssh_host'] = st.session_state.ssh_host_input
if "ssh_user_input" in st.session_state: config['ssh_user'] = st.session_state.ssh_user_input
if "ssh_key_input" in st.session_state: config['ssh_key_path'] = st.session_state.ssh_key_input

# --- SYNC STATE LOGIC ---
if 'shared_max_users' not in st.session_state:
    st.session_state.shared_max_users = int(config.get('max_users_per_cycle', 10))

def update_max_users_from_config():
    st.session_state.shared_max_users = st.session_state.config_max_users
    st.session_state.manual_max_users = st.session_state.config_max_users

def update_max_users_from_manual():
    st.session_state.shared_max_users = st.session_state.manual_max_users
    st.session_state.config_max_users = st.session_state.manual_max_users

# --- SIDEBAR: SYSTEM CONTEXT & MODE ---
# Moved to top so 'ssh_enabled' updates config before Preview renders
with st.sidebar:
    env_help = f"OS: {platform.system()} {platform.release()}\n\nVerify the Host matches your intended execution environment (Local vs Remote)."
    st.markdown(f"🖥️ **Host:** `{socket.gethostname()}`", help=env_help)
    
    st.divider()
    nav_view = st.radio("Navigation", ["⚙️ Configuration", "📂 Sync Jobs", "📺 Live Console", "🛠️ Manual Ops"], label_visibility="collapsed")
    st.divider()
    st.header("Execution Mode")
    ssh_enabled = st.checkbox("Enable SSH Remote Execution", value=config.get('ssh_enabled', False), help="Run logic locally, execute Rclone on remote server.")
    config['ssh_enabled'] = ssh_enabled # Update in-memory config for Previews

# --- COMMAND PREVIEW ---
# 1. Rclone Preview (Inner Command)
# We force ssh_enabled=False here to show the raw rclone command without SSH/Tmux wrappers.
preview_config = config.copy()
preview_config['ssh_enabled'] = False
preview_eng = ISyncEngine(preview_config)

with st.container():
    st.markdown('<div class="sticky-preview-marker"></div>', unsafe_allow_html=True)
    
    with st.expander("👁️ Rclone Command Preview", expanded=False):
        st.caption("This is the command that will run on the target system.")
        # Get first domain for context or use defaults
        d_preview = config.get('domains', [{}])[0] if config.get('domains') else {}
        p_src = "/local/source" if not config.get('ssh_enabled') else "/remote/source"
        p_dst = "drive:SharedDrive/Dest"
        
        cmd_preview = preview_eng.build_rclone_cmd(p_src, p_dst, d_preview.get('sa_json_path'), d_preview.get('admin_email', 'admin@example.com'), dry_run=False, remote_sa_json_path=d_preview.get('remote_sa_json_path'))
        
        if platform.system() == "Windows" and not config.get('ssh_enabled'):
            ps_bin = shutil.which("pwsh") or shutil.which("powershell")
            if ps_bin:
                st.caption(f"ℹ️ Executing via **{os.path.basename(ps_bin)}**")
                cmd_str = subprocess.list2cmdline(cmd_preview)
                cmd_preview = [ps_bin, "-NoProfile", "-Command", cmd_str]

        st.code(shlex.join(cmd_preview), language="bash")

    if config.get('ssh_enabled'):
        ssh_eng = ISyncEngine(config)
        with st.expander("🔌 SSH Command Preview", expanded=False):
            st.caption("Base command used for establishing remote connections.")
            st.code(shlex.join(ssh_eng._get_ssh_base_cmd()), language="bash")

# --- TAB 1: CONFIGURATION ---
if nav_view == "⚙️ Configuration":
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
        c1, c2 = st.columns(2)
        with c1:
            upload_limit = ui_text_input_copy("Upload Limit *", value=config.get('upload_limit', '700G'), help="Stop transfer and rotate user after this amount (e.g. 700G).")
        transfers = c2.number_input("Rclone Transfers *", value=int(config.get('transfers', 8)), help="Number of parallel file transfers.")
        
        st.subheader("Run & Stop Mode Settings")
        c_strat1, c_strat2 = st.columns(2)
        strategy = c_strat1.selectbox("Mode / Strategy", ["standard", "existing"], index=0 if config.get('rotation_strategy', 'standard') == 'standard' else 1, help="Standard: Create N users. Existing: Use list.")
        max_users = c_strat2.number_input("# Users to create *", value=st.session_state.shared_max_users, key="config_max_users", on_change=update_max_users_from_config, help="Number of users to rotate through before stopping.")
        users_file = config.get('existing_users_file', 'users.txt')
        if strategy == "existing":
            users_file = ui_text_input_copy("Users List File", value=users_file, help="Path to text file containing one email per line.")

        c4, c5 = st.columns(2)
        cmd_type = c4.selectbox("Rclone Command *", ["copy", "sync"], index=0 if config.get('rclone_command', 'copy') == 'copy' else 1, help="'copy' adds files; 'sync' makes dest identical to source (deletes files!).")
        stall_time = c5.number_input("Stall Timeout (Mins) *", value=int(config.get('stall_timeout_minutes', 10)), help="Restart rclone if no output is received for this many minutes.")
        
        c6, c7 = st.columns(2)
        with c6:
            webhook = ui_text_input_copy("Webhook URL (Optional)", value=config.get('webhook_url', ''), help="Discord or Slack webhook URL for notifications.")
        with c7:
            flags = ui_text_input_copy("Global Flags (Optional)", value=config.get('global_rclone_flags', ''), help="Extra flags passed to rclone (e.g. --drive-use-trash=false).")
        
        step_check = st.checkbox("Enable Step Check (Pause before execution)", value=config.get('step_check', False), help="If enabled, ISync will pause before every main step (Create User, Run Rclone, Delete User) and ask for confirmation.")

        st.caption("Advanced Rclone Settings")
        c_adv1, c_adv2, c_adv3 = st.columns(3)
        with c_adv1:
            chunk_size = ui_text_input_copy("Chunk Size", value=config.get('rclone_chunk_size', '128M'), help="Rclone --drive-chunk-size (e.g. 128M, 256M).")
        with c_adv2:
            stats_int = ui_text_input_copy("Stats Interval", value=config.get('rclone_stats_interval', '1s'), help="Rclone --stats frequency (e.g. 1s, 5s).")
        verbose_log = c_adv3.checkbox("Verbose Logging", value=config.get('rclone_verbose', True), help="Enable --verbose flag for detailed logs.")

        st.subheader("Remote Execution (SSH)")
        st.caption(f"SSH Mode is currently: **{'ENABLED' if ssh_enabled else 'DISABLED'}** (Toggle in Sidebar)")
        
        ssh_host = config.get('ssh_host', '')
        ssh_user = config.get('ssh_user', '')
        ssh_key = config.get('ssh_key_path', '')
        ssh_remote_path = config.get('ssh_remote_path', '~/isync')

        c_ssh1, c_ssh2, c_ssh3 = st.columns(3)
        with c_ssh1:
            ssh_host = ui_text_input_copy("SSH Host / Alias", value=ssh_host, key="ssh_host_input", help="Hostname, IP address, or SSH Config Alias (e.g. 'myserver').")
        with c_ssh2:
            ssh_user = ui_text_input_copy("SSH User", value=ssh_user, key="ssh_user_input", help="Optional. Leave empty if using Alias or defined in SSH config.")
        with c_ssh3:
            ssh_key = ui_text_input_copy("SSH Key Path", value=ssh_key, key="ssh_key_input", help="Optional. Absolute path to private key file.")
        
        c_rem1, c_rem2 = st.columns([3, 1])
        with c_rem1:
            ssh_remote_path = ui_text_input_copy("Remote ISync Path", value=ssh_remote_path, help="Directory on remote server where isync is installed (e.g. /home/user/isync). Required for Sync features.")
        with c_rem2:
            ssh_timeout = st.number_input("Timeout (s)", value=int(config.get('ssh_connect_timeout', 10)), min_value=1, help="SSH connection timeout in seconds.")

        st.subheader("Safety & Security")
        protected_list = config.get('protected_users', [])
        protected_str = "\n".join(protected_list)
        protected_input = st.text_area("Protected Users (One per line)", value=protected_str, help="Users listed here will NEVER be deleted by ISync (Manual or Automated). Use this for permanent accounts.")

        if st.button("Test SSH Connection"):
            cmd = ["ssh"]
            if ssh_key: cmd.extend(["-i", ssh_key])
            target = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
            cmd.append(target)
            cmd.extend(["echo", "SSH_SUCCESS"])
            try:
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=ssh_timeout)
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
            with col_a:
                d_name = ui_text_input_copy(f"Domain Name *", value=d.get('domain_name', ''), key=f"dn_{i}", help="Your Google Workspace domain (e.g. example.com).")
            with col_b:
                d_admin = ui_text_input_copy(f"Admin Email *", value=d.get('admin_email', ''), key=f"da_{i}", help="Super Admin email to impersonate.")
            with col_c:
                d_json = ui_text_input_copy(f"Local JSON Path", value=d.get('sa_json_path', ''), key=f"dj_{i}", help="Local path to SA JSON. Defaults to keys/master.json.")
            with col_d:
                d_group = ui_text_input_copy(f"Group Email *", value=d.get('group_email', ''), key=f"dg_{i}", help="Google Group email that has Shared Drive access.")
            with col_e:
                d_remote_json = ui_text_input_copy(f"Remote JSON Path", value=d.get('remote_sa_json_path', ''), key=f"drj_{i}", help="Path to SA JSON on the REMOTE server (required if SSH enabled).")
            
            if d_name: updated_domains.append({'domain_name': d_name, 'admin_email': d_admin, 'sa_json_path': d_json, 'group_email': d_group, 'remote_sa_json_path': d_remote_json})
        
        if st.button("💾 Save Settings"):
            p_users = [u.strip() for u in protected_input.split('\n') if u.strip()]
            new_conf = {
                'upload_limit': upload_limit, 'transfers': transfers, 'max_users_per_cycle': max_users,
                'rotation_strategy': strategy, 'existing_users_file': users_file,
                'rclone_command': cmd_type, 'stall_timeout_minutes': stall_time,
                'rclone_chunk_size': chunk_size, 'rclone_stats_interval': stats_int, 'rclone_verbose': verbose_log,
                'webhook_url': webhook, 'global_rclone_flags': flags,
                'step_check': step_check,
                'ssh_enabled': ssh_enabled, 'ssh_host': ssh_host, 'ssh_user': ssh_user, 'ssh_key_path': ssh_key, 'ssh_remote_path': ssh_remote_path, 'ssh_connect_timeout': ssh_timeout,
                'protected_users': p_users,
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
                if config.get('ssh_key_path'):
                     cmd.extend(["-i", config.get('ssh_key_path')])
                cmd.extend([src, dest])
                return subprocess.run(cmd, capture_output=True, text=True)

            remote_base = config.get('ssh_remote_path', '.')
            
            ssh_target = config.get('ssh_host')
            if config.get('ssh_user'):
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
                    if config.get('ssh_key_path'):
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
elif nav_view == "📂 Sync Jobs":
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
elif nav_view == "📺 Live Console":
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
elif nav_view == "🛠️ Manual Ops":
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
        
        c_n, c_create, c_delete = st.columns([1, 1, 1])
        with c_n:
            st.number_input("# Users to create", min_value=1, value=st.session_state.shared_max_users, key="manual_max_users", on_change=update_max_users_from_manual)

        with c_create:
            num_users = st.session_state.shared_max_users
            suffix = "s" if num_users > 1 else ""
            btn_create_text = f"Test User Creation ({num_users})" if manual_test_mode else f"Create New User{suffix}"
            
            if st.button(btn_create_text):
                with st.spinner(f"Processing {num_users} users..."):
                    try:
                        protected = config.get('protected_users', [])
                        mgr = ISyncAuthManager(sa_path, admin, protected_users=protected)
                        created_list = []

                        if manual_test_mode:
                            # Test Cycle: Create then Delete N times
                            for i in range(num_users):
                                email = mgr.provision_uploader(sel_conf['domain_name'], group)
                                mgr.delete_user(email)
                                created_list.append(email)
                            st.success(f"✅ Test Passed: {len(created_list)} users created and deleted successfully.")
                        else:
                            bar = st.progress(0)
                            for i in range(num_users):
                                email = mgr.provision_uploader(sel_conf['domain_name'], group)
                                created_list.append(email)
                                bar.progress((i + 1) / num_users)
                            
                            if created_list:
                                st.session_state['manual_email'] = created_list[-1]
                                st.session_state['target_user_input'] = created_list[-1]
                                st.success(f"Created {len(created_list)} users:")
                                st.code("\n".join(created_list), language=None)
                    except Exception as e: st.error(f"Failed: {e}")
        
        default_tgt = st.session_state['manual_email'] if st.session_state['manual_email'] else admin
        target_user = ui_text_input_copy("Target User Email", value=default_tgt, key="target_user_input", help="The temporary user email to operate on. Defaults to Admin Email.")
        
        with c_delete:
            btn_del_text = "Verify User Exists" if manual_test_mode else "Delete User"
            if st.button(btn_del_text):
                if target_user:
                    try:
                        protected = config.get('protected_users', [])
                        mgr = ISyncAuthManager(sa_path, admin, protected_users=protected)
                        if manual_test_mode:
                            if mgr.user_exists(target_user): st.success(f"✅ User {target_user} exists.")
                            else: st.warning(f"User {target_user} not found.")
                        else:
                            mgr.delete_user(target_user)
                            st.success("Deleted:"); st.code(target_user, language=None)
                    except Exception as e: st.error(f"Failed: {e}")

        st.subheader("Directory Listing")
        if st.button("List Users"):
            try:
                mgr = ISyncAuthManager(sa_path, admin)
                with st.spinner(f"Fetching users for {sel_conf['domain_name']}..."):
                    users = mgr.list_users(sel_conf['domain_name'])
                
                if users:
                    st.success(f"Found {len(users)} users.")
                    st.text_area("User List", "\n".join(users), height=200)
                else:
                    st.info("No users found.")
            except Exception as e: st.error(f"Failed to list users: {e}")

        st.divider()
        st.subheader("Run Single Rclone Job")
        m_src = ui_text_input_copy("Source Path", help="Source for manual run.")
        m_dst = ui_text_input_copy("Destination Path", help="Destination for manual run.")
        
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

        st.divider()
        st.subheader("Run Batch Job (Run & Stop)")
        st.caption("Execute a full rotation cycle manually with custom settings.")
        
        b_src = ui_text_input_copy("Source Path", key="b_src")
        b_dst = ui_text_input_copy("Destination Path", key="b_dst")
        
        c_b1, c_b2 = st.columns(2)
        b_strat = c_b1.selectbox("Strategy", ["standard", "existing"], key="b_strat")
        b_n = st.session_state.shared_max_users
        b_dry = c_b2.checkbox("Dry Run", value=True, key="b_dry_run")
        
        if st.button("🚀 Start Batch Job"):
            if b_src and b_dst and selected_dom:
                batch_conf = config.copy()
                batch_conf['rotation_strategy'] = b_strat
                batch_conf['max_users_per_cycle'] = b_n
                pair = {'source': b_src, 'dest': b_dst, 'domain_reference': selected_dom}
                eng = ISyncEngine(batch_conf)
                t = threading.Thread(target=eng.execute_job, args=(pair, b_dry))
                t.start()
                st.success(f"Batch Job Started! (N={b_n}, Strategy={b_strat})")
            else:
                st.error("Missing Source, Destination, or Domain Context.")