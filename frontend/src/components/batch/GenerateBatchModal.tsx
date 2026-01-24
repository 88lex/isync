import React, { useState, useEffect } from 'react';
import { X, Shuffle, Activity, User, Globe, List } from 'lucide-react';
import { Config, SyncPairWithBatch } from '../../api';

interface GenerateBatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGenerate: (params: GenerateBatchParams) => Promise<void>;
    config: Config;
    initialPairs: SyncPairWithBatch[];
}

export interface GenerateBatchParams {
    filename?: string;
    userCount: number;
    randomOrder: boolean;
    selectedDomains: string[];
    dryRun: boolean;
}

export const GenerateBatchModal: React.FC<GenerateBatchModalProps> = ({
    isOpen,
    onClose,
    onGenerate,
    config,
    initialPairs
}) => {
    const [userCount, setUserCount] = useState<number>(0);
    const [randomOrder, setRandomOrder] = useState<boolean>(true);
    const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
    const [generating, setGenerating] = useState(false);
    const [filename, setFilename] = useState('');

    // If generating for single pair, we allow custom filename
    const isSinglePair = initialPairs.length === 1;

    useEffect(() => {
        if (isOpen) {
            // Reset / Initialize defaults
            if (config.domains) {
                // Default: Select all domains
                setSelectedDomains(new Set(config.domains.map(d => d.domain_name)));
            }
            setUserCount(0); // Default to ALL

            if (isSinglePair && initialPairs[0]) {
                const pair = initialPairs[0];
                // Suggest filename
                if (pair.batch.exists && pair.batch.filename) {
                    setFilename(pair.batch.filename);
                } else {
                    const safeSource = pair.source.split('/').filter(Boolean).pop() || 'source';
                    const safeDest = pair.dest.split(':').pop()?.split('/').filter(Boolean).pop() || 'dest';
                    setFilename(`batch_${safeSource}_to_${safeDest}.sh`);
                }
            } else {
                setFilename('');
            }
        }
    }, [isOpen, config, initialPairs, isSinglePair]);

    const handleGenerateClick = async (dryRun: boolean) => {
        if (selectedDomains.size === 0) return alert("Select at least one domain.");
        if (isSinglePair && !filename.trim()) return alert("Filename required.");

        setGenerating(true);
        try {
            await onGenerate({
                filename: isSinglePair ? filename : undefined,
                userCount,
                randomOrder,
                selectedDomains: Array.from(selectedDomains),
                dryRun
            });
            onClose();
        } catch (e: any) {
            alert(`Generation failed: ${e.message}`);
        } finally {
            setGenerating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-950">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Shuffle size={18} className="text-purple-400" />
                        Generate Batch
                    </h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Header Info */}
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm text-blue-200 flex items-center gap-2">
                         <Activity size={16} />
                         Generating for <span className="font-bold text-white">{initialPairs.length}</span> Sync Pair(s)
                    </div>

                    {isSinglePair && (
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Batch Filename</label>
                            <input 
                                type="text" 
                                value={filename}
                                onChange={(e) => setFilename(e.target.value)}
                                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 font-mono"
                                placeholder="batch_name.sh"
                            />
                        </div>
                    )}

                    {/* Domains */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                                <Globe size={14} /> Domains
                            </label>
                            <button
                                onClick={() => {
                                    if (selectedDomains.size === (config.domains?.length || 0)) setSelectedDomains(new Set());
                                    else setSelectedDomains(new Set(config.domains?.map(d => d.domain_name) || []));
                                }}
                                className="text-[10px] text-zinc-500 hover:text-white uppercase font-bold"
                            >
                                {selectedDomains.size === (config.domains?.length || 0) ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar p-1">
                            {config.domains?.map(d => (
                                <button
                                    key={d.domain_name}
                                    onClick={() => {
                                        const next = new Set(selectedDomains);
                                        if (next.has(d.domain_name)) next.delete(d.domain_name); else next.add(d.domain_name);
                                        setSelectedDomains(next);
                                    }}
                                    className={`px-2.5 py-1.5 rounded text-xs font-medium transition border ${
                                        selectedDomains.has(d.domain_name) 
                                        ? 'bg-purple-600/20 border-purple-500 text-purple-200' 
                                        : 'bg-zinc-800 border-transparent text-zinc-400 hover:bg-zinc-700'
                                    }`}
                                >
                                    {d.domain_name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Users & Random */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                                <User size={14} /> User Limit
                             </label>
                             <div className="flex items-center gap-2">
                                 <input 
                                    type="number"
                                    min="0"
                                    value={userCount}
                                    onChange={(e) => setUserCount(parseInt(e.target.value) || 0)}
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                                 />
                             </div>
                             <p className="text-[10px] text-zinc-500 mt-1">Set to 0 for ALL users.</p>
                        </div>
                        
                        <div>
                             <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Options</label>
                             <label className="flex items-center gap-2 cursor-pointer bg-zinc-950 border border-zinc-800 p-2 rounded-lg hover:border-zinc-700 transition">
                                 <input 
                                    type="checkbox" 
                                    checked={randomOrder} 
                                    onChange={(e) => setRandomOrder(e.target.checked)}
                                    className="rounded accent-purple-500 bg-zinc-800 border-zinc-600"
                                 />
                                 <span className="text-sm text-zinc-300">Randomize Order</span>
                             </label>
                        </div>
                    </div>

                </div>

                <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
                    <div className="text-xs text-zinc-500">
                        {userCount === 0 ? "Processing ALL users" : `Start with ${userCount} users`}
                    </div>
                    <div className="flex gap-2">
                         <button 
                            onClick={onClose}
                            className="px-4 py-2 text-zinc-400 hover:text-white text-sm font-medium transition"
                         >
                            Cancel
                         </button>
                         <button
                            onClick={() => handleGenerateClick(false)}
                            disabled={generating || selectedDomains.size === 0}
                            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-purple-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                         >
                            {generating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Shuffle size={16} />}
                            Generate
                         </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
