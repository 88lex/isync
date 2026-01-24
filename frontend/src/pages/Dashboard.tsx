
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LayoutDashboard, RefreshCw, HardDrive, Database, Clock, Server, Play, MoreHorizontal, CheckCircle, XCircle, AlertTriangle, FileText, Square, Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useIsyncData } from '../contexts/IsyncDataContext';
import { formatDate, formatTB, formatBytes } from '../utils/formatters';
import { scanPath, SyncPair, SSHServer, fetchSSHServers, fetchSyncList, bulkUpdateScanServers } from '../api';
import { useDataTable } from '../hooks/useDataTable';
import { HierarchyTable } from '../components/dashboard/HierarchyTable';
import { ScanServerModal } from '../components/ScanServerModal';

// Format bytes


const formatCount = (count?: number) => {
    if (count === undefined || count === null) return '-';
    return count.toLocaleString();
};

const DashboardPage: React.FC = () => {
    const { cache, loadPayload, setLoading, invalidate, setCached, addOperation, updateOperation, removeOperation, activeOperations } = useIsyncData();
    const [localSynclist, setLocalSynclist] = useState<SyncPair[]>([]);
    
    const synclist = localSynclist.length > 0 ? localSynclist : ((cache.sync_pairs.data as SyncPair[]) || []);
    const servers = (cache.ssh_servers.data as SSHServer[]) || [];

    const getServerName = (id?: string) => {
        if (!id) return '?';
        if (id === 'local') return 'Local';
        const srv = servers.find(s => s.id === id);
        return srv ? srv.name : id.substring(0, 8);
    };

    const getServerType = (id?: string) => {
        if (!id) return '';
        if (id === 'local') return 'local';
        return 'ssh';
    };

    const [scanning, setScanning] = useState<{ [key: string]: boolean }>({});
	const [bulkSourceServer, setBulkSourceServer] = useState<string>('');
    const [bulkDestServer, setBulkDestServer] = useState<string>('');
    const [updatingBulk, setUpdatingBulk] = useState(false);

    const [bulkScanProgress, setBulkScanProgress] = useState({
        total: 0,
        completed: 0,
        failed: 0,
        currentPath: '',
        currentSide: '' as "source" | "dest" | '',
        inProgress: false,
        isStopping: false
    });

    const statsByServer = useMemo(() => {
        const stats: Record<string, { size: number, count: number, paths: number }> = {};
        synclist.forEach(item => {
            // Source
            const sId = item.scan_source_server_id || 'local';
            if (!stats[sId]) stats[sId] = { size: 0, count: 0, paths: 0 };
            stats[sId].size += item.source_size_bytes || 0;
            stats[sId].count += item.source_file_count || 0;
            stats[sId].paths += 1;

            // Dest
            const dId = item.scan_dest_server_id || 'local';
            if (!stats[dId]) stats[dId] = { size: 0, count: 0, paths: 0 };
            stats[dId].size += item.dest_size_bytes || 0;
            stats[dId].count += item.dest_file_count || 0;
            stats[dId].paths += 1;
        });
        return stats;
    }, [synclist]);

    const stopBulkRequested = useRef(false);

    // Unified Scan Selection
    const [scanModalPair, setScanModalPair] = useState<SyncPair | null>(null);
    const [scanModalSide, setScanModalSide] = useState<"source" | "dest" | "both" | null>(null);
    const [showScanModal, setShowScanModal] = useState(false);

    // Category Scan State (Unified)
    const [categoryScanInfo, setCategoryScanInfo] = useState<{ category: string, items: SyncPair[], side?: 'source' | 'dest' | 'both' } | null>(null);

    // Scan Result Reporting Modal
    const [reportModal, setReportModal] = useState<{
        show: boolean; // Truncated rest of state for brevity, ensuring replacement matches start
        type: 'success' | 'error';
        title: string;
        message?: string;
        details?: string;
        stats?: { bytes: number; count: number };
        path?: string;
        server?: string;
    }>({ show: false, type: 'success', title: '' });
    
    // UI State
    const [showBulkConfig, setShowBulkConfig] = useState(false);

    // Helper: Fetch from Source and Update Cache (Manual Hydration)
    const fetchAndCacheSyncPairs = useCallback(async () => {
        setLoading('sync_pairs', 'local', true);
        try {
            // 1. Invalidate stale cache
            invalidate('sync_pairs', 'local');

            // 2. Fetch fresh from Source API
            const data = await fetchSyncList();

            // 3. Update Local State (Immediate Display)
            setLocalSynclist(data);

            // 4. Populate Context Cache (Background)
            setCached('sync_pairs', 'local', data);
        } catch (e) {
            console.error("Failed to fetch sync list:", e);
        } finally {
            setLoading('sync_pairs', 'local', false);
        }
    }, [invalidate, setCached, setLoading]);

    // Initial load
    useEffect(() => {
        fetchAndCacheSyncPairs();

        if (!cache.ssh_servers.lastFetched) {
            setLoading('ssh_servers', 'local', true);
            fetchSSHServers()
                .then(srvs => {
                    setCached('ssh_servers', 'local', srvs);
                })
                .finally(() => setLoading('ssh_servers', 'local', false));
        }
    }, []); // Empty dependency array to prevent loops caused by stable-but-changing context funcs

    const refreshSynclist = fetchAndCacheSyncPairs;

    const handleInitiateScan = (pair: SyncPair, side: "source" | "dest") => {
        setScanModalPair(pair);
        setScanModalSide(side);
        setShowScanModal(true);
    };

    const scrollToActivityMonitor = () => {
        const el = document.getElementById('activity-monitor-section');
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Add temporary highlight effect
            el.classList.add('ring-2', 'ring-cyan-500', 'shadow-[0_0_20px_rgba(6,182,212,0.5)]');
            setTimeout(() => {
                el.classList.remove('ring-2', 'ring-cyan-500', 'shadow-[0_0_20px_rgba(6,182,212,0.5)]');
            }, 2000);
        }
    };

    const runScan = async (pair: SyncPair, side: "source" | "dest", serverId: string, timeout: number = 1200) => {
        if (!pair.id) return;
        const key = `${pair.id}-${side}`;
        const path = side === "source" ? pair.source : pair.dest;
        const serverName = servers.find(s => s.id === serverId)?.name || (serverId === 'local' ? 'Local Server' : serverId);
        
        const opId = `scan-${pair.id}-${side}-${Date.now()}`;
        addOperation({
            id: opId,
            type: 'scan',
            label: `Scanning ${path}`,
            status: 'running',
            description: `Scanning on ${serverName}...`,
            progress: 'Starting...'
        });

        setScanning(prev => ({ ...prev, [key]: true }));
        setShowScanModal(false);

        try {
            const res = await scanPath({
                pair_id: pair.id,
                side: side,
                server_id: serverId,
                timeout: timeout
            });

            // Update local state immediately
            setLocalSynclist(prev => {
                const updated = prev.length > 0 ? [...prev] : [...((cache.sync_pairs.data as SyncPair[]) || [])];
                const index = updated.findIndex(p => p.id === pair.id);
                if (index !== -1) {
                    const now = new Date().toISOString();
                    if (side === "source") {
                        updated[index] = { 
                            ...updated[index], 
                            source_size_bytes: res.result.bytes, 
                            source_file_count: res.result.count,
                            source_scanned_at: now,
                            scan_source_server_id: serverId
                        };
                    } else {
                        updated[index] = { 
                            ...updated[index], 
                            dest_size_bytes: res.result.bytes, 
                            dest_file_count: res.result.count,
                            dest_scanned_at: now,
                            scan_dest_server_id: serverId
                        };
                    }
                }
                return updated;
            });

            // Show Success Report
            setReportModal({
                show: true,
                type: 'success',
                title: 'Scan Successful',
                path: path,
                server: serverId,
                stats: { bytes: res.result.bytes, count: res.result.count }
            });
            updateOperation(opId, { 
                status: 'completed', 
                description: `Scan finished on ${serverName}`,
                progress: 'Done'
            });

        } catch (e: any) {
            // Show Error Report
            const errorMsg = e.response?.data?.detail || e.message || "Unknown error";
            const is404 = e.response?.status === 404;
            setReportModal({
                show: true,
                type: 'error',
                title: 'Scan Failed',
                path: path,
                server: serverId,
                message: is404
                    ? "Sync Pair not found. The database IDs might have changed."
                    : "An error occurred during the scan operation.",
                details: is404
                    ? `${errorMsg}\n\nSUGGESTION: Try clicking 'Refresh Stats' button to reload sync pairs.`
                    : errorMsg
            });
            updateOperation(opId, { 
                status: 'failed', 
                description: `Scan failed on ${serverName}`,
                progress: 'Error'
            });
        } finally {
            setScanning(prev => ({ ...prev, [key]: false }));
            // Auto remove single scan notifications after 5s to avoid clutter
            setTimeout(() => removeOperation(opId), 5000);
        }
    };

    const executeBulkScan = async (jobs: { pair: SyncPair, side: "source" | "dest", serverId: string }[]) => {
        stopBulkRequested.current = false;
        
        const opId = `bulk-scan-${Date.now()}`;
        addOperation({
            id: opId,
            type: 'scan',
            label: `Bulk Scan (${jobs.length} items)`,
            status: 'running',
            description: 'Initializing batch scan...',
            progress: '0%'
        });

        setBulkScanProgress({ total: jobs.length, completed: 0, failed: 0, currentPath: '', currentSide: '' as any, inProgress: true, isStopping: false });

        for (const [index, job] of jobs.entries()) {
            if (stopBulkRequested.current) {
                setBulkScanProgress(p => ({ ...p, isStopping: true }));
                updateOperation(opId, { status: 'failed', description: 'Scan stopped by user', progress: 'Stopped' });
                break;
            }

            const path = job.side === 'source' ? job.pair.source : job.pair.dest;
            const serverName = servers.find(s => s.id === job.serverId)?.name || (job.serverId === 'local' ? 'Local' : job.serverId);

            setBulkScanProgress(p => ({ 
                ...p, 
                currentPath: path,
                currentSide: job.side 
            }));

            // Update Global Monitor
            updateOperation(opId, { 
                description: `Scanning ${index + 1}/${jobs.length} on ${serverName}`,
                progress: `${Math.round(((index) / jobs.length) * 100)}% - ${path.substring(0, 30)}...`
            });
            
            try {
                await runScanSilent(job.pair, job.side, job.serverId);
                setBulkScanProgress(p => ({ ...p, completed: p.completed + 1 }));
            } catch (e) {
                console.error(`Bulk scan failed for ${job.pair.id} ${job.side}:`, e);
                setBulkScanProgress(p => ({ ...p, failed: p.failed + 1 }));
            }
        }
        
        setBulkScanProgress(p => ({ ...p, inProgress: false }));
        
        if (!stopBulkRequested.current) {
             updateOperation(opId, { 
                status: 'completed', 
                description: `Scanned ${jobs.length} items`, 
                progress: '100% Complete'
            });
        }
        
        // Refresh final counts
        await refreshSynclist();
    };

    const handleScanAll = async () => {
        const jobs: { pair: SyncPair, side: "source" | "dest", serverId: string }[] = [];
        
        for (const pair of synclist) {
            if (pair.scan_source_server_id) jobs.push({ pair, side: "source", serverId: pair.scan_source_server_id });
            if (pair.scan_dest_server_id) jobs.push({ pair, side: "dest", serverId: pair.scan_dest_server_id });
        }

        if (jobs.length === 0) {
            alert("No scan servers configured for any pairs.");
            return;
        }

        if (!confirm(`This will scan ${jobs.length} paths sequentially. Continue?`)) return;

        await executeBulkScan(jobs);
    };

    const executeCategoryScan = async (items: SyncPair[], mode: 'source' | 'dest' | 'both', overrideServerId?: string) => {
        const jobs: { pair: SyncPair, side: "source" | "dest", serverId: string }[] = [];
        
        for (const pair of items) {
            if (mode === 'source' || mode === 'both') {
                const sid = overrideServerId || pair.scan_source_server_id;
                if (sid) jobs.push({ pair, side: "source", serverId: sid });
            }
            if (mode === 'dest' || mode === 'both') {
                const sid = overrideServerId || pair.scan_dest_server_id;
                if (sid) jobs.push({ pair, side: "dest", serverId: sid });
            }
        }

        if (jobs.length === 0) {
            alert("No valid scan servers configured for items in this category.");
            return;
        }

        await executeBulkScan(jobs);
    };

    const handleInitiateCategoryScan = (items: SyncPair[], category: string, side?: 'source' | 'dest') => {
        setCategoryScanInfo({ category, items, side });
    };

    const handleApplyBulkDefaults = async () => {
        if (!bulkSourceServer && !bulkDestServer) {
            alert("Please select at least one server preference to apply.");
            return;
        }

        const pairIds = synclist.filter(p => p.id).map(p => p.id!);
        if (pairIds.length === 0) return;

        if (!confirm(`This will update scan server preferences for all ${pairIds.length} pairs. Continue?`)) return;

        setUpdatingBulk(true);
        try {
            await bulkUpdateScanServers({
                pair_ids: pairIds,
                source_server_id: bulkSourceServer || undefined,
                dest_server_id: bulkDestServer || undefined
            });
            await refreshSynclist();
            alert("Defaults updated successfully.");
        } catch (e) {
            console.error("Failed to update bulk defaults:", e);
            alert("Failed to update defaults.");
        } finally {
            setUpdatingBulk(false);
        }
    };

    // Silent version of runScan for bulk ops (avoids modal spam)
    const runScanSilent = async (pair: SyncPair, side: "source" | "dest", serverId: string) => {
        if (!pair.id) return;
        const key = `${pair.id}-${side}`;
        setScanning(prev => ({ ...prev, [key]: true }));

        try {
            const res = await scanPath({ pair_id: pair.id, side: side, server_id: serverId });
            
            // Update local state immediately
            setLocalSynclist(prev => {
                const updated = prev.length > 0 ? [...prev] : [...((cache.sync_pairs.data as SyncPair[]) || [])];
                const index = updated.findIndex(p => p.id === pair.id);
                if (index !== -1) {
                    const now = new Date().toISOString();
                    if (side === "source") {
                        updated[index] = { 
                            ...updated[index], 
                            source_size_bytes: res.result.bytes, 
                            source_file_count: res.result.count,
                            source_scanned_at: now,
                            scan_source_server_id: serverId
                        };
                    } else {
                        updated[index] = { 
                            ...updated[index], 
                            dest_size_bytes: res.result.bytes, 
                            dest_file_count: res.result.count,
                            dest_scanned_at: now,
                            scan_dest_server_id: serverId
                        };
                    }
                }
                return updated;
            });
        } catch (e: any) {
            console.error(`Scan failed for ${pair.id} ${side}:`, e);
        } finally {
            setScanning(prev => ({ ...prev, [key]: false }));
        }
    };

    const columns: ColumnConfig<SyncPair>[] = [
        {
            key: 'source',
            header: 'Source',
            render: (_, item) => (
                <div className="flex flex-col gap-1 max-w-[400px]">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-blue-400 line-clamp-2 break-all flex-1 leading-tight" title={item.source}>{item.source}</span>
                        <button
                            onClick={(e) => handleInitiateScan(item, "source")}
                            disabled={!item.id || scanning[`${item.id}-source`]}
                            className="p-1 text-zinc-400 hover:text-white transition rounded bg-white/5 hover:bg-white/10 shrink-0"
                            title={item.scan_source_server_id ? `Scan on ${getServerName(item.scan_source_server_id)}` : "Click to Configure Scan"}
                        >
                            <RefreshCw size={12} className={scanning[`${item.id}-source`] ? "animate-spin text-cyan-500" : ""} />
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                         <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-wider border ${
                             getServerType(item.scan_source_server_id) === 'local' 
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                                : item.scan_source_server_id ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                         }`}>
                             {getServerName(item.scan_source_server_id)}
                         </span>
                         {item.source_type && item.source_type !== 'LOCAL' && (
                             <span className="text-[9px] text-zinc-500 font-mono italic">
                                 Storage: {item.source_server_id || 'N/A'}
                             </span>
                         )}
                    </div>
                </div>
            ),
            sortable: true
        },
        {
            key: 'source_size_bytes',
            header: 'Size (TB)',
            render: (val) => <div className="text-right font-mono text-zinc-300">{formatTB(val)}</div>,
            sortable: true
        },
        {
            key: 'source_file_count',
            header: 'Files',
            render: (val) => <div className="text-right font-mono text-zinc-300">{formatCount(val)}</div>,
            sortable: true
        },
        {
            key: 'dest',
            header: 'Destination',
            render: (_, item) => (
                <div className="flex flex-col gap-1 max-w-[400px]">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-emerald-400 line-clamp-2 break-all flex-1 leading-tight" title={item.dest}>{item.dest}</span>
                        <button
                            onClick={(e) => handleInitiateScan(item, "dest")}
                            disabled={!item.id || scanning[`${item.id}-dest`]}
                            className="p-1 text-zinc-400 hover:text-white transition rounded bg-white/5 hover:bg-white/10 shrink-0"
                            title={item.scan_dest_server_id ? `Scan on ${getServerName(item.scan_dest_server_id)}` : "Click to Configure Scan"}
                        >
                            <RefreshCw size={12} className={scanning[`${item.id}-dest`] ? "animate-spin text-cyan-500" : ""} />
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                         <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-wider border ${
                             getServerType(item.scan_dest_server_id) === 'local' 
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                                : item.scan_dest_server_id ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                         }`}>
                             {getServerName(item.scan_dest_server_id)}
                         </span>
                         {item.dest_type && item.dest_type !== 'LOCAL' && (
                             <span className="text-[9px] text-zinc-500 font-mono italic">
                                 Storage: {item.dest_server_id || 'N/A'}
                             </span>
                         )}
                    </div>
                </div>
            ),
            sortable: true
        },
        {
            key: 'dest_size_bytes',
            header: 'Size (TB)',
            render: (val) => <div className="text-right font-mono text-zinc-300">{formatTB(val)}</div>,
            sortable: true
        },
        {
            key: 'dest_file_count',
            header: 'Files',
            render: (val) => <div className="text-right font-mono text-zinc-300">{formatCount(val)}</div>,
            sortable: true
        },
        {
            key: 'source_scanned_at',
            header: 'Scanned',
            render: (val, item) => (
                <div className="flex flex-col text-[10px] text-zinc-500 font-mono whitespace-nowrap leading-tight">
                    <span title="Source Scanned At">{val ? formatDate(val) : '-'}</span>
                    <span title="Dest Scanned At">{item.dest_scanned_at ? formatDate(item.dest_scanned_at) : '-'}</span>
                </div>
            ),
            sortable: true
        },

    ];

    const table = useDataTable({
        data: synclist || [],
        columns: columns,
        persistentKey: 'dashboard_list'
    });

    // Totals
    const totalSourceBytes = synclist.reduce((sum, item) => sum + (item.source_size_bytes || 0), 0);
    const totalDestBytes = synclist.reduce((sum, item) => sum + (item.dest_size_bytes || 0), 0);
    const totalSourceFiles = synclist.reduce((sum, item) => sum + (item.source_file_count || 0), 0);
    const totalDestFiles = synclist.reduce((sum, item) => sum + (item.dest_file_count || 0), 0);

    return (
        <div className="page-container pb-8">
            <PageHeader
                icon={LayoutDashboard}
                title="Dashboard"
                subtitle="Overview of sync pairs and storage statistics"
                gradient="from-blue-600 to-indigo-600"
            >
                <button
                    onClick={refreshSynclist}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition text-sm flex items-center gap-2 border border-zinc-700"
                >
                    <RefreshCw size={14} className={cache.sync_pairs.isLoading ? "animate-spin" : ""} />
                    Refresh Stats
                </button>

                <button
                    onClick={scrollToActivityMonitor}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition text-xs font-bold uppercase tracking-wider border ${
                        activeOperations.length > 0
                            ? "bg-zinc-800 text-cyan-400 border-cyan-500/30 hover:bg-zinc-700 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300"
                    }`}
                >
                    <Activity size={14} className={activeOperations.length > 0 ? "text-cyan-400 animate-pulse" : ""} />
                    Activity
                    {activeOperations.length > 0 && (
                        <span className="bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full">
                            {activeOperations.length}
                        </span>
                    )}
                </button>

                <button
                    onClick={handleScanAll}
                    disabled={cache.sync_pairs.isLoading || bulkScanProgress.inProgress}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition text-sm font-bold shadow-lg ${
                        bulkScanProgress.inProgress 
                            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed" 
                            : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/20"
                    }`}
                >
                    {bulkScanProgress.inProgress ? (
                        <RefreshCw size={14} className="animate-spin" />
                    ) : (
                        <Play size={14} />
                    )}
                    {bulkScanProgress.inProgress ? "Scanning..." : "Scan All"}
                </button>
            </PageHeader>

            {/* Bulk Scan Progress UI */}
            {bulkScanProgress.inProgress && (
                <Card className="mb-6 bg-cyan-950/20 border-cyan-500/30 overflow-hidden relative">
                    <div className="absolute top-0 left-0 h-1 bg-cyan-500 transition-all duration-500" style={{ width: `${(bulkScanProgress.completed + bulkScanProgress.failed) / bulkScanProgress.total * 100}%` }}></div>
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-lg animate-pulse">
                                <RefreshCw size={20} className="animate-spin" />
                            </div>
                            <div>
                                <h4 className="text-white font-bold text-sm">Bulk Scanning in Progress</h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${bulkScanProgress.currentSide === 'source' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                        {bulkScanProgress.currentSide}
                                    </span>
                                    <p className="text-zinc-400 text-xs font-mono truncate max-w-[300px]" title={bulkScanProgress.currentPath}>
                                        {bulkScanProgress.currentPath}
                                    </p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-8">
                            <div className="text-center">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Total</div>
                                <div className="text-lg font-mono font-bold text-white">{bulkScanProgress.total}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-[10px] uppercase font-bold text-emerald-500 mb-1">Completed</div>
                                <div className="text-lg font-mono font-bold text-emerald-400">{bulkScanProgress.completed}</div>
                            </div>
                            {bulkScanProgress.failed > 0 && (
                                <div className="text-center">
                                    <div className="text-[10px] uppercase font-bold text-red-500 mb-1">Failed</div>
                                    <div className="text-lg font-mono font-bold text-red-400">{bulkScanProgress.failed}</div>
                                </div>
                            )}
                            <div className="text-center pl-4 border-l border-white/5">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Progress</div>
                                <div className="text-lg font-mono font-bold text-cyan-400">
                                    {Math.round(((bulkScanProgress.completed + bulkScanProgress.failed) / bulkScanProgress.total) * 100)}%
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    stopBulkRequested.current = true;
                                    setBulkScanProgress(p => ({ ...p, isStopping: true }));
                                }}
                                disabled={bulkScanProgress.isStopping}
                                className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg transition text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                            >
                                <Square size={12} fill="currentColor" />
                                {bulkScanProgress.isStopping ? "Stopping..." : "Stop Scans"}
                            </button>
                        </div>
                    </div>
                </Card>
            )}



            {/* Hierarchy Dashboard */}
            <div className="mb-8">
                <HierarchyTable data={synclist} onScan={handleInitiateScan} onScanCategory={handleInitiateCategoryScan} scanning={scanning} />
            </div>

            {/* Storage Distribution by Server */}
            <div className="mb-8 overflow-x-auto">
                 <div className="flex items-center gap-2 mb-4">
                     <Server size={20} className="text-zinc-500" />
                     <h2 className="text-xl font-bold text-white">Storage Distribution</h2>
                 </div>
                 <div className="flex gap-4 pb-2">
                     {Object.entries(statsByServer).map(([id, stats]) => {
                         const s = stats as { size: number, count: number, paths: number };
                         return (
                             <Card key={id} className="min-w-[200px] bg-zinc-900/40 border-zinc-800 p-4">
                                 <div className="flex items-center justify-between mb-2">
                                     <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${id === 'local' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                         {getServerName(id)}
                                     </span>
                                     <span className="text-zinc-600 text-[10px] font-mono">{s.paths} paths</span>
                                 </div>
                                 <div className="text-xl font-bold text-white font-mono mb-1">{formatTB(s.size)}</div>
                                 <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                                     <span>{formatCount(s.count)} files</span>
                                     <span>{totalSourceBytes > 0 ? ((s.size / totalSourceBytes) * 100).toFixed(1) : 0}%</span>
                                 </div>
                                 <div className="mt-2 w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
                                     <div 
                                        className={`h-full ${id === 'local' ? 'bg-blue-500' : 'bg-purple-500'}`} 
                                        style={{ width: `${totalSourceBytes > 0 ? (s.size / (totalSourceBytes + totalDestBytes) * 100 * 2) : 0}%` }}
                                     ></div>
                                 </div>
                             </Card>
                         );
                     })}
                 </div>
            </div>

            {/* Bulk Scan Configuration */}
            {/* Bulk Scan Configuration */}
            <Card className="mb-6 bg-zinc-900/40 border-zinc-800">
                <button 
                    onClick={() => setShowBulkConfig(!showBulkConfig)}
                    className="w-full flex items-center justify-between group"
                >
                    <div className="flex items-center gap-2">
                         <div className={`p-1 rounded ${showBulkConfig ? 'bg-cyan-500/10 text-cyan-400' : 'text-zinc-500 bg-zinc-800'}`}>
                              <Database size={14} />
                         </div>
                         <h3 className="text-sm font-bold text-zinc-300 group-hover:text-white transition">Bulk Scan Defaults</h3>
                    </div>
                    {showBulkConfig ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                </button>
                
                {showBulkConfig && (
                    <div className="mt-6 animate-in slide-in-from-top-2 fade-in duration-200">
                        <div className="flex flex-col md:flex-row items-center gap-6">
                            <div className="flex flex-col gap-1.5 flex-1 w-full">
                                <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Bulk Source Scan Server</label>
                                <select
                                    value={bulkSourceServer}
                                    onChange={(e) => setBulkSourceServer(e.target.value)}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                >
                                    <option value="">-- No Change --</option>
                                    <option value="local">Local Server</option>
                                    {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1.5 flex-1 w-full">
                                <label className="text-[10px] uppercase font-bold text-emerald-500/70 tracking-wider">Bulk Dest Scan Server</label>
                                <select
                                    value={bulkDestServer}
                                    onChange={(e) => setBulkDestServer(e.target.value)}
                                    className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                >
                                    <option value="">-- No Change --</option>
                                    <option value="local">Local Server</option>
                                    {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                                </select>
                            </div>

                            <div className="flex items-end pt-5 w-full md:w-auto">
                                <button
                                    onClick={handleApplyBulkDefaults}
                                    disabled={updatingBulk || (!bulkSourceServer && !bulkDestServer)}
                                    className="w-full md:w-auto px-6 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg transition text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {updatingBulk ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                                    Apply & Save Defaults
                                </button>
                            </div>
                        </div>
                        <p className="mt-4 text-[11px] text-zinc-500 italic">
                            * Applying defaults will override individual scan server selections for all listed pairs and save them to the database.
                        </p>
                    </div>
                )}
            </Card>

            {/* Legacy Detail View */}
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <LayoutDashboard size={20} className="text-zinc-500" />
                Detail View
            </h2>
            <div className="card p-0 overflow-hidden bg-zinc-900/50 border-zinc-800/50">
                <DataTable
                    data={table.data}
                    columns={columns}
                    handleSort={table.handleSort}
                    SortIcon={table.SortIcon}
                    columnFilters={table.columnFilters}
                    onToggleColumnFilter={table.toggleColumnFilter}
                    onClearColumnFilter={table.clearColumnFilter}
                    getUniqueValues={table.getUniqueValues}
                    selectedItems={table.selectedItems}
                    onToggleItem={table.toggleItem}
                    onSelectAll={table.selectAll}
                    onInvertSelection={table.invertSelection}
                    emptyMessage="No sync pairs found. Go to Batch Generator to create some."
                    isLoading={cache.sync_pairs.isLoading}
                    compact={true}
                />
            </div>

            {/* Scan Server Selection Modal (Single Item) */}
            <ScanServerModal 
                isOpen={showScanModal && !!scanModalPair}
                onClose={() => setShowScanModal(false)}
                onSelect={(serverId, timeout) => {
                    if (scanModalPair && scanModalSide && scanModalSide !== 'both') {
                        runScan(scanModalPair, scanModalSide, serverId, timeout);
                    }
                }}
                title="Select Scan Server"
                subtitle={
                    <>
                        Select execution context for scanning:
                        <div className="mt-2 text-xs font-mono bg-black/40 p-2 rounded text-zinc-300 break-all border border-zinc-800">
                            {scanModalSide === 'source' ? scanModalPair?.source : scanModalPair?.dest}
                        </div>
                    </>
                }
                servers={servers}
                currentServerId={
                    scanModalSide === 'source' 
                        ? scanModalPair?.scan_source_server_id 
                        : scanModalPair?.scan_dest_server_id
                }
                showModeSelector={false}
                initialMode={scanModalSide === 'both' ? 'source' : (scanModalSide || 'source')}
            />
            
            {/* Unified Category Scan Selection Modal */}
            <ScanServerModal 
                isOpen={!!categoryScanInfo}
                onClose={() => setCategoryScanInfo(null)}
                onSelect={(serverId, timeout, mode) => {
                    if (categoryScanInfo) {
                        executeCategoryScan(categoryScanInfo.items, mode || 'both', serverId);
                    }
                }}
                title="Category Batch Scan"
                subtitle={ categoryScanInfo && (
                    <>
                        Configure bulk scan for <span className="text-white font-bold">{categoryScanInfo.category}</span>
                        <br/><span className="text-xs text-zinc-500">Targeting {categoryScanInfo.items.length} folders</span>
                    </>
                )}
                servers={servers}
                showModeSelector={!categoryScanInfo?.side}
                initialMode={categoryScanInfo?.side || 'both'}
            />

            
            {/* Scan Report Modal (Success/Failure) */}
            {reportModal.show && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className={`bg-zinc-900 border rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-200 ${reportModal.type === 'success' ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
                        <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-xl ${reportModal.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {reportModal.type === 'success' ? <CheckCircle size={24} /> : <AlertTriangle size={24} />}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-white mb-1">{reportModal.title}</h3>
                                {reportModal.message && <p className="text-zinc-400 text-sm mb-3">{reportModal.message}</p>}

                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between py-1 border-b border-zinc-800">
                                        <span className="text-zinc-500">Path</span>
                                        <span className="text-zinc-300 font-mono text-xs max-w-[250px] truncate" title={reportModal.path}>{reportModal.path}</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-zinc-800">
                                        <span className="text-zinc-500">Server</span>
                                        <span className="text-zinc-300">{reportModal.server === 'local' ? 'Local' : 'SSH Remote'}</span>
                                    </div>

                                    {reportModal.stats && (
                                        <>
                                            <div className="flex justify-between py-1 border-b border-zinc-800">
                                                <span className="text-zinc-500">Total Size</span>
                                                <span className="text-white font-mono font-bold">{formatBytes(reportModal.stats.bytes)}</span>
                                            </div>
                                            <div className="flex justify-between py-1 border-b border-zinc-800">
                                                <span className="text-zinc-500">File Count</span>
                                                <span className="text-white font-mono">{formatCount(reportModal.stats.count)}</span>
                                            </div>
                                        </>
                                    )}

                                    {reportModal.details && (
                                        <div className="mt-4">
                                            <div className="text-xs text-zinc-500 mb-1 uppercase font-bold">Error Details</div>
                                            <div className="bg-red-950/30 text-red-300 p-3 rounded text-xs font-mono border border-red-500/20 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">
                                                {reportModal.details}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end mt-6">
                            <button
                                onClick={() => setReportModal(prev => ({ ...prev, show: false }))}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition text-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DashboardPage;
