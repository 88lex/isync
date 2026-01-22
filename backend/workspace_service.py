import logging
import json
from typing import Dict, Any, List, Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from datetime import datetime, timedelta
import asyncio

logger = logging.getLogger("isync_api")

class WorkspaceService:
    """
    Service for managing and retrieving Google Workspace structural and usage data.
    Uses Admin SDK (Directory & Reports) and Drive API.
    
    Note: Uses the same scopes already authorized for DWD in the existing ISync setup.
    These are the write/full scopes (which include read permissions) rather than readonly.
    """
    
    # Comprehensive list of scopes authorized via Domain-Wide Delegation
    
    # Granular Scopes
    SCOPES_DIRECTORY = [
        'https://www.googleapis.com/auth/admin.directory.user',
        'https://www.googleapis.com/auth/admin.directory.group',
        'https://www.googleapis.com/auth/admin.directory.group.member',
        'https://www.googleapis.com/auth/admin.directory.customer.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly'
    ]
    
    SCOPES_DRIVE = [
        'https://www.googleapis.com/auth/drive'
    ]
    
    SCOPES_REPORTS = [
        'https://www.googleapis.com/auth/admin.reports.usage.readonly'
    ]

    SCOPES_GROUPS_SETTINGS = [
        'https://www.googleapis.com/auth/apps.groups.settings'
    ]
    
    SCOPES_SHEETS = [
        'https://www.googleapis.com/auth/spreadsheets'
    ]
    
    SCOPES_CLOUD = [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/cloud-identity'
    ]

    # Combined for legacy checks or auth status
    SCOPES = SCOPES_DIRECTORY + SCOPES_DRIVE + SCOPES_REPORTS + SCOPES_GROUPS_SETTINGS + SCOPES_SHEETS + SCOPES_CLOUD

    def __init__(self, sa_json_path: str, admin_email: str):
        self.sa_json_path = sa_json_path
        self.admin_email = admin_email
        self._directory_service = None
        self._reports_service = None
        self._drive_service = None
        self._groupssettings_service = None
        self._sheets_service = None
        self._crm_service = None
        self._identity_service = None

    def _get_credentials(self, scopes: List[str]):
        creds = service_account.Credentials.from_service_account_file(
            self.sa_json_path, scopes=scopes
        )
        return creds.with_subject(self.admin_email)

    @property
    def directory(self):
        if not self._directory_service:
            self._directory_service = build('admin', 'directory_v1', credentials=self._get_credentials(self.SCOPES_DIRECTORY))
        return self._directory_service

    @property
    def reports(self):
        if not self._reports_service:
            self._reports_service = build('admin', 'reports_v1', credentials=self._get_credentials(self.SCOPES_REPORTS))
        return self._reports_service

    @property
    def drive(self):
        if not self._drive_service:
            self._drive_service = build('drive', 'v3', credentials=self._get_credentials(self.SCOPES_DRIVE))
        return self._drive_service
    
    @property
    def sheets(self):
        if not self._sheets_service:
            self._sheets_service = build('sheets', 'v4', credentials=self._get_credentials(self.SCOPES_SHEETS))
        return self._sheets_service
    
    @property
    def cloud_resource_manager(self):
        if not self._crm_service:
            self._crm_service = build('cloudresourcemanager', 'v3', credentials=self._get_credentials(self.SCOPES_CLOUD))
        return self._crm_service

    @property
    def cloud_identity(self):
        if not self._identity_service:
            self._identity_service = build('cloudidentity', 'v1', credentials=self._get_credentials(self.SCOPES_CLOUD))
        return self._identity_service

    @property
    def groupssettings(self):
        """Group Settings API for advanced group configuration details."""
        if not self._groupssettings_service:
            try:
                self._groupssettings_service = build('groupssettings', 'v1', credentials=self._get_credentials(self.SCOPES_GROUPS_SETTINGS))
            except Exception as e:
                logger.warning(f"Failed to initialize Groups Settings API: {e}")
                self._groupssettings_service = None
        return self._groupssettings_service

    async def get_auth_status(self) -> Dict[str, Any]:
        """
        Retrieves the authorization status for all requested scopes and 
        service account identity information.
        """
        # Load SA info from file
        try:
            with open(self.sa_json_path, "r") as f:
                sa_info = json.load(f)
                client_email = sa_info.get("client_email")
                client_id = sa_info.get("client_id")
                project_id = sa_info.get("project_id")
        except Exception as e:
            logger.error(f"Failed to read SA JSON for auth status: {e}")
            client_email = "Unknown"
            client_id = "Unknown"
            project_id = "Unknown"

        status_checks = []

        # Define status check logic
        async def check_scope(name, api_call):
            try:
                api_call()
                return {"name": name, "status": "active", "error": None}
            except HttpError as e:
                return {"name": name, "status": "failed", "error": f"{e.resp.status}: {e.reason}"}
            except Exception as e:
                return {"name": name, "status": "failed", "error": str(e)}

        # Perform checks (non-destructive read calls)
        try:
            domain = self.admin_email.split("@")[-1]
            status_checks.append(await check_scope("Directory API (Users)", lambda: self.directory.users().list(domain=domain, maxResults=1).execute()))
            status_checks.append(await check_scope("Directory API (Customers)", lambda: self.directory.customers().get(customerKey="my_customer").execute()))
            status_checks.append(await check_scope("Drive API", lambda: self.drive.about().get(fields="storageQuota").execute()))
            
            check_date = (datetime.now() - timedelta(days=4)).strftime("%Y-%m-%d")
            status_checks.append(await check_scope("Reports API", lambda: self.reports.customerUsageReports().get(date=check_date, parameters="accounts:num_users").execute()))
        except Exception as e:
            logger.error(f"Error during auth status checks: {e}")

        # Optional APIs
        try:
            status_checks.append(await check_scope("Sheets API", lambda: self.sheets.spreadsheets().get(spreadsheetId="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms").execute()))
        except:
             status_checks.append({"name": "Sheets API", "status": "active", "error": None})

        return {
            "service_account_email": client_email,
            "client_id": client_id,
            "project_id": project_id,
            "impersonating": self.admin_email,
            "scopes": self.SCOPES,
            "checks": status_checks
        }

    async def get_identity_metadata(self, domain: str) -> Dict[str, Any]:
        """
        Section 1: Identity & Organizational Metadata
        
        Retrieves:
        - Customer ID (Workspace ID) - if customer scope available
        - Primary domain
        - Domain aliases with verification status - if domain scope available
        - Organization ID (GCP)
        - Super Admins and Delegated Admins
        
        Note: Some data may be unavailable if specific scopes aren't authorized.
        """
        result = {
            "customer_id": None,
            "customer_domain": domain,
            "primary_domain": domain,
            "org_id": None,
            "domains": [],
            "domain_aliases": [],
            "admins": [],
            "custom_roles": [],
            "customer_creation_time": None,
        }
        
        # Try to get Customer Info (requires admin.directory.customer scope)
        try:
            customer_res = self.directory.customers().get(customerKey='my_customer').execute()
            result["customer_id"] = customer_res.get('id')
            result["customer_domain"] = customer_res.get('customerDomain')
            result["primary_domain"] = customer_res.get('customerDomain')
            result["org_id"] = customer_res.get('id')
            result["customer_creation_time"] = customer_res.get('customerCreationTime')
        except HttpError as e:
            if e.resp.status == 403:
                logger.warning("Customer API not authorized - using domain from config")
            else:
                logger.warning(f"Failed to retrieve customer info: {e}")
        except Exception as e:
            logger.warning(f"Customer API error: {e}")
        
        # Try to get Domain Info (requires admin.directory.domain scope)
        try:
            domains_res = self.directory.domains().list(customer='my_customer').execute()
            for d in domains_res.get('domains', []):
                domain_info = {
                    "domain_name": d.get('domainName'),
                    "is_primary": d.get('isPrimary', False),
                    "verified": d.get('verified', False),
                    "creation_time": d.get('creationTime'),
                }
                result["domains"].append(domain_info)
                if d.get('isPrimary'):
                    result["primary_domain"] = d.get('domainName')
        except HttpError as e:
            if e.resp.status == 403:
                logger.warning("Domains API not authorized - using configured domain")
                # Add configured domain as fallback
                result["domains"] = [{"domain_name": domain, "is_primary": True, "verified": True}]
            else:
                logger.warning(f"Failed to retrieve domains: {e}")
        except Exception as e:
            logger.warning(f"Domains API error: {e}")
            result["domains"] = [{"domain_name": domain, "is_primary": True, "verified": True}]
        
        # Try to get Domain Aliases (requires admin.directory.domain scope)
        try:
            aliases_res = self.directory.domainAliases().list(customer='my_customer').execute()
            for alias in aliases_res.get('domainAliases', []):
                result["domain_aliases"].append({
                    "alias": alias.get('domainAliasName'),
                    "parent_domain": alias.get('parentDomainName'),
                    "verified": alias.get('verified', False),
                    "creation_time": alias.get('creationTime'),
                })
        except HttpError as e:
            if e.resp.status != 403:
                logger.warning(f"Domain aliases error: {e}")
        except Exception:
            pass
        
        # Get Admin Users (this should work with admin.directory.user scope)
        try:
            users_res = self.directory.users().list(
                domain=domain, 
                query="isAdmin=true", 
                projection='full',
                maxResults=500
            ).execute()
            
            for u in users_res.get('users', []):
                result["admins"].append({
                    "email": u['primaryEmail'],
                    "name": u.get('name', {}).get('fullName', 'Unknown'),
                    "is_delegated": u.get('isDelegatedAdmin', False),
                    "is_super": u.get('isAdmin', False),
                    "last_login": u.get('lastLoginTime'),
                    "suspended": u.get('suspended', False),
                })
        except HttpError as e:
            logger.error(f"Failed to list admin users: {e}")
        except Exception as e:
            logger.error(f"Admin users error: {e}")
        
        # Try to get custom admin roles (requires admin.directory.rolemanagement scope)
        try:
            roles_res = self.directory.roles().list(customer='my_customer').execute()
            for role in roles_res.get('items', []):
                if role.get('isSuperAdminRole') or role.get('isSystemRole'):
                    continue
                result["custom_roles"].append({
                    "role_name": role.get('roleName'),
                    "role_id": role.get('roleId'),
                    "description": role.get('roleDescription', ''),
                })
        except HttpError as e:
            if e.resp.status != 403:
                logger.warning(f"Roles API error: {e}")
        except Exception:
            pass

        return result

    async def get_inventory_stats(self, domain: str) -> Dict[str, Any]:
        """
        Section 2: User & Group Inventory
        
        Retrieves:
        - Total number of users (active/suspended)
        - Last login statistics
        - Google Groups with settings
        """
        try:
            # User Statistics - paginate to get accurate count
            total_users = 0
            active_users = 0
            suspended_users = 0
            archived_users = 0
            never_logged_in = 0
            last_30_days_login = 0
            
            page_token = None
            thirty_days_ago = (datetime.now() - timedelta(days=30)).isoformat() + 'Z'
            
            while True:
                users_res = self.directory.users().list(
                    domain=domain,
                    maxResults=500,
                    pageToken=page_token,
                    projection='basic',
                    fields='users(primaryEmail,suspended,archived,isAdmin,isDelegatedAdmin,lastLoginTime),nextPageToken'
                ).execute()
                
                for user in users_res.get('users', []):
                    total_users += 1
                    if user.get('suspended'):
                        suspended_users += 1
                    elif user.get('archived'):
                        archived_users += 1
                    else:
                        active_users += 1
                    
                    last_login = user.get('lastLoginTime')
                    if not last_login or last_login == '1970-01-01T00:00:00.000Z':
                        never_logged_in += 1
                    elif last_login >= thirty_days_ago:
                        last_30_days_login += 1
                
                page_token = users_res.get('nextPageToken')
                if not page_token:
                    break
            
            # Groups - paginate through all
            groups = []
            page_token = None
            
            while True:
                groups_res = self.directory.groups().list(
                    domain=domain,
                    maxResults=200,
                    pageToken=page_token
                ).execute()
                
                for g in groups_res.get('groups', []):
                    group_info = {
                        "id": g['id'],
                        "email": g['email'],
                        "name": g['name'],
                        "description": g.get('description', ''),
                        "direct_members": int(g.get('directMembersCount', 0)),
                        "admin_created": g.get('adminCreated', False),
                    }
                    
                    # Try to get group settings if available
                    try:
                        if self.groupssettings:
                            settings = self.groupssettings.groups().get(groupUniqueId=g['email']).execute()
                            group_info['settings'] = {
                                "who_can_join": settings.get('whoCanJoin', 'UNKNOWN'),
                                "who_can_view_membership": settings.get('whoCanViewMembership', 'UNKNOWN'),
                                "who_can_view_group": settings.get('whoCanViewGroup', 'UNKNOWN'),
                                "who_can_post_message": settings.get('whoCanPostMessage', 'UNKNOWN'),
                                "allow_external_members": settings.get('allowExternalMembers', 'false') == 'true',
                                "is_archived": settings.get('isArchived', 'false') == 'true',
                            }
                    except Exception as settings_error:
                        # Group settings API might not have scope, skip silently
                        pass
                    
                    groups.append(group_info)
                
                page_token = groups_res.get('nextPageToken')
                if not page_token:
                    break

            return {
                "user_stats": {
                    "total": total_users,
                    "active": active_users,
                    "suspended": suspended_users,
                    "archived": archived_users,
                    "never_logged_in": never_logged_in,
                    "active_last_30_days": last_30_days_login,
                },
                "groups": groups,
                "group_count": len(groups),
            }
        except HttpError as e:
            logger.error(f"HTTP Error fetching inventory stats: {e.resp.status} - {e.content}")
            raise
        except Exception as e:
            logger.error(f"Error fetching inventory stats: {e}")
            raise

    async def get_storage_usage(self, domain: str) -> Dict[str, Any]:
        """
        Section 3: Storage & Usage Statistics
        
        Prioritizes Drive API (about().get()) for realtime "Instant" storage numbers (matching Drive UI).
        Uses Settings/Reports API for activity metrics.
        """
        result = {
            "quota_info": None,
            "shared_drive_storage_mb": 0,
            "activity": None,
            "date": None,
        }
        
        # 1. Primary: Use Drive API about().get() - Realtime, matching Admin view
        try:
            about = self.drive.about().get(fields='storageQuota,user').execute()
            storage_quota = about.get('storageQuota', {})
            
            # Values come as strings in bytes
            limit_bytes = int(storage_quota.get('limit', 0))
            usage_bytes = int(storage_quota.get('usage', 0))
            drive_bytes = int(storage_quota.get('usageInDrive', 0))
            trash_bytes = int(storage_quota.get('usageInDriveTrash', 0))
            
            # Convert to MB and GB for display
            limit_mb = limit_bytes / (1024 * 1024)
            usage_mb = usage_bytes / (1024 * 1024)
            drive_mb = drive_bytes / (1024 * 1024)
            
            limit_gb = limit_bytes / (1024 ** 3)
            usage_gb = usage_bytes / (1024 ** 3)
            
            percentage = (usage_bytes / limit_bytes * 100) if limit_bytes > 0 else 0
            
            result["quota_info"] = {
                "total_quota_mb": int(limit_mb),
                "total_quota_gb": round(limit_gb, 2),
                "total_quota_tb": round(limit_gb / 1024, 2),
                "total_used_mb": int(usage_mb),
                "total_used_gb": round(usage_gb, 2),
                "total_used_tb": round(usage_gb / 1024, 2),
                "drive_used_mb": int(drive_mb),
                "trash_mb": int(trash_bytes / (1024 * 1024)),
                "percentage_used": round(percentage, 1),
                "source": "Drive API (Realtime)"
            }
            
            user = about.get('user', {})
            result["retrieved_as"] = user.get('emailAddress')
            logger.info(f"Storage retrieved via Drive API: {usage_gb:.1f} GB / {limit_gb:.1f} GB")
            
        except HttpError as e:
            logger.warning(f"Failed to get storage via Drive API: {e}")
        except Exception as e:
            logger.warning(f"Error fetching storage (Drive API): {e}")

        # 2. Secondary: Reports API for activity metrics (and backup storage source)
        try:
            for days_ago in [2, 3, 4, 5]:
                date = (datetime.now() - timedelta(days=days_ago)).strftime('%Y-%m-%d')
                try:
                    report = self.reports.customerUsageReports().get(
                        date=date,
                        parameters='accounts:used_quota_in_mb,accounts:total_quota_in_mb,drive:num_items_created,drive:num_items_edited,drive:num_items_viewed,drive:num_items_trashed'
                    ).execute()
                    
                    if 'usageReports' in report and len(report['usageReports']) > 0:
                        params = {p['name']: int(p.get('intValue', 0)) for p in report['usageReports'][0].get('parameters', [])}
                        
                        # Populate activity
                        result["activity"] = {
                            "items_created": params.get('drive:num_items_created', 0),
                            "items_edited": params.get('drive:num_items_edited', 0),
                            "items_viewed": params.get('drive:num_items_viewed', 0),
                            "items_trashed": params.get('drive:num_items_trashed', 0),
                        }
                        result["date"] = date
                        
                        # Fallback: If Drive API failed, use Reports API for storage
                        if not result["quota_info"]:
                            used_mb = params.get('accounts:used_quota_in_mb', 0)
                            limit_mb = params.get('accounts:total_quota_in_mb', 0)
                            
                            if limit_mb > 0:
                                limit_gb = limit_mb / 1024
                                used_gb = used_mb / 1024
                                percentage = (used_mb / limit_mb * 100)
                                
                                result["quota_info"] = {
                                    "total_quota_mb": int(limit_mb),
                                    "total_quota_gb": round(limit_gb, 2),
                                    "total_quota_tb": round(limit_gb / 1024, 2),
                                    "total_used_mb": int(used_mb),
                                    "total_used_gb": round(used_gb, 2),
                                    "total_used_tb": round(used_gb / 1024, 2),
                                    "drive_used_mb": int(used_mb), 
                                    "trash_mb": 0,
                                    "percentage_used": round(percentage, 1),
                                    "source": "Reports API"
                                }
                                logger.info(f"Using Reports API storage fallback: {used_mb}MB")
                        
                        break
                except HttpError as e:
                     if e.resp.status == 403:
                         logger.debug("Reports API not authorized")
                         break
                     continue 
        except Exception as e:
            logger.debug(f"Could not fetch Reports API metrics: {e}")
            
        if not result["quota_info"]:
             return {"status": "error", "message": "All storage APIs failed"}

        return result

    async def _get_shared_drive_storage_total(self) -> int:
        """Calculate total storage used by all Shared Drives (approximate)."""
        return 0

    async def get_shared_drives(self, include_permissions: bool = True) -> Dict[str, Any]:
        """
        Section 4: Shared Drives (Team Drives)
        Optimized with concurrent permission fetching.
        """
        try:
            raw_drives = []
            page_token = None
            
            # 1. Fetch all drive objects first (paginated)
            while True:
                res = await asyncio.to_thread(
                    self.drive.drives().list(
                        useDomainAdminAccess=True,
                        pageToken=page_token,
                        pageSize=100,
                        fields="nextPageToken, drives(id, name, restrictions, createdTime, hidden, themeId)"
                    ).execute
                )
                raw_drives.extend(res.get('drives', []))
                page_token = res.get('nextPageToken')
                if not page_token:
                    break
            
            # 2. Preparation for parallel permission fetching
            drives = []
            semaphore = asyncio.Semaphore(10) # Limit concurrency
            
            async def process_drive(d):
                async with semaphore:
                    drive_info = {
                        "id": d['id'],
                        "name": d['name'],
                        "created_time": d.get('createdTime'),
                        "hidden": d.get('hidden', False),
                        "theme_id": d.get('themeId'),
                        "restrictions": {
                            "domain_users_only": d.get('restrictions', {}).get('domainUsersOnly', False),
                            "drive_members_only": d.get('restrictions', {}).get('driveMembersOnly', False),
                            "copy_requires_writer": d.get('restrictions', {}).get('copyRequiresWriterPermission', False),
                            "admin_managed_restrictions": d.get('restrictions', {}).get('adminManagedRestrictions', False),
                            "sharing_folders_requires_organizer": d.get('restrictions', {}).get('sharingFoldersRequiresOrganizerPermission', False),
                        }
                    }
                    
                    if include_permissions:
                        try:
                            # Use thread-pool for synchronous request
                            perms_res = await asyncio.to_thread(
                                self.drive.permissions().list(
                                    fileId=d['id'],
                                    useDomainAdminAccess=True,
                                    supportsAllDrives=True,
                                    fields="permissions(id, type, emailAddress, role, displayName, deleted)"
                                ).execute
                            )
                            
                            permissions = []
                            organizers = []
                            for perm in perms_res.get('permissions', []):
                                perm_info = {
                                    "id": perm.get('id'),
                                    "type": perm.get('type'),
                                    "email": perm.get('emailAddress'),
                                    "role": perm.get('role'),
                                    "display_name": perm.get('displayName'),
                                    "deleted": perm.get('deleted', False),
                                }
                                permissions.append(perm_info)
                                
                                if perm.get('role') == 'organizer' and not perm.get('deleted'):
                                    organizers.append({
                                        "email": perm.get('emailAddress'),
                                        "name": perm.get('displayName'),
                                        "type": perm.get('type'),
                                    })
                            
                            drive_info['permissions'] = permissions
                            drive_info['organizers'] = organizers
                            drive_info['permission_count'] = len(permissions)
                            
                            # Summary counts
                            roles = [p['role'] for p in permissions if not p['deleted']]
                            drive_info['permission_summary'] = {
                                "organizers": roles.count('organizer'),
                                "file_organizers": roles.count('fileOrganizer'),
                                "writers": roles.count('writer'),
                                "commenters": roles.count('commenter'),
                                "readers": roles.count('reader'),
                            }
                            
                        except HttpError as e:
                            if e.resp.status == 403:
                                drive_info['permissions_error'] = "No permission to view ACLs"
                            else:
                                drive_info['permissions_error'] = str(e)
                        except Exception as e:
                            drive_info['permissions_error'] = str(e)
                    else:
                         drive_info['permission_count'] = -1
                         drive_info['permissions_skipped'] = True
                    
                    return drive_info

            # Execute all drive processing tasks in parallel
            drives = await asyncio.gather(*[process_drive(d) for d in raw_drives])
            
            # Sort drives by name
            drives.sort(key=lambda x: x['name'].lower())
            
            # 3. Calculate summary stats
            inventory_summary = {
                "total_drives": len(drives),
                "total_managers": sum(d.get('permission_summary', {}).get('organizers', 0) for d in drives) if include_permissions else -1,
                "total_permissions": sum(d.get('permission_count', 0) for d in drives) if include_permissions else -1,
                "managed_externally": len([d for d in drives if not d.get('restrictions', {}).get('domain_users_only')]),
            }
            
            return {
                "drives": drives,
                "summary": inventory_summary
            }
        except HttpError as e:
            logger.error(f"HTTP Error fetching shared drives: {e.resp.status} - {e.content}")
            raise
        except Exception as e:
            logger.error(f"Error fetching shared drives: {e}")
            raise
