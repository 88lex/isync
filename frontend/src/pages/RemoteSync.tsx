import { useState, useEffect } from 'react';
import { RefreshCw, Server, FileCode, Layers, Key, HardDrive, Clock, ChevronDown, Check, ArrowRight, ArrowLeft, Loader, Database } from 'lucide-react';
import axios from 'axios';
import { fetchSSHServers, SSHServer } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

interface SyncItem {
    name: string;
    size?: number;
}

interface CronItem {
    entry: string;
    index: number;
}

type ItemType = 'batch' | 'group' | 'key' | 'remote' | 'cron';

const ITEM_TYPES: { type: ItemType; label: string; icon: React.ReactNode }[] = [
    { type: 'batch', label: 'Batch Commands', icon: <FileCode size={16} /> },
    { type: 'group', label: 'Batch Groups', icon: <Layers size={16} /> },
    { type: 'key', label: 'JSON Keys', icon: <Key size={16} /> },
    { type: 'remote', label: 'Rclone Remotes', icon: <HardDrive size={16} /> },
    { type: 'cron', label: 'Cron Entries', icon: <Clock size={16} /> },
];

const RemoteSync: React.FC = () => {
    const [servers, setServers] = useState<SSHServer[]>([]);
    const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<ItemType>('batch');

    const [localItems, setLocalItems] = useState<SyncItem[]>([]);
    const [remoteItems, setRemoteItems] = useState<SyncItem[]>([]);
    const [localCrons, setLocalCrons] = useState<CronItem[]>([]);
    const [remoteCrons, setRemoteCrons] = useState<CronItem[]>([]);

    const [selectedLocal, setSelectedLocal] = useState<Set<string>>(new Set());
    const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());

    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    // Push progress and results
    const [pushStatus, setPushStatus] = useState<string>('');
    const [pushResults, setPushResults] = useState<any[]>([]);
    const [showResults, setShowResults] = useState(false);

    // Sync All options
    const [syncAllBatches, setSyncAllBatches] = useState(true);
    const [syncAllGroups, setSyncAllGroups] = useState(true);
    const [syncAllKeys, setSyncAllKeys] = useState(true);

    // Path info for display
    const localBasePath = '/opt/isync';
    const getLocalPath = (type: ItemType) => {
        if (type === 'batch') return `${localBasePath}/batch/`;
        if (type === 'group') return `${localBasePath}/batch/groups/`;
        if (type === 'key') return `${localBasePath}/keys/`;
        return localBasePath;
    };

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        if (selectedServers.size > 0) {
            loadItems();
        }
    }, [selectedServers, activeTab]);

    const toggleServer = (serverId: string) => {
        const next = new Set(selectedServers);
        if (next.has(serverId)) next.delete(serverId);
        else next.add(serverId);
        setSelectedServers(next);
    };

    const loadServers = async () => {
        try {
            const s = await fetchSSHServers();
            setServers(s);
            if (s.length > 0) {
                setSelectedServers(new Set([s[0].id]));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const loadItems = async () => {
        if (selectedServers.size === 0) return;
        const primaryServer = Array.from(selectedServers)[0];
        setLoading(true);
        setSelectedLocal(new Set());
        setSelectedRemote(new Set());

        try {
            // Load local items
            if (activeTab === 'batch') {
                const res = await axios.get(`${API_BASE}/manual/batch/list`);
                setLocalItems(res.data.files.map((f: any) => ({ name: f.name, size: f.size })));
            } else if (activeTab === 'group') {
                // List local groups from batch groups
                const res = await axios.get(`${API_BASE}/batch-groups`);
                setLocalItems(res.data.map((g: any) => ({ name: `group_${g.name.replace(/ /g, '_').toLowerCase()}.sh`, size: 0 })));
            } else if (activeTab === 'key') {
                const res = await axios.get(`${API_BASE}/drives/keys`);
                setLocalItems(res.data.keys.map((k: any) => ({ name: k.name, size: k.size })));
            } else if (activeTab === 'remote') {
                const res = await axios.get(`${API_BASE}/rclone/remotes`);
                setLocalItems(res.data.remotes.map((r: any) => ({ name: r.name, size: 0 })));
            }

            // Load remote items from primary selected server
            if (activeTab === 'batch') {
                const res = await axios.post(`${API_BASE}/ssh/remote/list-batches`, { server_id: primaryServer });
                setRemoteItems(res.data.items || []);
            } else if (activeTab === 'group') {
                const res = await axios.post(`${API_BASE}/ssh/remote/list-groups`, { server_id: primaryServer });
                setRemoteItems(res.data.items || []);
            } else if (activeTab === 'key') {
                const res = await axios.post(`${API_BASE}/ssh/remote/list-keys`, { server_id: primaryServer });
                setRemoteItems(res.data.items || []);
            } else if (activeTab === 'remote') {
                const res = await axios.post(`${API_BASE}/rclone/remote/list`, null, { params: { server_id: primaryServer } });
                setRemoteItems((res.data.remotes || []).map((r: any) => ({ name: r.name, size: 0 })));
            } else if (activeTab === 'cron') {
                const res = await axios.post(`${API_BASE}/ssh/remote/list-crons`, { server_id: primaryServer });
                setRemoteCrons(res.data.items || []);
                setRemoteItems([]);
            }
        } catch (e: any) {
            console.error(e);
            setMessage(`Error loading: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const toggleLocal = (name: string) => {
        const next = new Set(selectedLocal);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setSelectedLocal(next);
    };

    const toggleRemote = (name: string) => {
        const next = new Set(selectedRemote);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setSelectedRemote(next);
    };

    const handlePush = async () => {
        if (selectedLocal.size === 0 || selectedServers.size === 0) return;
        setSyncing(true);
        setMessage(null);
        setPushResults([]);
        setShowResults(true);

        const allResults: any[] = [];
        const serverNames = servers.filter(s => selectedServers.has(s.id)).map(s => s.name);
        const localPath = getLocalPath(activeTab);

        setPushStatus(`Starting push of ${selectedLocal.size} items to ${serverNames.join(', ')}...`);
        setPushStatus(`Source: ${localPath}`);

        try {
            for (const serverId of Array.from(selectedServers)) {
                const server = servers.find(s => s.id === serverId);
                const serverName = server?.name || serverId;
                setPushStatus(`Pushing to ${serverName}...`);

                if (activeTab === 'remote') {
                    const res = await axios.post(`${API_BASE}/rclone/remote/push`, {
                        server_id: serverId,
                        remote_names: Array.from(selectedLocal)
                    });
                    allResults.push({ server: serverName, ...res.data });
                } else {
                    const res = await axios.post(`${API_BASE}/ssh/remote/push-items`, {
                        server_id: serverId,
                        items: Array.from(selectedLocal),
                        item_type: activeTab
                    });
                    allResults.push({ server: serverName, ...res.data });
                }
            }

            const totalPushed = allResults.reduce((sum, r) => sum + (r.pushed || 0), 0);
            const totalItems = allResults.reduce((sum, r) => sum + (r.total || 0), 0);

            setPushStatus(`✓ Complete: ${totalPushed}/${totalItems} items pushed to ${serverNames.length} server(s)`);
            setPushResults(allResults);
            setMessage(`✓ Pushed ${totalPushed} items to ${serverNames.join(', ')}`);
            await loadItems();
        } catch (e: any) {
            setPushStatus(`✗ Error: ${e.response?.data?.detail || e.message}`);
            setMessage(`Error: ${e.response?.data?.detail || e.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const handlePull = async () => {
        if (selectedRemote.size === 0 || selectedServers.size === 0) return;
        const primaryServer = Array.from(selectedServers)[0];
        setSyncing(true);
        setMessage(null);

        try {
            if (activeTab === 'remote') {
                // Pull rclone remotes (merge)
                await axios.post(`${API_BASE}/rclone/remote/pull`, {
                    server_id: primaryServer,
                    remote_names: Array.from(selectedRemote)
                });
            } else {
                await axios.post(`${API_BASE}/ssh/remote/pull-items`, {
                    server_id: primaryServer,
                    items: Array.from(selectedRemote),
                    item_type: activeTab
                });
            }
            setMessage(`✓ Pulled ${selectedRemote.size} items`);
            await loadItems();
        } catch (e: any) {
            setMessage(`Error: ${e.response?.data?.detail || e.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const handleSyncAll = async (direction: 'push' | 'pull') => {
        if (selectedServers.size === 0) return;
        setSyncing(true);
        setMessage(null);
        setPushResults([]);
        setShowResults(true);

        const allResults: any[] = [];
        const serverNames = servers.filter(s => selectedServers.has(s.id)).map(s => s.name);

        setPushStatus(`Starting ${direction} to ${serverNames.join(', ')}...`);

        try {
            for (const serverId of Array.from(selectedServers)) {
                const server = servers.find(s => s.id === serverId);
                const serverName = server?.name || serverId;
                setPushStatus(`${direction === 'push' ? 'Pushing to' : 'Pulling from'} ${serverName}...`);

                const res = await axios.post(`${API_BASE}/ssh/remote/sync-all`, {
                    server_id: serverId,
                    include_batches: syncAllBatches,
                    include_groups: syncAllGroups,
                    include_keys: syncAllKeys,
                    direction
                });
                allResults.push({ server: serverName, ...res.data });
            }

            const totalSuccess = allResults.reduce((sum, r) => sum + (r.success || 0), 0);
            const totalItems = allResults.reduce((sum, r) => sum + (r.total || 0), 0);

            setPushStatus(`✓ Complete: ${totalSuccess}/${totalItems} items ${direction === 'push' ? 'pushed to' : 'pulled from'} ${serverNames.length} server(s)`);
            setPushResults(allResults);
            setMessage(`✓ ${direction === 'push' ? 'Pushed' : 'Pulled'} ${totalSuccess}/${totalItems} items`);
            await loadItems();
        } catch (e: any) {
            setPushStatus(`✗ Error: ${e.response?.data?.detail || e.message}`);
            setMessage(`Error: ${e.response?.data?.detail || e.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const selectAllLocal = () => setSelectedLocal(new Set(localItems.map(i => i.name)));
    const selectAllRemote = () => setSelectedRemote(new Set(remoteItems.map(i => i.name)));
    const clearLocal = () => setSelectedLocal(new Set());
    const clearRemote = () => setSelectedRemote(new Set());

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Database}
                title="Remote Sync"
                subtitle="Sync configuration items between local and remote servers"
            />

            {/* Server Selector */}
            <Card>
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <Server size={18} className="text-cyan-400" />
                        <span className="text-sm text-zinc-400">Target Servers (select one or more):</span>
                        <button
                            onClick={loadItems}
                            disabled={loading}
                            className="ml-auto flex items-center gap-2 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white transition disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {servers.map(s => (
                            <label key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition ${selectedServers.has(s.id) ? 'bg-cyan-600/30 border border-cyan-500' : 'bg-zinc-800 border border-zinc-700 hover:border-zinc-600'}`}>
                                <input
                                    type="checkbox"
                                    checked={selectedServers.has(s.id)}
                                    onChange={() => toggleServer(s.id)}
                                    className="rounded"
                                />
                                <span className="text-sm text-white">{s.name}</span>
                            </label>
                        ))}
                    </div>
                    {selectedServers.size > 0 && (
                        <div className="text-xs text-zinc-500">
                            {selectedServers.size} server(s) selected
                        </div>
                    )}
                </div>
            </Card>

            {/* Item Type Tabs */}
            <div className="flex gap-2 flex-wrap">
                {ITEM_TYPES.map(({ type, label, icon }) => (
                    <button
                        key={type}
                        onClick={() => setActiveTab(type)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === type
                            ? 'bg-cyan-600 text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                            }`}
                    >
                        {icon}
                        {label}
                    </button>
                ))}
            </div>

            {/* Sync All Section */}
            <Card>
                <h3 className="text-sm font-medium text-zinc-300 mb-3">Sync All</h3>
                <div className="flex items-center gap-4 flex-wrap mb-4">
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                        <input type="checkbox" checked={syncAllBatches} onChange={e => setSyncAllBatches(e.target.checked)} className="rounded" />
                        Batches
                    </label>
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                        <input type="checkbox" checked={syncAllGroups} onChange={e => setSyncAllGroups(e.target.checked)} className="rounded" />
                        Groups
                    </label>
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                        <input type="checkbox" checked={syncAllKeys} onChange={e => setSyncAllKeys(e.target.checked)} className="rounded" />
                        Keys
                    </label>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => handleSyncAll('push')}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                        {syncing ? <Loader size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                        Push All to Remote
                    </button>
                    <button
                        onClick={() => handleSyncAll('pull')}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                        {syncing ? <Loader size={14} className="animate-spin" /> : <ArrowLeft size={14} />}
                        Pull All from Remote
                    </button>
                </div>
            </Card>

            {/* Dual Pane View */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Local Items */}
                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-emerald-400">Local Items ({localItems.length})</h3>
                        <div className="flex gap-2">
                            <button onClick={selectAllLocal} className="text-xs text-zinc-500 hover:text-zinc-300">All</button>
                            <button onClick={clearLocal} className="text-xs text-zinc-500 hover:text-zinc-300">None</button>
                        </div>
                    </div>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="text-center py-4 text-zinc-500">Loading...</div>
                        ) : localItems.length === 0 ? (
                            <div className="text-center py-4 text-zinc-500 text-sm">No local items</div>
                        ) : (
                            localItems.map(item => (
                                <label
                                    key={item.name}
                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${selectedLocal.has(item.name) ? 'bg-emerald-600/20' : 'hover:bg-zinc-800'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedLocal.has(item.name)}
                                        onChange={() => toggleLocal(item.name)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-zinc-300 truncate flex-1">{item.name}</span>
                                    {item.size !== undefined && item.size > 0 && (
                                        <span className="text-xs text-zinc-600">{(item.size / 1024).toFixed(1)}KB</span>
                                    )}
                                </label>
                            ))
                        )}
                    </div>
                    <button
                        onClick={handlePush}
                        disabled={selectedLocal.size === 0 || syncing}
                        className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                        <ArrowRight size={14} />
                        Push Selected ({selectedLocal.size})
                    </button>
                </Card>

                {/* Remote Items */}
                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-cyan-400">Remote Items ({remoteItems.length})</h3>
                        <div className="flex gap-2">
                            <button onClick={selectAllRemote} className="text-xs text-zinc-500 hover:text-zinc-300">All</button>
                            <button onClick={clearRemote} className="text-xs text-zinc-500 hover:text-zinc-300">None</button>
                        </div>
                    </div>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="text-center py-4 text-zinc-500">Loading...</div>
                        ) : activeTab === 'cron' ? (
                            remoteCrons.length === 0 ? (
                                <div className="text-center py-4 text-zinc-500 text-sm">No cron entries</div>
                            ) : (
                                remoteCrons.map((cron, idx) => (
                                    <div key={idx} className="p-2 bg-zinc-800/50 rounded text-xs font-mono text-zinc-400 truncate">
                                        {cron.entry}
                                    </div>
                                ))
                            )
                        ) : remoteItems.length === 0 ? (
                            <div className="text-center py-4 text-zinc-500 text-sm">No remote items</div>
                        ) : (
                            remoteItems.map(item => (
                                <label
                                    key={item.name}
                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${selectedRemote.has(item.name) ? 'bg-cyan-600/20' : 'hover:bg-zinc-800'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedRemote.has(item.name)}
                                        onChange={() => toggleRemote(item.name)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-zinc-300 truncate flex-1">{item.name}</span>
                                    {item.size !== undefined && item.size > 0 && (
                                        <span className="text-xs text-zinc-600">{(item.size / 1024).toFixed(1)}KB</span>
                                    )}
                                </label>
                            ))
                        )}
                    </div>
                    <button
                        onClick={handlePull}
                        disabled={selectedRemote.size === 0 || syncing || activeTab === 'cron'}
                        className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                        <ArrowLeft size={14} />
                        Pull Selected ({selectedRemote.size})
                    </button>
                </Card>
            </div>

            {/* Push Progress & Status */}
            {(syncing || pushStatus) && (
                <Card>
                    <div className="flex items-center gap-2 mb-2">
                        {syncing && <Loader size={14} className="animate-spin text-cyan-400" />}
                        <span className={`text-sm ${pushStatus.startsWith('✓') ? 'text-emerald-400' : pushStatus.startsWith('✗') ? 'text-red-400' : 'text-cyan-400'}`}>
                            {pushStatus || 'Processing...'}
                        </span>
                    </div>
                    {getLocalPath(activeTab) && (
                        <div className="text-xs text-zinc-500 mb-2">
                            <span className="text-zinc-400">Source:</span> {getLocalPath(activeTab)}
                        </div>
                    )}
                </Card>
            )}

            {/* Push Results */}
            {showResults && pushResults.length > 0 && (
                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-zinc-300">Push Results</h3>
                        <button onClick={() => setShowResults(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Hide</button>
                    </div>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                        {pushResults.map((serverResult, idx) => (
                            <div key={idx} className="border border-zinc-700 rounded-lg p-3">
                                <div className="text-sm font-medium text-cyan-400 mb-2">{serverResult.server}</div>
                                <div className="text-xs text-zinc-500 mb-2">
                                    Destination: {serverResult.remote_base || '/opt/isync'}
                                </div>
                                <div className="text-xs text-zinc-400 mb-2">
                                    {serverResult.pushed || 0}/{serverResult.total || 0} items pushed
                                </div>
                                {Array.isArray(serverResult.results) && serverResult.results.length > 0 && (
                                    <div className="space-y-1">
                                        {serverResult.results.slice(0, 10).map((r: any, i: number) => (
                                            <div key={i} className={`text-xs flex items-center gap-2 ${r.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {r.status === 'success' ? <Check size={10} /> : '✗'}
                                                <span className="truncate">{r.item}</span>
                                                {r.destination && <span className="text-zinc-500">→ {r.destination}</span>}
                                            </div>
                                        ))}
                                        {serverResult.results.length > 10 && (
                                            <div className="text-xs text-zinc-500">... and {serverResult.results.length - 10} more</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Status Message */}
            {message && (
                <div className={`p-3 rounded-lg text-sm ${message.startsWith('✓') ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                    {message}
                </div>
            )}
        </div>
    );
};

export default RemoteSync;
