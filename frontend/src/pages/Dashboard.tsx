
import React, { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, RefreshCw, HardDrive, Database, Clock, Server, Play, MoreHorizontal, CheckCircle, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useIsyncData } from '../contexts/IsyncDataContext';
import { formatDate } from '../utils/formatters';
import { scanPath, SyncPair, SSHServer, fetchSSHServers, fetchSyncList } from '../api';
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

    const handleInitiateScan = (pair: SyncPair, side: "source" | "dest", forceModal: boolean = false) => {
        const currentServerId = side === "source" ? pair.scan_source_server_id : pair.scan_dest_server_id;

        if (currentServerId && !forceModal) {
            runScan(pair, side, currentServerId, scanTimeout);
        } else {
            setScanModalPair(pair);
            setScanModalSide(side);
            setShowScanModal(true);
        }
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

            await refreshSynclist();

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
        if (!confirm('This will trigger scans for ALL configured pairs. Continue?')) return;

        // We do not show modals for "Scan All" to avoid spam. FAILURES will be alerted though? 
        // Or maybe we create a "Bulk Report"? 
        // For simplicity, we fallback to simple logging or just let individual errors pop?
        // Actually showing 20 modals is bad.
        // Let's just run them and maybe aggregate results?
        // Given complexity, I will just run them and suppress success modals, but show failure modals (stacked? or just log?).
        // Or simpler: Just run them.

        for (const pair of synclist) {
            if (pair.scan_source_server_id) runScanSilent(pair, "source", pair.scan_source_server_id);
            if (pair.scan_dest_server_id) runScanSilent(pair, "dest", pair.scan_dest_server_id);
        }
        alert("Bulk scan initiated in background.");
    };

    // Silent version of runScan for bulk ops (avoids modal spam)
    const runScanSilent = async (pair: SyncPair, side: "source" | "dest", serverId: string) => {
        if (!pair.id) return;
        const key = `${pair.id}-${side}`;
        setScanning(prev => ({ ...prev, [key]: true }));

        try {
            await scanPath({ pair_id: pair.id, side: side, server_id: serverId });
            await refreshSynclist();
        } catch (e: any) {
            console.error(`Scan failed for ${pair.id} ${side}:`, e);
            // Optionally toast error?
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
                            onClick={(e) => handleInitiateScan(item, "source", e.shiftKey)}
                            disabled={!item.id || scanning[`${item.id}-source`]}
                            className="p-1.5 text-zinc-400 hover:text-white transition rounded bg-white/5 hover:bg-white/10"
                            title={item.scan_source_server_id ? `Scan on ${item.scan_source_server_id} (Shift+Click to configure)` : "Click to Configure Scan"}
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
                            onClick={(e) => handleInitiateScan(item, "dest", e.shiftKey)}
                            disabled={!item.id || scanning[`${item.id}-dest`]}
                            className="p-1.5 text-zinc-400 hover:text-white transition rounded bg-white/5 hover:bg-white/10"
                            title={item.scan_dest_server_id ? `Scan on ${item.scan_dest_server_id} (Shift+Click to configure)` : "Click to Configure Scan"}
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
                    disabled={cache.sync_pairs.isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition text-sm font-bold shadow-lg shadow-cyan-900/20"
                >
                    <Play size={14} />
                    Scan All
                </button>
            </PageHeader>

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
                                className="w-full flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition border border-zinc-800 hover:border-zinc-600 group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg group-hover:bg-blue-500/20 transition">
                                        <Database size={16} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-white font-medium text-sm">Local Server</div>
                                        <div className="text-xs text-zinc-500">Run locally</div>
                                    </div>
                                </div>
                            </button>

                            {Array.isArray(servers) ? servers.map(srv => (
                                <button
                                    key={srv.id}
                                    onClick={() => runScan(scanModalPair, scanModalSide!, srv.id, scanTimeout)}
                                    className="w-full flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition border border-zinc-800 hover:border-zinc-600 group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg group-hover:bg-purple-500/20 transition">
                                            <Server size={16} />
                                        </div>
                                        <div className="text-left">
                                            <div className="text-white font-medium text-sm">{srv.name}</div>
                                            <div className="text-xs text-zinc-500">{srv.host}</div>
                                        </div>
                                    </div>
                                </button>
                            )) : null}
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
