import React from 'react';
import { Shuffle, Zap, List } from 'lucide-react';
import { Config, RandomBatchResponse } from '../../api';

export interface RandomBatchSettingsProps {
    config: Config;
    randomUserCount: number;
    setRandomUserCount: (count: number) => void;
    randomOrder: boolean;
    setRandomOrder: (checked: boolean) => void;
    selectedDomains: Set<string>;
    setSelectedDomains: (domains: Set<string>) => void;
    toggleDomainSelection: (domain: string) => void;
    selectedUsers: Set<string>;
    batchLoading: boolean;
    loadingUserSummary: boolean;
    loadUserSummary: () => void;
    generateRandomBatchHandler: (dryRun: boolean) => void;
    randomBatchResult: RandomBatchResponse | null;
}

export const RandomBatchSettings: React.FC<RandomBatchSettingsProps> = ({
    config,
    randomUserCount,
    setRandomUserCount,
    randomOrder,
    setRandomOrder,
    selectedDomains,
    setSelectedDomains,
    toggleDomainSelection,
    selectedUsers,
    batchLoading,
    loadingUserSummary,
    loadUserSummary,
    generateRandomBatchHandler,
    randomBatchResult
}) => {
    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 mb-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Generation Settings</h3>
                <button
                    onClick={loadUserSummary}
                    disabled={loadingUserSummary}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition"
                >
                    <List size={14} /> User Summary
                </button>
            </div>

            {/* Controls */}
            <div className="space-y-4">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">User Count (0 for All)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="5000"
                                    value={randomUserCount}
                                    onChange={(e) => setRandomUserCount(parseInt(e.target.value) || 0)}
                                    className="w-20 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-purple-500"
                                />
                            </div>
                            {/* Random Order Toggle */}
                            <label className="flex items-center gap-2 cursor-pointer mt-5">
                                <input
                                    type="checkbox"
                                    checked={randomOrder}
                                    onChange={(e) => setRandomOrder(e.target.checked)}
                                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500"
                                />
                                <span className="text-sm text-zinc-400"><Shuffle size={14} className="inline mr-1" />Random Order</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs text-zinc-500">Select Domains</label>
                            <button
                                onClick={() => {
                                    const domains = config.domains || [];
                                    if (selectedDomains.size === domains.length) {
                                        setSelectedDomains(new Set());
                                    } else {
                                        setSelectedDomains(new Set(domains.map(d => d.domain_name)));
                                    }
                                }}
                                className="text-xs text-indigo-400 hover:text-indigo-300"
                            >
                                {selectedDomains.size === (config.domains?.length || 0) ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {config.domains?.map((d) => (
                                <button
                                    key={d.domain_name}
                                    onClick={() => toggleDomainSelection(d.domain_name)}
                                    className={`px-3 py-1 rounded text-xs font-medium transition ${selectedDomains.has(d.domain_name)
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                        }`}
                                >
                                    {d.domain_name}
                                </button>
                            ))}
                            {(!config.domains || config.domains.length === 0) && (
                                <span className="text-xs text-zinc-500 italic">No domains configured</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Summary info */}
                <div className="flex items-center justify-between bg-zinc-800/50 p-2 rounded">
                    <span className="text-xs text-zinc-400">
                        Generating for <span className="text-emerald-400 font-bold">{selectedDomains.size}</span> domains.
                        Limit: <span className="text-emerald-400 font-bold">{randomUserCount === 0 ? 'ALL' : randomUserCount}</span> users.
                        {selectedUsers.size > 0 && <span className="ml-2 text-indigo-400">(Overrides with {selectedUsers.size} manual selection if set)</span>}
                    </span>

                    <div className="flex gap-2">
                        <button
                            onClick={() => generateRandomBatchHandler(true)}
                            disabled={batchLoading || selectedDomains.size === 0}
                            className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded text-amber-400 text-xs font-medium transition"
                        >
                            <Zap size={12} className="inline mr-1" /> Dry Run
                        </button>
                        <button
                            onClick={() => generateRandomBatchHandler(false)}
                            disabled={batchLoading || selectedDomains.size === 0}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-white text-xs font-medium transition"
                        >
                            <Shuffle size={12} className="inline mr-1" /> Generate
                        </button>
                    </div>
                </div>
                {randomBatchResult && (
                    <div className="bg-purple-900/20 border border-purple-500/30 rounded p-3 mt-2">
                        <div className="text-xs text-purple-300">
                            Generated batch with <span className="font-bold">{randomBatchResult.user_count}</span> random users from: {randomBatchResult.domains_queried.join(', ')}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
