# ISync (Impersonate Sync)



**ISync** is an advanced Python automation tool designed for high-volume data migrations to Google Workspace Shared Drives. It bypasses the standard 750GB daily upload limit per user by automating the lifecycle of temporary user accounts.

It utilizes **Service Account Impersonation**, meaning you do **not** need to manage thousands of JSON key files. One Master Service Account can generate, control, and delete temporary users on the fly.

---

## 📋 Table of Contents
1.  [Architecture](#architecture)
2.  [Prerequisites (Critical Setup)](#prerequisites)
3.  [Installation (Local & Remote)](#installation)
4.  [Operating Modes & Usage](#usage)
5.  [First Run & Configuration Walkthrough](#first-run)
6.  [Background Persistence (Tmux)](#background-persistence)
7.  [Troubleshooting](#troubleshooting)

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