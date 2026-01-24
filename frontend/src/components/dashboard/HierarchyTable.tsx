import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsRight, Folder, Database, HardDrive, FileText, Calendar, RefreshCw } from 'lucide-react';
import { SyncPair } from '../../api';
import { formatBytes, formatDate, formatTB } from '../../utils/formatters';

interface HierarchyTableProps {
    data: SyncPair[];
    onScan: (pair: SyncPair, side: 'source' | 'dest') => void;
    onScanCategory: (items: SyncPair[], category: string, side?: 'source' | 'dest') => void;
    scanning?: { [key: string]: boolean };
}

type SortKey = 'category' | 'folder' | 'srcSize' | 'destSize' | 'sizePct' | 'srcCount' | 'destCount' | 'countPct' | 'scan';
type SortDirection = 'asc' | 'desc';

interface GroupedData {
    category: string;
    items: ProcessedItem[];
    totalSrcSize: number;
    totalDestSize: number;
    totalSrcCount: number;
    totalDestCount: number;
}

interface ProcessedItem extends SyncPair {
    category: string;
    folder: string;
    sizePct: number;
    countPct: number;
    scanTime: string; // Latest of source/dest
}

const formatCountK = (count: number) => {
    if (!count) return '-';
    return (count / 1000).toFixed(1) + 'k';
};

const calcPct = (a: number, b: number) => {
    if (!b) return 0;
    return (a / b) * 100;
};

export const HierarchyTable: React.FC<HierarchyTableProps> = ({ data, onScan, onScanCategory, scanning = {} }) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'category', direction: 'asc' });

    // 1. Process Data
    const processedData = useMemo(() => {
        return data.map(item => {
            // Parse Category/Folder
            let pathObj = item.source || '';
            // Handle rclone remote syntax (remote:path/to/folder)
            if (pathObj.includes(':')) {
                const parts = pathObj.split(':');
                pathObj = parts.length > 1 ? parts[1] : parts[0];
            }
            
            // Normalize slashes
            pathObj = pathObj.replace(/\\/g, '/');
            const segments = pathObj.split('/').filter(Boolean);
            
            let category = 'Uncategorized';
            let folder = pathObj;

            if (segments.length >= 2) {
                category = segments[segments.length - 2];
                folder = segments[segments.length - 1];
            } else if (segments.length === 1) {
                folder = segments[0];
            }

            const srcSize = item.source_size_bytes || 0;
            const destSize = item.dest_size_bytes || 0;
            const srcCount = item.source_file_count || 0;
            const destCount = item.dest_file_count || 0;
            
            // Latest scan time
            const sTime = item.source_scanned_at ? new Date(item.source_scanned_at).getTime() : 0;
            const dTime = item.dest_scanned_at ? new Date(item.dest_scanned_at).getTime() : 0;
            const latestScan = sTime > dTime ? item.source_scanned_at : item.dest_scanned_at;

            return {
                ...item,
                category,
                folder,
                sizePct: calcPct(destSize, srcSize),
                countPct: calcPct(destCount, srcCount),
                scanTime: latestScan || ''
            } as ProcessedItem;
        });
    }, [data]);

    // 2. Group & Aggregate
    const groups = useMemo(() => {
        const map = new Map<string, GroupedData>();
        
        processedData.forEach(item => {
            if (!map.has(item.category)) {
                map.set(item.category, {
                    category: item.category,
                    items: [],
                    totalSrcSize: 0,
                    totalDestSize: 0,
                    totalSrcCount: 0,
                    totalDestCount: 0
                });
            }
            const group = map.get(item.category)!;
            group.items.push(item);
            group.totalSrcSize += (item.source_size_bytes || 0);
            group.totalDestSize += (item.dest_size_bytes || 0);
            group.totalSrcCount += (item.source_file_count || 0);
            group.totalDestCount += (item.dest_file_count || 0);
        });

        return Array.from(map.values());
    }, [processedData]);

    // 3. Sort
    const sortedGroups = useMemo(() => {
        const sorted = [...groups];
        const { key, direction } = sortConfig;
        const dirMult = direction === 'asc' ? 1 : -1;

        // Sort Groups
        sorted.sort((a, b) => {
            let valA: any, valB: any;

            switch (key) {
                case 'category':
                    valA = a.category;
                    valB = b.category;
                    break;
                case 'folder': // Sort by summary count/size or just name? Let's use name for 'folder' sort on group level? Or usually irrelevant. Use category name.
                     valA = a.category;
                     valB = b.category;
                     break;
                case 'srcSize':
                    valA = a.totalSrcSize;
                    valB = b.totalSrcSize;
                    break;
                case 'destSize':
                    valA = a.totalDestSize;
                    valB = b.totalDestSize;
                    break;
                case 'sizePct':
                    valA = calcPct(a.totalDestSize, a.totalSrcSize);
                    valB = calcPct(b.totalDestSize, b.totalSrcSize);
                    break;
                case 'srcCount':
                    valA = a.totalSrcCount;
                    valB = b.totalSrcCount;
                    break;
                case 'destCount':
                    valA = a.totalDestCount;
                    valB = b.totalDestCount;
                    break;
                case 'countPct':
                    valA = calcPct(a.totalDestCount, a.totalSrcCount);
                    valB = calcPct(b.totalDestCount, b.totalSrcCount);
                    break;
                default:
                    valA = a.category;
                    valB = b.category;
            }

            if (valA < valB) return -1 * dirMult;
            if (valA > valB) return 1 * dirMult;
            return 0;
        });

        // Sort Items within Groups
        sorted.forEach(group => {
            group.items.sort((a, b) => {
                let valA: any, valB: any;
                
                switch (key) {
                    case 'category': // Within group, category is same. Sort by folder.
                    case 'folder':
                        valA = a.folder;
                        valB = b.folder;
                        break;
                    case 'srcSize':
                        valA = a.source_size_bytes || 0;
                        valB = b.source_size_bytes || 0;
                        break;
                    case 'destSize':
                        valA = a.dest_size_bytes || 0;
                        valB = b.dest_size_bytes || 0;
                        break;
                    case 'sizePct':
                        valA = a.sizePct;
                        valB = b.sizePct;
                        break;
                    case 'srcCount':
                        valA = a.source_file_count || 0;
                        valB = b.source_file_count || 0;
                        break;
                    case 'destCount':
                        valA = a.dest_file_count || 0;
                        valB = b.dest_file_count || 0;
                        break;
                    case 'countPct':
                        valA = a.countPct;
                        valB = b.countPct;
                        break;
                    case 'scan':
                        valA = a.scanTime;
                        valB = b.scanTime;
                        break;
                    default:
                        valA = a.folder;
                        valB = b.folder;
                }

                if (valA < valB) return -1 * dirMult;
                if (valA > valB) return 1 * dirMult;
                return 0;
            });
        });

        return sorted;
    }, [groups, sortConfig]);

    // Totals
    const grandTotals = useMemo(() => {
        return groups.reduce((acc, g) => ({
            srcSize: acc.srcSize + g.totalSrcSize,
            destSize: acc.destSize + g.totalDestSize,
            srcCount: acc.srcCount + g.totalSrcCount,
            destCount: acc.destCount + g.totalDestCount,
        }), { srcSize: 0, destSize: 0, srcCount: 0, destCount: 0 });
    }, [groups]);

    // Handlers
    const toggleGroup = (cat: string) => {
        const next = new Set(expanded);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        setExpanded(next);
    };

    const expandAll = () => {
        setExpanded(new Set(groups.map(g => g.category)));
    };

    const collapseAll = () => {
        setExpanded(new Set());
    };

    const handleSort = (key: SortKey) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortConfig.key !== col) return <div className="w-4 h-4 ml-1 inline-block opacity-0 group-hover:opacity-30">↕</div>;
        return <div className="w-4 h-4 ml-1 inline-block text-cyan-400">{sortConfig.direction === 'asc' ? '↑' : '↓'}</div>;
    };

    const Th = ({ label, col, width, align = 'left' }: { label: string, col: SortKey, width?: string, align?: 'left' | 'right' | 'center' }) => (
        <th 
            className={`text-${align} px-3 py-1.5 font-bold text-zinc-400 cursor-pointer hover:text-white transition group select-none ${width || ''}`}
            onClick={() => handleSort(col)}
        >
            <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
                {label}
                <SortIcon col={col} />
            </div>
        </th>
    );

    return (
        <div className="flex flex-col gap-4">
             {/* Controls & Grand Totals */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Source Total */}
                <div className="bg-gradient-to-br from-blue-900/40 to-black/60 border border-blue-500/30 rounded-xl p-4 flex items-center gap-4 shadow-lg">
                    <div className="p-3 rounded-lg bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30">
                        <Database size={28} />
                    </div>
                    <div>
                        <div className="text-blue-200/60 text-xs font-bold uppercase tracking-wider mb-1">Source Total</div>
                        <div className="text-3xl font-bold text-white font-mono">{formatTB(grandTotals.srcSize)}</div>
                        <div className="text-sm text-blue-200/50 font-mono">{formatCountK(grandTotals.srcCount)} files</div>
                    </div>
                </div>

                {/* Destination Total */}
                <div className="bg-gradient-to-br from-emerald-900/40 to-black/60 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-4 shadow-lg">
                    <div className="p-3 rounded-lg bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
                        <HardDrive size={28} />
                    </div>
                    <div>
                        <div className="text-emerald-200/60 text-xs font-bold uppercase tracking-wider mb-1">Destination Total</div>
                        <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-bold text-white font-mono">{formatTB(grandTotals.destSize)}</div>
                            <div className="text-lg font-bold text-emerald-400 font-mono opacity-80">
                                {grandTotals.srcSize > 0 ? Math.round((grandTotals.destSize / grandTotals.srcSize) * 100) : 0}%
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-emerald-200/50 font-mono">
                            <span>{formatCountK(grandTotals.destCount)} files</span>
                            <span className="text-emerald-500/50 text-xs">
                                ({grandTotals.srcCount > 0 ? Math.round((grandTotals.destCount / grandTotals.srcCount) * 100) : 0}%)
                            </span>
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex flex-col justify-center gap-3">
                    <div className="flex gap-2">
                        <button onClick={expandAll} className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-medium text-white transition flex items-center justify-center gap-2">
                            <ChevronsDown size={14} /> Expand All
                        </button>
                        <button onClick={collapseAll} className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-medium text-white transition flex items-center justify-center gap-2">
                            <ChevronsRight size={14} /> Collapse All
                        </button>
                    </div>
                    <div className="text-center text-xs text-zinc-500 font-mono">
                        {groups.length} Categories • {data.length} Folders
                    </div>
                </div>
            </div>

            {/* Hierarchy Table */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="bg-zinc-950/80 border-b border-zinc-800">
                             <Th label="Category" col="category" width="w-1/6" />
                             <Th label="Folder" col="folder" width="w-1/6" />
                             <Th label="Src Size (TB)" col="srcSize" align="right" />
                             <Th label="Dest Size (TB)" col="destSize" align="right" />
                             <Th label="%" col="sizePct" align="right" />
                             <Th label="Src Count" col="srcCount" align="right" />
                             <Th label="Dest Count" col="destCount" align="right" />
                             <Th label="%" col="countPct" align="right" />
                             <Th label="Scan Time" col="scan" align="right" />
                        </tr>
                    </thead>
                    <tbody>
                         {sortedGroups.map(group => {
                             const isExpanded = expanded.has(group.category);
                             const groupSizePct = calcPct(group.totalDestSize, group.totalSrcSize);
                             const groupCountPct = calcPct(group.totalDestCount, group.totalSrcCount);

                             return (
                                 <React.Fragment key={group.category}>
                                     {/* Group Header Row */}
                                     <tr 
                                         className="bg-zinc-900/80 hover:bg-zinc-800/80 cursor-pointer border-b border-zinc-800/50 transition group"
                                         onClick={() => toggleGroup(group.category)}
                                     >
                                        <td className="px-3 py-2 text-white font-bold text-lg flex items-center gap-2">
                                            {isExpanded ? <ChevronDown size={18} className="text-zinc-500" /> : <ChevronRight size={18} className="text-zinc-500" />}
                                            <Folder size={18} className="text-blue-400" />
                                            {group.category}
                                        </td>
                                        <td className="px-3 py-2 text-zinc-500 font-medium italic">
                                            {group.items.length} items
                                        </td>
                                        <td className="px-3 py-2 font-mono text-zinc-300 font-bold text-lg text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onScanCategory(group.items, group.category, 'source'); }}
                                                    className="p-1.5 text-zinc-500 hover:text-white rounded hover:bg-white/10 transition opacity-0 group-hover:opacity-100"
                                                    title="Scan Source Category"
                                                >
                                                    <RefreshCw size={14} />
                                                </button>
                                                {formatTB(group.totalSrcSize)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 font-mono text-zinc-300 font-bold text-lg text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onScanCategory(group.items, group.category, 'dest'); }}
                                                    className="p-1.5 text-zinc-500 hover:text-white rounded hover:bg-white/10 transition opacity-0 group-hover:opacity-100"
                                                    title="Scan Destination Category"
                                                >
                                                    <RefreshCw size={14} />
                                                </button>
                                                {formatTB(group.totalDestSize)}
                                            </div>
                                        </td>
                                        <td className={`px-3 py-2 font-mono font-bold text-lg text-right ${groupSizePct === 100 ? 'text-emerald-400' : groupSizePct < 100 ? 'text-amber-400' : 'text-blue-400'}`}>
                                            {groupSizePct.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 font-mono text-zinc-300 font-bold text-lg text-right">{formatCountK(group.totalSrcCount)}</td>
                                        <td className="px-3 py-2 font-mono text-zinc-300 font-bold text-lg text-right">{formatCountK(group.totalDestCount)}</td>
                                        <td className={`px-3 py-2 font-mono font-bold text-lg text-right ${groupCountPct === 100 ? 'text-emerald-400' : groupCountPct < 100 ? 'text-amber-400' : 'text-blue-400'}`}>
                                            {groupCountPct.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-zinc-500 text-sm text-right">
                                            {/* Summary Scan Time? Maybe range or latest? */}
                                        </td>
                                     </tr>

                                     {/* Item Rows */}
                                     {isExpanded && group.items.map(item => (
                                         <tr key={item.id || item.source} className="border-b border-zinc-800/30 bg-black/20 hover:bg-white/5 transition group/row">
                                             <td className="px-3 py-1 pl-10 text-zinc-500 text-sm">
                                                 {/* Indented Category (Optional, or just blank) */}
                                             </td>
                                             <td className="px-3 py-1 text-zinc-300 font-medium text-lg flex items-center gap-2">
                                                 <FileText size={16} className="text-zinc-600" />
                                                 {item.folder}
                                             </td>
                                             <td className="px-3 py-1 font-mono text-blue-300 text-lg text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button 
                                                        className={`opacity-0 group-hover/row:opacity-100 p-1 hover:bg-white/10 rounded transition ${scanning?.[`${item.id}-source`] ? 'opacity-100 text-cyan-500' : 'text-zinc-500'}`}
                                                        onClick={(e) => { e.stopPropagation(); onScan(item, 'source'); }}
                                                        title="Scan Source"
                                                    >
                                                        <RefreshCw size={12} className={scanning?.[`${item.id}-source`] ? 'animate-spin' : ''} />
                                                    </button>
                                                    {formatTB(item.source_size_bytes || 0)}
                                                </div>
                                             </td>
                                             <td className={`px-3 py-1 font-mono text-lg text-right ${item.sizePct === 100 ? 'text-emerald-400' : item.sizePct < 100 ? 'text-amber-400' : 'text-blue-400'}`}>
                                                <div className="flex items-center justify-end gap-2">
                                                    <button 
                                                        className={`opacity-0 group-hover/row:opacity-100 p-1 hover:bg-white/10 rounded transition ${scanning?.[`${item.id}-dest`] ? 'opacity-100 text-cyan-500' : 'text-zinc-500'}`}
                                                        onClick={(e) => { e.stopPropagation(); onScan(item, 'dest'); }}
                                                        title="Scan Destination"
                                                    >
                                                        <RefreshCw size={12} className={scanning?.[`${item.id}-dest`] ? 'animate-spin' : ''} />
                                                    </button>
                                                    {formatTB(item.dest_size_bytes || 0)}
                                                </div>
                                             </td>
                                             <td className={`px-3 py-1 font-mono text-right text-lg font-bold ${item.sizePct === 100 ? 'text-emerald-400' : item.sizePct < 100 ? 'text-amber-400' : 'text-blue-400'}`}>
                                                 {item.sizePct.toFixed(1)}%
                                             </td>
                                             <td className="px-3 py-1 font-mono text-blue-300/80 text-lg text-right">{formatCountK(item.source_file_count || 0)}</td>
                                             <td className={`px-3 py-1 font-mono text-lg text-right ${item.countPct === 100 ? 'text-emerald-400' : item.countPct < 100 ? 'text-amber-400' : 'text-blue-400'}`}>{formatCountK(item.dest_file_count || 0)}</td>
                                             <td className={`px-3 py-1 font-mono text-right text-lg font-bold ${item.countPct === 100 ? 'text-emerald-400' : item.countPct < 100 ? 'text-amber-400' : 'text-blue-400'}`}>
                                                 {item.countPct.toFixed(1)}%
                                             </td>
                                             <td className="px-3 py-1 font-mono text-zinc-500 text-xs text-right">
                                                 {item.scanTime ? formatDate(item.scanTime) : '-'}
                                             </td>
                                         </tr>
                                     ))}
                                 </React.Fragment>
                             );
                         })}
                    </tbody>
                </table>
                {sortedGroups.length === 0 && (
                     <div className="p-8 text-center text-zinc-500">
                         No data available. Run a scan to populate statistics.
                     </div>
                )}
            </div>
        </div>
    );
};
