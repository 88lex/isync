// --- DASHBOARD API ---
export interface ScanRequest {
    pair_id: string;
    side: "source" | "dest";
    server_id?: string;
    timeout?: number;
}

export interface BulkScanServerUpdateRequest {
    pair_ids: string[];
    source_server_id?: string;
    dest_server_id?: string;
}

export interface ScanResult {
    bytes: number;
    count: number;
    scanned_at: string;
}

export const scanPath = async (req: ScanRequest): Promise<{ status: string, result: ScanResult }> => {
    const res = await axios.post(`${API_BASE}/dashboard/scan`, req);
    return res.data;
};

export const bulkUpdateScanServers = async (req: BulkScanServerUpdateRequest): Promise<{ status: string, updated_count: number }> => {
    const res = await axios.post(`${API_BASE}/dashboard/bulk-update-scan-servers`, req);
    return res.data;
};

import axios from 'axios';
import { API_BASE } from './constants/config';

export interface DomainConfig {
    domain_name: string;
    admin_email: string;
    sa_json_path: string;
    group_email: string;
    remote_sa_json_path?: string;
}

export interface Config {
    // Core
    upload_limit?: string;
    transfers?: number;
    max_users_per_cycle?: number;
    rotation_strategy?: string;
    company_name?: string;
    existing_users_file?: string;

    // Rclone
    default_source?: string;
    default_dest?: string;
    rclone_command?: string;
    rclone_chunk_size?: string;
    rclone_stats_interval?: string;
    stall_timeout_minutes?: number;
    global_rclone_flags?: string;
    step_check?: boolean;

    // Integrations
    webhook_url?: string;

    // SSH
    ssh_enabled?: boolean;
    ssh_host?: string;
    ssh_user?: string;
    ssh_key_path?: string;
    ssh_remote_path?: string;
    ssh_connect_timeout?: number;

    // Security
    protected_users?: string[];
    include_protected_users?: boolean;

    // Domains
    domains?: DomainConfig[];

    // Any legacy fields
    [key: string]: any;
}

export interface SyncPair {
    index?: number;
    id?: string;
    source: string;
    dest: string;
    domain_reference?: string;
    source_type?: 'LOCAL' | 'SSH' | 'RCLONE';
    source_server_id?: string;
    dest_type?: 'LOCAL' | 'SSH' | 'RCLONE';
    dest_server_id?: string;
    meta_server_id?: string;
    meta_execution_mode?: 'local' | 'ssh';

    // Dashboard Stats
    scan_source_server_id?: string;
    scan_dest_server_id?: string;
    source_size_bytes?: number;
    source_file_count?: number;
    source_scanned_at?: string;
    dest_size_bytes?: number;
    dest_file_count?: number;
    dest_scanned_at?: string;
}

export interface JobRequest {
    pairs: SyncPair[];
    dry_run: boolean;
    selected_users?: string[];
    random_order?: boolean;
}

// Ops Types
export interface SSHRequest {
    host: string;
    user?: string;
    key_path?: string;
    remote_path?: string;
    timeout?: number;
}


// --- CONFIG ---
export const fetchConfig = async (): Promise<Config> => {
    const res = await axios.get(`${API_BASE}/config`);
    return res.data;
};

export const updateConfig = async (cfg: Config): Promise<Config> => {
    const res = await axios.post(`${API_BASE}/config`, cfg);
    return res.data.config;
};

export interface ConfigStatus {
    config_file: {
        path: string;
        exists: boolean;
        size: number;
    };
    synclist_file: {
        path: string;
        exists: boolean;
        size: number;
    };
    in_memory: {
        config_keys: number;
        domains: number;
        sync_pairs: number;
    };
}

export const fetchConfigStatus = async (): Promise<ConfigStatus> => {
    const res = await axios.get(`${API_BASE}/config/status`);
    return res.data;
};

export const reloadConfig = async () => {
    const res = await axios.post(`${API_BASE}/config/reload`);
    return res.data;
};

// --- SYNCLIST ---
export const fetchSyncList = async (): Promise<SyncPair[]> => {
    const res = await axios.get(`${API_BASE}/synclist`);
    return res.data;
};

export const updateSyncList = async (pairs: SyncPair[]) => {
    const res = await axios.post(`${API_BASE}/synclist`, { pairs });
    return res.data;
};

// --- Sync Pair CRUD ---
export const createSyncPair = async (pair: SyncPair): Promise<{ status: string; pair: SyncPair; total: number }> => {
    const res = await axios.post(`${API_BASE}/sync-pairs`, pair);
    return res.data;
};

export const updateSyncPair = async (id: string, pair: SyncPair): Promise<{ status: string; pair: SyncPair }> => {
    const res = await axios.put(`${API_BASE}/sync-pairs/${id}`, pair);
    return res.data;
};

export const deleteSyncPair = async (id: string): Promise<{ status: string; removed: SyncPair; remaining: number }> => {
    const res = await axios.delete(`${API_BASE}/sync-pairs/${id}`);
    return res.data;
};

// --- Unified Sync Pair + Batch ---
export interface BatchInfo {
    filename: string;
    exists: boolean;
    size?: number;
    modified?: number;
    user_count?: number;
    needs_update?: boolean;
}

export interface SyncPairWithBatch {
    index: number;
    id?: string;
    source: string;
    dest: string;
    domain_reference: string;
    source_type?: 'LOCAL' | 'SSH' | 'RCLONE';
    source_server_id?: string;
    dest_type?: 'LOCAL' | 'SSH' | 'RCLONE';
    dest_server_id?: string;
    meta_server_id?: string;
    meta_execution_mode?: 'local' | 'ssh';
    batch: BatchInfo;
}

export const getSyncPairsWithBatches = async (): Promise<{ pairs: SyncPairWithBatch[] }> => {
    const res = await axios.get(`${API_BASE}/sync-pairs/with-batches`);
    return res.data;
};

export interface BulkGenerateResult {
    index: number;
    filename: string;
    status: string;
    user_count?: number;
    message?: string;
}

export interface BulkGenerateResponse {
    status: string;
    results: BulkGenerateResult[];
    generated: number;
    failed: number;
}

export const bulkGenerateBatches = async (
    indices: number[],
    randomOrder: boolean,
    dryRun: boolean = false,
    selectedUsers?: string[]
): Promise<BulkGenerateResponse> => {
    const res = await axios.post(`${API_BASE}/sync-pairs/generate-batches`, {
        indices,
        random_order: randomOrder,
        dry_run: dryRun,
        selected_users: selectedUsers && selectedUsers.length > 0 ? selectedUsers : undefined
    });
    return res.data;
};


// --- Batch CRUD ---
export const deleteBatchFile = async (filename: string): Promise<{ status: string; deleted: string }> => {
    const res = await axios.delete(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}`);
    return res.data;
};

export const renameBatchFile = async (filename: string, newName: string): Promise<{ status: string }> => {
    const res = await axios.put(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}?new_name=${encodeURIComponent(newName)}`);
    return res.data;
};

// --- Remote Browser ---
export interface RemoteFolder {
    path: string;
    name: string;
    depth: number;
}

export interface FolderListResponse {
    status: string;
    base_path: string;
    depth: number;
    folders: string[];
    tree: RemoteFolder[];
    count: number;
    message?: string;
}

export const listServerFolders = async (serverId: string, path: string = '/', depth: number = 2): Promise<FolderListResponse> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/folders`, { params: { path, depth } });
    return res.data;
};

export interface RcloneRemote {
    name: string;
    type: string;
    config?: Record<string, string>;
}

export interface RemotesListResponse {
    status: string;
    remotes: RcloneRemote[];
    count: number;
}

export const listServerRemotes = async (serverId: string): Promise<RemotesListResponse> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/remotes`);
    return res.data;
};

export const listLocalRemotes = async (): Promise<{ remotes: RcloneRemote[]; config_path: string; exists: boolean }> => {
    const res = await axios.get(`${API_BASE}/rclone/remotes`);
    return res.data;
};

export interface SearchRcloneResponse {
    matches: { name: string; type: string }[];
    count: number;
}

export const searchRcloneConfig = async (query: string, serverId?: string): Promise<SearchRcloneResponse> => {
    const res = await axios.post(`${API_BASE}/rclone/search-config`, { query, server_id: serverId });
    return res.data;
};

export const backupRcloneConfig = async (serverId: string) => {
    const res = await axios.post(`${API_BASE}/rclone/backup`, { server_id: serverId });
    return res.data;
};

export const copyRcloneConfig = async (
    sourceId: string,
    destId: string,
    mode: 'backup' | 'replace',
    options?: { sourcePath?: string; destPath?: string; customName?: string; dryRun?: boolean }
) => {
    const res = await axios.post(`${API_BASE}/rclone/copy-config`, {
        source_server_id: sourceId,
        dest_server_id: destId,
        mode,
        source_path: options?.sourcePath,
        dest_path: options?.destPath,
        custom_name: options?.customName,
        dry_run: options?.dryRun
    });
    return res.data;
};

export const checkRcloneDuplicates = async (serverId: string) => {
    const res = await axios.post(`${API_BASE}/rclone/duplicates`, { server_id: serverId });
    return res.data;
};

// --- Expand Union ---

export interface ExpansionProposal {
    new_remote_name: string;
    new_drive_name: string;
    based_on_remote: string;
    service_account_file?: string;
    team_drive_id?: string;
}

export interface UnionAnalysis {
    union_name: string;
    upstreams: string[];
    detected_pattern?: string;
    next_index?: number;
    members: any[];
}

export interface ExpansionPlan {
    analysis: UnionAnalysis;
    proposals: ExpansionProposal[];
}

export const analyzeUnionExpansion = async (serverId: string, unionRemote: string): Promise<ExpansionPlan> => {
    const res = await axios.post(`${API_BASE}/rclone/expand/analyze`, { server_id: serverId, union_remote: unionRemote });
    return res.data;
};

export const executeUnionExpansion = async (serverId: string, unionRemote: string, proposals: ExpansionProposal[]): Promise<{ status: string; logs: string[] }> => {
    const res = await axios.post(`${API_BASE}/rclone/expand/execute`, {
        server_id: serverId,
        union_remote: unionRemote,
        proposals
    });
    return res.data;
};

export interface SharedDrive {
    id: string;
    name: string;
    kind: string;
    hidden?: boolean;
}

export interface SharedDrivesResponse {
    status: string;
    drives: SharedDrive[];
    count: number;
    message?: string;
}

export const listSharedDrives = async (serverId: string, remoteName: string): Promise<SharedDrivesResponse> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/remotes/${remoteName}/drives`);
    return res.data;
};

export interface RemotePathItem {
    name: string;
    type: string;
}

export interface RemotePathResponse {
    status: string;
    remote: string;
    path: string;
    items: RemotePathItem[];
    count: number;
}

export const listRemotePath = async (serverId: string, remoteName: string, path: string = ''): Promise<RemotePathResponse> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/remotes/${remoteName}/ls`, { params: { path } });
    return res.data;
};

// --- Step Ops ---
// --- Step Ops ---
export const fetchStepStatus = async () => {
    const res = await axios.get(`${API_BASE}/ops/step_status`);
    return res.data;
};

export const submitStepAction = async (action: 'CONTINUE' | 'ABORT') => {
    const res = await axios.post(`${API_BASE}/ops/step_action`, { action });
    return res.data;
};

// --- JOBS ---
export const startJob = async (req: JobRequest) => {
    return axios.post(`${API_BASE}/jobs/start`, req);
};

export const stopJob = async () => {
    return axios.post(`${API_BASE}/jobs/stop`);
};

export const generateBatch = async (req: JobRequest) => {
    const res = await axios.post(`${API_BASE}/manual/batch`, req);
    return res.data; // expects {status: ok, commands: {...}}
};

export const fetchJobPreview = async (pairs: SyncPair[]) => {
    const res = await axios.post(`${API_BASE}/jobs/preview`, { pairs, dry_run: false });
    return res.data; // [{pair, context, command}]
};

// --- BATCH SAVE ---
export interface SaveBatchRequest {
    filename: string;
    commands: Record<string, string>;
    include_header?: boolean;
    random_order?: boolean;
}

export interface BatchFile {
    name: string;
    size: number;
    modified: number;
    user_count?: number;
    sync_pair?: { id?: string; source: string; dest: string };
    random_order?: boolean;
}

export const saveBatch = async (req: SaveBatchRequest) => {
    const res = await axios.post(`${API_BASE}/manual/batch/save`, req);
    return res.data;
};

export const listSavedBatches = async (): Promise<BatchFile[]> => {
    const res = await axios.get(`${API_BASE}/manual/batch/list`);
    return res.data.files;
};

export const getBatchFile = async (filename: string) => {
    const res = await axios.get(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}`);
    return res.data;
};

export interface BatchUsersResponse {
    filename: string;
    users: string[];
    count: number;
    domain: string | null;
}

export const getBatchUsers = async (filename: string): Promise<BatchUsersResponse> => {
    const res = await axios.get(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}/users`);
    return res.data;
};

export const pushBatch = async (filename: string, serverId: string) => {
    const res = await axios.post(`${API_BASE}/batch/${encodeURIComponent(filename)}/push`, { server_id: serverId });
    return res.data;
};

export const updateBatchContent = async (filename: string, content: string) => {
    const res = await axios.patch(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}`, { content });
    return res.data;
};

export const checkBatchRemote = async (filename: string, serverId: string) => {
    const res = await axios.post(`${API_BASE}/batch/${encodeURIComponent(filename)}/check`, { server_id: serverId });
    return res.data;
};

export const pullBatch = async (filename: string, serverId: string) => {
    const res = await axios.post(`${API_BASE}/batch/${encodeURIComponent(filename)}/pull`, { server_id: serverId });
    return res.data;
};

export const deleteBatchRemote = async (filename: string, serverId: string) => {
    const res = await axios.delete(`${API_BASE}/batch/${encodeURIComponent(filename)}/remote?server_id=${serverId}`);
    return res.data;
};

export const deleteBatchLocal = async (filename: string) => {
    const res = await axios.delete(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}`);
    return res.data;
};

export const regenerateBatch = async (filename: string, randomOrder: boolean, selectedUsers?: string[], allUsers: boolean = false, pairId?: string) => {
    const res = await axios.post(`${API_BASE}/manual/batch/${encodeURIComponent(filename)}/regenerate`, {
        random_order: randomOrder,
        selected_users: selectedUsers && selectedUsers.length > 0 ? selectedUsers : undefined,
        all_users: allUsers,
        pair_id: pairId
    });
    return res.data;
};

export interface BatchCompareRequest {
    filename: string;
    domain?: string;
    compare_users?: string[];
}

export interface BatchCompareResponse {
    filename: string;
    batch_count: number;
    compare_count: number;
    in_batch_only: string[];
    in_compare_only: string[];
    in_both: string[];
    batch_coverage: number;
}

export const compareBatchUsers = async (req: BatchCompareRequest): Promise<BatchCompareResponse> => {
    const res = await axios.post(`${API_BASE}/manual/batch/compare`, req);
    return res.data;
};

// --- Random Batch Generation ---
export interface RandomBatchRequest {
    pairs: SyncPair[];
    user_count?: number;
    domains: string[];
    dry_run: boolean;
    random_order: boolean;
}

export interface RandomBatchResponse {
    status: string;
    commands: Record<string, string>;
    selected_users: string[];
    user_count: number;
    domains_queried: string[];
}

export const generateRandomBatch = async (req: RandomBatchRequest): Promise<RandomBatchResponse> => {
    const res = await axios.post(`${API_BASE}/manual/batch/generate-random`, req);
    return res.data;
};

// --- User Summary ---
export interface UserSummaryResponse {
    users: Record<string, string[]>;
    batches: string[];
    total_users: number;
    total_batches: number;
}

export const getUserBatchSummary = async (): Promise<UserSummaryResponse> => {
    const res = await axios.get(`${API_BASE}/manual/batch/user-summary`);
    return res.data;
};

// --- BATCH GROUPS ---
export interface BatchGroup {
    id: string;
    name: string;
    description: string;
    batch_files: string[];
    created_at: string;
    updated_at: string;
    batch_details?: {
        name: string;
        exists: boolean;
        size: number;
        modified: number | null;
    }[];
}

export interface BatchGroupCreate {
    name: string;
    description?: string;
    batch_files?: string[];
}

export interface BatchGroupUpdate {
    name?: string;
    description?: string;
    batch_files?: string[];
}

export const listBatchGroups = async (): Promise<BatchGroup[]> => {
    const res = await axios.get(`${API_BASE}/batch-groups`);
    return res.data;
};

export const createBatchGroup = async (req: BatchGroupCreate): Promise<BatchGroup> => {
    const res = await axios.post(`${API_BASE}/batch-groups`, req);
    return res.data.group;
};

export const getBatchGroup = async (groupId: string): Promise<BatchGroup> => {
    const res = await axios.get(`${API_BASE}/batch-groups/${groupId}`);
    return res.data;
};

export const updateBatchGroup = async (groupId: string, req: BatchGroupUpdate): Promise<BatchGroup> => {
    const res = await axios.put(`${API_BASE}/batch-groups/${groupId}`, req);
    return res.data.group;
};

export const deleteBatchGroup = async (groupId: string): Promise<void> => {
    await axios.delete(`${API_BASE}/batch-groups/${groupId}`);
};

export const reorderBatchGroup = async (groupId: string, batchFiles: string[]): Promise<BatchGroup> => {
    const res = await axios.post(`${API_BASE}/batch-groups/${groupId}/reorder`, { batch_files: batchFiles });
    return res.data.group;
};

export interface GeneratedGroupScript {
    status: string;
    filename: string;
    path: string;
    content: string;
    batch_count: number;
}

export const generateGroupScript = async (groupId: string): Promise<GeneratedGroupScript> => {
    const res = await axios.post(`${API_BASE}/batch-groups/${groupId}/generate`);
    return res.data;
};

export const getGroupScript = async (groupId: string) => {
    const res = await axios.get(`${API_BASE}/batch-groups/${groupId}/script`);
    return res.data;
};

export const pushBatchGroup = async (groupId: string, serverId: string) => {
    const res = await axios.post(`${API_BASE}/batch-groups/${groupId}/push`, { server_id: serverId });
    return res.data;
};

export const checkGroupRemote = async (groupId: string, serverId: string) => {
    const res = await axios.post(`${API_BASE}/batch-groups/${groupId}/check`, { server_id: serverId });
    return res.data;
};

export const pullGroupRemote = async (groupId: string, serverId: string) => {
    const res = await axios.post(`${API_BASE}/batch-groups/${groupId}/pull`, { server_id: serverId });
    return res.data;
};

export const deleteGroupRemote = async (groupId: string, serverId: string) => {
    const res = await axios.delete(`${API_BASE}/batch-groups/${groupId}/remote?server_id=${serverId}`);
    return res.data;
};

// --- CRONTAB ---
export interface CronPreset {
    name: string;
    expression: string;
}

export interface CrontabEntry {
    id: string;
    command_type: string;
    command_name: string;
    cron_expression: string;
    annotation: string;
    enabled: boolean;
}

export interface CrontabEntryCreate {
    command_type: string;
    command_name: string;
    cron_expression: string;
    annotation?: string;
    enabled?: boolean;
}

export interface CrontabConfig {
    server_id: string;
    server_name: string;
    entries: CrontabEntry[];
    last_pushed_at?: string;
    last_pulled_at?: string;
}

export const getCronPresets = async (): Promise<{ presets: CronPreset[] }> => {
    const res = await axios.get(`${API_BASE}/crontab/presets`);
    return res.data;
};

export const listCrontabServers = async () => {
    const res = await axios.get(`${API_BASE}/crontab/servers`);
    return res.data;
};

export const getServerCrontab = async (serverId: string): Promise<CrontabConfig> => {
    const res = await axios.get(`${API_BASE}/crontab/servers/${serverId}`);
    return res.data;
};

export const initServerCrontab = async (serverId: string, serverName: string) => {
    const res = await axios.post(`${API_BASE}/crontab/servers/${serverId}/init?server_name=${encodeURIComponent(serverName)}`);
    return res.data;
};

export const addCrontabEntry = async (serverId: string, entry: CrontabEntryCreate) => {
    const res = await axios.post(`${API_BASE}/crontab/servers/${serverId}/entries`, entry);
    return res.data;
};

export const updateCrontabEntry = async (serverId: string, entryId: string, entry: Partial<CrontabEntryCreate>) => {
    const res = await axios.put(`${API_BASE}/crontab/servers/${serverId}/entries/${entryId}`, entry);
    return res.data;
};

export const deleteCrontabEntry = async (serverId: string, entryId: string) => {
    await axios.delete(`${API_BASE}/crontab/servers/${serverId}/entries/${entryId}`);
};

export interface GeneratedCrontab {
    status: string;
    server_id: string;
    server_name: string;
    content: string;
    entry_count: number;
}

export const generateCrontabFile = async (serverId: string): Promise<GeneratedCrontab> => {
    const res = await axios.post(`${API_BASE}/crontab/servers/${serverId}/generate`);
    return res.data;
};

export const deleteServerCrontab = async (serverId: string) => {
    await axios.delete(`${API_BASE}/crontab/servers/${serverId}`);
};

export const installCrontab = async (serverId: string) => {
    const res = await axios.post(`${API_BASE}/crontab/servers/${serverId}/install`);
    return res.data;
};

// --- PROFILES ---
export const listProfiles = async (): Promise<string[]> => {
    const res = await axios.get(`${API_BASE}/profiles`);
    return res.data;
};

export const loadProfile = async (filename: string) => {
    const res = await axios.post(`${API_BASE}/profiles/load`, { filename });
    return res.data.config;
};

export const saveProfile = async (filename: string) => {
    return axios.post(`${API_BASE}/profiles/save`, { filename });
};

export const resetProfile = async () => {
    return axios.post(`${API_BASE}/profiles/reset`);
};

// --- OPS (SSH / BACKUP / SYNC) ---
export const testSSH = async (req: SSHRequest) => {
    const res = await axios.post(`${API_BASE}/ops/ssh/test`, req);
    return res.data;
};

export const approveSSH = async (req: SSHRequest) => {
    const res = await axios.post(`${API_BASE}/ops/ssh/approve`, req);
    return res.data;
};

export const createBackup = async () => {
    const res = await axios.post(`${API_BASE}/ops/backup`);
    return res.data; // {status: success, file: ...}
};

export const syncPush = async (req: SSHRequest) => {
    const res = await axios.post(`${API_BASE}/ops/sync/push`, req);
    return res.data;
};

export const syncPull = async (req: SSHRequest) => {
    const res = await axios.post(`${API_BASE}/ops/sync/pull`, req);
    return res.data;
};

export const syncDiff = async (req: SSHRequest) => {
    const res = await axios.post(`${API_BASE}/ops/sync/diff`, req);
    return res.data; // {diffs: {filename: content...}}
};
// --- BULK USER OPS ---
export const testDomainAuth = async () => {
    const res = await axios.post(`${API_BASE}/ops/auth/test`);
    return res.data;
};

export const listDomainUsers = async (domain: string) => {
    const res = await axios.get(`${API_BASE}/ops/users/${domain}`);
    return res.data; // {domain, count, users: []}
};

export interface BulkOpRequest {
    action: 'verify' | 'unsuspend' | 'delete' | 'protect' | 'add_to_group';
    domain: string;
    users: string[];
}

export const bulkUserOps = async (req: BulkOpRequest) => {
    const res = await axios.post(`${API_BASE}/ops/users/bulk`, req);
    return res.data; // {email: status...}
};

// --- SCHEDULES ---
export interface Schedule {
    id: string;
    name: string;
    source: string;
    dest: string;
    cron_expression: string;
    domain_reference: string | null;
    dry_run: boolean;
    enabled: boolean;
    created_at: string | null;
    last_run: string | null;
    next_run: string | null;
}

export interface CreateScheduleRequest {
    name: string;
    source: string;
    dest: string;
    cron_expression: string;
    dry_run?: boolean;
}

export const fetchSchedules = async (): Promise<{ schedules: Schedule[]; error?: string }> => {
    const res = await axios.get(`${API_BASE}/schedules`);
    return res.data;
};

export const createSchedule = async (req: CreateScheduleRequest) => {
    const res = await axios.post(`${API_BASE}/schedules`, req);
    return res.data;
};

export const deleteSchedule = async (id: string) => {
    const res = await axios.delete(`${API_BASE}/schedules/${id}`);
    return res.data;
};

export const pauseSchedule = async (id: string) => {
    const res = await axios.post(`${API_BASE}/schedules/${id}/pause`);
    return res.data;
};

export const resumeSchedule = async (id: string) => {
    const res = await axios.post(`${API_BASE}/schedules/${id}/resume`);
    return res.data;
};

// --- JOB HISTORY ---
export interface JobRun {
    id: number;
    source: string;
    dest: string;
    domain_reference: string | null;
    started_at: string | null;
    ended_at: string | null;
    status: string;
    error_message: string | null;
    total_bytes_transferred: number;
    users_processed: number;
    dry_run: boolean;
}

export interface JobLog {
    id: number;
    timestamp: string;
    level: string;
    message: string;
    user_email: string | null;
}

export const fetchJobHistory = async (limit = 50, offset = 0): Promise<{ runs: JobRun[] }> => {
    const res = await axios.get(`${API_BASE}/jobs/history`, { params: { limit, offset } });
    return res.data;
};

export const fetchJobLogs = async (runId: number, limit = 500): Promise<{ logs: JobLog[] }> => {
    const res = await axios.get(`${API_BASE}/jobs/history/${runId}/logs`, { params: { limit } });
    return res.data;
};

// --- SSH SERVER MANAGEMENT ---
export interface SSHServer {
    id: string;
    name: string;
    alias?: string;
    host?: string;
    port: number;
    user?: string;
    key_path?: string;
    remote_path: string;
    is_default: boolean;
}

export interface SSHServerStatus {
    status: string;
    connected: boolean;
    path_exists?: boolean;
    tmux_session?: boolean;
    backend_running?: boolean;
    frontend_running?: boolean;
    backend_healthy?: boolean;
    isync_running?: boolean;
    message?: string;
}

export const fetchSSHServers = async (): Promise<SSHServer[]> => {
    const res = await axios.get(`${API_BASE}/ssh/servers`);
    return res.data;
};

export const addSSHServer = async (server: Omit<SSHServer, 'id'>): Promise<SSHServer> => {
    const res = await axios.post(`${API_BASE}/ssh/servers`, server);
    return res.data.server;
};

export const updateSSHServer = async (id: string, server: Partial<SSHServer>): Promise<SSHServer> => {
    const res = await axios.put(`${API_BASE}/ssh/servers/${id}`, server);
    return res.data.server;
};

export const deleteSSHServer = async (id: string): Promise<void> => {
    await axios.delete(`${API_BASE}/ssh/servers/${id}`);
};

export const testSSHServer = async (id: string): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/ssh/servers/${id}/test`);
    return res.data;
};

export const getSSHServerStatus = async (id: string): Promise<SSHServerStatus> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${id}/status`);
    return res.data;
};

export const startRemoteISync = async (id: string): Promise<{ status: string; message: string; action?: string }> => {
    const res = await axios.post(`${API_BASE}/ssh/servers/${id}/start`);
    return res.data;
};

export const stopRemoteISync = async (id: string): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/ssh/servers/${id}/stop`);
    return res.data;
};

export const restartRemoteISync = async (id: string): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/ssh/servers/${id}/restart`);
    return res.data;
};

export interface DeployOptions {
    install_deps?: boolean;
    sync_config?: boolean;
    sync_keys?: boolean;
}

export interface DeployResult {
    status: string;
    message: string;
    steps_completed: string[];
    errors?: string[];
    remote_path?: string;
}

export const deployISync = async (id: string, options: DeployOptions = {}): Promise<DeployResult> => {
    const res = await axios.post(`${API_BASE}/ssh/servers/${id}/deploy`, {
        install_deps: options.install_deps ?? true,
        sync_config: options.sync_config ?? true,
        sync_keys: options.sync_keys ?? false
    });
    return res.data;
};

// --- LOCAL ADMIN CONTROLS ---
export interface LocalStatus {
    backend: boolean;
    frontend: boolean;
    pid_backend: string | null;
    pid_frontend: string | null;
}

export const getLocalStatus = async (): Promise<LocalStatus> => {
    const res = await axios.get(`${API_BASE}/admin/status`);
    return res.data;
};

export const restartBackend = async (): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/admin/restart/backend`);
    return res.data;
};

export const restartFrontend = async (): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/admin/restart/frontend`);
    return res.data;
};

export const restartAll = async (): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/admin/restart/all`);
    return res.data;
};

// --- ORCHESTRATOR ---
export interface ServerFile {
    name: string;
    path: string;
    size: number;
    modified: number;
    server_specific?: boolean;
}

export interface ServerFilesResponse {
    rclone: ServerFile[];
    keys: ServerFile[];
    batch: ServerFile[];
    cron: ServerFile[];
    scripts: ServerFile[];
}

export const listServerFiles = async (): Promise<ServerFilesResponse> => {
    const res = await axios.get(`${API_BASE}/orchestrator/files`);
    return res.data;
};

export const getServerFileContent = async (fileType: string, filename: string): Promise<{ path: string; content: string }> => {
    const res = await axios.get(`${API_BASE}/orchestrator/files/${fileType}/${filename}`);
    return res.data;
};

export const saveServerFileContent = async (fileType: string, filename: string, content: string): Promise<{ status: string; path: string }> => {
    const res = await axios.post(`${API_BASE}/orchestrator/files/${fileType}/${filename}`, { path: '', content });
    return res.data;
};

export interface PushPreviewItem {
    type: string;
    name: string;
    size: number;
    local_path: string;
}

export interface PushPreview {
    server_id: string;
    server_name: string;
    files: PushPreviewItem[];
    total_size: number;
}

export const getFilePushPreview = async (serverIds: string[], fileTypes: string[]): Promise<{ previews: PushPreview[] }> => {
    const res = await axios.post(`${API_BASE}/orchestrator/files/preview`, { server_ids: serverIds, file_types: fileTypes });
    return res.data;
};

export interface PushResult {
    server_id: string;
    server_name: string;
    files_pushed: { type: string; local?: string; remote?: string; output?: string; source?: string }[];
    errors: { type: string; error: string }[];
    success: boolean;
    dry_run: boolean;
}

export const pushFilesToServers = async (serverIds: string[], fileTypes: string[], dryRun: boolean = false): Promise<{ status: string; total: number; success: number; results: PushResult[] }> => {
    const res = await axios.post(`${API_BASE}/orchestrator/files/push`, { server_ids: serverIds, file_types: fileTypes, dry_run: dryRun });
    return res.data;
};

// --- PULL FILES / BACKUPS ---
export interface PullResult {
    server_id: string;
    server_name: string;
    backup_name: string;
    backup_dir: string;
    files_pulled: { type: string; remote?: string; local: string; output: string }[];
    errors: { type: string; error: string }[];
    success: boolean;
}

export const pullFilesFromServers = async (
    serverIds: string[],
    fileTypes: string[],
    backupName?: string
): Promise<{ status: string; total: number; success: number; results: PullResult[] }> => {
    const res = await axios.post(`${API_BASE}/orchestrator/files/pull`, {
        server_ids: serverIds,
        file_types: fileTypes,
        backup_name: backupName
    });
    return res.data;
};

export interface Backup {
    name: string;
    path: string;
    modified: number;
    file_count: number;
}

export const listBackups = async (): Promise<{ backups: Backup[] }> => {
    const res = await axios.get(`${API_BASE}/orchestrator/backups`);
    return res.data;
};

// --- SERVER VERIFICATION ---
export interface RemotesStatus {
    status: string;
    rclone_installed: boolean;
    remotes: string[];
    count: number;
}

export const getServerRemotes = async (serverId: string): Promise<RemotesStatus> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/remotes`);
    return res.data;
};

export interface MountInfo {
    device: string;
    mountpoint: string;
    type: string;
}

export interface MountsStatus {
    status: string;
    mounts: MountInfo[];
    count: number;
}

export const getServerMounts = async (serverId: string): Promise<MountsStatus> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/mounts`);
    return res.data;
};

export interface FilesStatus {
    status: string;
    path_exists: boolean;
    rclone_conf: boolean;
    keys_list: string[];
    keys_count: number;
    groups_list: string[];
    groups_count: number;
    batch_count: number;
    runner_exists: boolean;
    cron_entries: number;
}

export const getServerFiles = async (serverId: string): Promise<FilesStatus> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/files`);
    return res.data;
};

export interface BatchStatus {
    status: string;
    running: boolean;
    processes: string[];
    batch_files_list: string[];
    batch_count: number;
}

export const getServerBatchStatus = async (serverId: string): Promise<BatchStatus> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/batch`);
    return res.data;
};

export interface FullVerification {
    server_id: string;
    server_name: string;
    connected: boolean;
    status: string;
    rclone?: RemotesStatus;
    mounts?: MountsStatus;
    files?: FilesStatus;
    batch?: BatchStatus;
    cron?: {
        status: string;
        has_crontab: boolean;
        content: string;
        entries_list: string[];
        entries_count: number;
    };
}

export const verifyServer = async (serverId: string): Promise<FullVerification> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/verify`);
    return res.data;
};

// --- CRONJOB MANAGEMENT ---
export interface CronInfo {
    remote: { status: string; has_crontab: boolean; content: string };
    local_template: { content: string; source: string };
}

export const getServerCron = async (serverId: string): Promise<CronInfo> => {
    const res = await axios.get(`${API_BASE}/ssh/servers/${serverId}/cron`);
    return res.data;
};

export const deployServerCron = async (serverId: string, content: string, saveAsTemplate: boolean = false): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/ssh/servers/${serverId}/cron`, { content, save_as_template: saveAsTemplate });
    return res.data;
};

export const clearServerCron = async (serverId: string): Promise<{ status: string; message: string }> => {
    const res = await axios.delete(`${API_BASE}/ssh/servers/${serverId}/cron`);
    return res.data;
};

// --- CRON TEMPLATES ---
export interface CronTemplate {
    id: string;
    name: string;
    path: string;
    server_specific: boolean;
}

export const listCronTemplates = async (): Promise<{ templates: CronTemplate[] }> => {
    const res = await axios.get(`${API_BASE}/orchestrator/cron/templates`);
    return res.data;
};

export const getCronTemplate = async (templateId: string): Promise<{ id: string; content: string; source: string }> => {
    const res = await axios.get(`${API_BASE}/orchestrator/cron/templates/${templateId}`);
    return res.data;
};

export const saveCronTemplate = async (templateId: string, content: string, isDefault: boolean = false): Promise<{ status: string; id: string }> => {
    const res = await axios.post(`${API_BASE}/orchestrator/cron/templates/${templateId}`, { content, is_default: isDefault });
    return res.data;
};

// --- MULTI-SERVER BATCH STATUS ---
export interface ServerBatchInfo {
    server_id: string;
    server_name: string;
    batch_running: boolean;
    processes: string[];
}

export const getBatchStatusForServers = async (serverIds: string[]): Promise<{ results: ServerBatchInfo[] }> => {
    const res = await axios.post(`${API_BASE}/orchestrator/batch-status`, serverIds);
    return res.data;
};

// --- DRIVE MANAGER ---
export interface CreateDrivesRequest {
    gdrive_remote: string;
    member_template?: string;
    base_name: string;
    suffixes: string[];
    delay_seconds?: number;
}

export interface CreateDrivesResponse {
    status: string;
    created: (string | any)[];
    failed: { name: string; error: string }[];
    logs: string[];
    message?: string;
}

export interface DriveInfo {
    name: string;
    id: string;
    hidden?: boolean;
}

export interface ListDrivesResponse {
    status: string;
    drives: DriveInfo[];
    count: number;
    message?: string;
}

export interface CreateRemotesRequest {
    remotes: { name: string; team_drive_id: string }[];
    sa_dir: string;
    start_count?: number;
}

export interface CreateRemotesResponse {
    status: string;
    created: string[];
    failed: { name: string; error: string }[];
    logs: string[];
}

export interface CreateUnionRequest {
    name: string;
    upstreams: string[];
    action_policy?: string;
    create_policy?: string;
    sa_file_path?: string;
}

export interface CreateUnionResponse {
    status: string;
    name: string;
    upstreams?: string[];
    message: string;
}

export interface GenerateSuffixesRequest {
    start?: number;
    count?: number;
    increment?: number;
    padding?: number;
    prefix?: string;
}

export interface KeyInfo {
    name: string;
    path: string;
    size: number;
}

export const createSharedDrives = async (req: CreateDrivesRequest): Promise<CreateDrivesResponse> => {
    const res = await axios.post(`${API_BASE}/drives/shared`, req);
    return res.data;
};

export const listDrives = async (gdriveRemote: string, prefix?: string): Promise<ListDrivesResponse> => {
    const params: any = { gdrive_remote: gdriveRemote };
    if (prefix) params.prefix = prefix;
    const res = await axios.get(`${API_BASE}/drives/list`, { params });
    return res.data;
};

export const createRcloneRemotes = async (req: CreateRemotesRequest): Promise<CreateRemotesResponse> => {
    const res = await axios.post(`${API_BASE}/drives/remotes`, req);
    return res.data;
};

export const createUnionRemote = async (req: CreateUnionRequest): Promise<CreateUnionResponse> => {
    const res = await axios.post(`${API_BASE}/drives/union`, req);
    return res.data;
};

export const generateSuffixes = async (req: GenerateSuffixesRequest): Promise<{ suffixes: string[]; preview: string[] }> => {
    const res = await axios.post(`${API_BASE}/drives/generate-suffixes`, req);
    return res.data;
};

export const listKeys = async (): Promise<{ keys: KeyInfo[]; path: string }> => {
    const res = await axios.get(`${API_BASE}/drives/keys`);
    return res.data;
};

// --- Unified Drive Creation (method selection) ---
export type DriveMethod = 'fclone' | 'google_api';



export interface CreateDrivesUnifiedRequest {
    method: DriveMethod;
    base_name: string;
    suffixes: string[];
    delay_seconds?: number;
    default_managers?: { email: string; role: string }[];
    // fclone-specific
    gdrive_remote?: string;
    member_template?: string;
    // google_api-specific
    service_account_file?: string;
    impersonate_email?: string;
}

export interface MethodAvailability {
    available: boolean;
    message: string;
}

export interface MethodsResponse {
    fclone: MethodAvailability;
    google_api: MethodAvailability;
}

export const createDrivesUnified = async (req: CreateDrivesUnifiedRequest): Promise<CreateDrivesResponse> => {
    const res = await axios.post(`${API_BASE}/drives/create`, req);
    return res.data;
};

export interface ListDrivesUnifiedRequest {
    method: DriveMethod;
    prefix?: string;
    // fclone-specific
    gdrive_remote?: string;
    // google_api-specific
    service_account_file?: string;
    impersonate_email?: string;
    limit?: number;
}

export const listDrivesUnified = async (req: ListDrivesUnifiedRequest): Promise<ListDrivesResponse> => {
    const res = await axios.post(`${API_BASE}/drives/list-unified`, req);
    return res.data;
};

export const checkDriveMethods = async (): Promise<MethodsResponse> => {
    const res = await axios.get(`${API_BASE}/drives/methods`);
    return res.data;
};


// --- Rclone Connection Testing ---
export interface TestConnectionResponse {
    status: 'ok' | 'error' | 'partial';
    message: string;
    basic: boolean;
    advanced?: boolean | null;
}

export const testRcloneConnection = async (remoteName: string, advanced: boolean = false): Promise<TestConnectionResponse> => {
    const res = await axios.post(`${API_BASE}/rclone/test-connection`, { remote_name: remoteName, advanced });
    return res.data;
};


// --- Create Drive Remote ---
export interface CreateDriveRemoteRequest {
    name: string;
    drive_id: string;
    service_account_file: string;
    scope?: string;
}

export const createDriveRemote = async (req: CreateDriveRemoteRequest): Promise<{ status: string; remote: string }> => {
    const res = await axios.post(`${API_BASE}/drives/remote/create`, req);
    return res.data;
};


// --- Create Union Remote ---
export interface CreateUnionRemoteRequest {
    name: string;
    upstreams: string[];
    action_policy?: string;
    create_policy?: string;
}

export const createUnionRemoteDirect = async (req: CreateUnionRemoteRequest): Promise<{ status: string; remote: string; upstreams: string[] }> => {
    // Map Frontend definition to Backend definition
    const payload = {
        name: req.name,
        upstreams: req.upstreams,
        action_policy: req.action_policy,
        create_policy: req.create_policy
    };
    const res = await axios.post(`${API_BASE}/drives/union`, payload);
    return res.data;
};


// --- Add Group Managers to Drive ---
export interface AddManagersRequest {
    drive_id: string;
    service_account_file: string;
    impersonate_email: string;
    group_emails: string[];
    role?: string;
}

export interface AddManagersResponse {
    status: 'ok' | 'partial' | 'error';
    drive_id?: string;
    added: string[];
    failed: { email: string; error: string }[];
    message?: string;
}

export const addDriveManagers = async (req: AddManagersRequest): Promise<AddManagersResponse> => {
    const res = await axios.post(`${API_BASE}/drives/add-managers`, req);
    return res.data;
};


// --- List Known Groups ---
export const listKnownGroups = async (): Promise<{ groups: string[] }> => {
    const res = await axios.get(`${API_BASE}/drives/groups`);
    return res.data;
};


// --- Union Remote Operations ---

export interface UnionDrive {
    remote_name: string;
    type: string;
    team_drive: string;
    scope: string;
    service_account_file: string;
}

export interface UnionDetails {
    name: string;
    type: string;
    upstreams: string[];
    action_policy: string;
    create_policy: string;
    service_account_file: string;
    drives: UnionDrive[];
}

export interface UnionInfo {
    name: string;
    upstream_count: number;
    upstreams: string[];
}

export const listUnionRemotes = async (): Promise<{ unions: UnionInfo[] }> => {
    const res = await axios.get(`${API_BASE}/rclone/unions`);
    return res.data;
};

export const getUnionDetails = async (name: string): Promise<UnionDetails> => {
    const res = await axios.get(`${API_BASE}/rclone/union/${encodeURIComponent(name)}/details`);
    return res.data;
};

export interface ExpandUnionResponse {
    status: string;
    name: string;
    previous_upstreams: string[];
    new_upstreams: string[];
    updated_upstreams: string[];
}

export const expandUnion = async (name: string, newUpstreams: string[]): Promise<ExpandUnionResponse> => {
    const res = await axios.put(`${API_BASE}/rclone/union/${encodeURIComponent(name)}/expand`, {
        new_upstreams: newUpstreams
    });
    return res.data;
};


export interface RenameDriveRequest {
    drive_id: string;
    new_name: string;
    method?: string;
    service_account_file?: string;
    impersonate_email?: string;
}

export const renameDrive = async (req: RenameDriveRequest) => {
    const res = await axios.post(`${API_BASE}/drives/rename`, req);
    return res.data;
};

export interface DeleteDriveRequest {
    drive_id: string;
    method?: string;
    service_account_file?: string;
    impersonate_email?: string;
}

export const deleteDrive = async (req: DeleteDriveRequest) => {
    const res = await axios.post(`${API_BASE}/drives/delete`, req);
    return res.data;
};

export interface DriveDetails {
    id: string;
    name: string;
    kind: string;
    createdTime?: string;
    orgUnitId?: string;
    permissions?: {
        email: string;
        role: string;
        type: string;
        name?: string;
    }[];
}

export const getDriveDetails = async (
    driveId: string,
    serviceAccountFile?: string,
    impersonateEmail?: string
): Promise<{ status: string; drive?: DriveDetails; permissions?: any[]; message?: string }> => {
    const res = await axios.get(`${API_BASE}/drives/${driveId}/details`, {
        params: {
            method: 'google_api',
            service_account_file: serviceAccountFile,
            impersonate_email: impersonateEmail
        }
    });
    return res.data;
};


// --- Remote Flags (Ignore/Protect) Management ---

export interface RemoteFlags {
    ignored: string[];
    protected: string[];
}

export const getRemoteFlags = async (): Promise<RemoteFlags> => {
    const res = await axios.get(`${API_BASE}/rclone/remote-flags`);
    return res.data;
};

export const updateRemoteFlags = async (flags: RemoteFlags): Promise<{ status: string; flags: RemoteFlags }> => {
    const res = await axios.put(`${API_BASE}/rclone/remote-flags`, flags);
    return res.data;
};

export const addRemoteFlag = async (remoteName: string, flagType: 'ignored' | 'protected'): Promise<{ status: string; flags: RemoteFlags }> => {
    const res = await axios.post(`${API_BASE}/rclone/remote-flags/add`, null, {
        params: { remote_name: remoteName, flag_type: flagType }
    });
    return res.data;
};

export const removeRemoteFlag = async (remoteName: string, flagType: 'ignored' | 'protected'): Promise<{ status: string; flags: RemoteFlags }> => {
    const res = await axios.post(`${API_BASE}/rclone/remote-flags/remove`, null, {
        params: { remote_name: remoteName, flag_type: flagType }
    });
    return res.data;
};


// --- Batch Connection Testing ---

export interface BatchTestResult {
    name: string;
    status: 'ok' | 'error';
    message: string;
}

export interface BatchTestResponse {
    total: number;
    ok: number;
    failed: number;
    results: BatchTestResult[];
}

export const testBatchConnections = async (remoteNames: string[], serverId?: string): Promise<BatchTestResponse> => {
    const res = await axios.post(`${API_BASE}/rclone/test-batch`, {
        remote_names: remoteNames,
        server_id: serverId
    });
    return res.data;
};


// --- Remote with Flags ---

export interface RemoteWithFlags {
    name: string;
    type: string;
    status: 'normal' | 'ignored' | 'protected';
    config: Record<string, string>;
}

export interface RemotesWithFlagsResponse {
    remotes: RemoteWithFlags[];
    counts: {
        total: number;
        ignored: number;
        protected: number;
        normal: number;
    };
}

export const listRemotesWithFlags = async (serverId?: string): Promise<RemotesWithFlagsResponse> => {
    const res = await axios.get(`${API_BASE}/rclone/remotes/list-with-flags`, {
        params: serverId ? { server_id: serverId } : undefined
    });
    return res.data;
};

export const deleteRemoteWithConfirm = async (name: string, confirm: boolean = false, serverId?: string): Promise<{ status: string; deleted: string }> => {
    const res = await axios.delete(`${API_BASE}/rclone/remotes/${encodeURIComponent(name)}`, {
        params: { confirm, server_id: serverId }
    });
    return res.data;
};

export const updateLocalRemote = async (name: string, config: any): Promise<any> => {
    const res = await axios.put(`${API_BASE}/rclone/remotes/${encodeURIComponent(name)}`, { config });
    return res.data;
};

export const renameRemote = async (oldName: string, newName: string): Promise<any> => {
    const res = await axios.post(`${API_BASE}/rclone/remotes/${encodeURIComponent(oldName)}/rename`, {
        new_name: newName
    });
    return res.data;
};

export const verifyPath = async (type: 'local' | 'ssh' | 'rclone', path: string, serverId: string = 'local', rcloneRemote?: string): Promise<{ status: string; message: string }> => {
    const res = await axios.post(`${API_BASE}/ssh/verify-path`, {
        type,
        server_id: serverId,
        path,
        rclone_remote: rcloneRemote
    });
    return res.data;
};

export const browseRcloneContent = async (remoteName: string, path: string, serverId: string = 'local'): Promise<{ status: string; dirs: string[] }> => {
    const res = await axios.post(`${API_BASE}/rclone/browse`, {
        server_id: serverId,
        remote_name: remoteName,
        path
    });
    return res.data;
};

// --- Key Manager ---

export interface KeyInfo {
    filename: string;
    path: string;
    project_id?: string;
    client_email?: string;
    private_key_id?: string;
    client_id?: string;
    admin_email?: string;
    valid_json: boolean;
    error?: string;
}

export interface KeyInspection {
    filename: string;
    roles: string[];
    permissions: string[];
    dwd_enabled?: boolean;
    dwd_verified?: boolean;
    dwd_scopes?: string[];
    status: string;
    details?: string;
}

export const listJSONKeys = async (): Promise<KeyInfo[]> => {
    const res = await axios.get(`${API_BASE}/keys`);
    return res.data;
};

export const inspectJSONKey = async (filename: string, admin_email?: string): Promise<KeyInspection> => {
    const res = await axios.post(`${API_BASE}/keys/${filename}/inspect`, { admin_email });
    return res.data;
};

export const deleteJSONKey = async (filename: string): Promise<void> => {
    await axios.delete(`${API_BASE}/keys/${filename}`);
};

export interface KeyAttributes {
    filename: string;
    attributes: Record<string, any>;
    status: string;
    details?: string;
}

export const extractKeyAttributes = async (filename: string): Promise<KeyAttributes> => {
    const res = await axios.post(`${API_BASE}/keys/${filename}/attributes`);
    return res.data;
};

// --- Workspace Manager ---

// Domain information with verification status
export interface WorkspaceDomain {
    domain_name: string;
    is_primary: boolean;
    verified: boolean;
    creation_time?: string;
}

// Domain alias information
export interface WorkspaceDomainAlias {
    alias: string;
    parent_domain: string;
    verified: boolean;
    creation_time?: string;
}

// Admin user information
export interface WorkspaceAdmin {
    email: string;
    name: string;
    is_delegated: boolean;
    is_super?: boolean;
    last_login?: string;
    suspended?: boolean;
}

// Custom admin role
export interface WorkspaceCustomRole {
    role_name: string;
    role_id: string;
    description: string;
}

export interface WorkspaceMetadata {
    customer_id?: string;
    customer_domain?: string;
    primary_domain?: string;
    org_id?: string;
    domains?: WorkspaceDomain[];
    domain_aliases?: WorkspaceDomainAlias[];
    admins?: WorkspaceAdmin[];
    custom_roles?: WorkspaceCustomRole[];
    customer_creation_time?: string;
    phone_number?: string;
    postal_address?: any;
    language?: string;
    error?: string;
}

// User statistics
export interface WorkspaceUserStats {
    total: number;
    active: number;
    suspended: number;
    archived: number;
    never_logged_in: number;
    active_last_30_days: number;
}

// Group settings
export interface WorkspaceGroupSettings {
    who_can_join?: string;
    who_can_view_membership?: string;
    who_can_view_group?: string;
    who_can_post_message?: string;
    allow_external_members?: boolean;
    is_archived?: boolean;
}

// Group information
export interface WorkspaceGroup {
    id: string;
    email: string;
    name: string;
    description: string;
    direct_members: number;
    admin_created?: boolean;
    settings?: WorkspaceGroupSettings;
}

export interface WorkspaceInventory {
    user_stats?: WorkspaceUserStats;
    groups?: WorkspaceGroup[];
    group_count?: number;
    error?: string;
}

// Storage quota information
export interface WorkspaceQuotaInfo {
    total_quota_mb: number;
    drive_used_mb: number;
    gmail_used_mb: number;
    total_used_mb: number;
}

// Drive activity metrics
export interface WorkspaceDriveActivity {
    items_created: number;
    items_edited: number;
    items_viewed: number;
    items_shared_externally: number;
    items_trashed: number;
}

export interface WorkspaceStorage {
    date?: string;
    usage?: Record<string, number>;
    shared_drive_storage_mb?: number;
    quota_info?: WorkspaceQuotaInfo;
    activity?: WorkspaceDriveActivity;
    status?: string;
    message?: string;
    error?: string;
}

// Shared Drive restrictions
export interface SharedDriveRestrictions {
    domain_users_only?: boolean;
    drive_members_only?: boolean;
    copy_requires_writer?: boolean;
    admin_managed_restrictions?: boolean;
    sharing_folders_requires_organizer?: boolean;
}

// Shared Drive permission
export interface SharedDrivePermission {
    id: string;
    type: string;  // user, group, domain, anyone
    email?: string;
    role: string;  // organizer, fileOrganizer, writer, commenter, reader
    display_name?: string;
    deleted?: boolean;
}

// Shared Drive organizer
export interface SharedDriveOrganizer {
    email?: string;
    name?: string;
    type: string;
}

// Permission summary counts
export interface SharedDrivePermissionSummary {
    organizers: number;
    file_organizers: number;
    writers: number;
    commenters: number;
    readers: number;
}

// Shared Drive information
export interface SharedDriveInfo {
    id: string;
    name: string;
    created_time?: string;
    hidden?: boolean;
    theme_id?: string;
    restrictions?: SharedDriveRestrictions;
    permissions?: SharedDrivePermission[];
    organizers?: SharedDriveOrganizer[];
    permission_count?: number;
    permission_summary?: SharedDrivePermissionSummary;
    permissions_error?: string;
    createdTime?: string; // Legacy compatibility
    size_bytes?: number;
    file_count?: number;
    last_scanned?: string;
}

// Shared Drives summary stats
export interface SharedDrivesSummary {
    total_drives: number;
    restricted_to_domain: number;
    open_to_external: number;
    total_organizers: number;
    hidden_drives: number;
}

export interface WorkspaceDrives {
    drives?: SharedDriveInfo[];
    count?: number;
    summary?: SharedDrivesSummary;
    error?: string;
}

// Auth & Authorization check result
export interface WorkspaceAuthCheck {
    name: string;
    status: 'active' | 'failed';
    error: string | null;
}

// Auth & Authorization information
export interface WorkspaceAuth {
    service_account_email: string;
    client_id: string;
    project_id: string;
    impersonating: string;
    scopes: string[];
    checks: WorkspaceAuthCheck[];
    error?: string;
}

export interface WorkspaceSummary {
    auth?: WorkspaceAuth;
    metadata: WorkspaceMetadata;
    inventory: WorkspaceInventory;
    storage: WorkspaceStorage;
    drives: WorkspaceDrives;
}

export interface SharedDriveStats {
    id: number;
    drive_id: string;
    name: string;
    size_bytes: number;
    file_count: number;
    last_scanned: string | null;
}

export interface AuditResponse {
    status: string;
    message: string;
}

export const fetchWorkspaceMetadata = async (domain: string): Promise<WorkspaceMetadata> => {
    const res = await axios.get(`${API_BASE}/workspace/metadata`, { params: { domain } });
    return res.data;
};

export const fetchWorkspaceInventory = async (domain: string): Promise<WorkspaceInventory> => {
    const res = await axios.get(`${API_BASE}/workspace/inventory`, { params: { domain } });
    return res.data;
};

export const fetchWorkspaceStorage = async (domain: string): Promise<WorkspaceStorage> => {
    const res = await axios.get(`${API_BASE}/workspace/storage`, { params: { domain } });
    return res.data;
};

export const fetchWorkspaceDrives = async (domain: string): Promise<WorkspaceDrives> => {
    const res = await axios.get(`${API_BASE}/workspace/shared-drives`, { params: { domain } });
    return res.data;
};

export const fetchWorkspaceSummary = async (domain: string, refresh: boolean = false, quick: boolean = false): Promise<WorkspaceSummary> => {
    const res = await axios.get(`${API_BASE}/workspace/summary`, { params: { domain, refresh, quick } });
    // Handle potential wrapping from backend/cache
    const data = res.data;
    return Array.isArray(data) ? data[0] : data;
};

export interface DomainStats {
    domain: string;
    total_quota_gb: number;
    total_used_gb: number;
    user_count: number;
    group_count: number;
    last_updated: string;
}

export const fetchStorageOverview = async (): Promise<DomainStats[]> => {
    const res = await axios.get(`${API_BASE}/workspace/storage-overview`);
    return res.data;
};

export const fetchSharedDriveStats = async (): Promise<SharedDriveStats[]> => {
    const res = await axios.get(`${API_BASE}/storage/shared-drives-stats`);
    return res.data.drives;
};

export const triggerStorageAudit = async (req: { drive_id?: number, drive_resource_id?: string, drive_name?: string, domain?: string, server_id?: string }): Promise<AuditResponse> => {
    const res = await axios.post(`${API_BASE}/storage/audit`, req);
    return res.data;
};

export const scheduleStorageAudit = async (req: { domain: string, server_id: string, cron_expression: string, name?: string }): Promise<any> => {
    const res = await axios.post(`${API_BASE}/storage/schedule`, req);
    return res.data;
};

export const calculatePathSize = async (req: { path: string, location_type: string, server_id?: string }): Promise<any> => {
    const res = await axios.post(`${API_BASE}/storage/calculate-size`, req);
    return res.data;
};
