import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSortableData, SortDirection } from './useSortableData';
import { ColumnConfig } from '../components/ui/DataTable';

interface UseDataTableOptions<T> {
    data: T[];
    columns: ColumnConfig<T>[];
    initialSortColumn?: string | null;
    initialSortDirection?: SortDirection;
    filterFn?: (item: T, searchTerm: string) => boolean;
    persistentKey?: string; // Key for session storage
    rowIdKey?: string; // Key to use as ID (default: 'id')
}

export function useDataTable<T extends Record<string, any>>({
    data,
    columns,
    initialSortColumn = null,
    initialSortDirection = 'asc',
    filterFn,
    persistentKey,
    rowIdKey = 'id'
}: UseDataTableOptions<T>) {
    // Search Filter
    const [searchTerm, setSearchTerm] = useState(() => {
        if (persistentKey) return sessionStorage.getItem(`${persistentKey}_search`) || "";
        return "";
    });

    // Column Filters
    const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>(() => {
        if (persistentKey) {
            try {
                const saved = sessionStorage.getItem(`${persistentKey}_col_filters`);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    const revived: Record<string, Set<string>> = {};
                    for (const key in parsed) revived[key] = new Set(parsed[key]);
                    return revived;
                }
            } catch (e) { }
        }
        return {};
    });

    // Selection
    const [selectedItems, setSelectedItems] = useState<Set<string | number>>(() => {
        if (persistentKey) {
            const saved = sessionStorage.getItem(`${persistentKey}_selected`);
            return saved ? new Set(JSON.parse(saved)) : new Set();
        }
        return new Set();
    });
    const [lastClickedId, setLastClickedId] = useState<string | number | null>(null);

    // Persistence
    useEffect(() => {
        if (persistentKey) {
            sessionStorage.setItem(`${persistentKey}_search`, searchTerm);
            const toSave: Record<string, string[]> = {};
            for (const key in columnFilters) toSave[key] = Array.from(columnFilters[key]);
            sessionStorage.setItem(`${persistentKey}_col_filters`, JSON.stringify(toSave));
            sessionStorage.setItem(`${persistentKey}_selected`, JSON.stringify(Array.from(selectedItems)));
        }
    }, [searchTerm, columnFilters, selectedItems, persistentKey]);

    // Filtering logic
    const filteredData = useMemo(() => {
        return data.filter(item => {
            // Custom filter function (handles search + custom logic)
            if (filterFn && !filterFn(item, searchTerm)) return false;

            // Column filters
            for (const [colKey, selectedValues] of Object.entries(columnFilters)) {
                if (!selectedValues || selectedValues.size === 0) continue;

                const col = columns.find(c => c.key === colKey);
                const val = col?.getFilterValue ? col.getFilterValue(item) : String(item[colKey]);

                if (!selectedValues.has(val)) return false;
            }

            return true;
        });
    }, [data, searchTerm, columnFilters, filterFn, columns]);

    // Sorting logic (using the existing hook)
    const { sortedData, handleSort, SortIcon, sortColumn, sortDirection } = useSortableData({
        data: filteredData,
        initialSortColumn,
        initialSortDirection
    });

    // Selection Helpers
    const toggleItem = useCallback((id: string | number, e?: React.MouseEvent) => {
        setSelectedItems(prev => {
            const next = new Set(prev);

            // Shift-click range selection
            if (e?.shiftKey && lastClickedId !== null) {
                const ids = sortedData.map(item => item[rowIdKey] ?? item.id ?? item.email ?? item.index);
                const start = ids.indexOf(lastClickedId);
                const end = ids.indexOf(id);

                if (start !== -1 && end !== -1) {
                    const min = Math.min(start, end);
                    const max = Math.max(start, end);
                    for (let i = min; i <= max; i++) {
                        next.add(ids[i]);
                    }
                    return next;
                }
            }

            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setLastClickedId(id);
    }, [sortedData, lastClickedId, rowIdKey]);

    const selectAll = useCallback(() => {
        const ids = sortedData.map(item => item[rowIdKey] ?? item.id ?? item.email ?? item.index);
        if (selectedItems.size === ids.length && ids.length > 0) {
            setSelectedItems(new Set());
        } else {
            setSelectedItems(new Set(ids));
        }
    }, [sortedData, selectedItems.size, rowIdKey]);

    const invertSelection = useCallback(() => {
        const ids = sortedData.map(item => item[rowIdKey] ?? item.id ?? item.email ?? item.index);
        const next = new Set<string | number>();
        ids.forEach(id => {
            if (!selectedItems.has(id)) next.add(id);
        });
        setSelectedItems(next);
    }, [sortedData, selectedItems, rowIdKey]);

    const toggleColumnFilter = (column: string, value: string) => {
        setColumnFilters(prev => {
            const current = prev[column] ? new Set(prev[column]) : new Set<string>();
            if (current.has(value)) current.delete(value);
            else current.add(value);
            return { ...prev, [column]: current };
        });
    };

    const clearColumnFilter = (column: string) => {
        setColumnFilters(prev => {
            const next = { ...prev };
            delete next[column];
            return next;
        });
    };

    const getUniqueValues = (column: string) => {
        const col = columns.find(c => c.key === column);
        const values = new Set<string>();
        data.forEach(item => {
            const val = col?.getFilterValue ? col.getFilterValue(item) : String(item[column]);
            values.add(val);
        });
        return Array.from(values).sort();
    };

    return {
        data: sortedData,
        searchTerm,
        setSearchTerm,
        columnFilters,
        toggleColumnFilter,
        clearColumnFilter,
        getUniqueValues,
        selectedItems,
        setSelectedItems,
        toggleItem,
        selectAll,
        invertSelection,
        handleSort,
        SortIcon,
        sortColumn,
        sortDirection
    };
}
