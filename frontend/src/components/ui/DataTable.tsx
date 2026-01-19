import React, { useState } from 'react';
import { Check, Columns, ChevronDown } from 'lucide-react';
import { ColumnFilter } from './ColumnFilter';

export interface ColumnConfig<T> {
    key: string;
    header: string;
    sortable?: boolean;
    filterable?: boolean;
    render?: (value: any, item: T) => React.ReactNode;
    getFilterValue?: (item: T) => string;
    width?: string;
    headerClassName?: string;
    cellClassName?: string;
}

interface DataTableProps<T> {
    data: T[];
    columns: ColumnConfig<T>[];
    selectedItems?: Set<string | number>;
    onToggleItem?: (id: string | number, e: React.MouseEvent) => void;
    onSelectAll?: () => void;
    onInvertSelection?: () => void;
    handleSort: (key: string) => void;
    SortIcon: React.FC<{ column: string }>;
    columnFilters: Record<string, Set<string>>;
    onToggleColumnFilter: (column: string, value: string) => void;
    onClearColumnFilter: (column: string) => void;
    getUniqueValues: (column: string) => string[];
    rowIdKey?: string;
    isLoading?: boolean;
    emptyMessage?: string;
    renderExpansion?: (item: T) => React.ReactNode;
    className?: string;
    compact?: boolean;
}

export function DataTable<T extends Record<string, any>>({
    data,
    columns,
    selectedItems,
    onToggleItem,
    onSelectAll,
    onInvertSelection,
    handleSort,
    SortIcon,
    columnFilters,
    onToggleColumnFilter,
    onClearColumnFilter,
    getUniqueValues,
    rowIdKey = 'id',
    isLoading = false,
    emptyMessage = "No items found.",
    renderExpansion,
    className = "",
    compact = false
}: DataTableProps<T>) {

    const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());
    const isAllSelected = selectedItems && data.length > 0 && selectedItems.size === data.length;

    const toggleExpand = (id: string | number, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className={`bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden backdrop-blur-sm flex flex-col ${className}`}>
            <div className="overflow-auto flex-1 min-h-0 custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-zinc-800 bg-zinc-900 shadow-sm">
                            {(onToggleItem || renderExpansion) && (
                                <th className={`${compact ? 'px-2 py-1' : 'p-4'} w-12`}>
                                    <div className="flex items-center gap-2">
                                        {onToggleItem && (
                                            <>
                                                <div
                                                    onClick={onSelectAll}
                                                    className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${isAllSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600 bg-zinc-800 hover:border-zinc-500'
                                                        }`}
                                                >
                                                    {isAllSelected && <Check size={10} className="text-white" />}
                                                </div>
                                                {onInvertSelection && (
                                                    <button
                                                        onClick={onInvertSelection}
                                                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors uppercase font-bold tracking-tighter"
                                                        title="Invert Selection"
                                                    >
                                                        Inv
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </th>
                            )}
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className={`${compact ? 'px-2 py-1' : 'p-4'} text-xs font-bold text-zinc-400 uppercase tracking-wider ${col.headerClassName || ''}`}
                                    style={col.width ? { width: col.width } : {}}
                                >
                                    <div className="flex items-center">
                                        <div
                                            className={col.sortable ? "cursor-pointer hover:text-zinc-200 transition-colors flex items-center" : "flex items-center"}
                                            onClick={() => col.sortable && handleSort(col.key)}
                                        >
                                            {col.header}
                                            {col.sortable && <SortIcon column={col.key} />}
                                        </div>
                                        {col.filterable && (
                                            <ColumnFilter
                                                column={col.key}
                                                title={col.header}
                                                options={getUniqueValues(col.key)}
                                                selected={columnFilters[col.key] || new Set()}
                                                onToggle={onToggleColumnFilter}
                                                onClear={onClearColumnFilter}
                                            />
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                        {isLoading ? (
                            <tr>
                                <td colSpan={columns.length + (onToggleItem || renderExpansion ? 1 : 0)} className="p-8 text-center text-zinc-500">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Loading data...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : data.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + (onToggleItem || renderExpansion ? 1 : 0)} className="p-12 text-center text-zinc-500 italic">
                                    <div className="flex flex-col items-center gap-2">
                                        <Columns size={24} className="text-zinc-700" />
                                        <span>{emptyMessage}</span>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            data.map((item, index) => {
                                const id = item[rowIdKey] || item.email || item.index || index;
                                const isSelected = selectedItems?.has(id);
                                const isExpanded = expandedRows.has(id);
                                return (
                                    <React.Fragment key={id}>
                                        <tr
                                            className={`group transition-colors cursor-pointer ${isSelected ? 'bg-indigo-900/10' : 'hover:bg-zinc-800/30'
                                                }`}
                                            onClick={(e) => onToggleItem ? onToggleItem(id, e) : (renderExpansion ? toggleExpand(id, e) : null)}
                                        >
                                            {(onToggleItem || renderExpansion) && (
                                                <td className={`${compact ? 'px-2 py-1' : 'p-4'}`} onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center gap-3">
                                                        {onToggleItem && (
                                                            <div
                                                                onClick={(e) => onToggleItem(id, e)}
                                                                className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-700 bg-zinc-800 group-hover:border-zinc-500'
                                                                    }`}
                                                            >
                                                                {isSelected && <Check size={10} className="text-white" />}
                                                            </div>
                                                        )}
                                                        {renderExpansion && (
                                                            <button
                                                                onClick={(e) => toggleExpand(id, e)}
                                                                className={`p-1 rounded transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : 'text-zinc-500'}`}
                                                            >
                                                                <ChevronDown size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                            {columns.map((col) => (
                                                <td
                                                    key={col.key}
                                                    className={`${compact ? 'px-2 py-1' : 'p-4'} text-sm text-zinc-300 min-w-0 ${col.cellClassName || ''}`}
                                                    style={col.width ? { width: col.width } : {}}
                                                >
                                                    {col.render ? col.render(item[col.key], item) : String(item[col.key] ?? '')}
                                                </td>
                                            ))}
                                        </tr>
                                        {isExpanded && renderExpansion && (
                                            <tr className="bg-zinc-950/30">
                                                <td colSpan={columns.length + (onToggleItem || renderExpansion ? 1 : 0)} className="p-0">
                                                    <div className="p-4 animate-in slide-in-from-top-2 duration-200">
                                                        {renderExpansion(item)}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            <div className="p-3 bg-zinc-900/30 border-t border-zinc-800 flex justify-between items-center text-[10px] text-zinc-500 font-medium">
                <div>
                    Showing {data.length} items
                </div>
                {selectedItems && selectedItems.size > 0 && (
                    <div className="text-indigo-400 font-bold uppercase tracking-wider">
                        {selectedItems.size} selected
                    </div>
                )}
            </div>
        </div>
    );
}
