import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, CheckSquare, Square, MinusSquare } from 'lucide-react';
import { Config, DomainConfig } from '../api';

interface MultiDomainSelectorProps {
    domains: DomainConfig[];
    selected: string[];
    onChange: (selected: string[]) => void;
    className?: string;
    placeholder?: string;
}

export const MultiDomainSelector: React.FC<MultiDomainSelectorProps> = ({
    domains = [],
    selected = [],
    onChange,
    className = "",
    placeholder = "Select Domains"
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleDomain = (domain: string) => {
        const newSelected = selected.includes(domain)
            ? selected.filter(d => d !== domain)
            : [...selected, domain];
        onChange(newSelected);
    };

    const toggleAll = () => {
        if (selected.length === domains.length) {
            onChange([]);
        } else {
            onChange(domains.map(d => d.domain_name));
        }
    };

    // Derived state for "All" checkbox
    const isAllSelected = domains.length > 0 && selected.length === domains.length;
    const isIndeterminate = selected.length > 0 && selected.length < domains.length;

    const label = selected.length === 0 
        ? "None Selected" 
        : selected.length === domains.length 
            ? "All Domains" 
            : `${selected.length} Domain${selected.length > 1 ? 's' : ''}`;

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-between gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition shadow-sm min-w-[160px]"
            >
                <div className="flex items-center gap-2">
                    <span className="font-medium text-xs truncate max-w-[120px]">{placeholder}: <span className="text-cyan-400">{label}</span></span>
                </div>
                <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {/* Select All Option */}
                        <div 
                            onClick={toggleAll}
                            className="flex items-center px-3 py-2 cursor-pointer hover:bg-zinc-800 rounded-lg transition-colors group mb-1"
                        >
                            <div className={`mr-3 transition-colors ${isAllSelected ? 'text-cyan-500' : 'text-zinc-600 group-hover:text-zinc-500'}`}>
                                {isAllSelected ? <CheckSquare size={16} /> : (isIndeterminate ? <MinusSquare size={16} /> : <Square size={16} />)}
                            </div>
                            <span className={`text-sm font-bold ${isAllSelected ? 'text-white' : 'text-zinc-400'}`}>Select All</span>
                        </div>
                        
                        <div className="h-px bg-zinc-800 my-1 mx-2" />

                        {/* Individual Domains */}
                        {domains.map((d) => {
                            const isSelected = selected.includes(d.domain_name);
                            return (
                                <div
                                    key={d.domain_name}
                                    onClick={() => toggleDomain(d.domain_name)}
                                    className={`flex items-center px-3 py-2 cursor-pointer hover:bg-zinc-800 rounded-lg transition-colors group ${isSelected ? 'bg-zinc-800/50' : ''}`}
                                >
                                    <div className={`mr-3 transition-colors ${isSelected ? 'text-cyan-500' : 'text-zinc-600 group-hover:text-zinc-500'}`}>
                                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-sm ${isSelected ? 'text-white font-medium' : 'text-zinc-400 group-hover:text-zinc-300'}`}>
                                            {d.domain_name}
                                        </span>
                                    </div>
                                    {isSelected && <Check size={14} className="ml-auto text-cyan-500" />}
                                </div>
                            );
                        })}
                    </div>
                    
                    <div className="bg-zinc-950 p-2 text-[10px] text-zinc-500 text-center border-t border-zinc-800">
                        {selected.length} of {domains.length} selected
                    </div>
                </div>
            )}
        </div>
    );
};
