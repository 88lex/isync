# ISync - Impersonation Sync Engine

**Version 3.0.0 (Modular)** | High-speed Google Workspace data migration using per-account upload limits

---

## Introduction

**ISync** is a powerful, modular web-based tool for managing large-scale Google Workspace data migrations. It leverages rclone's `--drive-impersonate` feature to cycle through multiple Workspace user accounts—each with their own 750GB daily upload limit—enabling massive data transfers that would otherwise be rate-limited.

### Execution Modes

ISync is versatile and supports multiple operational modes:

| Mode | Description |
|------|-------------|
| **Local Execution** | Run rclone directly on the host machine |
| **Remote Execution** | Control ISync on a powerful remote server via SSH |
| **Batch Generation** | Create portable shell scripts for air-gapped or manual execution |
| **Orchestrator** | Push/pull files and configurations across a fleet of servers |

---

## Installation

### Prerequisites

*   **OS**: Linux (Ubuntu 20.04+) or Windows (WSL2)
*   **Python**: 3.9+
*   **Node.js**: 18+
*   **rclone**: Installed and configured

### Quick Start

1.  **Clone the Repository**
    ```bash
    cd /opt/isync_refactor
    ```

2.  **Run the Unified Launcher**
    This script will check requirements, install dependencies, build the frontend, and start the app.
    ```bash
    # Linux/WSL
    ./run_isync.sh
    ```
    *On Windows, you can run `run_isync.bat` which launches the WSL script.*

3.  **Access the UI**
    Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Detailed User Guide

This section explains every page of the application, describing each element and how to use it.

### 1. Prep Check (New in v3.0)
**Purpose**: Validates that your server environment is ready to run ISync.

![Prep Check Screenshot](file:///C:/Users/88/.gemini/antigravity/brain/5c536e39-dfdf-4e39-89e7-ed9c9e57040c/prep_check_top_1768368314794.png)

#### Elements
*   **System Checks**: Displays status of Python (3.9+), Node.js (18+), and Rclone.
*   **Auto-Fix Buttons**: Specialized buttons to install missing dependencies.
*   **Dependency List**: Shows installation status of required Python packages (e.g., `fastapi`, `uvicorn`, `google-api-python-client`).
*   **Remote Server Check**: Dropdown to run these same checks on a configured SSH server.

#### How to Use
1.  **Open Page**: Navigate to "Prep Check" in the sidebar.
2.  **Review Status**: Look for any red "X" icons.
3.  **Fix Issues**:
    *   If Python packages are missing, click **"Install Missing Packages"**.
    *   If Rclone is missing, follow the provided link to install it manually.
4.  **Test Remote**: Select a server from the dropdown to verify a remote deployment.

---

### 2. Dashboard (Sync Jobs)
**Purpose**: The central control room for running and monitoring migration jobs.

![Dashboard Screenshot](file:///C:/Users/88/.gemini/antigravity/brain/5c536e39-dfdf-4e39-89e7-ed9c9e57040c/dashboard_1768368230861.png)

#### Elements
*   **Status Card**: Large visual indicator of the current job state (IDLE, RUNNING, ERROR).
*   **Sync Pairs Panel** (Right Side):
    *   **Checkboxes**: Toggle which source→destination pairs to include in the job.
    *   **Edit/Delete**: Icons to modify or remove specific pair configurations.
*   **Control Buttons**:
    *   **Start**: Begins the sync process.
    *   **Stop**: Immediately halts the running job.
    *   **Preview**: Shows what commands *would* run without executing them.
*   **Live Console**: A scrolling window showing real-time logs from the backend.
*   **Progress Bar**: Visual bar showing percentage completion of the current user's quota or file transfer.

#### How to Use
1.  **Select Pairs**: In the right panel, check the box next to the sync pairs you want to run (e.g., `primary_source -> backup_dest`).
2.  **Launch**: Click **Start**. A confirmation modal will appear.
3.  **Confirm**: Review the settings in the modal and click "Confirm".
4.  **Monitor**: Watch the Live Console for "Transferring..." messages. The "Current User" field will update as ISync rotates through accounts.

---

### 3. User Management
**Purpose**: Manage the pool of Google Workspace users used for impersonation.

![User Management Screenshot](file:///C:/Users/88/.gemini/antigravity/brain/5c536e39-dfdf-4e39-89e7-ed9c9e57040c/user_management_1768368845581.png)

#### Elements
*   **Domain Selector**: Dropdown to switch between configured Workspace domains.
*   **User Table**:
    *   **Email**: The user's email address.
    *   **Status**: Active or Suspended.
    *   **Group**: Indicates if the user is a member of the permission group.
    *   **JSON Key**: Which service account file is associated with this user.
*   **Bulk Actions Toolbar**:
    *   **Verify Suspensions**: Query Google API to check if users are suspended.
    *   **Unsuspend**: Reactivate selected users.
    *   **Add to Group**: Add selected users to the configured permission group.
    *   **Delete**: Remove users from the local database.

#### How to Use
1.  **Choose Domain**: Select your target domain from the top dropdown.
2.  **List Users**: Click "List Users". ISync will fetch the directory from Google.
3.  **Filter**: Use the search bar to find specific users.
4.  **Manage**: Select 50 users, then click **"Add to Group"** to ensure they have permissions to write to the Shared Drives.

---

### 4. Batch Generator
**Purpose**: Create offline scripts for manual execution or backup.

#### Elements
*   **User Selection**: (Carried over from User Management) - which users to generate commands for.
*   **Sync Pair Selector**: Which source/dest paths to use.
*   **Options**:
    *   **Dry Run**: Add `--dry-run` flag to rclone commands.
    *   **Save as File**: Input field to name your batch script (e.g., `migration_weekend.sh`).

#### How to Use
1.  **Select Users**: Go to User Management, filter/select users.
2.  **Go to Generator**: Navigate to "Batch Generator".
3.  **Configure**: Choose the sync pair and enter a filename.
4.  **Generate**: Click **"Save Batch"**.
5.  **Retrieve**: The script is saved to `isync_batch/`. You can download it or run it later.

---

### 5. Drive Manager (New in v3.0)
**Purpose**: Mass-create Google Shared Drives (Team Drives).

![Drive Manager Screenshot](file:///C:/Users/88/.gemini/antigravity/brain/5c536e39-dfdf-4e39-89e7-ed9c9e57040c/drive_manager_1768368949386.png)

#### Elements
*   **Method Selector**: Choose between `fclone` (faster, requires config) or `Google API` (standard).
*   **Base Name**: The prefix for your drives (e.g., `Backup_Drive`).
*   **Suffix Config**:
    *   **Start/End**: Numeric range (e.g., 1 to 100).
    *   **Pattern**: Alphabetic pattern keys.
*   **Member Email**: The email (usually a group) to add as "Manager" to every drive.

#### How to Use
1.  **Setup**: Enter Base Name "Archive_2026".
2.  **Range**: Set Start=1, End=50.
3.  **Members**: Enter `admins@yourdomain.com`.
4.  **Create**: Click **"Create Drives"**. ISync will iterate and create "Archive_2026_01", "Archive_2026_02", etc., adding the group as Manager to each.

---

### 6. Configuration
**Purpose**: The settings brain of the application.

![Configuration Screenshot](file:///C:/Users/88/.gemini/antigravity/brain/5c536e39-dfdf-4e39-89e7-ed9c9e57040c/configuration_1768368978910.png)

#### Elements
*   **Global Settings**:
    *   **Upload Limit**: Default 750GB (Google's quota).
    *   **Transfers**: Number of parallel files (e.g., 8).
    *   **Rclone Command**: `copy` or `sync` (Use `copy` to be safe).
*   **Domains Config**:
    *   **Domain Name**: Your Google Workspace domain.
    *   **Admin Email**: The super admin user to impersonate.
    *   **Service Account JSON**: Absolute path to your `.json` key file.
*   **SSH Servers**:
    *   **Add Server**: Button to configure a new remote host.
    *   **Host/IP**: Address of the remote Server.
    *   **Key Path**: Path to your private SSH key (e.g., `~/.ssh/id_rsa`).

#### How to Use
1.  **Add Domain**: Scroll to Domains, click "Add Domain". Fill in details.
2.  **Set JSON**: Ensure the JSON path points to a file in the `keys/` directory.
3.  **Save**: Click the floating "Save" button in the bottom right to persist changes to `config.yaml`.

---

### 7. Remote Servers
**Purpose**: Manage distributed ISync instances.

#### Elements
*   **Server List**: Cards showing configured SSH servers.
*   **Status Indicators**: Shows if ISync is running/stopped on that server.
*   **Action Buttons**:
    *   **Deploy**: Pushes local code to the server.
    *   **Start/Stop**: Controls the remote process.
    *   **Terminal**: Copies an SSH command to your clipboard.

#### How to Use
1.  **Configure**: Add a server in the Configuration page first.
2.  **Deploy**: Click **"Deploy"**. ISync copies itself to the remote server and installs dependencies.
3.  **Start**: Click **"Start"**. The remote instance begins running in a `tmux` session.
4.  **Manage**: You can now tunnel to that server's UI or control it via Orchestrator.

---

## Troubleshooting

**Logs**
*   Logs are stored in `logs/isync.log` (rotating, max 10MB).
*   View live logs in the Dashboard console or the "Admin" section.

**Common Issues**
*   *Port in use*: Ensure ports 8000 (backend) and 5173 (frontend) are free.
*   *SSH Connection Refused*: Check your SSH keys and "Remote Servers" configuration.
*   *Service Account Error*: Verify your JSON key file has Domain-Wide Delegation enabled.

---

**ISync** | Engineered for Performance