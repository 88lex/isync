# Antigravity MCP Integration Plan: ISync Development

This document outlines the recommended Model Context Protocol (MCP) servers that can be integrated into the Antigravity AI assistant environment to enhance its effectiveness when working on the ISync codebase.

---

## 1. Recommended MCP Servers

### A. Google Workspace & Drive
*   **Description:** Provides direct access to Google Drive metadata, Shared Drive listings, and Service Account permissions.
*   **Benefit to ISync:** Allows Antigravity to verify if the Service Accounts in `keys/` have the correct DWD (Domain-Wide Delegation) scopes and can actually "see" the target Shared Drives, reducing debugging time for API 403 errors.

### B. Rclone Utility Server
*   **Description:** A bridge to the local `rclone` installation.
*   **Benefit to ISync:** Enables Antigravity to run `rclone version`, `rclone config show`, and `rclone check` commands safely to validate that the logic generated in `isync_engine.py` is compatible with the environment's specific Rclone version.

### C. SQLite Inspector
*   **Description:** Provides structured querying capabilities for SQLite databases.
*   **Benefit to ISync:** Allows Antigravity to inspect `isync.db` and `isync_history.db` directly. This is crucial for verifying database migrations, checking job history status, and ensuring that the `backend/repositories/` logic is interacting with the data correctly.

### D. SSH & Remote Execution Bridge
*   **Description:** Allows the AI to interact with configured remote servers via standard input/output.
*   **Benefit to ISync:** Since ISync manages remote clusters, this would let Antigravity check if a remote server is reachable and if the `tmux` sessions initiated by `orchestrator.py` are actually running, without requiring manual status checks from the user.

### E. GitHub API Server
*   **Description:** Integrates with the GitHub repository.
*   **Benefit to ISync:** Allows Antigravity to manage issues, pull requests, and track version history for the `88lex/isync` repository directly from the chat.

---

## 2. Implementation Plan

### Phase 1: Resource Preparation
1.  **API Keys:** Ensure a GitHub Personal Access Token (PAT) is available for repository operations.
2.  **Access:** Locate the absolute path to the `rclone.conf` and all `.db` files within the WSL environment.
3.  **Authentication:** Confirm that the primary Service Account JSON in `/opt/isync/keys/` has the "Cloud Resource Manager" API enabled for permission checking.

### Phase 2: Configuration
MCP servers are added to the Antigravity configuration (usually `mcp_config.json` in the user's roaming AppData or a local `.agent/mcp.json`).

**Example Configuration Block:**
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db", "/opt/isync/isync.db"]
    },
    "gdrive": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gdrive"]
    },
    "rclone": {
      "command": "python3",
      "args": ["-m", "mcp_server_rclone"]
    }
  }
}
```

### Phase 3: Validation
1.  **Connection Test:** Open the Antigravity "Manage MCP Servers" UI and verify all servers show a "Connected" status.
2.  **Smoke Test:** Ask Antigravity: *"List the names of all tables in isync.db"* or *"Check if my master-key.json can list the files in the 'Backup_01' drive."*

---

## 3. Future Option: The "ISync Bridge" MCP
For advanced development, a custom MCP server could be written *within* the ISync project (perhaps using Python's `fastmcp` library). This would expose ISync's internal `job_manager` and `orchestrator` states directly to Antigravity as a tool, allowing the AI to:
*   "Resume" failed sync jobs autonomously.
*   Monitor "Stall" events and suggest optimizations based on live performance metrics.
