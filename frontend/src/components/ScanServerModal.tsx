import React, { useState, useEffect } from 'react';
import { Database, Server, HardDrive, RefreshCw, Clock, CheckCircle2 } from 'lucide-react';
import { SSHServer } from '../api';

interface ScanServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (serverId: string, timeout: number, mode?: 'source' | 'dest' | 'both') => void;
    title: string;
    subtitle: React.ReactNode;
    servers: SSHServer[];
    currentServerId?: string; 
    initialMode?: 'source' | 'dest' | 'both';
    showModeSelector?: boolean;
}

export const ScanServerModal: React.FC<ScanServerModalProps> = ({
    isOpen,
    onClose,
    onSelect,
    title,
    subtitle,
    servers,
    currentServerId,
    initialMode = 'source',
    showModeSelector = false
}) => {
    const [scanTimeout, setScanTimeout] = useState(1200);
    const [mode, setMode] = useState<'source' | 'dest' | 'both'>(initialMode);

    // Sync mode if initialMode changes while modal is closed or just opened
    useEffect(() => {
        if (isOpen) {
            setMode(initialMode);
        }
    }, [isOpen, initialMode]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-6 pb-4 border-b border-zinc-800 bg-gradient-to-br from-zinc-800/50 to-transparent">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <RefreshCw size={20} className="text-cyan-400" />
                        {title}
                    </h3>
                    <div className="text-zinc-400 text-sm leading-relaxed">
                        {subtitle}
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {/* Mode Selector (Optional) */}
                    {showModeSelector && (
                        <div className="space-y-3">
                            <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Select Target Scope</label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => setMode('source')}
                                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                                        mode === 'source' 
                                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                                            : 'bg-zinc-800/50 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                                    }`}
                                >
                                    <Database size={18} />
                                    <span className="text-[10px] font-bold uppercase">Sources</span>
                                </button>
                                <button
                                    onClick={() => setMode('dest')}
                                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                                        mode === 'dest' 
                                            ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                                            : 'bg-zinc-800/50 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                                    }`}
                                >
                                    <HardDrive size={18} />
                                    <span className="text-[10px] font-bold uppercase">Destinations</span>
                                </button>
                                <button
                                    onClick={() => setMode('both')}
                                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                                        mode === 'both' 
                                            ? 'bg-purple-600/20 border-purple-500/50 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)]' 
                                            : 'bg-zinc-800/50 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                                    }`}
                                >
                                    <RefreshCw size={18} />
                                    <span className="text-[10px] font-bold uppercase">Both Sides</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Timeout Slider/Input */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1.5">
                                <Clock size={12} /> Scan Timeout
                            </label>
                            <span className="text-xs font-mono text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded-full border border-cyan-400/20">
                                {scanTimeout}s
                            </span>
                        </div>
                        <input
                            type="range"
                            min="60"
                            max="3600"
                            step="60"
                            value={scanTimeout}
                            onChange={(e) => setScanTimeout(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                        <div className="flex justify-between text-[9px] text-zinc-600 font-bold uppercase tracking-widest">
                            <span>1m</span>
                            <span>15m</span>
                            <span>30m</span>
                            <span>1h</span>
                        </div>
                    </div>

                    {/* Server Selection */}
                    <div className="space-y-3">
                        <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Execute on Server</label>
                        <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 custom-scrollbar">
                            {/* Local Server */}
                            <button
                                onClick={() => { onSelect('local', scanTimeout, mode); onClose(); }}
                                className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all group ${
                                    currentServerId === 'local'
                                        ? 'bg-blue-600/10 border-blue-500/40 text-blue-100 hover:bg-blue-600/20'
                                        : 'bg-zinc-800/40 border-zinc-800/50 text-zinc-400 hover:bg-zinc-800/60 hover:border-zinc-700'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg transition-colors ${
                                        currentServerId === 'local' ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-900 text-zinc-500 group-hover:bg-zinc-700'
                                    }`}>
                                        <Database size={16} />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold text-sm">Local Server</div>
                                        <div className="text-[10px] opacity-50 font-mono">127.0.0.1</div>
                                    </div>
                                </div>
                                {currentServerId === 'local' && <CheckCircle2 size={16} className="text-blue-400" />}
                            </button>

                            {/* SSH Servers */}
                            {Array.isArray(servers) && servers.map(srv => {
                                const isCurrent = currentServerId === srv.id;
                                return (
                                    <button
                                        key={srv.id}
                                        onClick={() => { onSelect(srv.id, scanTimeout, mode); onClose(); }}
                                        className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all group ${
                                            isCurrent
                                                ? 'bg-cyan-600/10 border-cyan-500/40 text-cyan-100 hover:bg-cyan-600/20'
                                                : 'bg-zinc-800/40 border-zinc-800/50 text-zinc-400 hover:bg-zinc-800/60 hover:border-zinc-700'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg transition-colors ${
                                                isCurrent ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-900 text-zinc-500 group-hover:bg-zinc-700'
                                            }`}>
                                                <Server size={16} />
                                            </div>
                                            <div className="text-left">
                                                <div className="font-bold text-sm">{srv.name}</div>
                                                <div className="text-[10px] opacity-50 font-mono">{srv.host}</div>
                                            </div>
                                        </div>
                                        {isCurrent && <CheckCircle2 size={16} className="text-cyan-400" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-zinc-950/50 border-t border-zinc-800 flex justify-between items-center">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-zinc-500 hover:text-white transition text-xs font-bold uppercase tracking-wider"
                    >
                        Cancel
                    </button>
                    <div className="text-[9px] text-zinc-600 font-mono italic">
                        Select a server to begin operation
                    </div>
                </div>
            </div>
        </div>
    );
};
