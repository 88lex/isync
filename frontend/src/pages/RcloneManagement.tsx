import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Server, HardDrive, Plus, Edit2, Trash2, Copy, Save, X, ChevronDown, Search, Shield, EyeOff, Zap, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import {
    fetchSSHServers, SSHServer,
    listRemotesWithFlags, RemoteWithFlags, RemoteFlags,
    addRemoteFlag, removeRemoteFlag, testBatchConnections, deleteRemoteWithConfirm,
    BatchTestResult
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

interface RcloneRemote {
    name: string;
    type: string;
    config: Record<string, string>;
}

const RcloneManagement: React.FC = () => {
    const [source, setSource] = useState<'local' | 'remote'>('local');
    const [servers, setServers] = useState<SSHServer[]>([]);
    const [selectedServer, setSelectedServer] = useState<string>('');

    const [remotes, setRemotes] = useState<RcloneRemote[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const [editingRemote, setEditingRemote] = useState<string | null>(null);
    const [editConfig, setEditConfig] = useState<string>('');

    const [showAddModal, setShowAddModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState('drive');
    const [newConfig, setNewConfig] = useState('');

    const [selectedForCopy, setSelectedForCopy] = useState<Set<string>>(new Set());
    const [searchFilter, setSearchFilter] = useState('');

    // Manage Tab State
    const [activeTab, setActiveTab] = useState<'browse' | 'manage'>('browse');
    const [remotesWithFlags, setRemotesWithFlags] = useState<RemoteWithFlags[]>([]);
    const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());
    const [statusFilter, setStatusFilter] = useState<'all' | 'normal' | 'ignored' | 'protected'>('all');
    const [testResults, setTestResults] = useState<BatchTestResult[]>([]);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        loadRemotes();
    }, [source, selectedServer]);

    useEffect(() => {
        if (activeTab === 'manage') {
            loadRemotesWithFlagsData();
        }
    }, [activeTab, source, selectedServer]);

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

    const loadRemotes = async () => {
        setLoading(true);
        setSelectedForCopy(new Set());

        try {
            if (source === 'local') {
                const res = await axios.get(`${API_BASE}/rclone/remotes`);
                setRemotes(res.data.remotes || []);
            } else if (selectedServer) {
                const res = await axios.post(`${API_BASE}/rclone/remote/list`, null, { params: { server_id: selectedServer } });
                setRemotes(res.data.remotes || []);
            }
        } catch (e: any) {
            console.error(e);
            setMessage(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadRemotesWithFlagsData = async () => {
        setLoading(true);
        setSelectedForAction(new Set());
        try {
            const serverId = source === 'remote' ? selectedServer : undefined;
            const res = await listRemotesWithFlags(serverId);
            setRemotesWithFlags(res.remotes);
        } catch (e: any) {
            console.error(e);
            setMessage(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleSetFlag = async (remoteName: string, flagType: 'ignored' | 'protected') => {
        try {
            await addRemoteFlag(remoteName, flagType);
            await loadRemotesWithFlagsData();
            setMessage(`Marked ${remoteName} as ${flagType}`);
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const handleClearFlag = async (remoteName: string) => {
        try {
            await removeRemoteFlag(remoteName, 'ignored');
            await removeRemoteFlag(remoteName, 'protected');
            await loadRemotesWithFlagsData();
            setMessage(`Cleared flag for ${remoteName}`);
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const handleBulkSetFlag = async (flagType: 'ignored' | 'protected') => {
        const selected = Array.from(selectedForAction);
        if (selected.length === 0) return;

        setLoading(true);
        for (const name of selected) {
            try {
                await addRemoteFlag(name, flagType);
            } catch (e) {
                console.error(e);
            }
        }
        await loadRemotesWithFlagsData();
        setSelectedForAction(new Set());
        setMessage(`Marked ${selected.length} remotes as ${flagType}`);
    };

    const handleTestSelected = async () => {
        const selected = Array.from(selectedForAction);
        if (selected.length === 0) return;

        setTesting(true);
        setTestResults([]);
        try {
            const serverId = source === 'remote' ? selectedServer : undefined;
            const res = await testBatchConnections(selected, serverId);
            setTestResults(res.results);
            setMessage(`Tested ${res.total}: ${res.ok} OK, ${res.failed} failed`);
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        } finally {
            setTesting(false);
        }
    };

    const handleDeleteRemote = async (name: string, confirm: boolean = false) => {
        try {
            const serverId = source === 'remote' ? selectedServer : undefined;
            await deleteRemoteWithConfirm(name, confirm, serverId);
            await loadRemotesWithFlagsData();
            setMessage(`Deleted ${name}`);
        } catch (e: any) {
            if (e.response?.status === 403) {
                // Protected remote, ask for confirmation
                if (window.confirm(`Remote "${name}" is protected. Delete anyway?`)) {
                    await handleDeleteRemote(name, true);
                }
            } else {
                setMessage(`Error: ${e.message}`);
            }
        }
    };

    const filteredRemotesWithFlags = useMemo(() => {
        return remotesWithFlags.filter(r => {
            const matchesSearch = r.name.toLowerCase().includes(searchFilter.toLowerCase());
            const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [remotesWithFlags, searchFilter, statusFilter]);

    const handleEdit = (remote: RcloneRemote) => {
        setEditingRemote(remote.name);
        setEditConfig(JSON.stringify(remote.config, null, 2));
    };

    const handleSaveEdit = async () => {
        if (!editingRemote) return;

        try {
            const config = JSON.parse(editConfig);
            await axios.put(`${API_BASE}/rclone/remotes/${editingRemote}`, { config });
            setMessage('✓ Remote updated');
            setEditingRemote(null);
            await loadRemotes();
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete remote "${name}"?`)) return;

        try {
            await axios.delete(`${API_BASE}/rclone/remotes/${name}`);
            setMessage('✓ Remote deleted');
            await loadRemotes();
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const handleAdd = async () => {
        if (!newName || !newType) return;

        try {
            const config = newConfig ? JSON.parse(newConfig) : {};
            await axios.post(`${API_BASE}/rclone/remotes`, {
                name: newName,
                type: newType,
                config
            });
            setMessage('✓ Remote created');
            setShowAddModal(false);
            setNewName('');
            setNewType('drive');
            setNewConfig('');
            await loadRemotes();
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const toggleCopySelect = (name: string) => {
        const next = new Set(selectedForCopy);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setSelectedForCopy(next);
    };

    const handleCopyToLocal = async () => {
        if (selectedForCopy.size === 0 || !selectedServer) return;

        try {
            await axios.post(`${API_BASE}/rclone/remote/pull`, {
                server_id: selectedServer,
                remote_names: Array.from(selectedForCopy)
            });
            setMessage(`✓ Copied ${selectedForCopy.size} remotes to local`);
            setSelectedForCopy(new Set());
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    const handlePushToRemote = async () => {
        if (selectedForCopy.size === 0 || !selectedServer) return;

        try {
            await axios.post(`${API_BASE}/rclone/remote/push`, {
                server_id: selectedServer,
                remote_names: Array.from(selectedForCopy)
            });
            setMessage(`✓ Pushed ${selectedForCopy.size} remotes to server`);
            setSelectedForCopy(new Set());
        } catch (e: any) {
            setMessage(`Error: ${e.message}`);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={HardDrive}
                title="Rclone Management"
                subtitle="View and edit rclone remotes on local or remote servers"
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
                        onClick={() => activeTab === 'browse' ? loadRemotes() : loadRemotesWithFlagsData()}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm text-white transition disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>

                    {source === 'local' && activeTab === 'browse' && (
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

            {/* Tab Navigation */}
            <div className="flex border-b border-zinc-800">
                <button
                    onClick={() => setActiveTab('browse')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'browse' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <div className="flex items-center gap-2">
                        <HardDrive size={16} />
                        Browse Remotes
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('manage')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'manage' ? 'border-purple-500 text-purple-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <div className="flex items-center gap-2">
                        <Shield size={16} />
                        Manage & Test
                    </div>
                </button>
            </div>

            {activeTab === 'browse' && (
                <>
                    {/* Copy Actions (when viewing remote) */}
                    {source === 'remote' && selectedForCopy.size > 0 && (
                        <Card>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-zinc-400">{selectedForCopy.size} selected</span>
                                <button
                                    onClick={handleCopyToLocal}
                                    className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white transition"
                                >
                                    <Copy size={14} />
                                    Copy to Local
                                </button>
                            </div>
                        </Card>
                    )}

                    {/* Push to Remote (when viewing local) */}
                    {source === 'local' && selectedForCopy.size > 0 && selectedServer && (
                        <Card>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-zinc-400">{selectedForCopy.size} selected</span>
                                <button
                                    onClick={handlePushToRemote}
                                    className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm text-white transition"
                                >
                                    <Copy size={14} />
                                    Push to Remote
                                </button>
                            </div>
                        </Card>
                    )}

                    {/* Remotes List */}
                    <Card>
                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                            <HardDrive size={18} className="text-purple-400" />
                            Remotes ({remotes.length})
                        </h3>

                        {/* Search Filter */}
                        <div className="mb-4 relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                                type="text"
                                value={searchFilter}
                                onChange={(e) => setSearchFilter(e.target.value)}
                                placeholder="Filter remotes..."
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                            />
                            {searchFilter && (
                                <button
                                    onClick={() => setSearchFilter('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {loading ? (
                            <div className="text-center py-8 text-zinc-500">Loading...</div>
                        ) : remotes.filter(r => r.name.toLowerCase().includes(searchFilter.toLowerCase())).length === 0 ? (
                            <div className="text-center py-8 text-zinc-500">{searchFilter ? `No remotes matching "${searchFilter}"` : 'No remotes found'}</div>
                        ) : (
                            <div className="space-y-2">
                                {remotes.filter(r => r.name.toLowerCase().includes(searchFilter.toLowerCase())).map(remote => (
                                    <div
                                        key={remote.name}
                                        className={`bg-zinc-800/50 border rounded-lg p-3 ${editingRemote === remote.name ? 'border-purple-500' : 'border-zinc-700'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedForCopy.has(remote.name)}
                                                    onChange={() => toggleCopySelect(remote.name)}
                                                    className="rounded"
                                                />
                                                <span className="font-medium text-white">{remote.name}</span>
                                                <span className="px-2 py-0.5 bg-purple-600/20 text-purple-400 rounded text-xs">
                                                    {remote.type}
                                                </span>
                                            </div>
                                            {source === 'local' && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleEdit(remote)}
                                                        className="p-1 text-zinc-400 hover:text-white transition"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(remote.name)}
                                                        className="p-1 text-zinc-400 hover:text-red-400 transition"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {editingRemote === remote.name ? (
                                            <div className="mt-3 space-y-2">
                                                <textarea
                                                    value={editConfig}
                                                    onChange={(e) => setEditConfig(e.target.value)}
                                                    className="w-full h-32 bg-zinc-900 border border-zinc-700 rounded p-2 text-sm font-mono text-zinc-300"
                                                />
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={handleSaveEdit}
                                                        className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm"
                                                    >
                                                        <Save size={12} /> Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingRemote(null)}
                                                        className="flex items-center gap-1 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm"
                                                    >
                                                        <X size={12} /> Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="mt-2 text-xs text-zinc-500 font-mono">
                                                {Object.entries(remote.config).slice(0, 3).map(([k, v]) => (
                                                    <div key={k}>{k} = {String(v).substring(0, 50)}{String(v).length > 50 ? '...' : ''}</div>
                                                ))}
                                                {Object.keys(remote.config).length > 3 && (
                                                    <div className="text-zinc-600">... +{Object.keys(remote.config).length - 3} more</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

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
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder="my-remote"
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs text-zinc-500 mb-1">Type</label>
                                        <select
                                            value={newType}
                                            onChange={(e) => setNewType(e.target.value)}
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
                                            value={newConfig}
                                            onChange={(e) => setNewConfig(e.target.value)}
                                            placeholder='{"scope": "drive", "team_drive": "..."}'
                                            className="w-full h-24 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm"
                                        />
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
                </>
            )}

            {/* MANAGE TAB */}
            {activeTab === 'manage' && (
                <div className="space-y-4">
                    {/* Search & Filter Bar */}
                    <Card>
                        <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex-1 min-w-[200px] relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input
                                    type="text"
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    placeholder="Fuzzy search remotes..."
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div className="flex gap-1">
                                {(['all', 'normal', 'ignored', 'protected'] as const).map(filter => (
                                    <button
                                        key={filter}
                                        onClick={() => setStatusFilter(filter)}
                                        className={`px-3 py-1.5 rounded text-xs font-medium transition ${statusFilter === filter
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
                    </Card>

                    {/* Bulk Actions */}
                    {selectedForAction.size > 0 && (
                        <Card>
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-sm text-zinc-400">{selectedForAction.size} selected</span>
                                <button
                                    onClick={() => handleBulkSetFlag('ignored')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm text-white"
                                >
                                    <EyeOff size={14} /> Ignore
                                </button>
                                <button
                                    onClick={() => handleBulkSetFlag('protected')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm text-white"
                                >
                                    <Shield size={14} /> Protect
                                </button>
                                <button
                                    onClick={handleTestSelected}
                                    disabled={testing}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 rounded text-sm text-white"
                                >
                                    <Zap size={14} className={testing ? 'animate-pulse' : ''} /> Test
                                </button>
                                <button
                                    onClick={() => setSelectedForAction(new Set())}
                                    className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm"
                                >
                                    Clear
                                </button>
                            </div>
                        </Card>
                    )}

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

                    {/* Remotes List with Flags */}
                    <Card>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-medium text-white">
                                Remotes ({filteredRemotesWithFlags.length})
                            </h3>
                            <button
                                onClick={() => {
                                    const allNames = filteredRemotesWithFlags.map(r => r.name);
                                    setSelectedForAction(prev => prev.size === allNames.length ? new Set() : new Set(allNames));
                                }}
                                className="text-xs text-zinc-500 hover:text-zinc-300"
                            >
                                {selectedForAction.size === filteredRemotesWithFlags.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>

                        {loading ? (
                            <div className="text-center py-8 text-zinc-500">Loading...</div>
                        ) : filteredRemotesWithFlags.length === 0 ? (
                            <div className="text-center py-8 text-zinc-500">No remotes found</div>
                        ) : (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {filteredRemotesWithFlags.map(remote => (
                                    <div
                                        key={remote.name}
                                        className={`flex items-center gap-3 p-3 rounded-lg border transition cursor-pointer ${selectedForAction.has(remote.name)
                                                ? 'border-purple-500 bg-purple-900/20'
                                                : remote.status === 'ignored' ? 'border-zinc-700 bg-zinc-800/50 opacity-60'
                                                    : remote.status === 'protected' ? 'border-amber-700 bg-amber-900/10'
                                                        : 'border-zinc-700 bg-zinc-800/30 hover:border-zinc-600'
                                            }`}
                                        onClick={() => {
                                            setSelectedForAction(prev => {
                                                const next = new Set(prev);
                                                if (next.has(remote.name)) next.delete(remote.name);
                                                else next.add(remote.name);
                                                return next;
                                            });
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedForAction.has(remote.name)}
                                            onChange={() => { }}
                                            className="w-4 h-4 accent-purple-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm text-white truncate">{remote.name}</span>
                                                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-400">{remote.type}</span>
                                                {remote.status === 'ignored' && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-600 rounded text-zinc-300">IGNORED</span>}
                                                {remote.status === 'protected' && <span className="text-[10px] px-1.5 py-0.5 bg-amber-700 rounded text-amber-200">PROTECTED</span>}
                                            </div>
                                        </div>
                                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                            {remote.status !== 'ignored' && (
                                                <button
                                                    onClick={() => handleSetFlag(remote.name, 'ignored')}
                                                    className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded"
                                                    title="Ignore"
                                                >
                                                    <EyeOff size={14} />
                                                </button>
                                            )}
                                            {remote.status !== 'protected' && (
                                                <button
                                                    onClick={() => handleSetFlag(remote.name, 'protected')}
                                                    className="p-1.5 text-zinc-500 hover:text-amber-400 hover:bg-zinc-700 rounded"
                                                    title="Protect"
                                                >
                                                    <Shield size={14} />
                                                </button>
                                            )}
                                            {remote.status !== 'normal' && (
                                                <button
                                                    onClick={() => handleClearFlag(remote.name)}
                                                    className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-700 rounded"
                                                    title="Clear Flag"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            )}

            {/* Status Message */}
            {message && (
                <div className={`p-3 rounded-lg text-sm ${message.startsWith('✓') || message.includes('OK') ? 'bg-emerald-600/20 text-emerald-400' : message.startsWith('Error') ? 'bg-red-600/20 text-red-400' : 'bg-blue-600/20 text-blue-400'}`}>
                    {message}
                </div>
            )}
        </div>
    );
};

export default RcloneManagement;
