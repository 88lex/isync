# Google Workspace Manager - Required API Permissions & Setup

The Workspace Manager feature leverages the **same scopes** already authorized for ISync's core functionality. Only additional optional scopes are needed for full featurs.

## Scopes Used

### Already Authorized (Used by ISync)

These scopes are already authorized in your DWD configuration for ISync to work:

| Scope | Purpose | What It Enables in Workspace Manager |
|-------|---------|--------------------------------------|
| `https://www.googleapis.com/auth/admin.directory.user` | User management | User statistics, admin identification |
| `https://www.googleapis.com/auth/admin.directory.group` | Group management | Group listing, member counts |
| `https://www.googleapis.com/auth/admin.directory.group.member` | Group members | Group membership details |
| `https://www.googleapis.com/auth/drive` | Drive access | Shared Drive listing, permissions, organizers |
| `https://www.googleapis.com/auth/spreadsheets` | Sheets API | Access to Google Sheets used by ISync |
| `https://www.googleapis.com/auth/cloud-platform` | Google Cloud APIs | Access to GCP resources and Cloud Resource Manager |
| `https://www.googleapis.com/auth/cloud-identity` | Cloud Identity | Access to Cloud Identity groups and memberships |
| `https://www.googleapis.com/auth/admin.directory.customer.readonly` | Customer info | Customer ID (Workspace ID), Organization creation time |
| `https://www.googleapis.com/auth/admin.directory.domain.readonly` | Domain info | Domain aliases, verification status |
| `https://www.googleapis.com/auth/admin.reports.usage.readonly` | Usage reports | Storage statistics, Drive activity metrics |
| `https://www.googleapis.com/auth/apps.groups.settings` | Group settings | Who can post, external members allowed |

### 📋 Quick Copy-Paste for Domain-Wide Delegation

When editing your Service Account in the Google Admin Console, copy and paste this entire comma-separated string into the **OAuth Scopes** field to enable all features:

```text
https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.group.member,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/cloud-identity,https://www.googleapis.com/auth/admin.directory.customer.readonly,https://www.googleapis.com/auth/admin.directory.domain.readonly,https://www.googleapis.com/auth/admin.reports.usage.readonly
```

---

## Setup Instructions

```
https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.group.readonly,https://www.googleapis.com/auth/admin.directory.customer.readonly,https://www.googleapis.com/auth/admin.directory.domain.readonly,https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly,https://www.googleapis.com/auth/admin.reports.usage.readonly,https://www.googleapis.com/auth/drive.readonly
```

7. Click **Authorize**

### Step 4: Configure ISync

Ensure your domain configuration in `config.yaml` has:

```yaml
domains:
  - domain_name: yourdomain.com
    admin_email: admin@yourdomain.com  # Must be a Super Admin email
    sa_json_path: /path/to/service-account.json
```

**Important**: The `admin_email` must be a Super Admin in Google Workspace. The service account will impersonate this user to make API calls.

## Troubleshooting

### Error: "unauthorized_client"

This error means either:
1. Domain-Wide Delegation is not enabled for the service account
2. The scopes are not authorized in Google Admin Console
3. The admin_email is not a valid Super Admin

### Error: "Access denied" or "403 Forbidden"

This typically means:
1. The scope is not authorized for the Client ID
2. The API is not enabled in Google Cloud Console
3. The admin being impersonated doesn't have the required admin privileges

### Error: "Reports API data unavailable"

The Reports API data may be:
1. Delayed by 24-48 hours
2. Not available for very new Workspace accounts
3. Blocked by API scope not being authorized

## Data Retrieved by Section

### Section 1: Identity & Organizational Metadata
- Customer ID (Workspace ID)
- Primary domain and domain aliases
- Domain verification status
- Super Admins and Delegated Admins
- Custom admin roles

### Section 2: User & Group Inventory  
- Total user count (active/suspended/archived)
- Last login statistics
- Google Groups with member counts
- Group settings (who can post, external members, etc.)

### Section 3: Storage & Usage Statistics
- Total storage quota
- Drive, Gmail, Photos usage
- Drive activity metrics (created, edited, shared, trashed)

### Section 4: Shared Drives
- All Shared Drive names and IDs
- Permissions/ACLs per drive
- Organizers (Managers)
- Sharing restrictions
