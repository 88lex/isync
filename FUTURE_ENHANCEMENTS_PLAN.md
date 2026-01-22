# ISync Future Enhancements Plan: Advanced Monitoring & Automation

This document outlines the strategic plan for integrating the **Cloud Quotas API**, **Cloud Asset API**, and **Workspace Policy API** into ISync to enable enterprise-grade migration management.

---

## 🚀 Phase 1: Proactive Quota & Rate Limit Management
**API Dependency**: Cloud Quotas API, Service Usage API

### 1.1 Quota Health Dashboard
*   **Feature**: A real-time visualization in the ISync UI showing current consumption vs. limits for critical Drive and Directory API methods.
*   **Implementation**:
    *   Periodic background polling of `cloudquotas.googleapis.com` for active quotas.
    *   Frontend gauge components for "Requests per Minute" and "Requests per Day".
    *   Visual alerts when any quota exceeds 80% utilization.

### 1.2 Preventative Rate Adjustments (Smart Throttling)
*   **Feature**: Automatic "braking" system for the task runner.
*   **Implementation**:
    *   Modify `Orchestrator` to consult the Quota Health service before launching new Rclone parallel jobs.
    *   If remaining quota is low, the orchestrator will dynamically reduce `--transfers` or `--checkers` in running jobs.
    *   Implement "Cool-down" periods where the engine pauses for 60 seconds if 403 errors are detected, rather than immediately retrying.

### 1.3 Automated Quota Increase Requests
*   **Feature**: Programmatic logic to request increases for standard quotas.
*   **Implementation**:
    *   Admin button: "Optimize Quotas for Migration".
    *   Triggers API calls to update `quotaConfigurations` for the Drive API high-volume methods.

---

## 🛠 Phase 2: Automated Infrastructure & Drift Detection
**API Dependency**: Cloud Asset API, IAM API

### 2.1 Service Account Discovery & Auto-Config
*   **Feature**: Eliminate manual JSON path entry.
*   **Implementation**:
    *   Use `cloudasset.googleapis.com` to search for all `iam.googleapis.com/ServiceAccount` resources in the project.
    *   Populate a "Discovery" dropdown in the Domain configuration page.
    *   Automatically verify DWD status for discovered accounts.

### 2.2 Security & Permission Drift Detection
*   **Feature**: Continuous validation that the Service Account has not been stripped of necessary project-level roles.
*   **Implementation**:
    *   Background task to "re-inspect" keys every 24 hours.
    *   If the "Security Reviewer" or "Project Viewer" role is missing (indicating drift), email/webhook notification is sent, and the Dashboard flags the domain as "At Risk".

---

## 🔍 Phase 3: Pre-Migration & Governance Audits
**API Dependency**: Google Workspace Policy API

### 3.1 Pre-Migration Environment Audit
*   **Feature**: A "Readiness Score" tool run before a migration starts.
*   **Implementation**:
    *   Use Policy API to check:
        *   **External Sharing Policies**: Warn if target Shared Drives might block the source data.
        *   **Org Unit Restrictions**: Check if specific users are blocked from Drive services.
        *   **DLP Rules**: Identify Data Loss Prevention rules that might flag or block the transfer of certain file types.
    *   Generate a PDF readiness report for the admin.

---

## 💡 Phase 4: Extended Future Features

### 4.1 Multi-Project Quota Pooling
*   **Strategy**: Use multiple GCP projects (each with its own API quota) to distribute the load if a single project's 10,000 requests-per-100-seconds limit is reached.
*   **Implementation**: Logic to spread API calls (Directory lookups, etc.) across a pool of Service Accounts from different projects.

### 4.2 Advanced Error-Pattern Analysis
*   **Strategy**: Use machine learning (or advanced heuristics) to categorize failure patterns.
*   **Goal**: Distinguish between "Transit Network Issues" (Retryable) and "Permissions/Policy Issues" (Fatal) to prevent wasted retry cycles.

### 4.3 Delta-Sync Optimization Engine
*   **Strategy**: Intelligent comparison of source/target file lists to minimize API calls for already-synced data.
*   **Goal**: Reduce the "overhead" API usage that often consumes 20-30% of daily quota just on checking file existence.
