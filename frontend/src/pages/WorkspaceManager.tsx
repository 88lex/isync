import { useState, useEffect, useMemo } from 'react';
import {
    Globe, Users, HardDrive, Database, Shield,
    ChevronDown, ChevronRight, RefreshCw, Activity,
    Info, BarChart, CheckCircle, XCircle, AlertTriangle,
    Mail, Lock, Unlock, Eye, EyeOff, UserCheck, UserX,
    Calendar, Building, Crown, Key, Settings, Folder, Trash2, Fingerprint, Search
} from 'lucide-react';
import {
    fetchConfig, Config,
    fetchWorkspaceSummary,
    WorkspaceSummary,
    fetchSharedDriveStats,
    fetchStorageOverview,
    triggerStorageAudit,
    scheduleStorageAudit,
    SSHServer
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { formatBytes } from '../utils/formatters';
import { useIsyncData, useCacheStatus } from '../contexts/IsyncDataContext';
import { CacheStatus } from '../components/CacheStatus';
import { useSortableData } from '../hooks/useSortableData';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useDataTable } from '../hooks/useDataTable';

const WorkspaceManager = () => {
    const { cache, setCached, setLoading: setCacheLoading } = useIsyncData();
    const [config, setConfig] = useState<Config>({});
    const [selectedDomain, setSelectedDomain] = useState<string>('');
    const [isScanning, setIsScanning] = useState(false);
    const [scanningDomains, setScanningDomains] = useState<Set<string>>(new Set());
    const [storageStats, setStorageStats] = useState<any[]>([]);
    const [auditLoading, setAuditLoading] = useState<string | null>(null);
    const [selectedAuditServer, setSelectedAuditServer] = useState<string>("local");
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [scheduleCron, setScheduleCron] = useState("0 2 * * *");

    // Cache Integration
    const workspaceCache = useCacheStatus<WorkspaceSummary>('workspace_summary', selectedDomain || 'none');
    const summary = workspaceCache.data[0] || null;

    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        auth: true,
        identity: true,
        domains: false,
        admins: false,
        inventory: true,
        users: false,
        groups: false,
        storage: true,
        drives: true
    });

    const combinedDrives = useMemo(() => {
        return (summary?.drives?.drives || []).map(drive => {
            const stats = storageStats.find(s => s.drive_id === drive.id);
            return {
                ...drive,
                size_bytes: stats?.size_bytes || 0,
                file_count: stats?.file_count || 0,
                last_scanned: stats?.last_scanned || null,
                db_id: stats?.id
            };
        });
    }, [summary?.drives?.drives, storageStats]);

    const driveColumns = useMemo<ColumnConfig<any>[]>(() => [
        {
            key: 'name',
            header: 'Drive',
            sortable: true,
            filterable: true,
            render: (val, drive) => (
                <div className="flex flex-col min-w-0">
                    <span className="font-bold text-white truncate max-w-[250px]">{val}</span>
                    <span className="text-[10px] text-zinc-600 font-mono truncate">{drive.id}</span>
                </div>
            )
        },
        {
            key: 'domain_only',
            header: 'Access',
            render: (_, drive: any) => (
                <div className="flex items-center gap-1.5">
                    {drive.restrictions?.domain_users_only ? (
                        <span className="flex items-center gap-1 text-[9px] bg-emerald-900/30 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                            <Lock size={10} /> Domain
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-[9px] bg-amber-900/30 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                            <Unlock size={10} /> External
                        </span>
                    )}
                </div>
            )
        },
        {
            key: 'size_bytes',
            header: 'Size',
            sortable: true,
            render: (val) => (
                <span className="font-mono font-bold text-white whitespace-nowrap">{formatBytes(val)}</span>
            )
        },
        {
            key: 'file_count',
            header: 'Files',
            sortable: true,
            render: (val) => (
                <span className="font-mono text-cyan-400">{(val ?? 0).toLocaleString()}</span>
            )
        },
        {
            key: 'last_scanned',
            header: 'Updated',
            sortable: true,
            render: (val) => (
                <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                    {val ? new Date(val).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                </span>
            )
        },
        {
            key: 'audit',
            header: 'Audit',
            render: (_, drive: any) => (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        runStorageAudit(drive);
                    }}
                    disabled={!!auditLoading}
                    className={`p-1.5 rounded border transition-all ${auditLoading === (drive.db_id ? `drive-${drive.db_id}` : `drive-${drive.id}`)
                        ? 'bg-orange-500 text-white border-orange-400'
                        : 'bg-orange-600/10 hover:bg-orange-600/40 text-orange-500 border-orange-500/20 shadow-sm'
                        }`}
                    title="Run Storage Audit"
                >
                    <BarChart size={14} className={auditLoading === (drive.db_id ? `drive-${drive.db_id}` : `drive-${drive.id}`) ? 'animate-pulse' : ''} />
                </button>
            )
        }
    ], [auditLoading]);

    const driveTable = useDataTable({
        data: combinedDrives,
        columns: driveColumns,
        initialSortColumn: 'name',
        filterFn: (item, term) => {
            if (!term) return true;
            const t = term.toLowerCase();
            return item.name.toLowerCase().includes(t) || item.id.toLowerCase().includes(t);
        },
        persistentKey: 'ws_drives'
    });

    const storageOverviewCache = useCacheStatus<any>('storage_overview');

    // Drive detail expansion
    const [expandedDrives, setExpandedDrives] = useState<Set<string>>(new Set());

    useEffect(() => {
        loadData();
    }, []);

    // Auto-fetch storage overview if empty
    useEffect(() => {
        if (!storageOverviewCache.hasData && !storageOverviewCache.isLoading) {
            fetchStorageOverview().then(data => {
                setCached('storage_overview', 'local', data, 'db_cache');
            }).catch(e => console.error("Failed to auto-fetch storage overview", e));
        }
    }, [storageOverviewCache.hasData, storageOverviewCache.isLoading]);

    const loadData = async () => {
        try {
            const cfg = await fetchConfig();
            setConfig(cfg);
            if (!selectedDomain && cfg.domains && cfg.domains.length > 0) {
                setSelectedDomain(cfg.domains[0].domain_name);
            }

            // Fetch storage stats from DB
            const stats = await fetchSharedDriveStats();
            setStorageStats(stats);
        } catch (e) {
            console.error('Failed to load initial data', e);
        }
    };

    const runStorageAudit = async (drive?: any) => {
        let loadKey = 'all';
        if (drive) {
            loadKey = drive.db_id ? `drive-${drive.db_id}` : `drive-${drive.id}`;
        }
        setAuditLoading(loadKey);

        try {
            const payload: any = {
                server_id: selectedAuditServer
            };

            if (drive) {
                if (drive.db_id) {
                    payload.drive_id = drive.db_id;
                } else {
                    payload.drive_resource_id = drive.id;
                    payload.drive_name = drive.name;
                }
            } else {
                payload.domain = selectedDomain;
            }

            const res = await triggerStorageAudit(payload);
            alert(res.message);

            // Refresh stats after a short delay (background task might take time)
            setTimeout(async () => {
                const stats = await fetchSharedDriveStats();
                setStorageStats(stats);
            }, 5000);
        } catch (e: any) {
            alert('Audit failed: ' + e.message);
        } finally {
            setAuditLoading(null);
        }
    };

    const handleCreateSchedule = async () => {
        try {
            const res = await scheduleStorageAudit({
                domain: selectedDomain,
                server_id: selectedAuditServer,
                cron_expression: scheduleCron,
                name: `Storage Audit: ${selectedDomain}`
            });
            alert(`Schedule Created! Next run: ${new Date(res.next_run).toLocaleString()}`);
            setShowScheduleModal(false);
        } catch (e: any) {
            alert('Failed to create schedule: ' + e.message);
        }
    };

    const scanAllDomains = async () => {
        if (!config.domains) return;
        setIsScanning(true);
        const promises = config.domains.map(async (d) => {
            const domain = d.domain_name;
            setCacheLoading('workspace_summary', domain, true);
            try {
                const result = await fetchWorkspaceSummary(domain, true, true);
                setCached('workspace_summary', domain, [result], 'workspace_api');
            } catch (e) {
                console.error(`Failed to fetch ${domain}`, e);
            } finally {
                setCacheLoading('workspace_summary', domain, false);
            }
        });
        await Promise.all(promises);

        // After all scans, update the global storage overview cache
        try {
            const overview = await fetchStorageOverview();
            setCached('storage_overview', 'local', overview, 'db_cache');
        } catch (e) {
            console.error("Failed to update storage overview after scan", e);
        }

        setIsScanning(false);
    };

    const fetchAll = async (domain = selectedDomain, force = false) => {
        if (!domain) return;

        // Skip redundant network scans if we have data or are already loading it.
        // workspaceCache.lastFetched indicates that the backend has a cached version available.
        if (!force && (workspaceCache.hasData || workspaceCache.isLoading || workspaceCache.lastFetched)) {
            console.log(`[WorkspaceManager] Skipping network scan for ${domain} as cache metadata exists.`);
            return;
        }

        console.log(`[WorkspaceManager] Initiating network scan for ${domain}...`);
        setIsScanning(true);
        setCacheLoading('workspace_summary', domain, true);
        try {
            const result = await fetchWorkspaceSummary(domain, force);
            setCached('workspace_summary', domain, [result], 'workspace_api');
        } catch (e) {
            console.error("Failed to fetch workspace data", e);
        } finally {
            setIsScanning(false);
            setCacheLoading('workspace_summary', domain, false);
        }
    };

    const scanSingleDomain = async (domain: string) => {
        setScanningDomains(prev => new Set(prev).add(domain));
        setCacheLoading('workspace_summary', domain, true);
        try {
            const result = await fetchWorkspaceSummary(domain, true);
            setCached('workspace_summary', domain, [result], 'workspace_api');

            // Update storage overview after scan
            const overview = await fetchStorageOverview();
            setCached('storage_overview', 'local', overview, 'db_cache');
        } catch (e) {
            console.error(`Failed to fetch ${domain}`, e);
        } finally {
            setScanningDomains(prev => {
                const next = new Set(prev);
                next.delete(domain);
                return next;
            });
            setCacheLoading('workspace_summary', domain, false);
        }
    };

    useEffect(() => {
        if (selectedDomain) {
            // Only load from cache, don't force refresh on domain selection
            fetchAll(selectedDomain, false);
        }
    }, [selectedDomain]);

    const toggleSection = (id: string) => {
        setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const toggleDriveExpand = (driveId: string) => {
        setExpandedDrives(prev => {
            const next = new Set(prev);
            if (next.has(driveId)) {
                next.delete(driveId);
            } else {
                next.add(driveId);
            }
            return next;
        });
    };

    const SectionHeader = ({
        id,
        title,
        icon: Icon,
        color,
        badge,
        subtitle
    }: {
        id: string,
        title: string,
        icon: any,
        color: string,
        badge?: string | number,
        subtitle?: string
    }) => (
        <button
            onClick={() => toggleSection(id)}
            className={`w-full flex items-center justify-between p-4 bg-zinc-900/40 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/50 ${expandedSections[id] ? '' : 'rounded-b-xl'}`}
        >
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${color}`}>
                    <Icon size={18} className="text-white" />
                </div>
                <div className="flex flex-col items-start">
                    <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
                        {badge !== undefined && (
                            <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] font-bold rounded-full">
                                {badge}
                            </span>
                        )}
                    </div>
                    {subtitle && <span className="text-[10px] text-zinc-500">{subtitle}</span>}
                </div>
            </div>
            <div className="flex items-center gap-4">
                {expandedSections[id] ? <ChevronDown size={20} className="text-zinc-500" /> : <ChevronRight size={20} className="text-zinc-500" />}
            </div>
        </button>
    );

    const SubSectionHeader = ({ id, title, icon: Icon, count }: { id: string, title: string, icon: any, count?: number }) => (
        <button
            onClick={() => toggleSection(id)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900/20 hover:bg-zinc-800/30 transition-colors border-b border-zinc-800/30"
        >
            <div className="flex items-center gap-2 text-sm">
                <Icon size={14} className="text-zinc-400" />
                <span className="text-zinc-300 font-medium">{title}</span>
                {count !== undefined && (
                    <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{count}</span>
                )}
            </div>
            {expandedSections[id] ? <ChevronDown size={14} className="text-zinc-600" /> : <ChevronRight size={14} className="text-zinc-600" />}
        </button>
    );

    const StatCard = ({ label, value, icon: Icon, color = "text-white" }: { label: string, value: string | number, icon?: any, color?: string }) => (
        <Card className="flex flex-col gap-1 p-4 bg-zinc-900/30">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                {Icon && <Icon size={10} />}
                {label}
            </span>
            <span className={`text-lg font-mono ${color}`}>{value || '---'}</span>
        </Card>
    );

    const isAuthError = (message: string) => {
        return message?.includes('unauthorized_client') ||
            message?.includes('access_denied') ||
            message?.includes('invalid_grant') ||
            message?.includes('403');
    };

    const ErrorBanner = ({ message }: { message: string }) => {
        if (isAuthError(message)) {
            return (
                <div className="p-5 bg-red-900/20 border border-red-500/20 rounded-lg space-y-4">
                    <div className="flex items-start gap-3">
                        <XCircle size={20} className="shrink-0 text-red-500 mt-0.5" />
                        <div>
                            <h4 className="text-red-400 font-bold text-sm mb-1">Authorization Error</h4>
                            <p className="text-red-400/80 text-xs">The Service Account is not authorized to access Google Workspace APIs. This typically means Domain-Wide Delegation is not configured correctly.</p>
                        </div>
                    </div>

                    <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
                        <h5 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Key size={12} className="text-cyan-400" />
                            Setup Instructions
                        </h5>
                        <ol className="space-y-2 text-xs text-zinc-400 list-decimal list-inside">
                            <li>Enable <strong className="text-white">Domain-Wide Delegation</strong> for your Service Account in <span className="text-cyan-400">Google Cloud Console</span></li>
                            <li>Go to <span className="text-cyan-400">Google Admin Console</span> → Security → API Controls → Domain-wide Delegation</li>
                            <li>Add the Service Account's <strong className="text-white">Client ID</strong> with these scopes:</li>
                        </ol>
                        <div className="mt-3 bg-zinc-950/50 p-3 rounded border border-zinc-800 overflow-x-auto">
                            <code className="text-[10px] text-cyan-400 break-all">
                                https://www.googleapis.com/auth/admin.directory.user.readonly,
                                https://www.googleapis.com/auth/admin.directory.group.readonly,
                                https://www.googleapis.com/auth/admin.directory.customer.readonly,
                                https://www.googleapis.com/auth/admin.directory.domain.readonly,
                                https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly,
                                https://www.googleapis.com/auth/admin.reports.usage.readonly,
                                https://www.googleapis.com/auth/drive.readonly
                            </code>
                        </div>
                        <p className="mt-3 text-[10px] text-zinc-500">
                            See <span className="text-cyan-400 font-mono">/opt/isync/docs/WORKSPACE_MANAGER_SETUP.md</span> for detailed instructions.
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div className="p-4 bg-red-900/20 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-start gap-2">
                <XCircle size={16} className="shrink-0 mt-0.5" />
                <span>{message}</span>
            </div>
        );
    };

    const WarningBanner = ({ message }: { message: string }) => (
        <div className="p-4 bg-amber-900/20 border border-amber-500/20 rounded-lg text-amber-500 text-xs flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{message}</span>
        </div>
    );

    const PermissionBadge = ({ role }: { role: string }) => {
        const colors: Record<string, string> = {
            'organizer': 'bg-red-900/30 text-red-400 border-red-500/20',
            'fileOrganizer': 'bg-orange-900/30 text-orange-400 border-orange-500/20',
            'writer': 'bg-blue-900/30 text-blue-400 border-blue-500/20',
            'commenter': 'bg-cyan-900/30 text-cyan-400 border-cyan-500/20',
            'reader': 'bg-zinc-800 text-zinc-400 border-zinc-700',
        };
        const labels: Record<string, string> = {
            'organizer': 'Manager',
            'fileOrganizer': 'Content Manager',
            'writer': 'Contributor',
            'commenter': 'Commenter',
            'reader': 'Viewer',
        };
        return (
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${colors[role] || colors['reader']}`}>
                {labels[role] || role}
            </span>
        );
    };

    const GlobalStorageTable = () => {
        if (!config.domains || config.domains.length === 0) return null;

        const overviewData = storageOverviewCache.data as any[];

        const stats = config.domains.map(d => {
            const domain = d.domain_name;
            const entry = (cache as any).workspace_summary[domain];
            // Rename to avoid shadowing and check global state
            const isRowScanning = scanningDomains.has(domain) || isScanning;

            // detailed result from latest scan (if available)
            const summaryResult = entry?.data?.[0];
            const hasAuthError = summaryResult?.auth?.error || summaryResult?.storage?.error;

            // Try to use overview data first
            const overviewEntry = overviewData.find(o => o.domain === domain);

            if (overviewEntry) {
                // If we have a fresh auth error in the detailed result, show it instead of stale overview data status
                const status = isRowScanning ? 'Scanning...' : (hasAuthError ? 'Auth Error' : 'Ready');
                return {
                    domain,
                    used: (overviewEntry.total_used_gb / 1024) || 0,
                    quota: (overviewEntry.total_quota_gb / 1024) || 0,
                    percentage: (overviewEntry.total_used_gb / overviewEntry.total_quota_gb * 100) || 0,
                    status
                };
            }

            // Fallback to full summary cache
            const s = summaryResult?.storage;
            const quotaInfo = (s as any)?.quota_info;

            if (!quotaInfo) {
                let status = isRowScanning || storageOverviewCache.isLoading || entry?.isLoading ? 'Scanning...' : 'No Data';
                if (hasAuthError && !isRowScanning) status = 'Auth Error';

                return {
                    domain,
                    used: 0,
                    quota: 0,
                    percentage: 0,
                    status
                };
            }

            const used = quotaInfo.total_used_tb || (quotaInfo.total_used_gb / 1024) || 0;
            const quota = quotaInfo.total_quota_tb || (quotaInfo.total_quota_gb / 1024) || 0;
            const percentage = quotaInfo.percentage_used || 0;

            const status = isRowScanning ? 'Scanning...' : (hasAuthError ? 'Auth Error' : 'Ready');
            return { domain, used, quota, percentage, status };
        });

        const { sortedData: sortedStats, handleSort, sortColumn, sortDirection } = useSortableData({
            data: stats,
            initialSortColumn: 'domain',
            initialSortDirection: 'asc'
        });

        const totalUsed = stats.reduce((acc, s) => acc + s.used, 0);
        const totalQuota = stats.reduce((acc, s) => acc + s.quota, 0);
        const totalPercentage = totalQuota > 0 ? (totalUsed / totalQuota * 100) : 0;

        const Th = ({ field, label, align = 'left' }: { field: string, label: string, align?: 'left' | 'right' | 'center' }) => (
            <th
                className={`px-6 py-2 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] border-b border-zinc-800 cursor-pointer hover:text-white transition-colors group ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}
                onClick={() => handleSort(field)}
            >
                <div className={`flex items-center ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
                    {label}
                    {sortColumn === field ? (
                        <ChevronDown size={14} className={`ml-1 text-cyan-400 transition-transform duration-300 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                    ) : (
                        <Activity size={10} className="ml-1 opacity-0 group-hover:opacity-30 transition-opacity" />
                    )}
                </div>
            </th>
        );

        return (
            <div className="max-w-7xl mx-auto mb-6 bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-700">
                <div className="bg-gradient-to-r from-zinc-800/80 to-zinc-900/80 px-6 py-3 border-b border-zinc-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-cyan-500/10 rounded-xl border border-cyan-500/20 shadow-inner">
                            <Database size={20} className="text-cyan-400" />
                        </div>
                        <div>
                            <h3 className="text-md font-black text-white uppercase tracking-tighter leading-none mb-0.5">Storage Overview</h3>
                            <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest opacity-80 leading-none">Full Infrastructure Analysis</p>
                        </div>
                    </div>
                    <button
                        onClick={scanAllDomains}
                        disabled={isScanning}
                        className="flex items-center gap-2 px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg shadow-lg shadow-cyan-900/20 transition-all active:scale-95 font-bold text-xs disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                        Scan All Domains
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-zinc-950/60">
                                <Th field="domain" label="Domain Name" />
                                <Th field="used" label="Storage Used" align="right" />
                                <Th field="quota" label="Storage Quota" align="right" />
                                <Th field="percentage" label="% Used" align="center" />
                                <th className="px-6 py-2 text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] border-b border-zinc-800 text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/30">
                            {sortedStats.map((s) => (
                                <tr key={s.domain} className={`group hover:bg-cyan-500/[0.03] transition-colors ${s.domain === selectedDomain ? 'bg-cyan-500/[0.07]' : ''}`}>
                                    <td className="px-6 py-2.5">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full border ${s.domain === selectedDomain ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] animate-pulse' : (s.status === 'Ready' ? 'bg-emerald-500 border-emerald-500/50' : 'bg-zinc-600 border-zinc-600/50')}`} />
                                            <button
                                                onClick={() => setSelectedDomain(s.domain)}
                                                className={`text-sm font-bold transition-all group-hover:translate-x-1 ${s.domain === selectedDomain ? 'text-white' : 'text-zinc-300 group-hover:text-cyan-400'}`}
                                            >
                                                {s.domain}
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    scanSingleDomain(s.domain);
                                                }}
                                                disabled={scanningDomains.has(s.domain)}
                                                className="p-1.5 rounded-lg bg-cyan-600/10 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Refresh data from Google Workspace"
                                            >
                                                <RefreshCw size={12} className={scanningDomains.has(s.domain) ? 'animate-spin' : ''} />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-6 py-2.5 text-right">
                                        <span className="text-sm font-bold text-zinc-200 tabular-nums">{s.used.toFixed(2)}</span>
                                        <span className="ml-1 text-[10px] font-black text-zinc-500 uppercase">TB</span>
                                    </td>
                                    <td className="px-6 py-2.5 text-right">
                                        <span className="text-sm font-bold text-zinc-400 tabular-nums">{s.quota.toFixed(2)}</span>
                                        <span className="ml-1 text-[10px] font-black text-zinc-600 uppercase">TB</span>
                                    </td>
                                    <td className="px-6 py-2.5">
                                        <div className="flex flex-col items-center gap-1.5 cursor-default">
                                            <span className={`text-sm font-black tabular-nums leading-none ${s.percentage > 90 ? 'text-red-500' : s.percentage > 75 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                {s.percentage.toFixed(1)}%
                                            </span>
                                            <div className="w-20 h-1.5 bg-zinc-800/80 rounded-full overflow-hidden border border-white/5 ring-1 ring-black/20">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ${s.percentage > 90 ? 'bg-gradient-to-r from-red-600 to-red-400' : s.percentage > 75 ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
                                                    style={{ width: `${Math.min(s.percentage, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-2.5 text-right">
                                        <span className={`text-[9px] px-2.5 py-0.5 rounded-full uppercase font-black tracking-widest border shadow-sm ${s.status === 'Ready' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30' :
                                            (s.status === 'Loading...' || s.status === 'Scanning...') ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/30 animate-pulse' :
                                                s.status === 'Auth Error' ? 'bg-red-950/40 text-red-400 border-red-500/30' :
                                                    'bg-zinc-800 text-zinc-500 border-zinc-700'
                                            }`}>
                                            {s.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-zinc-900 border-t border-zinc-700/50 shadow-[0_-10px_20px_rgba(0,0,0,0.2)]">
                                <td className="px-6 py-3">
                                    <div className="text-md font-black text-white uppercase tracking-tighter italic">Aggregate Total</div>
                                </td>
                                <td className="px-6 py-3 text-right">
                                    <span className="text-lg font-black text-cyan-400 tabular-nums">{totalUsed.toFixed(2)}</span>
                                    <span className="ml-1 text-[10px] font-black text-cyan-600 uppercase leading-none">TB</span>
                                </td>
                                <td className="px-6 py-3 text-right">
                                    <span className="text-lg font-black text-zinc-400 tabular-nums">{totalQuota.toFixed(2)}</span>
                                    <span className="ml-1 text-[10px] font-black text-zinc-600 uppercase leading-none">TB</span>
                                </td>
                                <td className="px-6 py-3">
                                    <div className="flex flex-col items-center gap-1.5">
                                        <span className={`text-lg font-black tabular-nums leading-none ${totalPercentage > 90 ? 'text-red-500' : totalPercentage > 75 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                            {totalPercentage.toFixed(1)}%
                                        </span>
                                        <div className="w-24 h-2 bg-zinc-950 rounded-full overflow-hidden border border-white/5 shadow-inner">
                                            <div
                                                className={`h-full rounded-full transition-all duration-1000 ${totalPercentage > 90 ? 'bg-gradient-to-r from-red-600 to-red-400 shadow-[0_0_15px_rgba(0,0,0,0.4)]' :
                                                    totalPercentage > 75 ? 'bg-gradient-to-r from-amber-600 to-amber-400 shadow-[0_0_15px_rgba(0,0,0,0.4)]' :
                                                        'bg-gradient-to-r from-emerald-600 to-cyan-400 shadow-[0_0_15px_rgba(0,0,0,0.4)]'}`}
                                                style={{ width: `${Math.min(totalPercentage, 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-3 text-right">
                                    <div className="inline-flex items-center gap-2 px-2 py-0.5 bg-zinc-800 rounded-lg text-[9px] font-black text-zinc-500 uppercase tracking-widest border border-zinc-700">
                                        <Activity size={10} className="text-cyan-500" />
                                        Aggregated
                                    </div>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="page-container pb-12">
            <PageHeader
                icon={Activity}
                title="Workspace Manager"
                subtitle="Consolidated Workspace Infrastructure, Metadata & Shared Drives"
                gradient="from-cyan-600 to-blue-600"
            >
                <div className="flex items-center gap-4">
                    <CacheStatus
                        dataType="workspace_summary"
                        contextKey={selectedDomain}
                        onRefresh={() => fetchAll(selectedDomain, true)}
                    />

                    <div className="h-8 w-px bg-zinc-800 mx-2" />

                    <select
                        value={selectedDomain}
                        onChange={(e) => setSelectedDomain(e.target.value)}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition"
                    >
                        {config.domains?.map(d => (
                            <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>
                        ))}
                    </select>
                </div>
            </PageHeader>

            <GlobalStorageTable />

            {(isScanning || workspaceCache.isLoading) && !summary && (
                <div className="py-20 flex justify-center">
                    <LoadingSpinner size="lg" message="Retrieving Workspace Metadata..." />
                </div>
            )}

            {!isScanning && !summary && selectedDomain && (
                <div className="py-20 flex flex-col items-center justify-center text-zinc-500 gap-4">
                    <Info size={48} className="opacity-20" />
                    <p>No data available for this domain. Click refresh to scan.</p>
                    <button
                        onClick={() => fetchAll(selectedDomain, true)}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition font-bold text-sm flex items-center gap-2"
                    >
                        <RefreshCw size={16} />
                        Scan Workspace
                    </button>
                </div>
            )}

            {summary && (
                <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">

                    {/* ========================================== */}
                    {/* SECTION 0: Authorization & API Status      */}
                    {/* ========================================== */}
                    <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                        <SectionHeader
                            id="auth"
                            title="0. Authorization & API Status"
                            icon={Shield}
                            color="bg-emerald-600"
                            subtitle="Service account identity, OAuth scopes, and DWD health check"
                        />
                        {expandedSections.auth && (
                            <div className="p-6 space-y-6">
                                {summary.auth?.error ? (
                                    <ErrorBanner message={summary.auth.error} />
                                ) : (
                                    <>
                                        {/* Identity Information */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <StatCard
                                                label="Service Account"
                                                value={summary.auth?.service_account_email || 'Unknown'}
                                                icon={Mail}
                                                color="text-cyan-400"
                                            />
                                            <StatCard
                                                label="Client ID"
                                                value={summary.auth?.client_id || 'Unknown'}
                                                icon={Fingerprint}
                                                color="text-indigo-400"
                                            />
                                            <StatCard
                                                label="Principal Admin"
                                                value={summary.auth?.impersonating || 'Unknown'}
                                                icon={Crown}
                                                color="text-amber-400"
                                            />
                                            <StatCard
                                                label="Project ID"
                                                value={summary.auth?.project_id || 'Unknown'}
                                                icon={Building}
                                                color="text-zinc-300"
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            {/* API Scope List */}
                                            <div className="bg-zinc-900/30 rounded-xl p-5 border border-zinc-800/50">
                                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                    <Lock size={14} className="text-emerald-400" />
                                                    Authorized OAuth Scopes (DWD)
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {summary.auth?.scopes.map((scope, idx) => (
                                                        <div key={idx} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 flex items-center gap-2 group">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            <span className="text-[10px] text-zinc-300 font-mono break-all">{scope}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* API Health Checks */}
                                            <div className="bg-zinc-900/30 rounded-xl p-5 border border-zinc-800/50">
                                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                    <Activity size={14} className="text-cyan-400" />
                                                    API Health & Access Check
                                                </h4>
                                                <div className="space-y-3">
                                                    {summary.auth?.checks.map((check, idx) => (
                                                        <div key={idx} className="flex items-center justify-between p-2 rounded bg-zinc-800/50 border border-zinc-800">
                                                            <div className="flex items-center gap-3">
                                                                {check.status === 'active' ? (
                                                                    <CheckCircle size={14} className="text-emerald-500" />
                                                                ) : (
                                                                    <XCircle size={14} className="text-red-500" />
                                                                )}
                                                                <span className="text-xs font-medium text-zinc-200">{check.name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${check.status === 'active' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
                                                                    }`}>
                                                                    {check.status}
                                                                </span>
                                                                {check.error && (
                                                                    <span className="text-[10px] text-zinc-500 italic max-w-[150px] truncate" title={check.error}>
                                                                        {check.error}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ========================================== */}
                    {/* SECTION 1: Identity & Organizational Metadata */}
                    {/* ========================================== */}
                    <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                        <SectionHeader
                            id="identity"
                            title="1. Workspace Identity & Organizational Metadata"
                            icon={Globe}
                            color="bg-blue-600"
                            subtitle="Domain info, customer ID, organization structure"
                        />
                        {expandedSections.identity && (
                            <div className="p-6 space-y-6">
                                {summary.metadata?.error ? (
                                    <ErrorBanner message={summary.metadata.error} />
                                ) : (
                                    <>
                                        {/* Core Identity Cards */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <StatCard
                                                label="Customer ID"
                                                value={summary.metadata?.customer_id || 'N/A'}
                                                icon={Key}
                                                color={summary.metadata?.customer_id ? "text-cyan-400" : "text-zinc-500"}
                                            />
                                            <StatCard
                                                label="Organization ID"
                                                value={(summary.metadata as any)?.org_id || 'N/A'}
                                                icon={Building}
                                                color={(summary.metadata as any)?.org_id ? "text-indigo-400" : "text-zinc-500"}
                                            />
                                            <StatCard label="Primary Domain" value={summary.metadata?.customer_domain || '---'} icon={Globe} color="text-white" />
                                            <StatCard
                                                label="Created"
                                                value={(summary.metadata as any)?.customer_creation_time ? new Date((summary.metadata as any).customer_creation_time).toLocaleDateString() : '---'}
                                                icon={Calendar}
                                                color="text-zinc-300"
                                            />
                                        </div>

                                        {/* Domains Sub-Section */}
                                        <div className="bg-zinc-900/30 rounded-lg overflow-hidden border border-zinc-800/50">
                                            <SubSectionHeader
                                                id="domains"
                                                title="Domains & Aliases"
                                                icon={Globe}
                                                count={((summary.metadata as any)?.domains?.length || 0) + ((summary.metadata as any)?.domain_aliases?.length || 0)}
                                            />
                                            {expandedSections.domains && (
                                                <div className="p-4 space-y-4">
                                                    {/* Primary Domains */}
                                                    <div>
                                                        <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Registered Domains</h5>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                            {(summary.metadata as any)?.domains?.map((domain: any) => (
                                                                <div key={domain.domain_name} className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <Globe size={14} className={domain.is_primary ? "text-cyan-400" : "text-zinc-500"} />
                                                                        <span className="text-sm text-white font-medium">{domain.domain_name}</span>
                                                                        {domain.is_primary && (
                                                                            <span className="text-[8px] bg-cyan-900/30 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded font-bold uppercase">Primary</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        {domain.verified ? (
                                                                            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                                                                                <CheckCircle size={12} /> Verified
                                                                            </span>
                                                                        ) : (
                                                                            <span className="flex items-center gap-1 text-[10px] text-amber-500">
                                                                                <AlertTriangle size={12} /> Unverified
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Domain Aliases */}
                                                    {(summary.metadata as any)?.domain_aliases?.length > 0 && (
                                                        <div>
                                                            <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Domain Aliases</h5>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                {(summary.metadata as any)?.domain_aliases?.map((alias: any) => (
                                                                    <div key={alias.alias} className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center justify-between">
                                                                        <div className="flex flex-col">
                                                                            <span className="text-sm text-zinc-300">{alias.alias}</span>
                                                                            <span className="text-[10px] text-zinc-600">→ {alias.parent_domain}</span>
                                                                        </div>
                                                                        {alias.verified ? (
                                                                            <CheckCircle size={12} className="text-emerald-400" />
                                                                        ) : (
                                                                            <AlertTriangle size={12} className="text-amber-500" />
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Admins Sub-Section */}
                                        <div className="bg-zinc-900/30 rounded-lg overflow-hidden border border-zinc-800/50">
                                            <SubSectionHeader
                                                id="admins"
                                                title="Super Admins & Delegated Admins"
                                                icon={Shield}
                                                count={summary.metadata?.admins?.length || 0}
                                            />
                                            {expandedSections.admins && (
                                                <div className="p-4">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                                        {summary.metadata?.admins?.map(admin => (
                                                            <div key={admin.email} className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center justify-between">
                                                                <div className="flex flex-col min-w-0">
                                                                    <span className="text-sm font-medium text-white truncate">{admin.name}</span>
                                                                    <span className="text-[10px] text-zinc-500 font-mono truncate">{admin.email}</span>
                                                                    {(admin as any).last_login && (
                                                                        <span className="text-[9px] text-zinc-600 mt-1">
                                                                            Last login: {new Date((admin as any).last_login).toLocaleDateString()}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-col items-end gap-1">
                                                                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${admin.is_delegated
                                                                        ? 'bg-amber-900/30 text-amber-500 border border-amber-500/20'
                                                                        : 'bg-red-900/30 text-red-500 border border-red-500/20'
                                                                        }`}>
                                                                        {admin.is_delegated ? 'Delegated' : 'Super Admin'}
                                                                    </span>
                                                                    {(admin as any).suspended && (
                                                                        <span className="text-[8px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">Suspended</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Custom Roles */}
                                                    {(summary.metadata as any)?.custom_roles?.length > 0 && (
                                                        <div className="mt-4 pt-4 border-t border-zinc-800/50">
                                                            <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Custom Admin Roles</h5>
                                                            <div className="flex flex-wrap gap-2">
                                                                {(summary.metadata as any)?.custom_roles?.map((role: any) => (
                                                                    <span key={role.role_id} className="bg-zinc-800 text-zinc-400 px-2 py-1 rounded text-xs" title={role.description}>
                                                                        {role.role_name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ========================================== */}
                    {/* SECTION 2: User & Group Inventory */}
                    {/* ========================================== */}
                    <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                        <SectionHeader
                            id="inventory"
                            title="2. Workspace User & Group Inventory"
                            icon={Users}
                            color="bg-indigo-600"
                            badge={`${(summary.inventory as any)?.user_stats?.total || 0} users`}
                            subtitle="User statistics, login activity, and groups"
                        />
                        {expandedSections.inventory && (
                            <div className="p-6 space-y-6">
                                {summary.inventory?.error ? (
                                    <ErrorBanner message={summary.inventory.error} />
                                ) : (
                                    <>
                                        {/* User Statistics Sub-Section */}
                                        <div className="bg-zinc-900/30 rounded-lg overflow-hidden border border-zinc-800/50">
                                            <SubSectionHeader
                                                id="users"
                                                title="User Statistics"
                                                icon={UserCheck}
                                                count={(summary.inventory as any)?.user_stats?.total}
                                            />
                                            {expandedSections.users && (
                                                <div className="p-4">
                                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                                        <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                                                            <Users size={20} className="mx-auto mb-2 text-blue-400" />
                                                            <div className="text-2xl font-bold text-white">{(summary.inventory as any)?.user_stats?.total || 0}</div>
                                                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Total Users</div>
                                                        </div>
                                                        <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                                                            <UserCheck size={20} className="mx-auto mb-2 text-emerald-400" />
                                                            <div className="text-2xl font-bold text-emerald-400">{(summary.inventory as any)?.user_stats?.active || 0}</div>
                                                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Active</div>
                                                        </div>
                                                        <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                                                            <UserX size={20} className="mx-auto mb-2 text-red-400" />
                                                            <div className="text-2xl font-bold text-red-400">{(summary.inventory as any)?.user_stats?.suspended || 0}</div>
                                                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Suspended</div>
                                                        </div>
                                                        <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                                                            <Folder size={20} className="mx-auto mb-2 text-amber-400" />
                                                            <div className="text-2xl font-bold text-amber-400">{(summary.inventory as any)?.user_stats?.archived || 0}</div>
                                                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Archived</div>
                                                        </div>
                                                        <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                                                            <Activity size={20} className="mx-auto mb-2 text-cyan-400" />
                                                            <div className="text-2xl font-bold text-cyan-400">{(summary.inventory as any)?.user_stats?.active_last_30_days || 0}</div>
                                                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Active 30d</div>
                                                        </div>
                                                        <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800 text-center">
                                                            <EyeOff size={20} className="mx-auto mb-2 text-zinc-500" />
                                                            <div className="text-2xl font-bold text-zinc-400">{(summary.inventory as any)?.user_stats?.never_logged_in || 0}</div>
                                                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Never Logged In</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Groups Sub-Section */}
                                        <div className="bg-zinc-900/30 rounded-lg overflow-hidden border border-zinc-800/50">
                                            <SubSectionHeader
                                                id="groups"
                                                title="Google Groups"
                                                icon={Users}
                                                count={summary.inventory?.group_count}
                                            />
                                            {expandedSections.groups && (
                                                <div className="p-4">
                                                    {summary.inventory?.groups && summary.inventory.groups.length > 0 ? (
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full text-left text-sm">
                                                                <thead className="bg-zinc-900/80 text-zinc-500 text-xs uppercase tracking-wider font-bold">
                                                                    <tr>
                                                                        <th className="px-4 py-3">Group Name</th>
                                                                        <th className="px-4 py-3">Email Address</th>
                                                                        <th className="px-4 py-3 text-center">Members</th>
                                                                        <th className="px-4 py-3 text-center">Settings</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-zinc-800">
                                                                    {summary.inventory?.groups?.map(group => (
                                                                        <tr key={group.id} className="hover:bg-zinc-800/30 transition-colors group">
                                                                            <td className="px-4 py-3">
                                                                                <div className="font-medium text-white group-hover:text-cyan-400 transition">{group.name}</div>
                                                                                <div className="text-[10px] text-zinc-500 italic max-w-xs truncate">{group.description}</div>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{group.email}</td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <span className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-300">{group.direct_members}</span>
                                                                            </td>
                                                                            <td className="px-4 py-3">
                                                                                <div className="flex items-center justify-center gap-1.5">
                                                                                    {(group as any).settings?.allow_external_members ? (
                                                                                        <span className="text-[9px] bg-amber-900/30 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold" title="Allows external members">
                                                                                            External
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span className="text-[9px] bg-emerald-900/30 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold" title="Domain only">
                                                                                            Internal
                                                                                        </span>
                                                                                    )}
                                                                                    {(group as any).admin_created && (
                                                                                        <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded" title="Admin created">Admin</span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <p className="text-zinc-500 text-sm text-center py-4">No groups found</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ========================================== */}
                    {/* SECTION 3: Storage & Usage Statistics */}
                    {/* ========================================== */}
                    <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                        <SectionHeader
                            id="storage"
                            title="3. Workspace Storage & Usage Statistics"
                            icon={BarChart}
                            color="bg-emerald-600"
                            subtitle="Aggregated storage across Drive, Gmail, and Photos"
                        />
                        {expandedSections.storage && (
                            <div className="p-6">
                                {summary.storage?.error ? (
                                    <ErrorBanner message={summary.storage.error} />
                                ) : (
                                    <div className="space-y-6">
                                        {/* Storage Usage Highlight */}
                                        <div className="bg-gradient-to-r from-cyan-900/20 via-zinc-900/50 to-emerald-900/20 border border-zinc-700/50 rounded-xl p-5">
                                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                                <div>
                                                    <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Workspace Storage Usage</div>
                                                    <div className="flex items-baseline gap-3">
                                                        <span className="text-3xl font-bold text-white">
                                                            {(summary.storage as any)?.quota_info?.total_used_tb?.toFixed(2) ||
                                                                ((summary.storage as any)?.quota_info?.total_used_gb / 1024)?.toFixed(2) || '0'} TB
                                                        </span>
                                                        <span className="text-zinc-500">/</span>
                                                        <span className="text-xl text-zinc-400">
                                                            {(summary.storage as any)?.quota_info?.total_quota_tb?.toFixed(2) ||
                                                                ((summary.storage as any)?.quota_info?.total_quota_gb / 1024)?.toFixed(2) || '0'} TB
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className={`text-4xl font-black ${((summary.storage as any)?.quota_info?.percentage_used || 0) > 90 ? 'text-red-500' :
                                                        ((summary.storage as any)?.quota_info?.percentage_used || 0) > 75 ? 'text-amber-500' : 'text-emerald-500'
                                                        }`}>
                                                        {(summary.storage as any)?.quota_info?.percentage_used || 0}%
                                                    </div>
                                                </div>
                                            </div>
                                            {/* Progress Bar */}
                                            <div className="mt-4 h-3 bg-zinc-800 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-500 ${((summary.storage as any)?.quota_info?.percentage_used || 0) > 90 ? 'bg-gradient-to-r from-red-600 to-red-400' :
                                                        ((summary.storage as any)?.quota_info?.percentage_used || 0) > 75 ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                                                            'bg-gradient-to-r from-emerald-600 to-cyan-400'
                                                        }`}
                                                    style={{ width: `${Math.min((summary.storage as any)?.quota_info?.percentage_used || 0, 100)}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Storage Breakdown Cards */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <Card className="p-4 bg-gradient-to-br from-blue-900/30 to-blue-950/50 border-blue-800/30">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-blue-500/20 rounded-lg">
                                                        <Database size={18} className="text-blue-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-zinc-500 font-bold uppercase">Total Quota</div>
                                                        <div className="text-xl font-bold text-white">
                                                            {(summary.storage as any)?.quota_info?.total_quota_tb?.toFixed(0) ||
                                                                Math.round(((summary.storage as any)?.quota_info?.total_quota_gb || 0) / 1024)} TB
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                            <Card className="p-4 bg-gradient-to-br from-cyan-900/30 to-cyan-950/50 border-cyan-800/30">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-cyan-500/20 rounded-lg">
                                                        <BarChart size={18} className="text-cyan-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-zinc-500 font-bold uppercase">Total Used</div>
                                                        <div className="text-xl font-bold text-cyan-400">
                                                            {(summary.storage as any)?.quota_info?.total_used_tb?.toFixed(2) ||
                                                                ((summary.storage as any)?.quota_info?.total_used_gb / 1024)?.toFixed(2) || '0'} TB
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                            <Card className="p-4 bg-gradient-to-br from-indigo-900/30 to-indigo-950/50 border-indigo-800/30">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                                                        <HardDrive size={18} className="text-indigo-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-zinc-500 font-bold uppercase">Drive Storage</div>
                                                        <div className="text-xl font-bold text-indigo-400">
                                                            {formatBytes(((summary.storage as any)?.quota_info?.drive_used_mb || 0) * 1024 * 1024)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                            <Card className="p-4 bg-gradient-to-br from-amber-900/30 to-amber-950/50 border-amber-800/30">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-amber-500/20 rounded-lg">
                                                        <Trash2 size={18} className="text-amber-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-zinc-500 font-bold uppercase">Trash</div>
                                                        <div className="text-xl font-bold text-amber-400">
                                                            {formatBytes(((summary.storage as any)?.quota_info?.trash_mb || 0) * 1024 * 1024)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                        </div>

                                        {/* Drive Activity */}
                                        {(summary.storage as any)?.activity && (
                                            <div className="bg-zinc-900/40 rounded-xl p-5 border border-zinc-800">
                                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                    <Activity size={14} className="text-cyan-400" />
                                                    Drive Activity (Recent)
                                                </h4>
                                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-white">{(summary.storage as any)?.activity?.items_created || 0}</div>
                                                        <div className="text-[10px] text-zinc-500 uppercase">Created</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-white">{(summary.storage as any)?.activity?.items_edited || 0}</div>
                                                        <div className="text-[10px] text-zinc-500 uppercase">Edited</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-white">{(summary.storage as any)?.activity?.items_viewed || 0}</div>
                                                        <div className="text-[10px] text-zinc-500 uppercase">Viewed</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-amber-400">{(summary.storage as any)?.activity?.items_shared_externally || 0}</div>
                                                        <div className="text-[10px] text-zinc-500 uppercase">Shared External</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-red-400">{(summary.storage as any)?.activity?.items_trashed || 0}</div>
                                                        <div className="text-[10px] text-zinc-500 uppercase">Trashed</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Report Info */}
                                        <div className="bg-zinc-900/40 rounded-xl p-4 border border-zinc-800 flex items-center gap-3">
                                            <Info size={16} className="text-cyan-400 shrink-0" />
                                            <p className="text-xs text-zinc-500 leading-relaxed">
                                                Usage statistics are retrieved from the Reports API. Data is typically delayed by 24-48 hours. Values shown are estimates as of <span className="text-cyan-400 font-mono">{summary.storage?.date || 'N/A'}</span>.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ========================================== */}
                    {/* SECTION 4: Shared Drives */}
                    {/* ========================================== */}
                    <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                        <SectionHeader
                            id="drives"
                            title="4. Shared Drives (Organization Level)"
                            icon={HardDrive}
                            color="bg-orange-600"
                            badge={`${summary.drives?.count || 0} drives`}
                            subtitle="Full inventory with permissions and restrictions"
                        />
                        {expandedSections.drives && (
                            <div className="p-6">
                                {summary.drives?.error ? (
                                    <ErrorBanner message={summary.drives.error} />
                                ) : (
                                    <>
                                        {/* Summary Stats */}
                                        {(summary.drives as any)?.summary && (
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                                                <Card className="p-4 bg-zinc-900/40 text-center">
                                                    <HardDrive size={20} className="mx-auto mb-2 text-orange-400" />
                                                    <div className="text-xl font-bold text-white">{(summary.drives as any)?.summary?.total_drives || 0}</div>
                                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Total Drives</div>
                                                </Card>
                                                <Card className="p-4 bg-zinc-900/40 text-center">
                                                    <Lock size={20} className="mx-auto mb-2 text-emerald-400" />
                                                    <div className="text-xl font-bold text-emerald-400">{(summary.drives as any)?.summary?.restricted_to_domain || 0}</div>
                                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Domain-Only</div>
                                                </Card>
                                                <Card className="p-4 bg-zinc-900/40 text-center">
                                                    <Unlock size={20} className="mx-auto mb-2 text-amber-400" />
                                                    <div className="text-xl font-bold text-amber-400">{(summary.drives as any)?.summary?.open_to_external || 0}</div>
                                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">External OK</div>
                                                </Card>
                                                <Card className="p-4 bg-zinc-900/40 text-center">
                                                    <Crown size={20} className="mx-auto mb-2 text-red-400" />
                                                    <div className="text-xl font-bold text-red-400">{(summary.drives as any)?.summary?.total_organizers || 0}</div>
                                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Total Managers</div>
                                                </Card>
                                                <Card className="p-4 bg-zinc-900/40 text-center">
                                                    <EyeOff size={20} className="mx-auto mb-2 text-zinc-500" />
                                                    <div className="text-xl font-bold text-zinc-400">{(summary.drives as any)?.summary?.hidden_drives || 0}</div>
                                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Hidden</div>
                                                </Card>
                                            </div>
                                        )}

                                        {/* Drives Header & Controls */}
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Global Shared Drive Inventory</span>
                                                    <span className="bg-orange-900/30 text-orange-500 border border-orange-500/20 text-[10px] px-1.5 py-0.5 rounded font-bold">Admin Level Access</span>
                                                </div>
                                                <p className="text-[10px] text-zinc-500">Inventory of all Shared Drives in the domain with size auditing.</p>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                {/* Search Bar */}
                                                <div className="relative group/search">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within/search:text-orange-500 transition-colors" />
                                                    <input
                                                        type="text"
                                                        value={driveTable.searchTerm}
                                                        onChange={(e) => driveTable.setSearchTerm(e.target.value)}
                                                        placeholder="Search drives..."
                                                        className="bg-zinc-900/50 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder:text-zinc-600 focus:ring-1 focus:ring-orange-500 outline-none w-48 md:w-64 transition-all"
                                                    />
                                                </div>

                                                {/* Storage Audit Controls */}
                                                <div className="flex items-center gap-2 bg-zinc-900/50 p-1.5 rounded-lg border border-zinc-800">
                                                    <div className="flex flex-col mr-2 pl-1">
                                                        <span className="text-[8px] text-zinc-500 uppercase font-black mb-1">Execution Node</span>
                                                        <select
                                                            value={selectedAuditServer}
                                                            onChange={(e) => setSelectedAuditServer(e.target.value)}
                                                            className="bg-zinc-800 border-none text-[10px] text-zinc-300 font-bold rounded px-1.5 py-1 focus:ring-1 focus:ring-orange-500 outline-none"
                                                        >
                                                            <option value="local">Local Instance</option>
                                                            {(config.ssh_servers as any[])?.map(s => (
                                                                <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <button
                                                        onClick={() => runStorageAudit()}
                                                        disabled={!!auditLoading}
                                                        className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:bg-zinc-800 text-white rounded text-[10px] font-black uppercase tracking-wider transition shadow-lg shadow-orange-900/20"
                                                    >
                                                        <BarChart size={12} className={auditLoading === 'all' ? 'animate-pulse' : ''} />
                                                        {auditLoading === 'all' ? 'Auditing...' : 'Audit All'}
                                                    </button>
                                                    <button
                                                        onClick={() => setShowScheduleModal(true)}
                                                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 rounded transition"
                                                        title="Schedule Recurring Audit"
                                                    >
                                                        <Calendar size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {auditLoading && (
                                            <div className="flex items-center gap-3 px-4 py-2 bg-orange-500/5 border border-orange-500/10 rounded-xl mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                                <RefreshCw size={14} className="text-orange-500 animate-spin" />
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Audit in Progress</span>
                                                    <span className="text-[9px] text-zinc-500 font-medium">Calculating directory sizes via rclone...</span>
                                                </div>
                                            </div>
                                        )}

                                        <DataTable
                                            data={driveTable.data}
                                            columns={driveColumns}
                                            handleSort={driveTable.handleSort}
                                            SortIcon={driveTable.SortIcon}
                                            columnFilters={driveTable.columnFilters}
                                            onToggleColumnFilter={driveTable.toggleColumnFilter}
                                            onClearColumnFilter={driveTable.clearColumnFilter}
                                            getUniqueValues={driveTable.getUniqueValues}
                                            rowIdKey="id"
                                            compact
                                            renderExpansion={(drive: any) => (
                                                <div className="space-y-4">
                                                    {/* Metadata */}
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                                        <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800/50">
                                                            <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Created</span>
                                                            <div className="text-zinc-300 font-medium">{drive.createdTime ? new Date(drive.createdTime).toLocaleDateString() : 'N/A'}</div>
                                                        </div>
                                                        <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800/50">
                                                            <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Hidden</span>
                                                            <div className="text-zinc-300 font-medium">{drive.hidden ? 'Yes' : 'No'}</div>
                                                        </div>
                                                        <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800/50">
                                                            <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Copy Restriction</span>
                                                            <div className="text-zinc-300 font-medium">{drive.restrictions?.copy_requires_writer ? 'Writers only' : 'Anyone'}</div>
                                                        </div>
                                                        <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800/50">
                                                            <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Admin Managed</span>
                                                            <div className="text-zinc-300 font-medium">{drive.restrictions?.admin_managed_restrictions ? 'Yes' : 'No'}</div>
                                                        </div>
                                                    </div>

                                                    {/* Organizers */}
                                                    {drive.organizers?.length > 0 && (
                                                        <div className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/50">
                                                            <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-1">
                                                                <Crown size={12} className="text-red-400" /> Organizers / Managers
                                                            </h5>
                                                            <div className="flex flex-wrap gap-2">
                                                                {drive.organizers?.map((org: any, idx: number) => (
                                                                    <span
                                                                        key={idx}
                                                                        className="bg-red-900/20 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 font-medium"
                                                                        title={org.email}
                                                                    >
                                                                        <Crown size={10} />
                                                                        {org.name || org.email}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Permissions Table (Internal) */}
                                                    {drive.permissions?.length > 0 && (
                                                        <div className="bg-zinc-900/40 rounded-xl border border-zinc-800/50 overflow-hidden">
                                                            <div className="px-4 py-3 bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                                                                <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                                                                    <Shield size={12} className="text-blue-400" /> Member Access List
                                                                </h5>
                                                                <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-full font-bold">{drive.permissions.length} members</span>
                                                            </div>
                                                            <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                                                                <table className="w-full text-xs">
                                                                    <thead className="bg-zinc-900/90 text-zinc-600 uppercase text-[9px] sticky top-0 border-b border-zinc-800/50">
                                                                        <tr>
                                                                            <th className="px-4 py-2 font-bold text-left">Entity</th>
                                                                            <th className="px-4 py-2 font-bold text-left">Type</th>
                                                                            <th className="px-4 py-2 font-bold text-left">Role</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-zinc-800/30">
                                                                        {drive.permissions.filter((p: any) => !p.deleted).map((perm: any) => (
                                                                            <tr key={perm.id} className="hover:bg-zinc-800/20">
                                                                                <td className="px-4 py-2 text-zinc-300 font-medium">{perm.email || perm.display_name || perm.type}</td>
                                                                                <td className="px-4 py-2 text-zinc-500 capitalize">{perm.type}</td>
                                                                                <td className="px-4 py-2"><PermissionBadge role={perm.role} /></td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {drive.permissions_error && (
                                                        <div className="px-4 py-3 bg-amber-500/5 border border-amber-500/10 rounded-xl text-xs text-amber-500 flex items-center gap-2">
                                                            <AlertTriangle size={14} />
                                                            <span className="font-medium">{drive.permissions_error}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        />
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Required Permissions Info */}
                    <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-xl p-4 mt-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Key size={14} className="text-cyan-400" />
                            Required API Scopes & Permissions
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={12} className="text-emerald-400" />
                                    <span className="text-zinc-400">Admin SDK - Directory API (Users, Groups, Domains)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={12} className="text-emerald-400" />
                                    <span className="text-zinc-400">Admin SDK - Reports API (Usage Statistics)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={12} className="text-emerald-400" />
                                    <span className="text-zinc-400">Drive API (Shared Drives with Admin Access)</span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Info size={12} className="text-cyan-400" />
                                    <span className="text-zinc-500">Groups Settings API (optional, for group visibility settings)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Info size={12} className="text-cyan-400" />
                                    <span className="text-zinc-500">Cloud Resource Manager API (optional, for GCP Org ID)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Schedule Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-gradient-to-r from-orange-600/10 to-transparent">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-orange-600 rounded-lg shadow-lg shadow-orange-900/20">
                                    <Calendar size={20} className="text-white" />
                                </div>
                                <h3 className="text-lg font-black text-white uppercase tracking-wider">Schedule Storage Audit</h3>
                            </div>
                            <button onClick={() => setShowScheduleModal(false)} className="text-zinc-500 hover:text-white transition">
                                <XCircle size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-zinc-500 uppercase">Target Domain</label>
                                <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 text-zinc-300 font-bold text-sm">
                                    {selectedDomain}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-zinc-500 uppercase">Execution Node</label>
                                <select
                                    value={selectedAuditServer}
                                    onChange={(e) => setSelectedAuditServer(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-800 text-sm text-white font-bold rounded-lg p-3 outline-none focus:ring-1 focus:ring-orange-500 transition"
                                >
                                    <option value="local">Local Instance</option>
                                    {(config.ssh_servers as any[])?.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-zinc-500 uppercase">Cron Expression</label>
                                <input
                                    type="text"
                                    value={scheduleCron}
                                    onChange={(e) => setScheduleCron(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-800 text-sm font-mono text-orange-400 rounded-lg p-3 outline-none focus:ring-1 focus:ring-orange-500 transition"
                                    placeholder="0 2 * * *"
                                />
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {[
                                        { label: 'Daily (2AM)', val: '0 2 * * *' },
                                        { label: 'Weekly (SUN)', val: '0 0 * * 0' },
                                        { label: 'Monthly (1st)', val: '0 0 1 * *' }
                                    ].map(p => (
                                        <button
                                            key={p.val}
                                            onClick={() => setScheduleCron(p.val)}
                                            className={`text-[9px] px-2 py-1 rounded font-bold border transition ${scheduleCron === p.val ? 'bg-orange-600/20 border-orange-500 text-orange-400' : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    onClick={() => setShowScheduleModal(false)}
                                    className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-black uppercase tracking-wider transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreateSchedule}
                                    className="flex-1 px-4 py-3 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-lg shadow-orange-900/30"
                                >
                                    Create Schedule
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default WorkspaceManager;
