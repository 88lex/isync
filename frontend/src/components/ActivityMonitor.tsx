import React from 'react';
import { Loader2, CheckCircle2, XCircle, Activity } from 'lucide-react';
import { useIsyncData } from '../contexts/IsyncDataContext';

export const ActivityMonitor: React.FC = () => {
    const { activeOperations, removeOperation } = useIsyncData();

    if (activeOperations.length === 0) return null;

    return (
        <div id="activity-monitor-section" className="w-full bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-hidden transition-all duration-300">
            <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    <Activity size={12} className="text-cyan-400" />
                    Background Tasks
                </div>
                <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-500">
                    {activeOperations.length}
                </span>
            </div>
            <div className="max-h-32 overflow-y-auto">
                {activeOperations.map(op => (
                    <div key={op.id} className="p-2 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition group">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-zinc-300 truncate mb-0.5">
                                    {op.label}
                                </div>
                                {op.description && (
                                    <div className="text-[10px] text-zinc-500 truncate">
                                        {op.description}
                                    </div>
                                )}
                            </div>
                            <div className="shrink-0 pt-0.5 flex items-center gap-1">
                                {op.status === 'running' && (
                                    <Loader2 size={12} className="text-cyan-400 animate-spin" />
                                )}
                                {op.status === 'completed' && (
                                    <button 
                                        onClick={() => removeOperation(op.id)}
                                        className="text-emerald-400 hover:text-white transition"
                                    >
                                        <CheckCircle2 size={12} />
                                    </button>
                                )}
                                {op.status === 'failed' && (
                                    <button 
                                        onClick={() => removeOperation(op.id)}
                                        className="text-red-400 hover:text-white transition"
                                    >
                                        <XCircle size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                        {op.progress && (
                            <div className="mt-1 text-[10px] font-mono text-zinc-500 bg-black/20 px-1 rounded truncate">
                                {op.progress}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
