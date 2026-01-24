import React from 'react';
import { Plus, Zap, Shuffle, Edit2, Trash2, Shield, Globe, FileCode } from 'lucide-react';
import { SyncPairWithBatch, regenerateBatch } from '../../api';
import { DataTable, ColumnConfig } from '../ui/DataTable';

export interface SyncPairListProps {
    unifiedPairs: SyncPairWithBatch[];
    selectedPairs: Set<number>;
    togglePair: (id: string | number, e: React.MouseEvent) => void;
    selectAllPairs: () => void;
    invertSelection: () => void;
    openWizard: () => void;
    handleEditSyncPair: (pair: SyncPairWithBatch) => void;
    handleDeleteSyncPair: (id: string, source: string, dest: string) => void;
    randomOrder: boolean;
    loadData: () => Promise<void>;
    handleSort: (key: string) => void;
    SortIcon: React.FC<{ column: string }>;
    columnFilters: Record<string, Set<string>>;
    onToggleColumnFilter: (column: string, value: string) => void;
    onClearColumnFilter: (column: string) => void;
    getUniqueValues: (column: string) => string[];
    onGenerateSingle: (pair: SyncPairWithBatch) => Promise<void>;
}

export const SyncPairList: React.FC<SyncPairListProps> = ({
    unifiedPairs,
    selectedPairs,
    togglePair,
    selectAllPairs,
    invertSelection,
    openWizard,
    handleEditSyncPair,
    handleDeleteSyncPair,
    randomOrder,
    loadData,
    handleSort,
    SortIcon,
    columnFilters,
    onToggleColumnFilter,
    onClearColumnFilter,
    getUniqueValues,
    onGenerateSingle
}) => {

    const columns: ColumnConfig<SyncPairWithBatch>[] = [
        {
            key: 'source',
            header: 'Source',
            sortable: true,
            render: (_, p) => (
                <div className="flex flex-col">
                    <span className="text-orange-300 font-mono text-xs truncate" title={p.source}>{p.source}</span>
                    {p.source_type && p.source_type !== 'LOCAL' && (
                        <span className="text-[10px] text-orange-500/70 font-bold uppercase tracking-widest flex items-center gap-1">
                            {p.source_type === 'SSH' ? <Shield size={10} /> : <Globe size={10} />}
                            {p.source_type}: {p.source_server_id}
                        </span>
                    )}
                </div>
            )
        },
        {
            key: 'dest',
            header: 'Destination',
            sortable: true,
            render: (_, p) => (
                <div className="flex flex-col">
                    <span className="text-blue-300 font-mono text-xs truncate" title={p.dest}>{p.dest}</span>
                    {p.dest_type && p.dest_type !== 'LOCAL' && (
                        <span className="text-[10px] text-blue-500/70 font-bold uppercase tracking-widest flex items-center gap-1">
                            {p.dest_type === 'SSH' ? <Shield size={10} /> : <Globe size={10} />}
                            {p.dest_type}: {p.dest_server_id}
                        </span>
                    )}
                </div>
            )
        },
        {
            key: 'status',
            header: 'Batch Status',
            sortable: true,
            filterable: true,
            render: (_, p) => (
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
                            <span className={`text-[10px] truncate ${p.batch.needs_update ? 'text-amber-400/70 italic' : 'text-zinc-500'}`} title={p.batch.filename}>
                                {p.batch.filename}
                            </span>
                        </>
                    ) : (
                        <span className="text-xs text-amber-500/80 italic">No batch file</span>
                    )}
                </div>
            ),
            getFilterValue: (p) => p.batch.exists ? (p.batch.needs_update ? "Needs Update" : "Current") : "No Batch"
        },
        {
            key: 'actions',
            header: '',
            render: (_, p) => (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                        onClick={(e) => { e.stopPropagation(); onGenerateSingle(p); }}
                        className="text-emerald-500 hover:text-emerald-400 p-1"
                        title={p.batch.exists ? "Generate New Batch File" : "Generate Batch File"}
                    >
                        <FileCode size={14} />
                    </button>
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
                            title="Regenerate batch"
                        >
                            <Shuffle size={14} />
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); handleEditSyncPair(p); }}
                        className="text-zinc-600 hover:text-cyan-400 p-1"
                        title="Edit"
                    >
                        <Edit2 size={14} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSyncPair(p.id || String(p.index), p.source, p.dest); }}
                        className="text-zinc-600 hover:text-red-400 p-1"
                        title="Delete"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            )
        }
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={openWizard}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30 rounded-lg text-xs font-bold transition"
                    >
                        <Plus size={14} /> NEW SYNC PAIR
                    </button>
                    <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-lg border border-zinc-800">
                        <button
                            onClick={selectAllPairs}
                            className={`px-3 py-1 rounded transition-colors text-[10px] font-bold uppercase tracking-tighter ${selectedPairs.size === unifiedPairs.length && unifiedPairs.length > 0 ? 'bg-violet-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                            title="Select All"
                        >
                            All
                        </button>
                        <button
                            onClick={invertSelection}
                            className="px-3 py-1 text-zinc-500 hover:text-zinc-300 transition-colors text-[10px] font-bold uppercase tracking-tighter"
                            title="Invert Selection"
                        >
                            Inv
                        </button>
                    </div>
                </div>
            </div>

            <DataTable
                data={unifiedPairs}
                columns={columns}
                selectedItems={selectedPairs}
                onToggleItem={togglePair}
                onSelectAll={selectAllPairs}
                onInvertSelection={invertSelection}
                handleSort={handleSort}
                SortIcon={SortIcon}
                columnFilters={columnFilters}
                onToggleColumnFilter={onToggleColumnFilter}
                onClearColumnFilter={onClearColumnFilter}
                getUniqueValues={getUniqueValues}
                rowIdKey="index"
                emptyMessage="No sync pairs configured."
            />
        </div>
    );
};
