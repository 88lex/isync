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
    cd /opt/isync
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

## Google Workspace & GCP Setup

To use ISync, you must configure a Google Cloud Project (GCP) and authorize it within your Google Workspace via Domain-Wide Delegation (DWD).

### Phase 1: Google Cloud Project (GCP)

1.  **Create a Project**:
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project named "ISync-Migration" (or similar).

2.  **Enable APIs** (Search for these in the **API Library**):
    *   **Admin SDK API** (Critical: For User/Group management)
    *   **Google Drive API** (Critical: For data transfer)
    *   **Google Sheets API** (Optional: For logs/exports)
    *   **Cloud Resource Manager API** (Critical: For project/hierarchy verification)
    *   **IAM API** (Identity and Access Management API: Required for permission checks)
    *   **Service Usage API** (Required for API discovery and quota management)
    *   **Cloud Identity API**
    *   **Groups Settings API**

3.  **Create a Service Account**:
    *   Navigate to **IAM & Admin > Service Accounts**.
    *   Click **Create Service Account**. Give it a name like `isync-worker`.
    *   **Important**: On the "Grant this service account access to project" step, assign the **Security Reviewer** role (Search for it in the role dropdown). This allows ISync to verify its own project-level health.
    *   Finish creation.

4.  **Generate JSON Key**:
    *   Click on your new Service Account.
    *   Go to the **Keys** tab > **Add Key** > **Create new key**.
    *   Select **JSON** and download it.
    *   **Save this file** to `/opt/isync/keys/master-key.json`.

5.  **Assign Project Roles** (Distinction from APIs):
    *   Permissions are managed in **IAM & Admin > IAM**, *not* the API Library.
    *   Ensure your `isync-worker` service account has the **Security Reviewer** role. If you cannot find it, **Project Viewer** is a functional alternative.

### Phase 2: Google Workspace (Admin Console)

This phase authorizes the Service Account to act on behalf of your users.

1.  **Copy the Client ID**:
    *   Open your downloaded JSON key and copy the numeric `client_id` (e.g., `123456789...`).

2.  **Configure Domain-Wide Delegation (DWD)**:
    *   Open the [Google Admin Console](https://admin.google.com/).
    *   Go to **Security > Access and data control > API controls**.
    *   Click **Manage Domain-wide Delegation**.
    *   Click **Add new**.
    *   **Client ID**: Paste the numeric ID from your JSON key (e.g., `11223344556677889900`).
    *   **OAuth Scopes**: Copy and paste the entire comma-separated list below (Triple-click to select all):

    ```text
    https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.group.member,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/cloud-identity,https://www.googleapis.com/auth/admin.directory.customer.readonly,https://www.googleapis.com/auth/admin.directory.domain.readonly,https://www.googleapis.com/auth/admin.reports.usage.readonly,https://www.googleapis.com/auth/apps.groups.settings,https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly
    ```

3.  **Verify Scopes (Feature Checklist)**:
    | Scope | Feature Enabled |
    | :--- | :--- |
    | `admin.directory.user` | Identifying Admins & listing users for migration. |
    | `admin.directory.group` | Managing migration permission groups. |
    | `drive` | Core data transfer & Shared Drive management. |
    | `admin.reports.usage.readonly` | Storage statistics & activity dashboards. |
    | `apps.groups.settings` | Advanced group security & posting policies. |
    | `admin.directory.rolemanagment` | Verification of admin roles & custom permissions. |
    | `cloud-platform` | Cross-service GCP integration for automation. |
    | `admin.directory.customer.readonly` | Retrieving your Workspace Organization ID. |

### Phase 3: Final Linkage

1.  **Select a Super Admin**: You must choose a **Super Admin** email from your Workspace (e.g., `admin@yourdomain.com`). The Service Account will impersonate this user to perform directory lookups.
2.  **Add to Configuration**: 
    *   Go to the **Configuration** page in the ISync UI.
    *   Add a new Domain.
    *   Input your **Domain**, **Admin Email**, and the path to your **JSON Key**.
    *   **Save**.
3.  **Run Prep Check**: Navigate to the **Prep Check** page to verify that all APIs and DWD credentials are valid and active.

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
5.  **Retrieve**: The script is saved to `batch/`. You can download it or run it later.

---

### 5. Drive Manager (Updated v3.1)
**Purpose**: Lifecycle management of Google Shared Drives and associated Rclone remotes.

![Drive Manager Screenshot](file:///C:/Users/88/.gemini/antigravity/brain/5c536e39-dfdf-4e39-89e7-ed9c9e57040c/drive_manager_1768368949386.png)

#### Elements
*   **Method Selector**: Choose between `fclone` (faster, requires config) or `Google API` (standard).
*   **Creation Tools**:
    *   **Base Name & Suffix**: Generate drives like `Backup_01` to `Backup_100`.
    *   **Members**: Auto-add a group email as "Manager" to newly created drives.
*   **Management Tools** (New):
    *   **Rename**: Select a drive and click "Rename" to update its name in Google Drive.
    *   **Delete**: Select one or more drives to permanently delete them.
    *   **Create Union**: Select multiple drives to generate a `union` remote combining them.
*   **Remote Integration**:
    *   **View Remotes**: See which `rclone.conf` entries point to each drive.
    *   **Manage Remotes**: Rename or Delete rclone remotes directly from the drive card using the Edit/Trash icons.

#### How to Use
1.  **Create**: Enter Base Name, Range, and Admin Email. Click **"Create Drives"**.
2.  **Rename**: Select a drive (checkbox), click **"Rename"** in the toolbar.
3.  **Delete**: Select drives, click **"Delete"**. A confirmation prompt will appear.
4.  **Fix Configs**: If a drive's rclone remote has a typo, click the **Edit icon** next to the remote name on the drive card to rename the local config entry.

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

### 8. Rclone Manager (New in v3.1)
**Purpose**: Direct control over the `rclone.conf` file on the local machine and remote servers.

#### Elements
*   **Remote List**: Displays all configured remotes in `~/.config/rclone/rclone.conf`.
*   **Editor**: JSON/Text based editor to modify remote configurations directly.
*   **Push to Remote**: Select specific remote configs and "Push" them to one of your connected SSH servers.
*   **Test**: Verify connectivity for any specific remote.

#### How to Use
1.  **View**: See all your current remotes.
2.  **Edit**: Click a remote to tweak parameters (e.g., `team_drive` ID).
3.  **Push**: Check the box next to "my-team-drive", select "Backup Server" from the dropdown, and click **Push**. The config is securely transferred and appended to the remote server's rclone config.

---

### 9. Remote Sync (New in v3.1)
**Purpose**: Orchestrate file transfers between servers or push local data to remotes.

#### Elements
*   **Source/Dest**: Select local folders or remote paths.
*   **Push**: Initiate rclone operations remotely.
*   **Status**: Monitor transfer progress across multiple nodes.

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