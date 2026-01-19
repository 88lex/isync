import React, { useState } from 'react';
import { Filter } from 'lucide-react';

interface ColumnFilterProps {
    column: string;
    title: string;
    options: string[];
    selected: Set<string>;
    onToggle: (column: string, value: string) => void;
    onClear: (column: string) => void;
}

export const ColumnFilter: React.FC<ColumnFilterProps> = ({
    column,
    title,
    options,
    selected,
    onToggle,
    onClear
}) => {
    const [open, setOpen] = useState(false);
    const isActive = selected && selected.size > 0;

    return (
        <div className="relative inline-block ml-2">
            <button
                onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                className={`p-1 rounded hover:bg-zinc-800 transition ${isActive ? 'text-indigo-400' : 'text-zinc-600'}`}
                title={`Filter ${title}`}
            >
                <Filter size={12} fill={isActive ? "currentColor" : "none"} />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }}></div>
                    <div
                        className="absolute top-full left-0 mt-1 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 p-2 text-left animate-in fade-in zoom-in-95 duration-150"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-zinc-800">
                            <span className="text-xs font-bold text-zinc-400">{title}</span>
                            {isActive && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onClear(column); }}
                                    className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                            {options.map((opt: string) => (
                                <label
                                    key={opt}
                                    className="flex items-center gap-2 p-1.5 hover:bg-zinc-800 rounded cursor-pointer text-xs text-zinc-300 transition-colors"
                                >
                                    <input
                                        type="checkbox"
                                        checked={isActive ? selected.has(opt) : false}
                                        onChange={() => onToggle(column, opt)}
                                        className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-0"
                                    />
                                    <span className="truncate">{opt}</span>
                                </label>
                            ))}
                            {options.length === 0 && (
                                <div className="p-2 text-zinc-500 italic text-[10px] text-center">No options</div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
