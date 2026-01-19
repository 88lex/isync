
import { useState, useEffect, useMemo } from 'react';
import {
    RefreshCw, HardDrive, Plus, Trash2, Edit2, CheckCircle,
    X, Save, Copy, Server, Shield, ShieldAlert, ArrowRight,
    AlertTriangle, Info, XCircle, Search, Filter, MoreHorizontal, EyeOff, Zap,
    FileText, ArrowDown, ArrowUpDown, ChevronDown
} from 'lucide-react';
import axios from 'axios';
import {
    fetchSSHServers, SSHServer,
    listRemotesWithFlags, RemoteWithFlags, RemoteFlags,
    addRemoteFlag, removeRemoteFlag, testBatchConnections, deleteRemoteWithConfirm,
    BatchTestResult, backupRcloneConfig, copyRcloneConfig, checkRcloneDuplicates, fetchConfig, updateConfig, updateLocalRemote
} from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useSortableData } from '../hooks/useSortableData';
import { useIsyncData } from '../contexts/IsyncDataContext';
// Consolidated lucide-react imports above

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

interface RcloneRemote {
    name: string;
    type: string;
    config: Record<string, string>;
}

const RcloneManagement: React.FC = () => {
    const { rcloneManager, setRcloneManager } = useIsyncData();
    const { source, servers, selectedServer, remotes, searchFilter, statusFilter } = rcloneManager;

    const [loading, setLoading] = useState(remotes.length === 0);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    // Unified Selection state
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    const [testing, setTesting] = useState(false);

    // Filter Updaters
    const setSource = (val: 'local' | 'remote') => setRcloneManager(prev => ({ ...prev, source: val }));
    const setServers = (val: any[]) => setRcloneManager(prev => ({ ...prev, servers: val }));
    const setSelectedServer = (val: string) => setRcloneManager(prev => ({ ...prev, selectedServer: val }));
    const setRemotes = (val: any[]) => setRcloneManager(prev => ({ ...prev, remotes: val, lastUpdated: Date.now() }));
    const setSearchFilter = (val: string) => setRcloneManager(prev => ({ ...prev, searchFilter: val }));
    const setStatusFilter = (val: any) => setRcloneManager(prev => ({ ...prev, statusFilter: val }));

    // Other state
    const [showAddModal, setShowAddModal] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [showDupModal, setShowDupModal] = useState(false);

    const [newRemoteName, setNewRemoteName] = useState('');
    const [newRemoteType, setNewRemoteType] = useState('drive');
    const [newRemoteConfig, setNewRemoteConfig] = useState('');
    const [editingRemote, setEditingRemote] = useState<string | null>(null);
    const [editConfig, setEditConfig] = useState('');

    const [duplicateResults, setDuplicateResults] = useState<any[]>([]);

    const [testResults, setTestResults] = useState<any[]>([]);

    // Sorting
    const { sortedData: sortedRemotes, handleSort: requestSort, SortIcon } = useSortableData({ data: remotes });
    const [excludedRemotes, setExcludedRemotes] = useState<string[]>([]);

    // Push Modal State
    const [showPushModal, setShowPushModal] = useState(false);
    const [targetSshServers, setTargetSshServers] = useState<Set<string>>(new Set());
    const [pushStatus, setPushStatus] = useState<string | null>(null); // null, 'pushing', 'complete'
    const [pushProgress, setPushProgress] = useState<string[]>([]);
    const [copyDest, setCopyDest] = useState('local');
    const [copyMode, setCopyMode] = useState<'backup' | 'replace'>('backup');

    const [sourcePath, setSourcePath] = useState('');
    const [destPath, setDestPath] = useState('');
    const [customName, setCustomName] = useState('');
    const [copyLoading, setCopyLoading] = useState(false);

    const [copyStep, setCopyStep] = useState<'config' | 'confirm'>('config');
    const [previewData, setPreviewData] = useState<any>(null);

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        // Load remotes if missing or source changes
        loadRemotes();
        fetchConfig().then(c => setExcludedRemotes(c.excluded_remotes || [])).catch(console.error);
    }, [source, selectedServer]);

    const loadServers = async () => {
        try {
            const s = await fetchSSHServers();
            setServers(s);
            if (s.length > 0) {
                setSelectedServer(s[0].id);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const loadRemotes = async (force: boolean = false) => {
        if (!force && rcloneManager.lastUpdated > 0 && remotes.length > 0) return;

        setLoading(true);
        setSelectedItems(new Set());

        try {
            if (source === 'local') {
                const res = await listRemotesWithFlags();
                setRemotes(res.remotes);
            } else if (selectedServer) {
                const res = await listRemotesWithFlags(selectedServer);
                setRemotes(res.remotes);
            } else {
                setRemotes([]);
            }
        } catch (e: any) {
            console.error(e);
            setMessage(`Error: ${e.message} `);
        } finally {
            setLoading(false);
        }
    };

    const handleSetFlag = async (remoteName: string, flagType: 'ignored' | 'protected') => {
        try {
            await addRemoteFlag(remoteName, flagType);
            await loadRemotes(true);
            setMessage(`Marked ${remoteName} as ${flagType} `);
        } catch (e: any) {
            setMessage(`Error: ${e.message} `);
        }
    };

    const handleExclude = async (remoteName: string) => {
        if (!confirm(`Exclude remote "${remoteName}" ? It will be hidden from all lists.`)) return;
        try {
            const config = await fetchConfig();
            const current = config.excluded_remotes || [];
            if (!current.includes(remoteName)) {
                const next = [...current, remoteName];
                await updateConfig({ excluded_remotes: next });
                setExcludedRemotes(next);
                // Refresh list
                loadRemotes(true);
            }
        } catch (e: any) {
            setMessage(`Failed to exclude: ${e.message} `);
        }
    };

    const handleBulkExclude = async () => {
        const selected = Array.from(selectedItems);
        if (selected.length === 0) return;
        if (!confirm(`Exclude ${selected.length} selected remote(s) ? `)) return;

        try {
            const config = await fetchConfig();
            const current = config.excluded_remotes || [];
            const next = [...current];
            let added = 0;

            selected.forEach(name => {
                if (!next.includes(name)) {
                    next.push(name);
                    added++;
                }
            });

            if (added > 0) {
                await updateConfig({ excluded_remotes: next });
                setExcludedRemotes(next);
                await loadRemotes(true);
                setSelectedItems(new Set());
                setMessage(`Excluded ${added} remotes.`);
            }
        } catch (e: any) {
            setMessage(`Failed to exclude: ${e.message} `);
        }
    };

    const handleClearFlag = async (remoteName: string) => {
        try {
            await removeRemoteFlag(remoteName, 'ignored');
            await removeRemoteFlag(remoteName, 'protected');
            await loadRemotes(true);
            setMessage(`Cleared flag for ${remoteName}`);
        } catch (e: any) {
            setMessage(`Error: ${e.message} `);
        }
    };

    const handleBulkSetFlag = async (flagType: 'ignored' | 'protected') => {
        const selected = Array.from(selectedItems);
        if (selected.length === 0) return;

        setLoading(true);
        for (const name of selected) {
            try {
                await addRemoteFlag(name, flagType);
            } catch (e) {
                console.error(e);
            }
        }
        await loadRemotes(true);
        setSelectedItems(new Set());
        setMessage(`Marked ${selected.length} remotes as ${flagType} `);
    };

    const handleTestSelected = async () => {
        const selected = Array.from(selectedItems);
        if (selected.length === 0) return;

        setTesting(true);
        setTestResults([]);
        try {
            const serverId = source === 'remote' ? selectedServer : undefined;
            const res = await testBatchConnections(selected, serverId);
            setTestResults(res.results);
            setMessage(`Tested ${res.total}: ${res.ok} OK, ${res.failed} failed`);
        } catch (e: any) {
            setMessage(`Error: ${e.message} `);
        } finally {
            setTesting(false);
        }
    };

    const handleDeleteRemote = async (name: string, confirm: boolean = false) => {
        try {
            const serverId = source === 'remote' ? selectedServer : undefined;
            await deleteRemoteWithConfirm(name, confirm, serverId);
            await loadRemotes(true);
            setMessage(`Deleted${name}`);
        } catch (e: any) {
            if (e.response?.status === 403) {
                // Protected remote, ask for confirmation
                if (window.confirm(`Remote "${name}" is protected.Delete anyway ? `)) {
                    await handleDeleteRemote(name, true);
                }
            } else {
                setMessage(`Error: ${e.message} `);
            }
        }
    };

    const handleEdit = (remote: RcloneRemote) => {
        setEditingRemote(remote.name);
        setEditConfig(JSON.stringify(remote.config, null, 2));
    };

    const handleSaveEdit = async () => {
        if (!editingRemote) return;
        try {
            const config = JSON.parse(editConfig);
            await updateLocalRemote(editingRemote, config);
            setMessage('✓ Remote updated');
            setEditingRemote(null);
            await loadRemotes(true);
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete remote "${name}" ? `)) return;

        try {
            await axios.delete(`${API_BASE}/rclone/remotes/${name}`);
            setMessage('✓ Remote deleted');
            await loadRemotes(true);
        } catch (e: any) {
            setMessage(`Error: ${e.message} `);
        }
    };

    const handleAdd = async () => {
        if (!newRemoteName || !newRemoteType) return;

        try {
            const config = newRemoteConfig ? JSON.parse(newRemoteConfig) : {};
            await axios.post(`${API_BASE}/rclone/remotes`, {
                name: newRemoteName,
                type: newRemoteType,
                config
            });
            setMessage('✓ Remote created');
            setShowAddModal(false);
            setNewRemoteName('');
            setNewRemoteType('drive');
            setNewRemoteConfig('');
            await loadRemotes(true);
        } catch (e: any) {
            setMessage(`Error: ${e.message} `);
        }
    };

    const handleCopyToLocal = async () => {
        if (selectedItems.size === 0 || !selectedServer) return;

        try {
            await axios.post(`${API_BASE}/rclone/remote/pull`, {
                server_id: selectedServer,
                remote_names: Array.from(selectedItems)
            });
            setMessage(`✓ Copied ${selectedItems.size} remotes to local`);
            setSelectedItems(new Set());
        } catch (e: any) {
            setMessage(`Error: ${e.message} `);
        }
    };

    const handlePushToRemote = () => {
        if (selectedItems.size === 0) return;
        setTargetSshServers(new Set());
        setPushStatus(null);
        setPushProgress([]);
        setShowPushModal(true);
    };

    const handleConfirmPush = async () => {
        if (targetSshServers.size === 0) return;

        setPushStatus('pushing');
        setPushProgress([]);
        const targets = Array.from(targetSshServers);
        const remotesToPush = Array.from(selectedItems);
        let successCount = 0;

        for (const serverId of targets) {
            const serverName = servers.find(s => s.id === serverId)?.name || serverId;
            setPushProgress(prev => [...prev, `Pushing to ${serverName}...`]);

            try {
                const res = await axios.post(`${API_BASE}/rclone/remote/push`, {
                    server_id: serverId,
                    remote_names: remotesToPush
                });

                if (res.data.status === 'ok') {
                    setPushProgress(prev => {
                        const next = [...prev];
                        next[next.length - 1] = `✓ ${serverName}: Success(Updated ${res.data.target_path})`;
                        // Add trace if available (for debugging)
                        if (res.data.debug_trace) {
                            res.data.debug_trace.forEach((t: string) => next.push(`    > ${t} `));
                        }
                        return next;
                    });
                    successCount++;
                } else {
                    throw new Error(res.data.message || "Unknown error");
                }
            } catch (e: any) {
                setPushProgress(prev => {
                    const next = [...prev];
                    next[next.length - 1] = `✗ ${serverName}: Failed - ${e.message} `;
                    // If we have a trace in the error response (handled via axios interceptor mostly, but let's check response data if available)
                    if (e.response?.data?.debug_trace) {
                        e.response.data.debug_trace.forEach((t: string) => next.push(`    > ${t} `));
                    }
                    return next;
                });
            }


        }

        setPushStatus('complete');
        if (successCount === targets.length) {
            setMessage(`✓ Successfully pushed to ${successCount} SSH servers`);
            setTimeout(() => {
                setShowPushModal(false);
                setSelectedItems(new Set());
            }, 1000); // Auto close on full success
        } else {
            setMessage(`Completed with errors.Pushed to ${successCount}/${targets.length} servers.`);
        }
    };

    return (

        <div className="space-y-4">
            <PageHeader
                icon={HardDrive}
                title="Rclone Manager"
                subtitle="View and edit rclone remotes on local or remote servers"
                compact={true}
            />

            {/* Source & Server Selector */}
            <Card>
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-400">Source:</span>
                        <select
                            value={source}
                            onChange={(e) => setSource(e.target.value as 'local' | 'remote')}
                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white"
                        >
                            <option value="local">Local Machine</option>
                            <option value="remote">Remote Server</option>
                        </select>
                    </div>

                    {source === 'remote' && (
                        <div className="flex items-center gap-2">
                            <Server size={16} className="text-cyan-400" />
                            <select
                                value={selectedServer}
                                onChange={(e) => setSelectedServer(e.target.value)}
                                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white"
                            >
                                {servers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <button
                        onClick={() => loadRemotes(true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm text-white transition disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>

                    <button
                        onClick={handleBulkExclude}
                        disabled={selectedItems.size === 0}
                        className="flex items-center gap-2 px-3 py-2 bg-orange-900/30 hover:bg-orange-800/50 disabled:opacity-50 disabled:cursor-not-allowed text-orange-400 rounded-lg text-sm transition border border-orange-900/50"
                    >
                        <ShieldAlert size={14} />
                        Exclude ({selectedItems.size})
                    </button>


                    {source === 'local' && (
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white transition"
                        >
                            <Plus size={14} />
                            Add Remote
                        </button>
                    )}
                </div>
            </Card>

            {/* Tools Section */}
            <Card>
                <div className="flex items-center gap-4 flex-wrap">
                    <h3 className="text-sm font-medium text-zinc-400 mr-2">Config Tools:</h3>

                    <button onClick={async () => {
                        const target = source === 'local' ? 'local' : selectedServer;
                        if (!target) return;
                        setLoading(true);
                        try {
                            const res = await backupRcloneConfig(target);
                            setMessage(`✓ Backup created: ${res.backup_path}`);
                        } catch (e: any) { setMessage(`Error: ${e.message}`); }
                        finally { setLoading(false); }
                    }} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white">
                        <Save size={14} /> Backup Config
                    </button>

                    <button onClick={() => setShowCopyModal(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white">
                        <Copy size={14} /> Copy Config
                    </button>

                    <button onClick={async () => {
                        const target = source === 'local' ? 'local' : selectedServer;
                        if (!target) return;
                        setLoading(true);
                        try {
                            const res = await checkRcloneDuplicates(target);
                            if (res.has_duplicates) {
                                setDuplicateResults(res.duplicates);
                                setShowDupModal(true);
                            } else {
                                setMessage("✓ No duplicates found in config");
                            }
                        } catch (e: any) { setMessage(`Error: ${e.message}`); }
                        finally { setLoading(false); }
                    }} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white">
                        <Shield size={14} /> Check Duplicates
                    </button>
                </div>
            </Card>


            {/* Unified Remotes View */}
            <>
                {/* Actions for Selected Items */}
                <Card>
                    <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-sm text-zinc-400">{selectedItems.size} selected</span>

                        {source === 'remote' && (
                            <button
                                onClick={handleCopyToLocal}
                                className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white transition"
                            >
                                <Copy size={14} />
                                Copy to Local
                            </button>
                        )}

                        {source === 'local' && (
                            <>
                                <button
                                    onClick={handlePushToRemote}
                                    className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm text-white transition"
                                >
                                    <Server size={14} />
                                    Push to SSH
                                </button>
                                <button
                                    onClick={() => handleBulkSetFlag('ignored')}
                                    className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm text-white transition"
                                >
                                    <EyeOff size={14} />
                                    Ignore
                                </button>
                                <button
                                    onClick={() => handleBulkSetFlag('protected')}
                                    className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm text-white transition"
                                >
                                    <Shield size={14} />
                                    Protect
                                </button>
                            </>
                        )}
                        <button
                            onClick={handleTestSelected}
                            disabled={testing}
                            className="flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm text-white transition"
                        >
                            <Zap size={14} className={testing ? 'animate-pulse' : ''} />
                            Test
                        </button>
                    </div>
                </Card>

                {/* Remotes Table */}
                <div className="mb-4">
                    <h3 className="text-base font-medium text-white flex items-center gap-2 mb-2">
                        <HardDrive size={18} className="text-purple-400" />
                        Remotes ({remotes.length})
                    </h3>

                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                                type="text"
                                value={searchFilter}
                                onChange={(e) => setSearchFilter(e.target.value)}
                                placeholder="Filter remotes..."
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                            />
                        </div>
                        <div className="flex gap-1">
                            {(['all', 'normal', 'ignored', 'protected'] as const).map(filter => (
                                <button
                                    key={filter}
                                    onClick={() => setStatusFilter(filter)}
                                    className={`px-3 py-2 rounded-lg text-xs font-medium transition ${statusFilter === filter
                                        ? filter === 'ignored' ? 'bg-zinc-600 text-white'
                                            : filter === 'protected' ? 'bg-amber-600 text-white'
                                                : 'bg-purple-600 text-white'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                        }`}
                                >
                                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <DataTable
                        compact={true}
                        data={sortedRemotes.filter(r => {
                            const matchesSearch = r.name.toLowerCase().includes(searchFilter.toLowerCase());
                            const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
                            return matchesSearch && matchesStatus;
                        })}
                        columns={[
                            {
                                key: 'name',
                                header: 'Name',
                                sortable: true,
                                width: '200px',
                                render: (val, item) => (
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-zinc-200 truncate">{val}</span>
                                        {item.status === 'ignored' && <span className="text-[9px] bg-red-900/30 text-red-400 px-1 py-0 rounded leading-none">Ignored</span>}
                                        {item.status === 'protected' && <span className="text-[9px] bg-amber-900/30 text-amber-400 px-1 py-0 rounded leading-none">Protected</span>}
                                    </div>
                                )
                            },
                            {
                                key: 'type',
                                header: 'Type',
                                sortable: true,
                                width: '100px',
                                render: (val) => (
                                    <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/50 px-1.5 py-0.5 rounded border border-zinc-800">{val}</span>
                                )
                            },
                            {
                                key: 'config',
                                header: 'Config Parameters',
                                render: (val) => (
                                    <div className="flex flex-col gap-0.5 text-[10px] leading-tight font-mono">
                                        {Object.entries(val || {}).map(([k, v]) => (
                                            <div key={k} className="flex items-start gap-1">
                                                <span className="text-zinc-500 shrink-0">{k}=</span>
                                                <span className={`${k === 'service_account_file' ? 'text-amber-400 font-bold' : 'text-zinc-300'} break-all`}>
                                                    {String(v)}
                                                </span>
                                            </div>
                                        ))}
                                        {(!val || Object.keys(val).length === 0) && (
                                            <span className="text-zinc-600 italic">No parameters</span>
                                        )}
                                    </div>
                                )
                            },
                            {
                                key: 'actions',
                                header: '',
                                render: (_, item) => (
                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {source === 'local' ? (
                                            <>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
                                                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition"
                                                    title="Edit Config"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(item.name); }}
                                                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/30 rounded transition"
                                                    title="Delete Remote"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </>
                                        ) : (
                                            <div className="text-xs text-zinc-500 italic">Read-only</div>
                                        )}
                                    </div>
                                )
                            }
                        ]}
                        selectedItems={selectedItems}
                        onToggleItem={(id) => {
                            const next = new Set(selectedItems);
                            if (next.has(id as string)) next.delete(id as string);
                            else next.add(id as string);
                            setSelectedItems(next);
                        }}
                        onSelectAll={() => {
                            const filtered = sortedRemotes.filter(r => r.name.toLowerCase().includes(searchFilter.toLowerCase()));
                            if (selectedItems.size === filtered.length) setSelectedItems(new Set());
                            else setSelectedItems(new Set(filtered.map(r => r.name)));
                        }}
                        onInvertSelection={() => {
                            const filtered = sortedRemotes.filter(r => r.name.toLowerCase().includes(searchFilter.toLowerCase()));
                            const inverted = new Set(filtered.filter(r => !selectedItems.has(r.name)).map(r => r.name));
                            setSelectedItems(inverted);
                        }}
                        handleSort={requestSort}
                        SortIcon={SortIcon}
                        columnFilters={{}}
                        onToggleColumnFilter={() => { }}
                        onClearColumnFilter={() => { }}
                        getUniqueValues={() => []}
                        rowIdKey="name"
                        isLoading={loading}
                    />
                </div>

                {/* Add Remote Modal */}
                {showAddModal && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg">
                            <h3 className="text-lg font-bold text-white mb-4">Add New Remote</h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Name</label>
                                    <input
                                        type="text"
                                        value={newRemoteName}
                                        onChange={(e) => setNewRemoteName(e.target.value)}
                                        placeholder="my-remote"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Type</label>
                                    <select
                                        value={newRemoteType}
                                        onChange={(e) => setNewRemoteType(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
                                    >
                                        <option value="drive">Google Drive</option>
                                        <option value="s3">S3</option>
                                        <option value="b2">Backblaze B2</option>
                                        <option value="sftp">SFTP</option>
                                        <option value="local">Local</option>
                                        <option value="union">Union</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Config (JSON)</label>
                                    <textarea
                                        value={newRemoteConfig}
                                        onChange={(e) => setNewRemoteConfig(e.target.value)}
                                        placeholder='{"scope": "drive", "team_drive": "...", "service_account_file": "..."}'
                                        className="w-full h-24 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm mb-2"
                                    />
                                    {newRemoteConfig.includes("service_account_file") && (
                                        <div className="p-2 bg-amber-900/10 border border-amber-900/30 rounded text-[10px]">
                                            <span className="text-amber-500 font-bold uppercase mr-2">Detected SA:</span>
                                            <span className="text-amber-200/80 font-mono italic">
                                                {(() => {
                                                    try {
                                                        const parsed = JSON.parse(newRemoteConfig);
                                                        return parsed.service_account_file || parsed.service_account_file_path || "Not found";
                                                    } catch (e) {
                                                        return "Invalid JSON";
                                                    }
                                                })()}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={handleAdd}
                                    className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium"
                                >
                                    Create
                                </button>
                                <button
                                    onClick={() => setShowAddModal(false)}
                                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Copy Config Modal */}
                {showCopyModal && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Copy size={18} /> Copy Config
                            </h3>
                            {copyStep === 'config' ? (
                                <>
                                    <div className="text-sm text-zinc-400 mb-4">
                                        Copy <strong>rclone.conf</strong> from
                                        <span className="text-cyan-400 mx-1">{source === 'local' ? 'Local' : (servers.find(s => s.id === selectedServer)?.name || 'Unknown')}</span>
                                        to another machine.
                                    </div>

                                    <div className="space-y-4 mb-6">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Source Path (Optional)</label>
                                                <input type="text" value={sourcePath} onChange={e => setSourcePath(e.target.value)}
                                                    placeholder="Auto-detect"
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-xs font-mono" />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Destination Server</label>
                                                <select value={copyDest} onChange={e => setCopyDest(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-xs">
                                                    <option value="local">Local Machine</option>
                                                    {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Dest Path (Optional Folder)</label>
                                                <input type="text" value={destPath} onChange={e => setDestPath(e.target.value)}
                                                    placeholder="Auto-detect"
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-xs font-mono" />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Target Filename (Optional)</label>
                                                <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
                                                    placeholder={copyMode === 'replace' ? 'rclone.conf' : 'Auto-generated'}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-xs font-mono" />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs text-zinc-500 mb-1">Copy Mode</label>
                                            <div className="flex flex-col gap-2">
                                                <label className={`flex items-center gap-2 p-3 rounded border cursor-pointer ${copyMode === 'backup' ? 'bg-emerald-900/20 border-emerald-600' : 'bg-zinc-800 border-zinc-700'}`}>
                                                    <input type="radio" name="copyMode" value="backup" checked={copyMode === 'backup'} onChange={() => setCopyMode('backup')} />
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium text-white">Back Up (Safe)</span>
                                                        <span className="text-xs text-zinc-500">Save as a new file (e.g. .bak) - No Overwrite</span>
                                                    </div>
                                                </label>
                                                <label className={`flex items-center gap-2 p-3 rounded border cursor-pointer ${copyMode === 'replace' ? 'bg-red-900/20 border-red-600' : 'bg-zinc-800 border-zinc-700'}`}>
                                                    <input type="radio" name="copyMode" value="replace" checked={copyMode === 'replace'} onChange={() => setCopyMode('replace')} />
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium text-white">Replace Active Config</span>
                                                        <span className="text-xs text-zinc-500">Overwrites target file (Automatic backup created first)</span>
                                                    </div>
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    {copyLoading ? (
                                        <div className="text-center py-4 bg-zinc-950 rounded border border-zinc-800 mb-4 animate-pulse">
                                            <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-cyan-400" />
                                            <div className="text-zinc-400 text-sm">Validating paths... please wait</div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <button onClick={async () => {
                                                setCopyLoading(true);
                                                setMessage(null);
                                                try {
                                                    const src = source === 'local' ? 'local' : selectedServer;
                                                    const res = await copyRcloneConfig(src, copyDest, copyMode, {
                                                        sourcePath: sourcePath || undefined,
                                                        destPath: destPath || undefined,
                                                        customName: customName || undefined,
                                                        dryRun: true
                                                    });
                                                    setPreviewData(res);
                                                    setCopyStep('confirm');
                                                } catch (e: any) {
                                                    setMessage(`Error: ${e.message}`);
                                                }
                                                finally { setCopyLoading(false); }
                                            }} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium flex items-center justify-center gap-2">
                                                Preview & Confirm
                                            </button>
                                            <button onClick={() => setShowCopyModal(false)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded">
                                                Cancel
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="space-y-4 mb-6 bg-zinc-950 p-4 rounded border border-zinc-800">
                                        <h4 className="text-white font-medium flex gap-2 items-center">
                                            <FileText size={18} className="text-emerald-400" /> Confirm Copy Details
                                        </h4>

                                        <div className="grid gap-4 text-sm">
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Source Configuration</label>
                                                <div className="font-mono text-zinc-300 break-all bg-zinc-900/50 p-2 rounded border border-zinc-800">
                                                    {previewData?.source}
                                                </div>
                                            </div>
                                            <div className="flex justify-center text-zinc-600">
                                                <ArrowDown size={20} />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Destination Configuration</label>
                                                <div className="font-mono text-cyan-300 break-all font-bold bg-cyan-900/20 p-2 rounded border border-cyan-800/50">
                                                    {previewData?.destination}
                                                </div>
                                            </div>

                                            {copyMode === 'replace' && (
                                                <div className="p-3 bg-red-900/10 border border-red-900/30 rounded text-red-400 text-xs flex gap-2 items-start mt-2">
                                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                                    <div>
                                                        <strong className="block mb-1">Warning: Overwrite Mode</strong>
                                                        This will overwrite the active configuration at the destination.
                                                        An automatic backup of the existing file will be created before writing.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {copyLoading ? (
                                        <div className="text-center py-4 bg-zinc-950 rounded border border-zinc-800 mb-4 animate-pulse">
                                            <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-cyan-400" />
                                            <div className="text-zinc-400 text-sm">Copying config... please wait</div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <button onClick={async () => {
                                                setCopyLoading(true);
                                                setMessage(null);
                                                try {
                                                    const src = source === 'local' ? 'local' : selectedServer;
                                                    const res = await copyRcloneConfig(src, copyDest, copyMode, {
                                                        sourcePath: sourcePath || undefined,
                                                        destPath: destPath || undefined,
                                                        customName: customName || undefined,
                                                        dryRun: false
                                                    });
                                                    setMessage(`✓ ${res.message}`);
                                                    setShowCopyModal(false);
                                                    setCopyStep('config');
                                                    setSourcePath(''); setDestPath(''); setCustomName('');
                                                } catch (e: any) {
                                                    setMessage(`Error: ${e.message}`);
                                                }
                                                finally { setCopyLoading(false); }
                                            }} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium flex items-center justify-center gap-2">
                                                Confirm Copy
                                            </button>
                                            <button onClick={() => setCopyStep('config')} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded">
                                                Back
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}


                {/* Push Modal */}
                {
                    showPushModal && (
                        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <Server size={20} className="text-cyan-400" />
                                    Push Configs to SSH Servers
                                </h3>

                                <div className="mb-4">
                                    <div className="text-sm text-zinc-400 mb-2">
                                        Pushing <span className="text-white font-bold">{selectedItems.size}</span> selected Rclone details to:
                                    </div>
                                    <div className="max-h-60 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded p-2 space-y-1">
                                        {servers.map(server => (
                                            <div
                                                key={server.id}
                                                onClick={() => {
                                                    if (pushStatus === 'pushing') return;
                                                    const next = new Set(targetSshServers);
                                                    if (next.has(server.id)) next.delete(server.id);
                                                    else next.add(server.id);
                                                    setTargetSshServers(next);
                                                }}
                                                className={`flex items-center gap-3 p-2 rounded cursor-pointer transition ${targetSshServers.has(server.id) ? 'bg-cyan-900/30 border border-cyan-500/50' : 'bg-zinc-900 border border-transparent hover:bg-zinc-800'
                                                    } ${pushStatus === 'pushing' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${targetSshServers.has(server.id) ? 'bg-cyan-600 border-cyan-600' : 'border-zinc-600'
                                                    }`}>
                                                    {targetSshServers.has(server.id) && <CheckCircle size={10} className="text-white" />}
                                                </div>
                                                <div className="text-sm text-zinc-200">{server.name}</div>
                                                <div className="text-xs text-zinc-500 ml-auto font-mono">{server.host}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {pushProgress.length > 0 && (
                                    <div className="mb-4 p-3 bg-black/40 rounded border border-zinc-800 text-xs font-mono text-zinc-300 max-h-32 overflow-y-auto">
                                        {pushProgress.map((line, i) => (
                                            <div key={i} className={line.includes('✓') ? 'text-emerald-400' : line.includes('✗') ? 'text-red-400' : 'text-zinc-400'}>{line}</div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center justify-between mt-6">
                                    <button
                                        onClick={() => setShowPushModal(false)}
                                        disabled={pushStatus === 'pushing'}
                                        className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded disabled:opacity-50"
                                    >
                                        {pushStatus === 'complete' ? 'Close' : 'Cancel'}
                                    </button>
                                    {pushStatus !== 'complete' && (
                                        <button
                                            onClick={handleConfirmPush}
                                            disabled={targetSshServers.size === 0 || pushStatus === 'pushing'}
                                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {pushStatus === 'pushing' ? <RefreshCw size={14} className="animate-spin" /> : <Server size={14} />}
                                            Push Configs
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }
                {/* Duplicates Modal */}
                {showDupModal && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <div className="text-amber-500"><AlertTriangle size={20} /></div>
                                Duplicate Sections Found
                            </h3>
                            <div className="text-sm text-zinc-400 mb-4">
                                The following remote names appear multiple times in the config file. This usually indicates corruption or append errors.
                            </div>

                            <div className="bg-zinc-950 p-3 rounded border border-zinc-800 mb-6 max-h-48 overflow-y-auto">
                                {duplicateResults.map(d => (
                                    <div key={d} className="text-red-400 font-mono text-sm py-1 border-b border-zinc-800 last:border-0">
                                        [{d}]
                                    </div>
                                ))}
                            </div>

                            <div className="text-xs text-zinc-500 mb-4">
                                Please edit the config file manually on the server to resolve these duplicates.
                            </div>

                            <div className="flex justify-end">
                                <button onClick={() => setShowDupModal(false)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Edit Remote Modal */}
                {editingRemote && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Edit2 size={18} className="text-blue-400" />
                                    Edit Remote: <span className="text-blue-400 font-mono">{editingRemote}</span>
                                </h3>
                                <button onClick={() => setEditingRemote(null)} className="text-zinc-500 hover:text-white transition">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1 uppercase font-bold tracking-wider">Configuration (JSON)</label>
                                    <textarea
                                        value={editConfig}
                                        onChange={(e) => setEditConfig(e.target.value)}
                                        className="w-full h-64 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-xs focus:border-blue-500 outline-none custom-scrollbar"
                                        spellCheck={false}
                                    />
                                    <p className="mt-1 text-[10px] text-zinc-500">
                                        Modify the JSON configuration directly. Ensure it is valid JSON.
                                    </p>
                                </div>

                                {editConfig.includes("service_account_file") && (
                                    <div className="p-3 bg-amber-900/10 border border-amber-900/30 rounded">
                                        <div className="text-[10px] font-bold text-amber-500 uppercase mb-1">Detected Service Account</div>
                                        <div className="text-[11px] text-amber-200/80 font-mono break-all leading-relaxed">
                                            {(() => {
                                                try {
                                                    const parsed = JSON.parse(editConfig);
                                                    return parsed.service_account_file || parsed.service_account_file_path || "Not found in valid JSON";
                                                } catch (e) {
                                                    return "Invalid JSON - cannot parse service account";
                                                }
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={handleSaveEdit}
                                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <Save size={16} />
                                    Save Changes
                                </button>
                                <button
                                    onClick={() => setEditingRemote(null)}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>

            {/* Test Results */}
            {testResults.length > 0 && (
                <Card>
                    <h4 className="text-sm font-medium text-white mb-3">Test Results</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {testResults.map(r => (
                            <div key={r.name} className={`flex items-center gap-3 p-2 rounded ${r.status === 'ok' ? 'bg-emerald-900/20' : 'bg-red-900/20'}`}>
                                {r.status === 'ok' ? <CheckCircle size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-red-400" />}
                                <span className="font-mono text-sm text-white">{r.name}</span>
                                <span className="text-xs text-zinc-500 truncate flex-1">{r.message}</span>
                                {r.status === 'error' && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleSetFlag(r.name, 'ignored')}
                                            className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white"
                                        >
                                            Ignore
                                        </button>
                                        <button
                                            onClick={() => handleDeleteRemote(r.name)}
                                            className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs text-white"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Status Message */}
            {
                message && (
                    <div className={`p-3 rounded-lg text-sm ${message.startsWith('✓') || message.includes('OK') ? 'bg-emerald-600/20 text-emerald-400' : message.startsWith('Error') ? 'bg-red-600/20 text-red-400' : 'bg-blue-600/20 text-blue-400'}`}>
                        {message}
                    </div>
                )
            }
        </div >
    );
};

export default RcloneManagement;
