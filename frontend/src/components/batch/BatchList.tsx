import React, { useState, useMemo } from 'react';
import {
    BatchFile, SSHServer, getBatchFile, updateBatchContent, renameBatchFile,
    deleteBatchLocal, checkBatchRemote, pullBatch, deleteBatchRemote, regenerateBatch
} from '../../api';
import { FolderOpen, ChevronDown, ChevronRight, FileCode, Users, Shuffle, Trash2, Edit2 } from 'lucide-react';

export interface BatchListProps {
    savedBatches: BatchFile[];
    loadSavedBatches: () => Promise<void>;
    sshServers: SSHServer[];
    selectedUsers: Set<string>;
    randomOrder: boolean;
    batchContentCache: Record<string, string>;
    setBatchContentCache: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    remoteStatusCache: Record<string, Record<string, boolean>>;
    setRemoteStatusCache: React.Dispatch<React.SetStateAction<Record<string, Record<string, boolean>>>>;
    openBatchUsersModal: (filename: string) => void;
    handleOpenPushModal: (type: 'batch' | 'group', id: string) => void;
    batchOperationLoading: string | null;
    setBatchOperationLoading: (val: string | null) => void;
}

export const BatchList: React.FC<BatchListProps> = ({
    savedBatches,
    loadSavedBatches,
    sshServers,
    selectedUsers,
    randomOrder,
    batchContentCache,
    setBatchContentCache,
    remoteStatusCache,
    setRemoteStatusCache,
    openBatchUsersModal,
    handleOpenPushModal,
    batchOperationLoading,
    setBatchOperationLoading
}) => {
    // Local UI State
    const [expandedBatchFile, setExpandedBatchFile] = useState<string | null>(null);
    const [editingBatch, setEditingBatch] = useState<string | null>(null);
    const [editBatchContent, setEditBatchContent] = useState('');
    const [renamingBatch, setRenamingBatch] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [selectedServerId, setSelectedServerId] = useState('');

    const sortedSavedBatches = useMemo(() =>
        [...savedBatches].sort((a, b) => a.name.localeCompare(b.name)),
        [savedBatches]
    );

    // Handlers
    const handleExpandBatch = async (filename: string) => {
        if (expandedBatchFile === filename) {
            setExpandedBatchFile(null);
            setEditingBatch(null);
            return;
        }
        setExpandedBatchFile(filename);
        if (!batchContentCache[filename]) {
            try {
                const data = await getBatchFile(filename);
                setBatchContentCache(prev => ({ ...prev, [filename]: data.content }));
            } catch (e) {
                console.error('Failed to load batch content', e);
            }
        }
    };

    const handleStartEdit = (filename: string) => {
        setEditingBatch(filename);
        setEditBatchContent(batchContentCache[filename] || '');
    };

    const handleSaveEdit = async (filename: string) => {
        try {
            setBatchOperationLoading(filename);
            await updateBatchContent(filename, editBatchContent);
            setEditingBatch(null);
            setBatchContentCache(prev => ({ ...prev, [filename]: editBatchContent }));
            await loadSavedBatches();
            alert('Updated batch file content.');
        } catch (e: any) {
            alert(`Update failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handleRename = async (oldName: string, newName: string) => {
        if (!newName || newName === oldName) {
            setRenamingBatch(null);
            return;
        }
        try {
            await renameBatchFile(oldName, newName);
            await loadSavedBatches();
            setRenamingBatch(null);
        } catch (e: any) {
            alert(`Rename failed: ${e.message}`);
        }
    };

    const handleDeleteLocal = async (filename: string) => {
        if (!confirm(`Permanently delete local file ${filename}?`)) return;
        try {
            await deleteBatchLocal(filename);
            await loadSavedBatches();
        } catch (e: any) {
            alert(`Delete failed: ${e.message}`);
        }
    };

    const handleCheckRemote = async (filename: string, serverId: string) => {
        try {
            setBatchOperationLoading(`check-${filename}`);
            const res = await checkBatchRemote(filename, serverId);
            setRemoteStatusCache(prev => ({
                ...prev,
                [filename]: { ...prev[filename], [serverId]: res.exists }
            }));
        } catch (e: any) {
            alert(`Check failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handlePullBatch = async (filename: string, serverId: string) => {
        if (!confirm(`Overwrite local ${filename} with version from server?`)) return;
        try {
            setBatchOperationLoading(`pull-${filename}`);
            await pullBatch(filename, serverId);
            await loadSavedBatches();
            const data = await getBatchFile(filename);
            setBatchContentCache(prev => ({ ...prev, [filename]: data.content }));
            alert('Pulled successfully');
        } catch (e: any) {
            alert(`Pull failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handleDeleteRemote = async (filename: string, serverId: string) => {
        if (!confirm(`Delete ${filename} from remote server?`)) return;
        try {
            setBatchOperationLoading(`del-remote-${filename}`);
            await deleteBatchRemote(filename, serverId);
            handleCheckRemote(filename, serverId); // Refresh status
        } catch (e: any) {
            alert(`Remote delete failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    return (
        <React.Fragment>
            {savedBatches.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-cyan-400">
                            <FolderOpen size={18} /> Saved Batches
                        </h2>
                        <button
                            onClick={loadSavedBatches}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                        >
                            Refresh
                        </button>
                    </div>
                    <div className="space-y-2">
                        {sortedSavedBatches.map((f) => {
                            const isExpanded = expandedBatchFile === f.name;
                            const isEditing = editingBatch === f.name;
                            const isLoading = batchOperationLoading?.includes(f.name);

                            return (
                                <div
                                    key={f.name}
                                    className={`bg-zinc-800/50 border rounded-lg transition ${isExpanded ? 'border-cyan-500/50' : 'border-zinc-700'}`}
                                >
                                    {/* Header Row */}
                                    <div
                                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-800/80"
                                        onClick={() => handleExpandBatch(f.name)}
                                    >
                                        <div className="flex items-center gap-3">
                                            {isExpanded ? <ChevronDown size={16} className="text-cyan-400" /> : <ChevronRight size={16} className="text-zinc-500" />}
                                            <FileCode size={16} className="text-amber-400" />
                                            {renamingBatch === f.name ? (
                                                <input
                                                    autoFocus
                                                    value={renameValue}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRename(f.name, renameValue);
                                                        if (e.key === 'Escape') setRenamingBatch(null);
                                                    }}
                                                    onBlur={() => handleRename(f.name, renameValue)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-sm font-medium bg-zinc-900 border border-indigo-500 rounded px-2 py-0.5 text-white focus:outline-none"
                                                />
                                            ) : (
                                                <span
                                                    className="text-sm font-medium text-zinc-200 hover:text-indigo-400 cursor-pointer"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRenamingBatch(f.name);
                                                        setRenameValue(f.name);
                                                    }}
                                                    title="Click to rename"
                                                >
                                                    {f.name}
                                                </span>
                                            )}
                                            {f.user_count !== undefined && f.user_count > 0 && (
                                                <span className="text-xs bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">{f.user_count} users</span>
                                            )}
                                            {f.random_order && (
                                                <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1" title="Random Order">
                                                    <Shuffle size={10} /> Random
                                                </span>
                                            )}
                                            {f.sync_pair && (
                                                <span className="text-xs text-zinc-500 truncate max-w-[200px]" title={`${f.sync_pair.source} → ${f.sync_pair.dest}`}>
                                                    {f.sync_pair.source.split('/').pop()} → {f.sync_pair.dest.split(':')[0]}
                                                </span>
                                            )}
                                            <span className="text-xs text-zinc-600">{(f.size / 1024).toFixed(1)} KB</span>
                                        </div>
                                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => openBatchUsersModal(f.name)}
                                                className="flex items-center gap-1 px-2 py-1 bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white rounded text-xs transition"
                                                title="View/Compare Users"
                                            >
                                                <Users size={12} /> Users
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    const choice = prompt(
                                                        `How would you like to regenerate ${f.name}?\n\n` +
                                                        `1: Keep existing users in file (just update paths/logic)\n` +
                                                        `2: Use currently selected ${selectedUsers.size} users from table\n` +
                                                        `3: Refresh and use ALL users from domain\n\n` +
                                                        `Enter 1, 2, or 3:`,
                                                        "1"
                                                    );

                                                    if (!choice || !['1', '2', '3'].includes(choice)) return;

                                                    try {
                                                        setBatchOperationLoading(`regen-${f.name}`);

                                                        let sUsers: string[] | undefined = undefined;
                                                        let allU = false;

                                                        if (choice === '2') {
                                                            if (selectedUsers.size === 0) {
                                                                alert("No users selected in the table!");
                                                                setBatchOperationLoading(null);
                                                                return;
                                                            }
                                                            sUsers = Array.from(selectedUsers);
                                                        } else if (choice === '3') {
                                                            allU = true;
                                                        }

                                                        await regenerateBatch(f.name, randomOrder, sUsers, allU, f.sync_pair?.id);
                                                        await loadSavedBatches();

                                                        // Refresh content cache
                                                        const data = await getBatchFile(f.name);
                                                        setBatchContentCache(prev => ({ ...prev, [f.name]: data.content }));
                                                        alert(`Batch ${f.name} regenerated successfully.`);
                                                    } catch (e: any) {
                                                        alert(`Regeneration failed: ${e.response?.data?.detail || e.message}`);
                                                    } finally {
                                                        setBatchOperationLoading(null);
                                                    }
                                                }}
                                                disabled={!!isLoading || !f.sync_pair}
                                                className="flex items-center gap-1 px-2 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                title={f.sync_pair ? `Regenerate with current users${randomOrder ? ' (Random Order)' : ''}` : 'No sync pair found'}
                                            >
                                                <Shuffle size={12} /> Regen
                                            </button>
                                            <button
                                                onClick={() => handleDeleteLocal(f.name)}
                                                disabled={!!isLoading}
                                                className="flex items-center gap-1 px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                title="Delete Local"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Content */}
                                    {isExpanded && (
                                        <div className="border-t border-zinc-700 p-3 space-y-3">
                                            {/* Server Operations Row */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <select
                                                    value={selectedServerId}
                                                    onChange={(e) => setSelectedServerId(e.target.value)}
                                                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                                                >
                                                    {sshServers.length === 0 && <option value="">No servers</option>}
                                                    {sshServers.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => handleCheckRemote(f.name, selectedServerId)}
                                                    disabled={!selectedServerId || !!isLoading}
                                                    className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Check
                                                </button>
                                                <button
                                                    onClick={() => handleOpenPushModal('batch', f.name)}
                                                    disabled={!selectedServerId || !!isLoading}
                                                    className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Push
                                                </button>
                                                <button
                                                    onClick={() => handlePullBatch(f.name, selectedServerId)}
                                                    disabled={!selectedServerId || !!isLoading}
                                                    className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Pull
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteRemote(f.name, selectedServerId)}
                                                    disabled={!selectedServerId || !!isLoading}
                                                    className="px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Del Remote
                                                </button>
                                                {remoteStatusCache[f.name]?.[selectedServerId] !== undefined && (
                                                    <span className={`text-xs px-2 py-0.5 rounded ${remoteStatusCache[f.name][selectedServerId] ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                                                        {remoteStatusCache[f.name][selectedServerId] ? '✓ Exists' : '✗ Missing'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Content Area */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-zinc-500">Content</span>
                                                    {!isEditing ? (
                                                        <button
                                                            onClick={() => handleStartEdit(f.name)}
                                                            className="flex items-center gap-1 px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition"
                                                        >
                                                            <Edit2 size={10} /> Edit
                                                        </button>
                                                    ) : (
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => handleSaveEdit(f.name)}
                                                                disabled={!!isLoading}
                                                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs transition disabled:opacity-50"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingBatch(null);
                                                                    setEditBatchContent('');
                                                                }}
                                                                className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                {isEditing ? (
                                                    <textarea
                                                        value={editBatchContent}
                                                        onChange={(e) => setEditBatchContent(e.target.value)}
                                                        className="w-full h-64 bg-zinc-950 font-mono text-xs text-zinc-300 p-2 rounded border border-zinc-700 focus:outline-none focus:border-cyan-500"
                                                    />
                                                ) : (
                                                    <div className="max-h-64 overflow-y-auto bg-zinc-950 p-2 rounded border border-zinc-800">
                                                        <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap">
                                                            {batchContentCache[f.name] || 'Click expand to load content...'}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </React.Fragment>
    );
};
