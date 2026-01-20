/**
 * Centralized storage keys for localStorage and sessionStorage
 * Prevents typos and makes it easy to find all persisted data
 */

// localStorage keys (persist across sessions)
export const STORAGE_KEYS = {
    // Navigation
    VIEW: 'isync_view',
    COLLAPSED_GROUPS: 'isync_collapsed_groups',

    // Dashboard
    SELECTED_INDICES: 'isync_selected_indices',
} as const;


// sessionStorage keys (cleared when tab closes)
export const SESSION_KEYS = {
    // User Management
    SELECTED_DOMAINS: 'isync_sel_domains',
    USERS: 'isync_users',
    SELECTED_USERS: 'isync_sel_users',
    USER_FILTER: 'isync_user_filter',
    USER_COL_FILTERS: 'isync_user_col_filters',

    // Drive Manager
    DRIVE_MANAGER_QUERY: 'isync_dm_query',
    DRIVE_MANAGER_LIMIT: 'isync_dm_limit',
    DRIVE_MANAGER_DOMAIN: 'isync_dm_domain',
    DRIVE_MANAGER_ACTIVE_TAB: 'isync_dm_active_tab',
    DRIVE_MANAGER_BUILDER_STATE: 'isync_dm_builder_state',
    DRIVE_MANAGER_MANUAL_STATE: 'isync_dm_manual_state',
    DRIVE_MANAGER_HIDDEN_FILTER: 'isync_dm_hidden_filter',
    DRIVE_MANAGER_UNION_NAME_INPUT: 'isync_dm_union_name',
    DRIVE_MANAGER_MANAGER_MODE: 'isync_dm_manager_mode',

    // Rclone Manager
    RCLONE_SEARCH_FILTER: 'isync_rclone_search',
    RCLONE_STATUS_FILTER: 'isync_rclone_status',

    // Remote Sync
    REMOTE_SYNC_FILTERS: 'isync_remote_sync_filters',
} as const;
