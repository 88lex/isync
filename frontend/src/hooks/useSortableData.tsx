import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc';

interface UseSortableDataOptions<T> {
    data: T[];
    initialSortColumn?: string | null;
    initialSortDirection?: SortDirection;
}

export function useSortableData<T extends Record<string, any>>({
    data,
    initialSortColumn = null,
    initialSortDirection = 'asc'
}: UseSortableDataOptions<T>) {
    const [sortColumn, setSortColumn] = useState<string | null>(initialSortColumn);
    const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDirection);

    const sortedData = useMemo(() => {
        if (!sortColumn) return data;

        return [...data].sort((a, b) => {
            const aVal = a[sortColumn];
            const bVal = b[sortColumn];

            // Handle null/undefined values
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Convert to strings for comparison
            const aStr = String(aVal);
            const bStr = String(bVal);

            const comparison = aStr.localeCompare(bStr);
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [data, sortColumn, sortDirection]);

    const handleSort = (column: string) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const SortIcon = ({ column }: { column: string }) => {
        if (sortColumn !== column) return <span className="text-zinc-600 ml-1">⇅</span>;
        return <span className="text-indigo-400 ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
    };

    return {
        sortedData,
        sortColumn,
        sortDirection,
        handleSort,
        SortIcon
    };
}
