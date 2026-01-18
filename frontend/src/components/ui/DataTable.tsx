import React, { useState, useCallback, useRef } from 'react';
import { ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';

export interface Column<T> {
    key: string;
    header: string;
    width?: string;
    sortable?: boolean;
    render?: (row: T, index: number) => React.ReactNode;
    align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T> {
    data: T[];
    columns: Column<T>[];
    keyField: keyof T;
    selectable?: boolean;
    selectedKeys?: Set<string | number>;
    onSelectionChange?: (keys: Set<string | number>) => void;
    expandable?: boolean;
    renderExpanded?: (row: T) => React.ReactNode;
    defaultSortColumn?: string;
    defaultSortDirection?: 'asc' | 'desc';
    emptyMessage?: string;
    compact?: boolean;
    className?: string;
}

type SortDirection = 'asc' | 'desc' | null;

export function DataTable<T extends Record<string, any>>({
    data,
    columns,
    keyField,
    selectable = false,
    selectedKeys = new Set(),
    onSelectionChange,
    expandable = false,
    renderExpanded,
    defaultSortColumn,
    defaultSortDirection = 'asc',
    emptyMessage = 'No data available',
    compact = true,
    className = '',
}: DataTableProps<T>) {
    // Sorting state
    const [sortColumn, setSortColumn] = useState<string | null>(
        defaultSortColumn || (columns[0]?.sortable !== false ? columns[0]?.key : null)
    );
    const [sortDirection, setSortDirection] = useState<SortDirection>(
        defaultSortColumn || columns[0] ? defaultSortDirection : null
    );

    // Expansion state
    const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set());

    // Shift-click tracking
    const lastClickedIndex = useRef<number | null>(null);

    // Handle column header click for sorting
    const handleSort = (colKey: string) => {
        if (sortColumn === colKey) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(colKey);
            setSortDirection('asc');
        }
    };

    // Sort data
    const sortedData = React.useMemo(() => {
        if (!sortColumn || !sortDirection) return data;

        return [...data].sort((a, b) => {
            const aVal = a[sortColumn];
            const bVal = b[sortColumn];

            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [data, sortColumn, sortDirection]);

    // Handle row selection with shift-click support
    const handleRowClick = useCallback((e: React.MouseEvent, row: T, index: number) => {
        const key = row[keyField] as string | number;

        if (expandable && !selectable) {
            // Toggle expansion
            setExpandedKeys(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
            });
            return;
        }

        if (!selectable || !onSelectionChange) return;

        if (e.shiftKey && lastClickedIndex.current !== null) {
            // Shift-click: select range
            const start = Math.min(lastClickedIndex.current, index);
            const end = Math.max(lastClickedIndex.current, index);
            const newKeys = new Set(selectedKeys);

            for (let i = start; i <= end; i++) {
                const rowKey = sortedData[i][keyField] as string | number;
                newKeys.add(rowKey);
            }
            onSelectionChange(newKeys);
        } else {
            // Normal click: toggle single
            const newKeys = new Set(selectedKeys);
            if (newKeys.has(key)) newKeys.delete(key);
            else newKeys.add(key);
            onSelectionChange(newKeys);
            lastClickedIndex.current = index;
        }
    }, [selectable, onSelectionChange, selectedKeys, keyField, sortedData, expandable]);

    // Toggle expansion separately if both selectable and expandable
    const handleExpandClick = (e: React.MouseEvent, row: T) => {
        e.stopPropagation();
        const key = row[keyField] as string | number;
        setExpandedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const cellPadding = compact ? 'px-2 py-1.5' : 'px-3 py-2';
    const headerPadding = compact ? 'px-2 py-2' : 'px-3 py-2.5';

    return (
        <div className={`overflow-auto ${className}`}>
            <table className="w-full text-sm">
                <thead>
                    <tr>
                        {expandable && selectable && <th className={`${headerPadding} w-8`} />}
                        {selectable && (
                            <th className={`${headerPadding} w-8 text-left`}>
                                <input
                                    type="checkbox"
                                    checked={selectedKeys.size === data.length && data.length > 0}
                                    onChange={() => {
                                        if (!onSelectionChange) return;
                                        if (selectedKeys.size === data.length) {
                                            onSelectionChange(new Set());
                                        } else {
                                            onSelectionChange(new Set(data.map(d => d[keyField] as string | number)));
                                        }
                                    }}
                                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 cursor-pointer"
                                />
                            </th>
                        )}
                        {columns.map((col) => (
                            <th
                                key={col.key}
                                onClick={() => col.sortable !== false && handleSort(col.key)}
                                className={`${headerPadding} text-left text-xs font-semibold uppercase tracking-wide bg-zinc-900 border-b border-zinc-700 select-none transition-colors ${col.sortable !== false ? 'cursor-pointer hover:bg-zinc-800' : ''
                                    } ${sortColumn === col.key ? 'text-cyan-400' : 'text-zinc-400'}`}
                                style={{ width: col.width, textAlign: col.align || 'left' }}
                            >
                                <div className="flex items-center gap-1">
                                    {col.header}
                                    {col.sortable !== false && sortColumn === col.key && (
                                        sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                    )}
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sortedData.length === 0 ? (
                        <tr>
                            <td
                                colSpan={columns.length + (selectable ? 1 : 0) + (expandable && selectable ? 1 : 0)}
                                className="px-4 py-8 text-center text-zinc-500"
                            >
                                {emptyMessage}
                            </td>
                        </tr>
                    ) : (
                        sortedData.map((row, idx) => {
                            const key = row[keyField] as string | number;
                            const isSelected = selectedKeys.has(key);
                            const isExpanded = expandedKeys.has(key);

                            return (
                                <React.Fragment key={key}>
                                    <tr
                                        onClick={(e) => handleRowClick(e, row, idx)}
                                        className={`border-b border-zinc-800 transition-colors ${selectable || expandable ? 'cursor-pointer' : ''
                                            } ${isSelected ? 'bg-blue-900/20' : 'hover:bg-zinc-800/50'} ${isExpanded ? 'bg-zinc-800/30' : ''
                                            }`}
                                    >
                                        {expandable && selectable && (
                                            <td className={`${cellPadding} w-8`}>
                                                <button
                                                    onClick={(e) => handleExpandClick(e, row)}
                                                    className="p-0.5 hover:bg-zinc-700 rounded"
                                                >
                                                    <ChevronRight
                                                        size={14}
                                                        className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                    />
                                                </button>
                                            </td>
                                        )}
                                        {selectable && (
                                            <td className={`${cellPadding} w-8`}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => { }}
                                                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 cursor-pointer"
                                                />
                                            </td>
                                        )}
                                        {columns.map((col) => (
                                            <td
                                                key={col.key}
                                                className={`${cellPadding} text-zinc-200`}
                                                style={{ textAlign: col.align || 'left' }}
                                            >
                                                {col.render ? col.render(row, idx) : row[col.key]}
                                            </td>
                                        ))}
                                    </tr>
                                    {expandable && isExpanded && renderExpanded && (
                                        <tr>
                                            <td
                                                colSpan={columns.length + (selectable ? 1 : 0) + (expandable && selectable ? 1 : 0)}
                                                className="px-4 py-2 bg-zinc-900/50 border-b border-zinc-800"
                                            >
                                                {renderExpanded(row)}
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
    );
}

export default DataTable;
