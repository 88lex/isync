# Database Refactoring & Optimization Plan

## Status: ALL PHASES COMPLETE ✅

### Summary of Changes

| Entity | Before | After | Status |
|--------|--------|-------|--------|
| **SSH Servers** | `config.yaml` | `ssh_servers` DB table | ✅ Complete (5 records) |
| **Sync Pairs** | `synclist.yaml` | `sync_pairs` DB table | ✅ Complete (18 records) |
| **Batch Groups** | `.batch_groups.json` | `batch_groups` DB table | ✅ Complete |
| **Schedules** | JSON + APScheduler | `schedules` DB table | ✅ Complete (2 records) |
| **Maintenance** | N/A | API + Frontend UI | ✅ Complete |

---

## Database Statistics (Current)

```json
{
    "database_file": "isync.db",
    "tables": {
        "ssh_servers": 5,
        "sync_pairs": 18,
        "batch_groups": 0,
        "schedules": 2,
        "data_cache": 11,
        "node_stats": 24,
        "domain_stats": 4
    }
}
```

---

## Completed Phases

### Phase 1: Database Schema Consolidation ✅

1. **New SQLAlchemy Models** (`backend/models/models.py`):
   - `SSHServer` - SSH server configurations
   - `BatchGroup` - Batch file groupings
   - `Schedule` - Unified local/remote schedules with execution context
   - `SyncPair` - Enhanced with execution metadata

2. **Migration Utility** (`backend/migrate_to_db.py`):
   - Migrates SSH servers from `config.yaml`
   - Migrates batch groups from `.batch_groups.json`
   - Migrates sync pairs from `synclist.yaml`
   - Migrates schedules from JSON files

3. **Repository Pattern** (`backend/repositories/`):
   - `BatchGroupRepository` - CRUD for batch groups
   - `SyncPairRepository` - CRUD for sync pairs
   - `ScheduleRepository` - CRUD for schedules + crontab generation

4. **Updated Routers**:
   - `backend/routers/ssh.py` - Database CRUD for SSH servers
   - `backend/routers/batch_groups.py` - Database CRUD for batch groups
   - `backend/routers/config.py` - Database CRUD for sync pairs
   - `backend/routers/schedules.py` - Unified schedule management

### Phase 2: Relational Integrity ✅

1. **Foreign Key Relationships**:
   - `Schedule.target_server_id` → `SSHServer.id`
   - `SyncPair.meta_server_id` → `SSHServer.id` (logical reference)

2. **Reference Validation**:
   - Maintenance service validates orphaned references
   - API validates server existence before creating SSH schedules

### Phase 3: Database Maintenance Feature ✅

1. **Maintenance Service** (`backend/maintenance_service.py`):
   - Integrity check (PRAGMA integrity_check)
   - Vacuum (reclaim space)
   - Log cleanup (remove old job history)
   - Cache cleanup (stale entries)
   - Reference validation

2. **API Endpoints** (`/api/admin/maintenance/*`):
   - stats, check, vacuum, clean-logs, clean-cache, validate, full

3. **Frontend UI** (`frontend/src/pages/Config.tsx`):
   - "Database" tab with statistics and action buttons

### Phase 4: Unified Schedule Architecture ✅

1. **Unified Schedule Table**:
   - `execution_context`: "LOCAL" or "SSH"
   - `target_server_id`: SSH server for remote schedules
   - `command_type`: sync, batch, task
   - `command`: JSON blob with task-specific parameters

2. **Schedule Router Features**:
   - List schedules with filtering by context/server
   - Create LOCAL (APScheduler) and SSH (crontab) schedules
   - Pause/resume/delete schedules
   - Generate crontab content for SSH servers
   - Push crontab to remote servers

3. **Crontab Generation**:
   - `GET /api/schedules/crontab/{server_id}` - Generate crontab content
   - `POST /api/schedules/crontab/push` - Push to remote server

---

## Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/models/models.py` | Modified | Added new models |
| `backend/migrate_to_db.py` | Created | Migration utility |
| `backend/maintenance_service.py` | Created | Maintenance operations |
| `backend/routers/admin.py` | Modified | Maintenance endpoints |
| `backend/routers/ssh.py` | Modified | Database CRUD |
| `backend/routers/batch_groups.py` | Modified | Database CRUD |
| `backend/routers/config.py` | Modified | Database CRUD for sync pairs |
| `backend/routers/schedules.py` | Modified | Unified schedule management |
| `backend/repositories/__init__.py` | Created | Repositories package |
| `backend/repositories/batch_groups.py` | Created | BatchGroup repository |
| `backend/repositories/sync_pairs.py` | Created | SyncPair repository |
| `backend/repositories/schedules.py` | Created | Schedule repository |
| `frontend/src/pages/Config.tsx` | Modified | Database maintenance tab |

---

## API Endpoints Summary

### SSH Servers (`/api/ssh/servers`)
- `GET /api/ssh/servers` - List all servers
- `POST /api/ssh/servers` - Create server
- `PUT /api/ssh/servers/{id}` - Update server
- `DELETE /api/ssh/servers/{id}` - Delete server

### Sync Pairs (`/api/synclist`, `/api/sync-pairs`)
- `GET /api/synclist` - List all sync pairs
- `POST /api/synclist` - Bulk update sync pairs
- `POST /api/sync-pairs` - Create sync pair
- `PUT /api/sync-pairs/{id}` - Update sync pair
- `DELETE /api/sync-pairs/{id}` - Delete sync pair

### Batch Groups (`/api/batch-groups`)
- `GET /api/batch-groups` - List all groups
- `POST /api/batch-groups` - Create group
- `PUT /api/batch-groups/{id}` - Update group
- `DELETE /api/batch-groups/{id}` - Delete group

### Schedules (`/api/schedules`)
- `GET /api/schedules` - List schedules (filter by context/server)
- `POST /api/schedules` - Create schedule (LOCAL or SSH)
- `GET /api/schedules/{id}` - Get schedule
- `PUT /api/schedules/{id}` - Update schedule
- `DELETE /api/schedules/{id}` - Delete schedule
- `POST /api/schedules/{id}/pause` - Pause schedule
- `POST /api/schedules/{id}/resume` - Resume schedule
- `GET /api/schedules/crontab/{server_id}` - Generate crontab
- `POST /api/schedules/crontab/push` - Push crontab to server
- `GET /api/schedules/stats` - Schedule statistics

### Maintenance (`/api/admin/maintenance`)
- `GET /api/admin/maintenance/stats` - Database statistics
- `POST /api/admin/maintenance/check` - Integrity check
- `POST /api/admin/maintenance/vacuum` - Vacuum database
- `POST /api/admin/maintenance/clean-logs` - Clean old logs
- `POST /api/admin/maintenance/clean-cache` - Clean stale cache
- `POST /api/admin/maintenance/validate` - Validate references
- `POST /api/admin/maintenance/full` - Full maintenance cycle

---

## Commands

### Run Migration
```bash
cd /opt/isync
source venv/bin/activate
python -m backend.migrate_to_db
```

### Test Endpoints
```bash
# Get all schedules
curl http://localhost:8000/api/schedules

# Create local schedule
curl -X POST http://localhost:8000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"name": "Daily Sync", "cron_expression": "0 2 * * *", "command_type": "sync", "command": {"source": "/data", "dest": "remote:backup"}, "execution_context": "LOCAL"}'

# Create SSH schedule
curl -X POST http://localhost:8000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"name": "Remote Backup", "cron_expression": "0 3 * * *", "command_type": "batch", "command": {"command_name": "backup.sh"}, "execution_context": "SSH", "target_server_id": "server-id"}'

# Generate crontab for server
curl http://localhost:8000/api/schedules/crontab/{server_id}

# Run full maintenance
curl -X POST http://localhost:8000/api/admin/maintenance/full
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    ISync SQLite Database                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐     │
│  │ ssh_servers │◄───┤  schedules  │    │  batch_groups   │     │
│  │ (5 records) │    │ (2 records) │    │    (0 records)  │     │
│  └──────┬──────┘    └─────────────┘    └─────────────────┘     │
│         │                                                       │
│         │                                                       │
│  ┌──────▼──────┐    ┌─────────────┐    ┌─────────────────┐     │
│  │ sync_pairs  │    │  data_cache │    │  domain_stats   │     │
│  │(18 records) │    │(11 records) │    │   (4 records)   │     │
│  └─────────────┘    └─────────────┘    └─────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Unified Schedule Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌─────────────────┐    ┌────────────────┐ │
│  │   Frontend   │───►│  /api/schedules │───►│ ScheduleRepo   │ │
│  │  Schedules   │    │    Router       │    │ (Database)     │ │
│  │    Page      │    └────────┬────────┘    └───────┬────────┘ │
│  └──────────────┘             │                     │          │
│                               ▼                     ▼          │
│                    ┌──────────────────────────────────────┐    │
│                    │         Execution Context            │    │
│                    ├──────────────────┬───────────────────┤    │
│                    │      LOCAL       │        SSH        │    │
│                    │   (APScheduler)  │    (Crontab)      │    │
│                    └──────────────────┴───────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Completed: 2026-01-21

All phases of the database refactoring plan have been successfully completed. The ISync application now uses a unified SQLite database as the single source of truth for:
- SSH server configurations
- Sync pair definitions
- Batch group metadata
- Scheduled jobs (both local and remote)

The repository pattern provides clean separation between the API layer and database operations, making the codebase more maintainable and testable.
