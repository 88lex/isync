# Database Refactoring & Optimization Plan

## 1. Audit Analysis

### A. Current Data Fragmentation
Currently, ISync's data is split across multiple storage mechanisms, leading to redundancy and difficulty in maintaining relationships:

| Data Type | Primary Storage | Redundant/Secondary Storage | Issue |
|-----------|-----------------|-----------------------------|-------|
| **Sync Pairs** | `synclist.yaml` | `SyncPair` (SQL Table - Unused) | Logic split; Database relational features (Foreign Keys) cannot be used. |
| **SSH Servers** | `config.yaml` (`ssh_servers` list) | Cache RAM | No database entity; cannot easily link Sync Pairs or Jobs to Servers. |
| **Domains** | `config.yaml` (`domains` list) | `DomainStats` (SQL Table) | Domain existence is defined in YAML, but stats are in SQL. |
| **Batch Groups** | `.batch_groups.json` | None | File-based; prone to corruption; inconsistent with other entity storage. |
| **Crontab** | `.crontab_configs.json` | None | File-based; isolated from Server entities. |
| **Workspace Data** | `SharedDrive`, `WorkspaceUser` (SQL) | RAM Cache | Good (already in SQL), but needs better linking to Rclone config. |
| **App Config** | `config.yaml` | `AppConfig` (SQL Table - Unused) | Split sources of truth. |

### B. Missing Logical Links
1.  **Sync Pairs ↔ Servers**: Currently, Sync Pairs store `server_id` as a string. If an SSH server is deleted from YAML, the Sync Pair becomes invalid with no database constraint to prevent it.
2.  **Jobs ↔ Sync Pairs**: Job history records source/dest paths but loosely links to the original Sync Pair.
3.  **Batch Groups ↔ Files**: Batch groups store lists of filenames strings.

## 2. Refactoring Plan

### Phase 1: Database Schema Consolidation
We will transition "Entity" data to the SQLite database to establish a Single Source of Truth for core objects.

1.  **Activate & Update `SyncPair` Table**:
    *   Migrate data from `synclist.yaml` to SQLite `sync_pairs` table.
    *   Add Foreign Keys to `ssh_servers` (new table).
    *   *User Impact*: Sync Pairs will effectively be managed by the DB. We will keep an "Export to YAML" feature for backup/manual editing if desired, but runtime reads come from DB.

2.  **Create `SSHServer` Table**:
    *   Migrate `ssh_servers` list from `config.yaml` to a new `ssh_servers` table.
    *   Fields: `id` (PK), `name`, `alias`, `host`, `port`, `user`, `key_path`, `remote_path`, `is_default`.

3.  **Create `BatchGroup` & `CrontabEntry` Tables**:
    *   Replace JSON file storage with proper SQL tables.
    *   Allows complex querying (e.g., "Show all cron jobs for Server X").

4.  **Refine `AppConfig`**:
    *   Use `config.yaml` **only** for bootstrap settings (DB path, environment defaults) and read-only preferences.
    *   Dynamic settings (UI toggles, last sorted column, etc.) should move to `AppConfig` table or separate `UserSettings` table.

### Phase 2: Relational Integrity
Establish relationships between the new tables:
*   `SyncPair` → `SSHServer` (Source/Dest Server IDs).
*   `CrontabEntry` → `SSHServer` (Server ID).
*   `JobRun` → `SyncPair` (Link execution history to the configuration).

### Phase 4: Unified Schedule Architecture
Unify local APScheduler jobs and remote Crontab entries into a single management flow.

1.  **Unified `Schedule` Table**:
    *   Fields: `id`, `name`, `cron_expression`, `command`, `execution_context` (LOCAL/SSH:id), `target_server_id`, `enabled`, `last_run`, `next_run`.
    *   Replaces isolated `scheduler.py` JSON storage and `.crontab_configs.json`.

2.  **Logic Update**:
    *   **Local Jobs**: The backend reads `Schedule` rows where `execution_context=LOCAL` and loads them into APScheduler.
    *   **Remote Crons**: The backend reads `Schedule` rows where `execution_context=SSH:id`, generates the crontab file, and syncs it to the remote server.

## Summary of Changes

| Scope | Change Description |
|-------|--------------------|
| **Backend** | Create `SSHServer`, `BatchGroup`, `CrontabEntry` (to be merged into `Schedule`) models in `models.py`. |
| **Backend** | Create migration script to move data from YAML/JSON to SQLite. |
| **Backend** | Update `routers` (config, ssh, batch) to read/write to DB instead of files. |
| **Backend** | Implement `DatabaseMaintenanceService` for health checks and cleaning. |
| **Backend** | Implement `ScheduleService` to unify local/remote job logic. |
| **Frontend** | Build `DatabaseHealth` and Unified `Schedules` components. |

## Next Steps
Upon approval:
1.  I will define the new SQLAlchemy models.
2.  I will create a migration utility to populate the DB from current files.
3.  I will switch the API routers to use the database repositories.
4.  I will implement the maintenance UI.
