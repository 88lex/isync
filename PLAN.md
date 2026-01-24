# ISync Development Plan

**Last Updated:** 2026-01-23  
**Status:** Active Development

---

## 📊 Project Status Overview

### ✅ Recently Completed (2026-01-21 to 2026-01-23)

- **Database Migration**: Successfully migrated from file-based storage (YAML/JSON) to SQLite
- **Repository Pattern**: Implemented clean data access layer for all entities
- **Critical Bug Fixes**: Fixed 10+ critical and high-priority issues
  - getCached stability (infinite loop prevention)
  - Async blocking I/O issues
  - ID type inconsistencies
  - Cache invalidation
  - DriveManager domain refresh
- **Workspace Manager**: Fixed granular scope authorization and data refresh
- **Database Maintenance**: Added comprehensive maintenance API and UI
- **ConfigStore DB Update Logic**: Implemented `add_known_email` method with proper DB persistence (2026-01-23)
- **Schema Alignment**: Verified and aligned DB/State structures with new Workspace Manager features (2026-01-24)

### 🎯 Current Focus

This plan consolidates all outstanding tasks, technical debt, and future enhancements into a single actionable roadmap.

---

## 🔴 Priority 1: Critical & High-Impact Tasks

### 1.1 Bulk Scan Progress UI
**Priority:** High  
**Effort:** 4 hours  
**Status:** Deferred (UX improvement)

**Problem:**
- Dashboard's "Scan All" operation fires and forgets without user feedback
- All scans run in parallel, potentially overwhelming the server
- No error aggregation or completion notification

**Solution:**
```typescript
// Add to Dashboard.tsx
const [bulkScanProgress, setBulkScanProgress] = useState({
  total: 0,
  completed: 0,
  failed: 0,
  inProgress: false
});

const handleScanAll = async () => {
  const pairs = synclist.filter(p => p.scan_source_server_id || p.scan_dest_server_id);
  setBulkScanProgress({ total: pairs.length, completed: 0, failed: 0, inProgress: true });
  
  for (const pair of pairs) {
    try {
      if (pair.scan_source_server_id) await runScanSilent(pair, "source", ...);
      if (pair.scan_dest_server_id) await runScanSilent(pair, "dest", ...);
      setBulkScanProgress(p => ({ ...p, completed: p.completed + 1 }));
    } catch {
      setBulkScanProgress(p => ({ ...p, failed: p.failed + 1 }));
    }
  }
  
  setBulkScanProgress(p => ({ ...p, inProgress: false }));
  showBulkResultModal();
};
```

**Files to Modify:**
- `frontend/src/pages/Dashboard.tsx`

---

### ~~1.2 Complete Database Update Logic in ConfigStore~~ ✅ DONE
**Priority:** High  
**Effort:** 2 hours  
**Status:** ✅ Completed (2026-01-23)

**Location:** `backend/store.py`

**Implementation:**
- Added proper DB persistence for `add_known_email` method
- Follows session management pattern (optional external session, own session fallback)
- Includes error handling, rollback on failure, and logging
- Backward compatible with existing callers in `backend/routers/drives.py`

---

## 🟡 Priority 2: Technical Debt & Code Quality

### 2.1 Remove Legacy State from IsyncDataContext
**Priority:** Medium  
**Effort:** 2 hours  
**Status:** Marked for deprecation

**Location:** `frontend/src/contexts/IsyncDataContext.tsx` (Lines 107, 114)

**Current State:**
```typescript
// TODO: Remove in future release after all consumers migrate.
const [driveManager, setDriveManager] = useState({ drives: [], localRemotes: [], lastUpdated: 0 });
const [rcloneManager, setRcloneManager] = useState({...});
```

**Action Required:**
1. Verify all components have migrated to new cache system
2. Search codebase for any remaining references to `driveManager` or `rcloneManager`
3. Remove deprecated state and related functions
4. Update any documentation

**Files to Check:**
- `frontend/src/contexts/IsyncDataContext.tsx`
- All components that import `IsyncDataContext`

---

### 2.2 Improve TypeScript Type Safety
**Priority:** Medium  
**Effort:** 4 hours  
**Status:** Technical debt

**Problem:**
Excessive use of `(cache as any)` in IsyncDataContext loses TypeScript safety.

**Solution:**
```typescript
// Define discriminated unions
type SingletonDataType = 'ssh_servers' | 'keys' | 'sync_pairs' | 'batch_files' | 'batch_groups' | 'schedules' | 'storage_overview';
type KeyedDataType = 'users' | 'rclone_remotes' | 'workspace_domains';

function isSingleton(dataType: DataType): dataType is SingletonDataType {
  return SINGLETON_TYPES.includes(dataType);
}

function isKeyed(dataType: DataType): dataType is KeyedDataType {
  return KEYED_TYPES.includes(dataType);
}

// Use type guards instead of (cache as any)
if (isSingleton(dataType)) {
  cache[dataType] = { data, lastFetch: Date.now() };
}
```

**Files to Modify:**
- `frontend/src/contexts/IsyncDataContext.tsx`

---

### 2.3 Add React Error Boundaries
**Priority:** Medium  
**Effort:** 2 hours  
**Status:** Missing safety feature

**Problem:**
Dashboard and BatchGenerator don't have error boundaries. A single failing API call can crash the entire page.

**Solution:**
```typescript
// Create ErrorBoundary.tsx
class ErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

// Wrap critical pages
<ErrorBoundary>
  <Dashboard />
</ErrorBoundary>
```

**Files to Create/Modify:**
- `frontend/src/components/ErrorBoundary.tsx` (new)
- `frontend/src/App.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/BatchGenerator.tsx`

---

### 2.4 Implement Proper Logging System
**Priority:** Low  
**Effort:** 3 hours  
**Status:** Code quality improvement

**Problem:**
Production code uses `console.error`, `console.warn` directly.

**Solution:**
```typescript
// Create logger.ts
const logger = {
  error: (...args: any[]) => {
    if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_LOGGING) {
      console.error(...args);
    }
    // Optionally send to error tracking service
  },
  warn: (...args: any[]) => {
    if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_LOGGING) {
      console.warn(...args);
    }
  },
  info: (...args: any[]) => {
    if (import.meta.env.DEV) {
      console.info(...args);
    }
  }
};

export default logger;
```

**Files to Create/Modify:**
- `frontend/src/utils/logger.ts` (new)
- Replace all `console.*` calls throughout frontend

---

## 🚀 Priority 3: Future Enhancements (Strategic)

### 3.1 Phase 1: API Request Stability & Monitoring
**Priority:** Future  
**Effort:** 2-3 weeks  
**Dependencies:** GCP Cloud Quotas API, Service Usage API

#### 3.1.1 Meta-API Health Dashboard
**Goal:** Real-time monitoring of Google Drive and Admin SDK API request rates

**Features:**
- Background polling of `cloudquotas.googleapis.com`
- Track "Queries per 100 seconds" metric
- Alert before hitting rate limits
- Visual gauge in UI showing current API health

**Why:** When rotating 100+ users, metadata overhead can trigger rate limits even if data volume is safe.

#### 3.1.2 Intelligent Metadata Throttling
**Goal:** Dynamic task adjustment based on project-level API health

**Features:**
- Monitor project-level Drive API request rate
- Auto-reduce scanning speed when approaching 90% utilization
- Prevent "403 User Rate Limit Exceeded" errors
- Graceful degradation during high-concurrency operations

#### 3.1.3 Automated Quota Discovery & Reporting
**Goal:** Pre-flight "API Capacity" report

**Features:**
- Verify GCP project has "Enterprise" limits before large jobs
- Generate capacity report showing current quotas
- Recommend quota increases if needed
- Validate DWD configuration completeness

---

### 3.2 Phase 2: Gateway Governance & Automation
**Priority:** Future  
**Effort:** 2-3 weeks  
**Dependencies:** Cloud Asset API, IAM API

#### 3.2.1 Service Account Discovery
**Goal:** API-driven gateway selection instead of manual JSON path input

**Features:**
- Discover authorized DWD gateways via Cloud Asset API
- Automatic mapping of correct gateway project per domain
- Eliminate managing 100+ JSON files on disk
- "Identity-as-a-Service" model in UI

**Why:** Prevent configuration drift in MSP/multi-tenant environments.

#### 3.2.2 Critical Path Permission Monitoring
**Goal:** Continuous validation of DWD prerequisites

**Features:**
- Monitor Service Account roles (Security Reviewer, Project Viewer)
- Detect permission drift in real-time
- Pause queue if critical permissions are revoked
- Clear error messages instead of silent failures

**Why:** Security administrators can silently revoke roles, causing failures hours later.

---

### 3.3 Phase 3: Governance & Pre-Migration Audits
**Priority:** Future  
**Effort:** 3-4 weeks  
**Dependencies:** Google Workspace Policy API

#### 3.3.1 "Zero-Block" Readiness Audit
**Goal:** Proactive scanning of Workspace Service Policies

**Audit Points:**
- **Trust Rules**: Will target Shared Drive accept data from source domain?
- **Sharing Restrictions**: Is external sharing disabled for rotation pool users?
- **DLP Analysis**: Will Data Loss Prevention rules trigger on data being moved?

**Outcome:** "Migration Readiness Scorecard" provided before any data transfer.

---

### 3.4 Phase 4: Scaling the Control Plane
**Priority:** Future  
**Effort:** 4-6 weeks

#### 3.4.1 Multi-Project Request Pooling
**Strategy:** Rotate between multiple Project Gateways for metadata scanning

**Analogy:** 100 people (Users) walking through 5 revolving doors (Projects) instead of 1.

**Benefits:**
- Exceed single-project API limits
- Load balance across multiple GCP projects
- Maintain same user pool

#### 3.4.2 Pattern-Based Error Intelligence
**Strategy:** High-resolution error logging with intelligent categorization

**Error Types:**
- **User-Level**: 750GB limit → Rotate user
- **Project-Level**: API rate limit → Slow down all users
- **System-Level**: Network/auth error → Alert admin

**Benefits:**
- Automated recovery strategies
- Better diagnostics
- Reduced manual intervention

#### 3.4.3 Policy-Aware Delta Syncs
**Strategy:** Use Policy API to skip restricted folders

**Benefits:**
- Save thousands of unnecessary API calls
- Faster "Check" phase
- Avoid permission errors proactively

---

## 📋 Code TODOs Tracker

### Active TODOs in Codebase

| File | Line | Description | Priority |
|------|------|-------------|----------|
| ~~`backend/store.py`~~ | ~~265~~ | ~~Implement DB update~~ | ~~High~~ ✅ Done |
| ~~`frontend/src/contexts/IsyncDataContext.tsx`~~ | ~~107, 114~~ | ~~Remove legacy driveManager/rcloneManager state~~ | ~~Medium~~ ✅ Done |

### Known Technical Debt

| Issue | Location | Impact | Effort |
|-------|----------|--------|--------|
| Type casting with `(cache as any)` | IsyncDataContext.tsx | Type safety | 4h |
| Missing error boundaries | Dashboard, BatchGenerator | Stability | 2h |
| Console logging in production | Multiple files | Code quality | 3h |
| Hardcoded singleton lists | IsyncDataContext.tsx | Maintainability | 30m |

---

## 🎯 Recommended Implementation Order

### Sprint 1: Quick Wins (1 week)
1. ✅ ~~Complete DB update logic in `store.py` (2h)~~ **DONE 2026-01-23**
2. ⬜ Add error boundaries to critical pages (2h)
3. ✅ ~~Verify and remove legacy state (2h)~~ **DONE 2026-01-23**
4. ⬜ Extract singleton type constants (30m) - *Already done, constants exist at lines 87-88*

### Sprint 2: UX Improvements (1 week)
1. ✅ Implement bulk scan progress UI (4h)
2. ✅ Improve TypeScript type safety (4h)
3. ✅ Add proper logging system (3h)

### Sprint 3: Future Planning (As needed)
1. Evaluate Phase 1 enhancements based on scale requirements
2. Prototype API health monitoring
3. Research GCP Cloud Quotas API integration

---

## 📚 Archived Documents

The following planning documents have been archived to `archive/`:
- `CODE_REVIEW_AND_IMPROVEMENTS.md` - Comprehensive code review (completed items)
- `FUTURE_ENHANCEMENTS_PLAN.md` - Enterprise API stability features (consolidated here)
- `DB_REFACTOR_PLAN.md` - Database migration plan (completed)
- `WORKSPACE_REFRESH_FIX.md` - Workspace manager fixes (completed)

**Archive Date:** 2026-01-23

---

## 🔄 Maintenance

This plan should be updated:
- ✅ When tasks are completed (move to "Recently Completed")
- ✅ When new issues are discovered (add to appropriate priority section)
- ✅ When priorities change (re-order sections)
- ✅ Monthly review of future enhancements relevance

---

*Last Review: 2026-01-23*  
*Next Review: 2026-02-23*
