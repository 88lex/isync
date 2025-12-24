# ISync (Impersonate Sync)

**ISync** is an advanced Python automation tool designed for high-volume data migrations to Google Workspace Shared Drives. It bypasses the standard 750GB daily upload limit per user by automating the lifecycle of temporary user accounts.

It utilizes **Service Account Impersonation**, meaning you do **not** need to manage thousands of JSON key files. One Master Service Account can generate, control, and delete temporary users on the fly.

---

## 📋 Table of Contents
1. [Architecture](#architecture)
2. [Prerequisites (Critical Setup)](#prerequisites)
3. [Installation (Local & Remote)](#installation)
4. [Operating Modes & Usage](#usage)
5. [First Run & Configuration Walkthrough](#first-run)
6. [Background Persistence (Tmux)](#background-persistence)
7. [Troubleshooting](#troubleshooting)

---

## <a name="architecture"></a> 1. Architecture

*   **Auth Module (`isync_auth.py`):** Interfaces with Google Directory API to create/delete temporary "Bot" users and manage group membership.
*   **Engine (`isync_engine.py`):** The core loop. Launches `rclone` subprocesses, monitors output for stalls, and rotates users when the 750GB limit is reached.
*   **UI (`isync_ui.py`):** A Streamlit web dashboard for configuration, job queuing, and real-time monitoring.

---

## <a name="prerequisites"></a> 2. Prerequisites (Critical Setup)

You must perform the following steps for **EACH** Google Workspace domain you wish to use as a destination.

### A. Google Cloud Platform (GCP) Setup
1.  **Create a Project:**
    * Go to the [Google Cloud Console](https://console.cloud.google.com).
    * Create a new project (e.g., `isync-migration`).
2.  **Enable APIs:**
    * Navigate to **APIs & Services > Library**.
    * Search for and enable the following two APIs:
        * **Admin SDK API**
        * **IAM API**

        **Optional**
        * **Cloud Identity API**, 
        * **Cloud Resource Manager API**
        * **Service Management API**
        * **Drive API**
        * **Sheets API**

3.  **Create the Master Service Account (SA):**
    * Navigate to **IAM & Admin > Service Accounts**.
    * Click **+ CREATE SERVICE ACCOUNT**.
    * Name it (e.g., `isync-master`).
    * **Roles:** You can assign "Project > Owner" for simplicity, or "Service Account Token Creator" + "Service Account User".
4.  **Generate the Key:**
    * Click on your new Service Account in the list.
    * Go to the **Keys** tab > **Add Key** > **Create new key**.
    * Select **JSON**.
    * **Save this file securely.** You will need the path to this file later.
5.  **Enable Domain-Wide Delegation (DWD):**
    * While still in the Service Account details, go to the **Details** tab (or "Advanced Settings" depending on the UI version).
    * Look for "Domain-wide Delegation".
    * Click **Manage Domain-wide Delegation** (or simply check the box if visible).
    * **Copy the "Client ID"** (a long string of numbers). You need this for the next section.

### B. Google Workspace Admin Console Setup

1.  Log in to [admin.google.com](https://admin.google.com) as a Super Admin.
2.  Navigate to **Security > Access and data control > API controls**.
3.  Scroll down to **Domain-wide Delegation** and click **Manage Domain Wide Delegation**.
4.  Click **Add new**:
    * **Client ID:** Paste the numeric Client ID from the previous step.
    * **OAuth Scopes:** Copy and paste the following block exactly:
      ```text
      [https://www.googleapis.com/auth/admin.directory.user](https://www.googleapis.com/auth/admin.directory.user),
      [https://www.googleapis.com/auth/admin.directory.group](https://www.googleapis.com/auth/admin.directory.group),
      [https://www.googleapis.com/auth/drive](https://www.googleapis.com/auth/drive)
      ```
    * Click **Authorize**.

### C. Permissions Group
ISync does not add users directly to the Shared Drive (which is slow and messy). Instead, it adds them to a **Group**, and that Group has access to the Drive.

1.  Go to **Directory > Groups**.
2.  Create a new group (e.g., `uploaders@yourdomain.com`).
3.  **Important:** Ensure the group Security settings allow "Members" (specifically Service Accounts) to be added.
4.  Go to your destination **Shared Drive** (in Google Drive).
5.  Add `uploaders@yourdomain.com` as a **Manager** of that Shared Drive.

---

## <a name="installation"></a> 3. Installation

### System Requirements
* **OS:** Linux (Ubuntu/Debian recommended), macOS, or Windows.
* **Rclone:** Must be installed and accessible in your system PATH.
    * *Verify by typing `rclone version` in your terminal.*
* **Python:** Version 3.10 or higher.

### Automatic Setup

**Option A: Local Installation (Windows/Mac/Linux)**
Use this if you plan to run the app on your own computer (Mode 1).

```bash
# 1. Download the code
# 2. Run the installer
./install.sh   # Linux/Mac
install.bat    # Windows
```

**Option B: Remote Server Installation (Ubuntu/Debian)**
Use this if you plan to run the app on a headless server (Mode 2 or 3).

```bash
# 1. Copy files to the server (e.g., via git or scp)
scp -r isync_folder user@your-server:~/isync

# 2. SSH into the server
ssh user@your-server
cd isync

# 3. Set permissions and install
chmod +x install.sh run_isync.sh
./install.sh

---

## <a name="usage"></a> 4. Operating Modes & Usage

ISync supports three flexible operating modes. Choose the one that fits your network.

### Mode 1: Fully Local
*   **Scenario:** You run the app and rclone on your local machine.
*   **Launch:** Double-click `run_isync.bat` (Windows) or `./run_isync.sh` (Linux/Mac).
*   **Access:** Open browser to `http://localhost:8501`.
*   **UI Check:** Sidebar Host should match your local computer name.

### Mode 2: Remote Server (Tailscale / VPN)
*   **Scenario:** App runs on a remote server connected via Tailscale.
*   **Launch (Server):** SSH into server and run `./run_isync.sh`.
*   **Access (Local):** Open browser to `http://<tailscale-ip>:8501`.
*   **UI Check:** Sidebar Host should match the Server's hostname.

### Mode 3: Remote Server (SSH Tunnel)
*   **Scenario:** App runs on a remote server NOT on Tailscale (public internet or private VPC).
*   **Launch (Server):** SSH into server and run `./run_isync.sh`.
*   **Connect (Local):** Run the `connect_tunnel.bat` script on your Windows machine.
    *   Enter your server address (e.g., `user@1.2.3.4`).
    *   Keep the window open.
*   **Access (Local):** Open browser to `http://localhost:8501`.
*   **UI Check:** Sidebar Host should match the Server's hostname.

---

## <a name="first-run"></a> 5. First Run & Configuration Walkthrough

Once you have launched the app (see Section 4), follow these steps to configure your first job.

### Step 1: Global Settings (Tab 1)
Navigate to the ⚙️ **Configuration** tab. You will see a health check at the top. If it's your first run, it will likely show errors. Expand the "Edit Configuration" form.

1.  **Upload Limit:** Set this to `700G` (Google's daily limit is 750GB). ISync will rotate users when this is hit.
2.  **Rclone Transfers:** Default is 8. Higher values use more bandwidth/CPU.
3.  **Max Users/Cycle:** How many temporary users to create in a single run (e.g., 10).
4.  **Rclone Command:** Usually `copy`. Use `sync` only if you want the destination to exactly match the source (deletes files at dest!).
5.  **Stall Timeout:** If Rclone stops outputting stats for this many minutes, the process is killed and restarted.

### Step 2: Domain Configuration
This is the most critical part. You need the files from the Prerequisites section.

*   **Domain Name:** Your Google Workspace domain (e.g., `example.com`).
*   **Admin Email:** The Super Admin email you are impersonating (e.g., `admin@example.com`).
*   **Local JSON Path:** The absolute path to the Service Account JSON key on the machine running the UI.
    *   Windows Example: `C:\Users\Admin\keys\isync-sa.json`
    *   Linux Example: `/home/user/keys/isync-sa.json`
*   **Group Email:** The Google Group created in Prerequisites (e.g., `uploaders@example.com`).
*   **Remote JSON Path:** (Only for Mode 2/3) The path to the JSON key on the remote server.

Click 💾 **Save Settings**. The page will reload, and the "Configuration Health" check should turn green.

### Step 3: Verify Connectivity
Click the "Test Config & Connectivity" button at the bottom of Tab 1.
*   **Success:** You see "✅ Domain: API OK".
*   **Failure:** Check your JSON path, Admin Email, and ensure Domain-Wide Delegation scopes are correct in the Google Admin Console.

### Step 4: Add a Job (Tab 2)
Go to the 📂 **Sync Jobs** tab.

1.  **Source:** Local path (`C:\Data`) or Rclone remote (`myremote:bucket`).
2.  **Destination:** Usually a Shared Drive path (e.g., `drive:SharedDriveName/TargetFolder`).
3.  **Target Domain:** Select the domain configured in Step 2.
4.  Click **Add Job**.

### Step 5: Launch
Select the job in the Queue list and click 🚀 **Launch ISync**. Switch to the 📺 **Live Console** tab to watch the progress.

---

## <a name="background-persistence"></a> 6. Background Persistence (Tmux)

On Linux/Mac, `run_isync.sh` automatically attempts to use `tmux`. This ensures the sync job continues running even if you close your SSH terminal.

*   **Attach:** `./run_isync.sh` (will attach to existing session if found).
*   **Detach:** Press `Ctrl+B`, then `D`.

---

## <a name="troubleshooting"></a> 7. Troubleshooting

*   **Stalls:** If Rclone output stops for 10 minutes (configurable), ISync will kill the process and restart the loop.
*   **Auth Errors:** Use the "Check Auth Connection" button in Manual Ops to verify your Service Account and Admin Email.
*   **Logs:** Check the "Live Console" tab or view `isync.log` directly.