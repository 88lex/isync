import { useState, useEffect } from 'react';
import { RefreshCw, Server, HardDrive, Plus, Edit2, Trash2, Copy, Save, X, ChevronDown } from 'lucide-react';
import axios from 'axios';
import { fetchSSHServers, SSHServer } from '../api';
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

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        loadRemotes();
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
                        onClick={loadRemotes}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm text-white transition disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
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

                {loading ? (
                    <div className="text-center py-8 text-zinc-500">Loading...</div>
                ) : remotes.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500">No remotes found</div>
                ) : (
                    <div className="space-y-2">
                        {remotes.map(remote => (
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

            {/* Status Message */}
            {message && (
                <div className={`p-3 rounded-lg text-sm ${message.startsWith('✓') ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                    {message}
                </div>
            )}
        </div>
    );
};

export default RcloneManagement;
