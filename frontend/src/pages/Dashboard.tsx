
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LayoutDashboard, RefreshCw, HardDrive, Database, Clock, Server, Play, MoreHorizontal, CheckCircle, XCircle, AlertTriangle, FileText, Square } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useIsyncData } from '../contexts/IsyncDataContext';
import { formatDate } from '../utils/formatters';
import { scanPath, SyncPair, SSHServer, fetchSSHServers, fetchSyncList, bulkUpdateScanServers } from '../api';
import { useDataTable } from '../hooks/useDataTable';

// Format bytes
const formatBytes = (bytes?: number) => {
    if (bytes === undefined || bytes === null) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatCount = (count?: number) => {
    if (count === undefined || count === null) return '-';
    return count.toLocaleString();
};

const DashboardPage: React.FC = () => {
    const { cache, loadPayload, setLoading, invalidate, setCached } = useIsyncData();
    const [localSynclist, setLocalSynclist] = useState<SyncPair[]>([]);
    const [scanTimeout, setScanTimeout] = useState(1200);

    const synclist = localSynclist.length > 0 ? localSynclist : ((cache.sync_pairs.data as SyncPair[]) || []);
    const servers = (cache.ssh_servers.data as SSHServer[]) || [];

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

    const stopBulkRequested = useRef(false);

    // Scan Configuration Modal
    const [scanModalPair, setScanModalPair] = useState<SyncPair | null>(null);
    const [scanModalSide, setScanModalSide] = useState<"source" | "dest" | null>(null);
    const [showScanModal, setShowScanModal] = useState(false);

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
                    loadPayload('ssh_servers', 'local');
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

    const runScan = async (pair: SyncPair, side: "source" | "dest", serverId: string, timeout: number = 1200) => {
        if (!pair.id) return;
        const key = `${pair.id}-${side}`;
        const path = side === "source" ? pair.source : pair.dest;

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
        } finally {
            setScanning(prev => ({ ...prev, [key]: false }));
        }
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

        stopBulkRequested.current = false;
        setBulkScanProgress({ total: jobs.length, completed: 0, failed: 0, currentPath: '', currentSide: '', inProgress: true, isStopping: false });

        for (const job of jobs) {
            if (stopBulkRequested.current) {
                setBulkScanProgress(p => ({ ...p, isStopping: true }));
                break;
            }

            setBulkScanProgress(p => ({ 
                ...p, 
                currentPath: job.side === 'source' ? job.pair.source : job.pair.dest,
                currentSide: job.side 
            }));
            
            try {
                await runScanSilent(job.pair, job.side, job.serverId);
                setBulkScanProgress(p => ({ ...p, completed: p.completed + 1 }));
            } catch (e) {
                console.error(`Bulk scan failed for ${job.pair.id} ${job.side}:`, e);
                setBulkScanProgress(p => ({ ...p, failed: p.failed + 1 }));
            }
        }
        
        setBulkScanProgress(p => ({ ...p, inProgress: false }));
        // Refresh final counts
        await refreshSynclist();
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
                <div className="flex flex-col gap-1 max-w-[200px]">
                    <span className="font-mono text-xs text-blue-400 truncate" title={item.source}>{item.source}</span>
                    <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => handleInitiateScan(item, "source")}
                                disabled={!item.id || scanning[`${item.id}-source`]}
                                className="p-1.5 text-zinc-400 hover:text-white transition rounded bg-white/5 hover:bg-white/10"
                                title={item.scan_source_server_id ? `Scan on ${item.scan_source_server_id}` : "Click to Configure Scan"}
                            >
                                <RefreshCw size={12} className={scanning[`${item.id}-source`] ? "animate-spin text-cyan-500" : ""} />
                            </button>
                            <span className="text-[10px] text-zinc-600 bg-black/30 px-1.5 py-0.5 rounded border border-white/5 uppercase min-w-[30px] text-center">
                                {item.scan_source_server_id === 'local' ? 'LOC' : item.scan_source_server_id ? 'SSH' : '?'}
                            </span>
                    </div>
                </div>
            )
        },
        {
            key: 'source_size_bytes',
            header: 'Size',
            render: (val) => <span className="font-mono text-zinc-300">{formatBytes(val)}</span>,
            sortable: true
        },
        {
            key: 'source_file_count',
            header: 'Files',
            render: (val) => <span className="font-mono text-zinc-300">{formatCount(val)}</span>,
            sortable: true
        },
        {
            key: 'dest',
            header: 'Destination',
            render: (_, item) => (
                <div className="flex flex-col gap-1 max-w-[200px]">
                    <span className="font-mono text-xs text-emerald-400 truncate" title={item.dest}>{item.dest}</span>
                    <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => handleInitiateScan(item, "dest")}
                                disabled={!item.id || scanning[`${item.id}-dest`]}
                                className="p-1.5 text-zinc-400 hover:text-white transition rounded bg-white/5 hover:bg-white/10"
                                title={item.scan_dest_server_id ? `Scan on ${item.scan_dest_server_id}` : "Click to Configure Scan"}
                            >
                                <RefreshCw size={12} className={scanning[`${item.id}-dest`] ? "animate-spin text-cyan-500" : ""} />
                            </button>
                            <span className="text-[10px] text-zinc-600 bg-black/30 px-1.5 py-0.5 rounded border border-white/5 uppercase min-w-[30px] text-center">
                                {item.scan_dest_server_id === 'local' ? 'LOC' : item.scan_dest_server_id ? 'SSH' : '?'}
                            </span>
                    </div>
                </div>
            )
        },
        {
            key: 'dest_size_bytes',
            header: 'Size',
            render: (val) => <span className="font-mono text-zinc-300">{formatBytes(val)}</span>,
            sortable: true
        },
        {
            key: 'dest_file_count',
            header: 'Files',
            render: (val) => <span className="font-mono text-zinc-300">{formatCount(val)}</span>,
            sortable: true
        },
        {
            key: 'source_scanned_at',
            header: 'Scanned',
            render: (val, item) => (
                <div className="flex flex-col text-[10px] text-zinc-500 font-mono">
                    <span title="Source Scanned At">{val ? formatDate(val) : '-'}</span>
                    <span title="Dest Scanned At">{item.dest_scanned_at ? formatDate(item.dest_scanned_at) : '-'}</span>
                </div>
            ),
            sortable: true
        },
        {
            key: 'id',
            header: 'Actions',
            render: (_, item) => (
                <button
                    onClick={() => {
                        handleInitiateScan(item, "source");
                        handleInitiateScan(item, "dest");
                    }}
                    className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded transition"
                    title="Scan Both"
                >
                    <Play size={14} />
                </button>
            )
        }
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

            {/* Bulk Scan Configuration */}
            <Card className="mb-6 bg-zinc-900/40 border-zinc-800">
                <div className="flex flex-col md:flex-row items-center gap-6">
                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Bulk Source Scan Server</label>
                        <select
                            value={bulkSourceServer}
                            onChange={(e) => setBulkSourceServer(e.target.value)}
                            className="bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        >
                            <option value="">-- No Change --</option>
                            <option value="local">Local Server</option>
                            {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-[10px] uppercase font-bold text-emerald-500/70 tracking-wider">Bulk Dest Scan Server</label>
                        <select
                            value={bulkDestServer}
                            onChange={(e) => setBulkDestServer(e.target.value)}
                            className="bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                        >
                            <option value="">-- No Change --</option>
                            <option value="local">Local Server</option>
                            {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                        </select>
                    </div>

                    <div className="flex items-end pt-5">
                        <button
                            onClick={handleApplyBulkDefaults}
                            disabled={updatingBulk || (!bulkSourceServer && !bulkDestServer)}
                            className="px-6 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg transition text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {updatingBulk ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                            Apply & Save Defaults
                        </button>
                    </div>
                </div>
                <p className="mt-4 text-[11px] text-zinc-500 italic">
                    * Applying defaults will override individual scan server selections for all listed pairs and save them to the database.
                </p>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <Card className="bg-gradient-to-br from-blue-900/20 to-black/40 border-blue-500/20">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20">
                            <Database size={24} />
                        </div>
                        <div>
                            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Source Total</div>
                            <div className="text-2xl font-bold text-white font-mono">{formatBytes(totalSourceBytes)}</div>
                            <div className="text-xs text-zinc-400 font-mono">{formatCount(totalSourceFiles)} files</div>
                        </div>
                    </div>
                </Card>
                <Card className="bg-gradient-to-br from-emerald-900/20 to-black/40 border-emerald-500/20">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                            <HardDrive size={24} />
                        </div>
                        <div>
                            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Destination Total</div>
                            <div className="text-2xl font-bold text-white font-mono">{formatBytes(totalDestBytes)}</div>
                            <div className="text-xs text-zinc-400 font-mono">{formatCount(totalDestFiles)} files</div>
                        </div>
                    </div>
                </Card>
            </div>

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
                />
            </div>

            {/* Scan Server Selection Modal */}
            {showScanModal && scanModalPair && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                        <h3 className="text-lg font-bold text-white mb-2">Select Scan Server</h3>
                        <p className="text-zinc-400 text-sm mb-4">
                            Select execution context for scanning:
                            <div className="mt-2 text-xs font-mono bg-black/40 p-2 rounded text-zinc-300 break-all border border-zinc-800">
                                {scanModalSide === 'source' ? scanModalPair.source : scanModalPair.dest}
                            </div>
                        </p>

                        <div className="mb-4">
                            <label className="block text-xs uppercase text-zinc-500 font-bold mb-1">Scan Timeout (Seconds)</label>
                            <input
                                type="number"
                                value={scanTimeout}
                                onChange={(e) => setScanTimeout(parseInt(e.target.value) || 1200)}
                                className="w-full bg-black/40 border border-zinc-700 rounded p-2 text-white text-sm focus:border-blue-500 outline-none transition"
                                min="10"
                            />
                            <p className="text-[10px] text-zinc-600 mt-1">Increase for large drives (Default: 1200s)</p>
                        </div>

                        <div className="space-y-2 mb-6 max-h-[300px] overflow-y-auto pr-1">
                            <button
                                onClick={() => runScan(scanModalPair, scanModalSide!, 'local', scanTimeout)}
                                className={`w-full flex items-center justify-between p-3 rounded-lg transition border group ${
                                    (scanModalSide === 'source' ? scanModalPair.scan_source_server_id : scanModalPair.scan_dest_server_id) === 'local'
                                        ? 'bg-blue-600/20 border-blue-500/50 hover:bg-blue-600/30'
                                        : 'bg-zinc-800 border-zinc-800 hover:bg-zinc-700 hover:border-zinc-600'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg transition ${
                                        (scanModalSide === 'source' ? scanModalPair.scan_source_server_id : scanModalPair.scan_dest_server_id) === 'local'
                                            ? 'bg-blue-500/20 text-blue-400'
                                            : 'bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20'
                                    }`}>
                                        <Database size={16} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-white font-medium text-sm flex items-center gap-2">
                                            Local Server
                                            {(scanModalSide === 'source' ? scanModalPair.scan_source_server_id : scanModalPair.scan_dest_server_id) === 'local' && (
                                                <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold uppercase">Current</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-zinc-500">Run locally</div>
                                    </div>
                                </div>
                            </button>

                            {Array.isArray(servers) ? servers.map(srv => {
                                const isCurrent = (scanModalSide === 'source' ? scanModalPair.scan_source_server_id : scanModalPair.scan_dest_server_id) === srv.id;
                                return (
                                    <button
                                        key={srv.id}
                                        onClick={() => runScan(scanModalPair, scanModalSide!, srv.id, scanTimeout)}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg transition border group ${
                                            isCurrent
                                                ? 'bg-purple-600/20 border-purple-500/50 hover:bg-purple-600/30'
                                                : 'bg-zinc-800 border-zinc-800 hover:bg-zinc-700 hover:border-zinc-600'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg transition ${
                                                isCurrent
                                                    ? 'bg-purple-500/20 text-purple-400'
                                                    : 'bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20'
                                            }`}>
                                                <Server size={16} />
                                            </div>
                                            <div className="text-left">
                                                <div className="text-white font-medium text-sm flex items-center gap-2">
                                                    {srv.name}
                                                    {isCurrent && (
                                                        <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded font-bold uppercase">Current</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-zinc-500">{srv.host}</div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            }) : null}
                        </div>

                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowScanModal(false)}
                                className="px-4 py-2 text-zinc-400 hover:text-white transition text-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
