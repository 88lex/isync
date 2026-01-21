# ISync Dashboard & Frontend-to-Database Architecture Review

**Review Date:** 2026-01-21  
**Reviewer:** Code Review (Claude)  
**Scope:** Dashboard, IsyncDataContext, Backend Cache, Repositories, Database Models

---

## Executive Summary

The codebase demonstrates a **working migration from file-based to database-backed storage**, but there are several architectural issues, performance concerns, and safety gaps that should be addressed. The code works but has technical debt that could cause maintenance challenges and subtle bugs.

**Overall Assessment:** 🟡 **Functional but needs refinement**

---

## 🔧 IMPLEMENTATION STATUS (Updated: 2026-01-21)

| Issue | Status | Details |
|-------|--------|---------|
| **CRITICAL-1**: getCached stability | ✅ **FIXED** | Added `useRef` for stable reference, moved `SINGLETON_TYPES` to module level |
| **CRITICAL-2**: Missing SSHServerRepository | ✅ **FIXED** | Created `backend/repositories/ssh_servers.py` |
| **CRITICAL-3**: Blocking I/O in async | ✅ **FIXED** | Wrapped `exec_remote_command` in `run_in_executor` |
| **HIGH-1**: Duplicate router import | ✅ **FIXED** | Removed duplicate `workspace_router` from main.py |
| **HIGH-3**: ID type inconsistency | ✅ **FIXED** | Simplified repository and dashboard.py lookup logic |
| **MED-2**: Missing database indices | ✅ **FIXED** | Added composite indices to SyncPair and DataCache |
| **LOW-2**: Hardcoded singleton lists | ✅ **FIXED** | Extracted to `SINGLETON_TYPES` and `KEYED_TYPES` constants |
| HIGH-2: store.py session management | ⏳ Pending | Requires larger refactor |
| MED-3: Cache invalidation | ⏳ Pending | Requires WebSocket or event system |

---

## 1. Architecture Analysis

### 1.1 Data Flow Overview

```
Frontend Components
       │
       ▼
IsyncDataContext (React Context)
       │
       ├─► Local State (useState)
       │
       └─► Backend Cache API (/api/cache)
                   │
                   ▼
             DataCache Table ─┐
                              │
    ┌─────────────────────────┘
    │   Auto-Populate on Miss
    ▼
Repositories (SyncPairRepository, etc.)
    │
    ▼
SQLAlchemy Models (SyncPair, SSHServer, etc.)
    │
    ▼
SQLite Database (isync.db)
```

### 1.2 Identified Architecture Layers

| Layer | Component | Status |
|-------|-----------|--------|
| Frontend State | `IsyncDataContext` | ⚠️ Complex, some redundancy |
| Frontend API | `api.ts` | ✅ Clean, well-typed |
| Backend Cache | `cache.py` router | ⚠️ Auto-populate has issues |
| Backend Config | `store.py` | ⚠️ Hybrid legacy/DB |
| Data Access | Repositories | ✅ Good pattern |
| ORM | SQLAlchemy Models | ⚠️ Missing indices, constraints |
| Database | SQLite | ✅ Appropriate for use case |

---

## 2. Critical Issues

### 🔴 CRITICAL-1: getCached Function Instability Causes Infinite Loops

**File:** `frontend/src/contexts/IsyncDataContext.tsx`  
**Lines:** 140-151

```typescript
const getCached = useCallback(<T,>(dataType: DataType, contextKey: string = 'local'): CacheEntry<T> | null => {
    const typeData = (cache as any)[dataType];
    // ...
}, [cache]);  // ❌ PROBLEM: Depends on 'cache' which changes frequently
```

**Problem:** The `getCached` function recreates on every cache state change. When used as a dependency in `useEffect` or other `useCallback` hooks, this causes unnecessary re-renders and potential infinite loops (as seen in Dashboard).

**Fix:**
```typescript
// Option 1: Use useRef for stable access
const cacheRef = useRef(cache);
cacheRef.current = cache;

const getCached = useCallback(<T,>(dataType: DataType, contextKey: string = 'local'): CacheEntry<T> | null => {
    const typeData = (cacheRef.current as any)[dataType];
    // ...
}, []); // Empty deps = stable reference

// Option 2: Remove getCached, access cache directly
// Components can just use: cache.sync_pairs.data
```

---

### 🔴 CRITICAL-2: Data Type Collision in Shared Cache

**File:** `frontend/src/contexts/IsyncDataContext.tsx`

**Problem:** `Dashboard.tsx` and `BatchGenerator.tsx` both use `sync_pairs` cache key but expect different data shapes:
- Dashboard expects: `SyncPair[]`
- BatchGenerator expects: `SyncPairWithBatch[]` (includes `.batch` property)

When one component writes to the cache, it can break the other.

**Current Workaround:** BatchGenerator now uses local state (`unifiedPairs`), isolating it from cache conflicts. This is a band-aid, not a proper solution.

**Proper Fix:**
```typescript
// Option 1: Separate cache keys
type DataType = 
    | 'sync_pairs'        // For Dashboard (simple)
    | 'sync_pairs_full'   // For BatchGenerator (with batch info)
    // ...

// Option 2: Normalize cache, fetch batch info separately
// Dashboard: GET /api/synclist
// BatchGenerator: GET /api/sync-pairs/with-batches (don't cache, or use different key)
```

---

### 🔴 CRITICAL-3: Blocking I/O in Async Context

**File:** `backend/storage_service.py`  
**Lines:** 46, 96-97

```python
async def get_path_size(...):
    # ...
    result = exec_remote_command(req, cmd)  # ❌ BLOCKING!
```

The `exec_remote_command` function uses `subprocess.run` (blocking) inside an `async def` function. This blocks the FastAPI event loop for up to 20 minutes during scans.

**Impact:** Server becomes unresponsive during long scans if called from async endpoints.

**Fix:**
```python
# Option 1: Run in thread executor
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)

async def get_path_size(...):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        executor, 
        lambda: exec_remote_command(req, cmd)
    )
```

---

### 🟠 HIGH-1: Missing SSH Server Repository

**Problem:** `cache.py` imports `SSHServerRepository` which doesn't exist as a separate file:

```python
# cache.py:89
from backend.repositories.ssh_servers import SSHServerRepository  # ❌ File doesn't exist!
```

**Current State:** SSH servers are managed directly in `routers/ssh.py` with inline DB operations, not via a repository pattern.

**Fix:** Either:
1. Create `backend/repositories/ssh_servers.py` with SSHServerRepository class
2. Or update `cache.py` to use inline queries like `ssh.py` does

---

### 🟠 HIGH-2: store.py is a Hybrid Singleton with DB Access

**File:** `backend/store.py`

The `ConfigStore` singleton creates its own database sessions:

```python
def get_config(self) -> Dict[str, Any]:
    from backend.database import SessionLocal
    db = SessionLocal()  # ❌ Creates new session each call
    try:
        rows = db.query(AppConfig).all()
        # ...
    finally:
        db.close()
```

**Problems:**
1. Creates sessions outside FastAPI's dependency injection
2. No connection pooling awareness
3. Thread safety concerns with singleton + sessions
4. Can cause "database is locked" errors in SQLite under load

**Fix:** Refactor to accept session dependency:
```python
# Option 1: Pass session from caller
def get_config(self, db: Session) -> Dict[str, Any]:
    rows = db.query(AppConfig).all()
    # ...

# Option 2: Use async context or request-scoped pattern
```

---

### 🟠 HIGH-3: Repository ID Type Inconsistency

**File:** `backend/repositories/sync_pairs.py`

```python
def get_by_id(self, pair_id: str) -> Optional[dict]:
    # Convoluted logic to handle string vs int
    pair = self.db.query(SyncPairModel).filter(
        SyncPairModel.id == int(pair_id) if pair_id.isdigit() else -1
    ).first()
    if not pair:
        pairs = self.db.query(SyncPairModel).all()
        for p in pairs:  # ❌ O(n) scan!
            if str(p.id) == pair_id:
                pair = p
                break
```

**Problems:**
1. Inefficient O(n) fallback scan
2. Type confusion between string and int IDs
3. Same issue in `dashboard.py` (lines 151-166)

**Fix:** Standardize on integer IDs throughout:
```python
def get_by_id(self, pair_id: int) -> Optional[dict]:
    pair = self.db.query(SyncPairModel).filter(SyncPairModel.id == pair_id).first()
    return self._to_dict(pair) if pair else None
```

---

## 3. Medium Priority Issues

### 🟡 MED-1: Excessive Type Casting with `(cache as any)`

**File:** `frontend/src/contexts/IsyncDataContext.tsx`

The code uses `(cache as any)[dataType]` repeatedly, losing TypeScript safety:

```typescript
const singletonTypes = ['ssh_servers', 'keys', ...];
if (singletonTypes.includes(dataType)) {
    (newCache as any)[dataType] = { data, ... };  // ❌ Type bypass
}
```

**Fix:** Use proper TypeScript discriminated unions:
```typescript
type SingletonDataType = 'ssh_servers' | 'keys' | 'sync_pairs' | ...;
type KeyedDataType = 'users' | 'rclone_remotes' | ...;

function isSingleton(dataType: DataType): dataType is SingletonDataType {
    return ['ssh_servers', 'keys', ...].includes(dataType);
}
```

---

### 🟡 MED-2: No Index on Frequently Queried Columns

**File:** `backend/models/models.py`

Several columns that are frequently queried lack indices:

```python
class SyncPair(Base):
    # These are queried often but not indexed:
    source = Column(String(500), nullable=False)  # find_by_source_dest
    dest = Column(String(500), nullable=False)    # find_by_source_dest
    domain_reference = Column(String(100), ...)   # filtered in UI

class DataCache(Base):
    # Composite query: WHERE data_type = ? AND context_key = ?
    data_type = Column(String(50), index=True)    # ✅ indexed
    context_key = Column(String(100), index=True) # ✅ indexed
    # But no composite index
```

**Fix:**
```python
from sqlalchemy import Index

class SyncPair(Base):
    __table_args__ = (
        Index('ix_sync_pair_source_dest', 'source', 'dest'),
        Index('ix_sync_pair_domain', 'domain_reference'),
    )
```

---

### 🟡 MED-3: Cache Invalidation is Inconsistent

**Problem:** When data changes via direct API calls (e.g., creating a SyncPair), the frontend cache isn't automatically invalidated.

**Current Flow:**
1. User creates SyncPair via API
2. Backend writes to DB
3. Frontend cache still has stale data
4. User must manually click "Refresh" to see new data

**Fix:** Implement cache invalidation in backend mutations:
```python
@router.post("/sync-pairs")
def create_sync_pair(pair: SyncPairCreate, db: Session = Depends(get_db)):
    # ... create pair ...
    
    # Invalidate cache
    cache_id = "sync_pairs_local"
    db.query(DataCache).filter(DataCache.id == cache_id).delete()
    db.commit()
    
    return {"status": "ok", "pair": new_pair}
```

Or use WebSocket to push cache invalidation events.

---

### 🟡 MED-4: Dashboard `handleScanAll` Doesn't Wait for Completion

**File:** `frontend/src/pages/Dashboard.tsx`

```typescript
const handleScanAll = async () => {
    for (const pair of synclist) {
        if (pair.scan_source_server_id) runScanSilent(pair, "source", ...);
        if (pair.scan_dest_server_id) runScanSilent(pair, "dest", ...);
    }
    alert("Bulk scan initiated in background.");  // Fires immediately
};
```

**Problems:**
1. Fire-and-forget behavior - user has no feedback on completion
2. All scans run in parallel, potentially overwhelming the server
3. No error aggregation

**Fix:**
```typescript
const handleScanAll = async () => {
    setBulkScanProgress({ total: count, completed: 0, failed: 0 });
    
    for (const pair of synclist) {
        try {
            if (pair.scan_source_server_id) {
                await runScanSilent(pair, "source", ...);
            }
            setBulkScanProgress(p => ({ ...p, completed: p.completed + 1 }));
        } catch {
            setBulkScanProgress(p => ({ ...p, failed: p.failed + 1 }));
        }
    }
    
    showBulkResultModal();
};
```

---

### 🟡 MED-5: Legacy State in IsyncDataContext

**File:** `frontend/src/contexts/IsyncDataContext.tsx`

```typescript
// Legacy state for backwards compatibility
const [driveManager, setDriveManager] = useState({ drives: [], localRemotes: [], lastUpdated: 0 });
const [rcloneManager, setRcloneManager] = useState({...});
```

This legacy state appears unused or partially used. It should be:
1. Migrated to the new cache system
2. Or removed if truly deprecated

---

## 4. Low Priority / Technical Debt

### 🔵 LOW-1: Duplicate Router Import

**File:** `backend/main.py`

```python
app.include_router(workspace_router)
app.include_router(workspace_router)  # ❌ Duplicate!
```

---

### 🔵 LOW-2: Hardcoded Singleton Type Lists

The list `['ssh_servers', 'keys', 'sync_pairs', ...]` is repeated 5+ times in `IsyncDataContext.tsx`. Should be a constant:

```typescript
const SINGLETON_CACHE_TYPES: DataType[] = [
    'ssh_servers', 'keys', 'sync_pairs', 'batch_files', 
    'batch_groups', 'schedules', 'storage_overview'
];
```

---

### 🔵 LOW-3: Console Logging in Production Code

Multiple files use `console.error`, `console.warn`. Consider using a proper logging system or environment-gated logging.

---

### 🔵 LOW-4: Missing Error Boundaries

The Dashboard and BatchGenerator don't have error boundaries. A single failing API call can crash the entire page.

---

## 5. Recommended Improvements Plan

### Phase 1: Critical Fixes (Immediate)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 1 | Stabilize `getCached` with useRef | 🔴 Critical | 1 hour |
| 2 | Create SSHServerRepository or fix cache.py import | 🔴 Critical | 2 hours |
| 3 | Wrap blocking subprocess in run_in_executor | 🔴 Critical | 3 hours |

### Phase 2: High Priority Fixes (This Week)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 4 | Standardize ID types (always int) | 🟠 High | 4 hours |
| 5 | Refactor store.py session management | 🟠 High | 4 hours |
| 6 | Separate cache keys for different data shapes | 🟠 High | 3 hours |

### Phase 3: Medium Priority (Next Sprint)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 7 | Add composite database indices | 🟡 Medium | 2 hours |
| 8 | Implement cache invalidation on writes | 🟡 Medium | 6 hours |
| 9 | Add bulk scan progress UI | 🟡 Medium | 4 hours |
| 10 | Remove legacy driveManager/rcloneManager | 🟡 Medium | 2 hours |

### Phase 4: Polish (Backlog)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 11 | Type-safe cache access (remove `as any`) | 🔵 Low | 4 hours |
| 12 | Add React Error Boundaries | 🔵 Low | 2 hours |
| 13 | Remove duplicate workspace_router | 🔵 Low | 5 min |
| 14 | Extract singleton type list to constant | 🔵 Low | 30 min |

---

## 6. Security Considerations

### ⚠️ SQL Injection Protected
SQLAlchemy ORM is used consistently, which parameterizes queries. No raw SQL string concatenation was observed. ✅

### ⚠️ Path Injection Risk
```python
# dashboard.py
cmd = f"rclone size '{path}' --json"  # Path comes from DB, relatively safe
cmd = f"find '{path}' -type f | wc -l"  # Same
```
While paths come from the database (not direct user input), shell injection could occur if a malicious path is stored. Consider validating paths or using `shlex.quote()`:
```python
import shlex
cmd = f"rclone size {shlex.quote(path)} --json"
```

### ⚠️ No Input Validation on Cache Keys
```python
# cache.py
cache_id = f"{data_type}_{context_key}"  # User-provided values
```
While unlikely to be exploited, very long or specially crafted keys could cause issues.

---

## 7. Performance Recommendations

1. **Add Connection Pooling:** SQLite connection limits may cause contention. Consider WAL mode:
   ```python
   engine = create_engine(DATABASE_URL, connect_args={
       "check_same_thread": False,
       "timeout": 30
   })
   # Run: PRAGMA journal_mode=WAL
   ```

2. **Batch Database Writes:** Dashboard scan updates could batch commits:
   ```python
   # Instead of commit per scan
   db.bulk_update_mappings(SyncPair, [
       {"id": pair1.id, "source_size_bytes": ...},
       {"id": pair2.id, "source_size_bytes": ...},
   ])
   db.commit()  # Single commit
   ```

3. **Cache TTL:** Add automatic cache expiration:
   ```python
   class DataCache(Base):
       expires_at = Column(DateTime, nullable=True)
   ```

---

## 8. Conclusion

The codebase represents a **reasonable first iteration** of the database migration. The core functionality works, but there are architectural patterns that will cause problems as the application scales or if multiple users access it simultaneously.

**Top 3 Actions:**
1. Fix the `getCached` stability issue to prevent infinite loops
2. Standardize ID handling (int everywhere)
3. Address blocking I/O in async context

The issues identified are typical of rapid development phases. With the recommended improvements, the codebase will be more maintainable, performant, and robust.

---

*End of Review*
