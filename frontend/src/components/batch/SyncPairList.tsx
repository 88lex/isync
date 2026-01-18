import React, { useMemo } from 'react';
import { Plus, Check, Zap, Shuffle, Edit2, Trash2 } from 'lucide-react';
import { SyncPairWithBatch, regenerateBatch } from '../../api';

export interface SyncPairListProps {
    unifiedPairs: SyncPairWithBatch[];
    selectedPairs: Set<number>;
    handlePairClick: (index: number, e: React.MouseEvent, allIndices: number[]) => void;
    selectAllPairs: () => void;
    openWizard: () => void;
    handleEditSyncPair: (pair: SyncPairWithBatch) => void;
    handleDeleteSyncPair: (id: string, source: string, dest: string) => void;
    randomOrder: boolean;
    loadData: () => Promise<void>;
}

export const SyncPairList: React.FC<SyncPairListProps> = ({
    unifiedPairs,
    selectedPairs,
    handlePairClick,
    selectAllPairs,
    openWizard,
    handleEditSyncPair,
    handleDeleteSyncPair,
    randomOrder,
    loadData
}) => {
    // Sort pairs: needs_update first, then source path
    const sortedUnifiedPairs = useMemo(() => {
        return [...unifiedPairs].sort((a, b) => {
            if (a.batch.needs_update && !b.batch.needs_update) return -1;
            if (!a.batch.needs_update && b.batch.needs_update) return 1;
            return a.source.localeCompare(b.source);
        });
    }, [unifiedPairs]);

    return (
        <>
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-zinc-400">
                    Sync Pairs & Batches ({selectedPairs.size} of {unifiedPairs.length} selected)
                </span>
                <div className="flex items-center gap-3">
                    <button
                        onClick={openWizard}
                        className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
                    >
                        <Plus size={14} /> New Sync Pair
                    </button>
                    <button
                        onClick={selectAllPairs}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                    >
                        {selectedPairs.size === unifiedPairs.length ? 'Deselect All' : 'Select All'}
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                {unifiedPairs.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-zinc-500 italic mb-3">No sync pairs configured.</div>
                        <button
                            onClick={openWizard}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 mx-auto"
                        >
                            <Plus size={16} /> Create First Sync Pair
                        </button>
                    </div>
                ) : (
                    sortedUnifiedPairs.map((p) => {
                        const isSelected = selectedPairs.has(p.index);
                        return (
                            <div
                                key={p.index}
                                onClick={(e) => handlePairClick(p.index, e, sortedUnifiedPairs.map(sp => sp.index))}
                                className={`flex items-center gap-3 p-2 rounded border transition cursor-pointer group ${isSelected
                                    ? 'bg-indigo-900/20 border-indigo-500/50'
                                    : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                                    }`}
                            >
                                <div
                                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600 bg-zinc-800'
                                        }`}>
                                    {isSelected && <Check size={10} className="text-white" />}
                                </div>
                                <div className="flex-1 grid grid-cols-3 gap-2 text-sm font-mono min-w-0">
                                    <div className="text-orange-300 truncate" title={p.source}>
                                        {p.source}
                                    </div>
                                    <div className="text-blue-300 truncate" title={p.dest}>
                                        {p.dest}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {p.batch.exists ? (
                                            <>
                                                <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${p.batch.needs_update
                                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                                    : 'bg-emerald-500/20 text-emerald-400'
                                                    }`}>
                                                    {p.batch.user_count || 0} users
                                                    {p.batch.needs_update && <span title="Sync pair edited - Update Saved Batch"><Zap size={10} /></span>}
                                                </span>
                                                <span className={`text-xs truncate ${p.batch.needs_update ? 'text-amber-400/70 italic' : 'text-zinc-500'}`} title={p.batch.filename}>
                                                    {p.batch.filename}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-xs text-amber-500/80 italic">No batch file</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                                    {p.batch.needs_update && p.batch.filename && (
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                if (confirm(`Update ${p.batch.filename} with new paths?`)) {
                                                    try {
                                                        await regenerateBatch(
                                                            p.batch.filename!,
                                                            randomOrder,
                                                            undefined,
                                                            false,
                                                            p.id
                                                        );
                                                        await loadData();
                                                    } catch (err: any) {
                                                        alert(`Failed: ${err.message}`);
                                                    }
                                                }
                                            }}
                                            className="text-amber-500 hover:text-amber-400 p-1"
                                            title="Regenerate batch with new paths"
                                        >
                                            <Shuffle size={14} />
                                        </button>
                                    )}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleEditSyncPair(p); }}
                                        className="text-zinc-600 hover:text-cyan-400 p-1"
                                        title="Edit sync pair"
                                    >
                                        <Edit2 size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSyncPair(p.id || String(p.index), p.source, p.dest); }}
                                        className="text-zinc-600 hover:text-red-400 p-1"
                                        title="Delete sync pair"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                {p.batch.needs_update && (
                                    <div className="absolute -top-1 -right-1 flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </>
    );
};
