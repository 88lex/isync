import React from 'react';
import { CheckSquare, Square, RefreshCcw } from 'lucide-react';

interface SelectionControlsProps {
    selectedCount: number;
    totalCount: number;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onInvertSelection?: () => void;
    className?: string;
}

export const SelectionControls: React.FC<SelectionControlsProps> = ({
    selectedCount,
    totalCount,
    onSelectAll,
    onDeselectAll,
    onInvertSelection,
    className = '',
}) => {
    const allSelected = selectedCount === totalCount && totalCount > 0;
    const noneSelected = selectedCount === 0;

    return (
        <div className={`flex items-center gap-2 text-xs ${className}`}>
            <span className="text-zinc-400">
                {selectedCount} / {totalCount} selected
            </span>
            <button
                onClick={onSelectAll}
                disabled={allSelected}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
                <CheckSquare size={12} />
                All
            </button>
            <button
                onClick={onDeselectAll}
                disabled={noneSelected}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
                <Square size={12} />
                None
            </button>
            {onInvertSelection && (
                <button
                    onClick={onInvertSelection}
                    disabled={totalCount === 0}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                    <RefreshCcw size={12} />
                    Invert
                </button>
            )}
        </div>
    );
};

export default SelectionControls;
