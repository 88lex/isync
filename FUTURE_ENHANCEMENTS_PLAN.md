# ISync Future Enhancements Plan: Enterprise API Stability & Reliability

This document outlines the strategic plan for integrating advanced GCP and Workspace APIs into ISync. The focus has shifted from "Quota Bypassing" (which is now handled by DWD User Rotation) to **Enterprise Stability**, **API Rate Management**, and **Infrastructure Governance**.

---

## 🚀 Phase 1: API Request Stability (The "Nervous System")
**API Dependency**: Cloud Quotas API, Service Usage API

### 1.1 Meta-API Health Dashboard
*   **Focus**: Monitoring **API Request Rates** (Requests Per Minute) rather than data volume.
*   **Feature**: Real-time gauge of the GCP Project's current status with the Google Drive and Admin SDK APIs.
*   **Why**: When rotating 100+ users, the *metadata* overhead (listing files/folders) can easily trigger rate limits even if the data volume is safe.
*   **Implementation**: Background polling of `cloudquotas.googleapis.com` to track "Queries per 100 seconds" and alert before the task runner hits a hard limit.

### 1.2 Intelligent Metadata Throttling
*   **Feature**: Dynamic task adjustment based on project-level API health.
*   **Implementation**: If the Project-level Drive API request rate reaches 90% utilization, ISync will automatically reduce the *scanning* speed of the user-rotation engine, preventing "403 User Rate Limit Exceeded" errors that occur during high-concurrency metadata lookups.

### 1.3 Automated Quota Discovery & Reporting
*   **Feature**: Pre-flight "API Capacity" report.
*   **Goal**: Ensure the GCP project is configured for "Enterprise" limits before a massive DWD job begins.

---

## 🛠 Phase 2: Gateway Governance & Automation
**API Dependency**: Cloud Asset API, IAM API

### 2.1 Service Account (Gateway) Discovery
*   **Feature**: Selection of authorized DWD gateways via API discovery rather than manual JSON path input.
*   **Why**: To prevent configuration drift and manage identity at scale. In an MSP/Multi-tenant environment, this allows ISync to discover and map the correct "Gateway" project for each client domain automatically.
*   **Goal**: Eliminate the risk of managing 100+ JSON files on disk; move toward an "Identity-as-a-Service" model within the UI.

### 2.2 Critical Path Permission Monitoring (Drift Detection)
*   **Feature**: Continuous validation of DWD Prerequisites.
*   **Implementation**: Use the Asset API to monitor the Service Account's roles (e.g., Security Reviewer, Project Viewer). 
*   **Why**: If a security administrator silently revokes a project-level role, a running migration can fail hours later. ISync will detect this "drift" and pause the queue, providing a clear error rather than crashing.

---

## 🔍 Phase 3: Governance & Pre-Migration Audits
**API Dependency**: Google Workspace Policy API

### 3.1 "Zero-Block" Readiness Audit
*   **Feature**: Proactive scanning of Workspace Service Policies.
*   **Audit Points**:
    *   **Trust Rules**: Will the target Shared Drive accept data from the source domain?
    *   **Sharing Restrictions**: Is "External Sharing" disabled for the users in the rotation pool?
    *   **DLP Analysis**: Are there Data Loss Prevention rules that will trigger on the data being moved?
*   **Outcome**: A "Migration Readiness Scorecard" provided to the admin before a single byte is transferred.

---

## 💡 Phase 4: Scaling the Control Plane

### 4.1 Multi-Project Request Pooling (API Load Balancing)
*   **Strategy**: If the metadata scanning requirements of a 100-TB migration exceed the limits of a single GCP project, ISync can rotate between multiple **Project Gateways** while remaining on the same **User Pool**.
*   **Analogy**: 100 people (Users) trying to walk through 5 revolving doors (Project Gateways) instead of 1.

### 4.2 Pattern-Based Error Intelligence
*   **Strategy**: Use high-resolution error logging to distinguish between:
    *   **User-Level Failures**: (750GB limit reached -> Rotate user).
    *   **Project-Level Failures**: (API rate limit reached -> Slow down all users).
    *   **System-Level Failures**: (Network/DWD auth error -> Alert admin).

### 4.3 Policy-Aware Delta Syncs
*   **Strategy**: Optimize the "Check" phase of syncs by using the Policy API to identify and skip folders that are restricted, saving thousands of unnecessary API calls.
