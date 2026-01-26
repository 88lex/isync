import React, { useState } from 'react';
import {
    BatchFile, SSHServer, getBatchFile, updateBatchContent, renameBatchFile,
    deleteBatchLocal, checkBatchRemote, pullBatch, deleteBatchRemote
} from '../../api';
import { FolderOpen, FileCode, Users, Shuffle, Trash2, Edit2, ChevronDown, UploadCloud } from 'lucide-react';
import { DataTable, ColumnConfig } from '../ui/DataTable';
import { useDataTable } from '../../hooks/useDataTable';

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
    handleOpenPushModal: (type: 'batch' | 'group', ids: string | string[]) => void;
    batchOperationLoading: string | null;
    setBatchOperationLoading: (val: string | null) => void;
    onRegenerate: (file: BatchFile) => void;
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
    setBatchOperationLoading,
    onRegenerate
}) => {
    // Local UI State for editing
    const [editingBatch, setEditingBatch] = useState<string | null>(null);
    const [editBatchContent, setEditBatchContent] = useState('');
    const [renamingBatch, setRenamingBatch] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [selectedServerId, setSelectedServerId] = useState(() => sshServers[0]?.id || '');

    // Table Logic
    const columns: ColumnConfig<BatchFile>[] = [
        {
            key: 'name',
            header: 'Filename',
            sortable: true,
            filterable: true,
            render: (val, f) => (
                <div className="flex items-center gap-2">
                    <FileCode size={16} className="text-amber-400 shrink-0" />
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
                            className="text-sm font-medium text-zinc-200 hover:text-indigo-400 cursor-pointer truncate"
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
                </div>
            )
        },
        {
            key: 'user_count',
            header: 'Users',
            sortable: true,
            render: (val) => (
                val !== undefined && val > 0 ? (
                    <span className="text-xs bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-mono">{val}</span>
                ) : <span className="text-zinc-600">-</span>
            )
        },
        {
            key: 'type',
            header: 'Type',
            filterable: true,
            render: (_, f) => (
                <div className="flex gap-2">
                    {f.random_order && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase font-bold tracking-tighter shadow-sm border border-amber-500/20" title="Random Order">
                            <Shuffle size={10} /> RANDOM
                        </span>
                    )}
                    {f.sync_pair && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter shadow-sm border border-blue-500/20" title="Generated from Sync Pair">
                            PAIR
                        </span>
                    )}
                </div>
            ),
            getFilterValue: (f) => f.random_order ? "Random" : (f.sync_pair ? "Pair" : "Manual")
        },
        {
            key: 'size',
            header: 'Size',
            sortable: true,
            render: (val) => <span className="text-xs text-zinc-500 font-mono">{(val / 1024).toFixed(1)} KB</span>
        },
        {
            key: 'actions',
            header: '',
            render: (_, f) => {
                const isLoading = batchOperationLoading?.includes(f.name);
                return (
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                        <button
                            onClick={() => openBatchUsersModal(f.name)}
                            className="flex items-center gap-1 px-2 py-1 bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white rounded text-xs transition border border-purple-500/20"
                            title="View/Compare Users"
                        >
                            <Users size={12} />
                        </button>
                        <button
                            onClick={() => handleOpenPushModal('batch', f.name)}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white rounded text-xs transition border border-cyan-500/20 disabled:opacity-50"
                            title="Push to Remote"
                        >
                            <UploadCloud size={12} />
                        </button>
                        <button
                            onClick={() => onRegenerate(f)}
                            disabled={!!isLoading || !f.sync_pair}
                            className="flex items-center gap-1 px-2 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded text-xs transition disabled:opacity-50 border border-amber-500/20"
                            title="Regenerate"
                        >
                            <Shuffle size={12} />
                        </button>
                        <button
                            onClick={() => handleDeleteLocal(f.name)}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition disabled:opacity-50 border border-red-500/20"
                            title="Delete Local"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                );
            }
        }
    ];

    const {
        data: sortedFilteredBatches,
        searchTerm,
        setSearchTerm,
        columnFilters,
        toggleColumnFilter,
        clearColumnFilter,
        getUniqueValues,
        selectedItems: selectedBatches,
        toggleItem,
        selectAll,
        invertSelection,
        handleSort,
        SortIcon,
        sortColumn,
        sortDirection
    } = useDataTable({
        data: savedBatches,
        columns,
        persistentKey: 'batch_list',
        rowIdKey: 'name',
        filterFn: (f, search) => f.name.toLowerCase().includes(search.toLowerCase())
    });

    // Handlers
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
        } catch (e: any) {
            alert(`Update failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const [isRenaming, setIsRenaming] = useState(false);

    const handleRename = async (oldName: string, newName: string) => {
        if (!newName || newName === oldName || isRenaming) {
            setRenamingBatch(null);
            return;
        }
        try {
            setIsRenaming(true);
            await renameBatchFile(oldName, newName);
            await loadSavedBatches();
            setRenamingBatch(null);
        } catch (e: any) {
            alert(`Rename failed: ${e.message}`);
        } finally {
            setIsRenaming(false);
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
            handleCheckRemote(filename, serverId);
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
                        <div className="flex items-center gap-3">
                            <h2 className="text-lg font-bold flex items-center gap-2 text-indigo-400">
                                <FolderOpen size={18} /> Saved Batches
                            </h2>
                            {selectedBatches.size > 0 && (
                                <button
                                    onClick={() => handleOpenPushModal('batch', Array.from(selectedBatches) as string[])}
                                    className="flex items-center gap-1 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-bold transition shadow-lg shadow-cyan-900/20 animate-in fade-in zoom-in duration-200"
                                >
                                    <UploadCloud size={14} /> Push Selected ({selectedBatches.size})
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 relative group-search-container">
                            <input
                                type="text"
                                placeholder="Search batches..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="bg-zinc-950 border border-zinc-700 text-xs px-2 py-1 rounded w-48 focus:border-indigo-500 outline-none transition-all"
                            />
                            <button
                                onClick={loadSavedBatches}
                                className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                            >
                                Refresh
                            </button>
                        </div>
                    </div>

                    <DataTable
                        data={sortedFilteredBatches}
                        columns={columns}
                        selectedItems={selectedBatches}
                        onToggleItem={toggleItem}
                        onSelectAll={selectAll}
                        onInvertSelection={invertSelection}
                        handleSort={handleSort}
                        SortIcon={SortIcon}
                        columnFilters={columnFilters}
                        onToggleColumnFilter={toggleColumnFilter}
                        onClearColumnFilter={clearColumnFilter}
                        getUniqueValues={getUniqueValues}
                        rowIdKey="name"
                        emptyMessage="No matching batches found."
                        renderExpansion={(f) => {
                            const isEditing = editingBatch === f.name;
                            const isLoading = batchOperationLoading?.includes(f.name);
                            return (
                                <div className="space-y-4">
                                    {/* Server Ops */}
                                    <div className="flex items-center gap-3 bg-zinc-900/50 p-3 rounded border border-zinc-800">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] uppercase font-bold text-zinc-500">Target Server:</span>
                                            <select
                                                value={selectedServerId}
                                                onChange={(e) => setSelectedServerId(e.target.value)}
                                                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:border-indigo-500 outline-none"
                                            >
                                                {sshServers.length === 0 && <option value="">No servers</option>}
                                                {sshServers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleCheckRemote(f.name, selectedServerId)}
                                                disabled={!selectedServerId || !!isLoading}
                                                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition border border-zinc-700 disabled:opacity-50"
                                            >Check</button>
                                            <button
                                                onClick={() => handleOpenPushModal('batch', f.name)}
                                                disabled={!!isLoading}
                                                className="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded text-xs transition border border-indigo-500/20 disabled:opacity-50"
                                            >Push</button>
                                            <button
                                                onClick={() => handlePullBatch(f.name, selectedServerId)}
                                                disabled={!selectedServerId || !!isLoading}
                                                className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded text-xs transition border border-emerald-500/20 disabled:opacity-50"
                                            >Pull</button>
                                            <button
                                                onClick={() => handleDeleteRemote(f.name, selectedServerId)}
                                                disabled={!selectedServerId || !!isLoading}
                                                className="px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition border border-red-500/20 disabled:opacity-50"
                                            >Del Remote</button>
                                        </div>
                                        {remoteStatusCache[f.name]?.[selectedServerId] !== undefined && (
                                            <div className={`text-[10px] px-2 py-1 rounded font-bold uppercase tracking-tighter ${remoteStatusCache[f.name][selectedServerId] ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/20' : 'bg-red-900/20 text-red-500 border border-red-900/20'}`}>
                                                {remoteStatusCache[f.name][selectedServerId] ? '✓ ONLINE' : '✗ MISSING'}
                                            </div>
                                        )}
                                    </div>

                                    {/* Content Preview/Edit */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                                <FileCode size={12} /> BATCH SCRIPT CONTENT
                                            </h3>
                                            {!isEditing ? (
                                                <button
                                                    onClick={async () => {
                                                        if (!batchContentCache[f.name]) {
                                                            try {
                                                                setBatchOperationLoading(`load-${f.name}`);
                                                                const data = await getBatchFile(f.name);
                                                                setBatchContentCache(prev => ({ ...prev, [f.name]: data.content }));
                                                                handleStartEdit(f.name);
                                                            } catch (e) { alert('Failed to load'); }
                                                            finally { setBatchOperationLoading(null); }
                                                        } else {
                                                            handleStartEdit(f.name);
                                                        }
                                                    }}
                                                    className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition border border-zinc-700"
                                                >
                                                    <Edit2 size={10} /> Edit Script
                                                </button>
                                            ) : (
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleSaveEdit(f.name)} disabled={!!isLoading} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition">Save Changes</button>
                                                    <button onClick={() => setEditingBatch(null)} className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition">Cancel</button>
                                                </div>
                                            )}
                                        </div>
                                        {isEditing ? (
                                            <textarea
                                                value={editBatchContent}
                                                onChange={(e) => setEditBatchContent(e.target.value)}
                                                className="w-full h-80 bg-zinc-950 font-mono text-xs text-indigo-300/80 p-3 rounded border border-zinc-800 focus:border-indigo-500 outline-none leading-relaxed"
                                            />
                                        ) : (
                                            <div
                                                className="max-h-80 overflow-y-auto bg-zinc-950 p-4 rounded border border-zinc-900 cursor-pointer hover:border-zinc-800 transition-colors"
                                                onClick={async () => {
                                                    if (!batchContentCache[f.name]) {
                                                        try {
                                                            setBatchOperationLoading(`load-${f.name}`);
                                                            const data = await getBatchFile(f.name);
                                                            setBatchContentCache(prev => ({ ...prev, [f.name]: data.content }));
                                                        } catch (e) { console.error(e); }
                                                        finally { setBatchOperationLoading(null); }
                                                    }
                                                }}
                                            >
                                                <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap selection:bg-indigo-500/30">
                                                    {batchContentCache[f.name] || 'Click to load script content preview...'}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        }}
                    />
                </div>
            )}
        </React.Fragment>
    );
};
