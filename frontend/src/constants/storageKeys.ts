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
} as const;
