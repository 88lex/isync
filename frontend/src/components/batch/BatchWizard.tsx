import React, { useState, useEffect } from 'react';
import { X, Folder, Save, Search, Globe, Shield, HardDrive, Server, ChevronDown } from 'lucide-react';
import { SyncPairWithBatch, Config, SSHServer, createSyncPair, updateSyncPair, listLocalRemotes, listServerRemotes, RcloneRemote } from '../../api';
import { FileBrowserModal } from '../FileBrowserModal';

interface BatchWizardProps {
    isOpen: boolean;
    onClose: () => void;
    editingPair: SyncPairWithBatch | null;
    config: Config;
    sshServers: SSHServer[];
    onSuccess: () => Promise<void>;
}

export const BatchWizard: React.FC<BatchWizardProps> = ({
    isOpen,
    onClose,
    editingPair,
    config,
    sshServers,
    onSuccess
}) => {
    const [source, setSource] = useState('');
    const [dest, setDest] = useState('');
    const [domain, setDomain] = useState('');
    const [sourceType, setSourceType] = useState<'LOCAL' | 'SSH' | 'RCLONE'>('LOCAL');
    const [sourceServerId, setSourceServerId] = useState('');
    const [destType, setDestType] = useState<'LOCAL' | 'SSH' | 'RCLONE'>('LOCAL');
    const [destServerId, setDestServerId] = useState('');
    const [executionServerId, setExecutionServerId] = useState('');
    const [executionMode, setExecutionMode] = useState<'local' | 'ssh'>('local');
    const [isSaving, setIsSaving] = useState(false);

    // Rclone Remotes Cache
    const [localRemotes, setLocalRemotes] = useState<RcloneRemote[]>([]);
    const [remoteRemotesCache, setRemoteRemotesCache] = useState<Record<string, RcloneRemote[]>>({});
    const [loadingRemotes, setLoadingRemotes] = useState(false);

    // File Browser State
    const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
    const [fileBrowserMode, setFileBrowserMode] = useState<'source' | 'dest'>('source');
    const [fileBrowserPath, setFileBrowserPath] = useState('');
    const [fileBrowserServer, setFileBrowserServer] = useState<SSHServer | undefined>(undefined);

    // Initialize/Reset form when opening
    useEffect(() => {
        if (isOpen) {
            if (editingPair) {
                setSource(editingPair.source);
                setDest(editingPair.dest);
                setDomain(editingPair.domain_reference || '');
                setSourceType(editingPair.source_type || 'LOCAL');
                setSourceServerId(editingPair.source_server_id || '');
                setDestType(editingPair.dest_type || 'LOCAL');
                setDestServerId(editingPair.dest_server_id || '');
                setExecutionServerId(editingPair.meta_server_id || '');
                setExecutionMode(editingPair.meta_execution_mode || 'local');
            } else {
                setSource('');
                setDest('');
                setDomain('');
                setSourceType('LOCAL');
                setSourceServerId('');
                setDestType('LOCAL');
                setDestServerId('');
                setExecutionServerId('');
                setExecutionMode('local');
            }
        }
    }, [isOpen, editingPair]);

    // Fetch Rclone Remotes
    useEffect(() => {
        if (!isOpen) return;

        const loadRemotes = async () => {
            setLoadingRemotes(true);
            try {
                // Load local remotes
                const local = await listLocalRemotes();
                setLocalRemotes(local.remotes);

                // Load remotes for selected execution server if it exists
                if (executionServerId && !remoteRemotesCache[executionServerId]) {
                    const remotes = await listServerRemotes(executionServerId);
                    setRemoteRemotesCache(prev => ({ ...prev, [executionServerId]: remotes.remotes }));
                }
            } catch (e) {
                console.error("Failed to load remotes", e);
            } finally {
                setLoadingRemotes(false);
            }
        };

        loadRemotes();
    }, [isOpen, executionServerId]);

    const handleSave = async () => {
        if (!source || !dest) {
            alert("Source and Destination are required.");
            return;
        }

        setIsSaving(true);
        try {
            // Construct paths with server prefixes if selected? 
            // NOTE: The previous code seemed to treat server selection mainly for BROWSING,
            // but the actual path saved was just the path string.
            // If rclone remotes are used, the path string usually implies the remote.

            const payload = {
                source,
                dest,
                domain_reference: domain || undefined,
                source_type: sourceType,
                source_server_id: sourceServerId || undefined,
                dest_type: destType,
                dest_server_id: destServerId || undefined,
                meta_server_id: executionServerId || undefined,
                meta_execution_mode: executionMode
            };

            if (editingPair && editingPair.id) {
                await updateSyncPair(editingPair.id, payload as any);
            } else {
                await createSyncPair(payload as any);
            }
            await onSuccess();
            onClose();
        } catch (e: any) {
            alert(`Failed to save: ${e.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const openFileBrowser = (mode: 'source' | 'dest') => {
        setFileBrowserMode(mode);
        const currentPath = mode === 'source' ? source : dest;
        const currentServerId = mode === 'source' ? sourceServerId : destServerId;
        // Fallback to execution server if local context is selected for browsing but an execution server is set
        const effectiveServerId = currentServerId || executionServerId;

        setFileBrowserPath(currentPath || (effectiveServerId ? '/' : ''));
        setFileBrowserServer(sshServers.find(s => s.id === effectiveServerId));
        setIsFileBrowserOpen(true);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        {editingPair ? <Edit2Icon size={18} /> : <Folder size={18} />}
                        {editingPair ? 'Edit Sync Pair' : 'New Sync Pair'}
                    </h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    {/* Source */}
                    <div className="bg-zinc-950/50 p-4 rounded-lg border border-zinc-800/50 space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                                <Folder size={14} /> Source Association
                            </label>
                            <div className="flex bg-zinc-900 rounded p-0.5 border border-zinc-800">
                                {(['LOCAL', 'SSH', 'RCLONE'] as const).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => { setSourceType(t); setSourceServerId(''); }}
                                        className={`px-3 py-1 text-[10px] font-bold rounded transition ${sourceType === t ? 'bg-orange-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {sourceType !== 'LOCAL' && (
                                <div>
                                    <label className="block text-[10px] text-zinc-500 uppercase font-bold mb-1">
                                        {sourceType === 'SSH' ? 'SSH Server' : 'Rclone Remote'}
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={sourceServerId}
                                            onChange={(e) => setSourceServerId(e.target.value)}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-300 focus:border-orange-500 transition appearance-none"
                                        >
                                            <option value="">-- Select {sourceType === 'SSH' ? 'Server' : 'Remote'} --</option>
                                            {sourceType === 'SSH' ? (
                                                sshServers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)
                                            ) : (
                                                (executionServerId ? (remoteRemotesCache[executionServerId] || []) : localRemotes).map(r => (
                                                    <option key={r.name} value={r.name}>{r.name} ({r.type})</option>
                                                ))
                                            )}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-2.5 text-zinc-500 pointer-events-none" />
                                    </div>
                                </div>
                            )}
                            <div className={sourceType === 'LOCAL' ? 'col-span-1 md:col-span-2' : ''}>
                                <label className="block text-[10px] text-zinc-500 uppercase font-bold mb-1">Path</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={source}
                                        onChange={(e) => setSource(e.target.value)}
                                        placeholder={sourceType === 'RCLONE' ? "path/to/folder" : "/path/to/source"}
                                        className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-orange-500 transition font-mono"
                                    />
                                    <button
                                        onClick={() => openFileBrowser('source')}
                                        className="px-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 transition"
                                        title="Browse"
                                    >
                                        <Folder size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Destination */}
                    <div className="bg-zinc-950/50 p-4 rounded-lg border border-zinc-800/50 space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                                <HardDrive size={14} /> Destination Association
                            </label>
                            <div className="flex bg-zinc-900 rounded p-0.5 border border-zinc-800">
                                {(['LOCAL', 'SSH', 'RCLONE'] as const).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => { setDestType(t); setDestServerId(''); }}
                                        className={`px-3 py-1 text-[10px] font-bold rounded transition ${destType === t ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {destType !== 'LOCAL' && (
                                <div>
                                    <label className="block text-[10px] text-zinc-500 uppercase font-bold mb-1">
                                        {destType === 'SSH' ? 'SSH Server' : 'Rclone Remote'}
                                    </label>
                                    <div className="relative">
                                        <select
                                            value={destServerId}
                                            onChange={(e) => setDestServerId(e.target.value)}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-300 focus:border-blue-500 transition appearance-none"
                                        >
                                            <option value="">-- Select {destType === 'SSH' ? 'Server' : 'Remote'} --</option>
                                            {destType === 'SSH' ? (
                                                sshServers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)
                                            ) : (
                                                (executionServerId ? (remoteRemotesCache[executionServerId] || []) : localRemotes).map(r => (
                                                    <option key={r.name} value={r.name}>{r.name} ({r.type})</option>
                                                ))
                                            )}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-2.5 text-zinc-500 pointer-events-none" />
                                    </div>
                                </div>
                            )}
                            <div className={destType === 'LOCAL' ? 'col-span-1 md:col-span-2' : ''}>
                                <label className="block text-[10px] text-zinc-500 uppercase font-bold mb-1">Path</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={dest}
                                        onChange={(e) => setDest(e.target.value)}
                                        placeholder={destType === 'RCLONE' ? "path/to/folder" : "remote:/path/to/dest"}
                                        className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-blue-500 transition font-mono"
                                    />
                                    <button
                                        onClick={() => openFileBrowser('dest')}
                                        className="px-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 transition"
                                        title="Browse"
                                    >
                                        <Folder size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Execution Context */}
                    <div className="bg-zinc-950/50 p-4 rounded-lg border border-zinc-800/50 space-y-4">
                        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                            <Server size={14} /> Execution Context
                        </label>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] text-zinc-500 uppercase font-bold mb-1">Execution Server</label>
                                <select
                                    value={executionServerId}
                                    onChange={(e) => setExecutionServerId(e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-300 focus:border-indigo-500 transition"
                                >
                                    <option value="">Local / None</option>
                                    {sshServers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} (SSH)</option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-zinc-600 mt-1">Server where this batch will be pushed/run.</p>
                            </div>

                            <div>
                                <label className="block text-[10px] text-zinc-500 uppercase font-bold mb-1">Command Syntax</label>
                                <div className="flex bg-zinc-900 rounded p-1 border border-zinc-700">
                                    <button
                                        onClick={() => setExecutionMode('local')}
                                        className={`flex-1 py-1 text-xs font-medium rounded transition ${executionMode === 'local' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        Local (Direct)
                                    </button>
                                    <button
                                        onClick={() => setExecutionMode('ssh')}
                                        className={`flex-1 py-1 text-xs font-medium rounded transition ${executionMode === 'ssh' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        Remote (SSH)
                                    </button>
                                </div>
                                <p className="text-[10px] text-zinc-600 mt-1">
                                    {executionMode === 'local'
                                        ? "Generates 'rclone copy ...' (Run ON remote)"
                                        : "Generates 'ssh user@host ...' (Run FROM here)"}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Domain */}
                    <div>
                        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Server size={14} /> Domain (Optional)
                        </label>
                        <select
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-purple-500 transition"
                        >
                            <option value="">-- No Domain --</option>
                            {config.domains?.map(d => (
                                <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-zinc-500 mt-1">
                            Associating a domain allows extracting users from the path automatically.
                        </p>
                    </div>
                </div>

                <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-900/50 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-zinc-400 hover:text-white text-sm font-medium transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 flex items-center gap-2 transition disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : <><Save size={16} /> Save Sync Pair</>}
                    </button>
                </div>
            </div>

            {isFileBrowserOpen && (
                <FileBrowserModal
                    isOpen={isFileBrowserOpen}
                    onClose={() => setIsFileBrowserOpen(false)}
                    initialPath={fileBrowserPath}
                    serverId={fileBrowserServer?.id || ''}
                    onSelect={(path) => {
                        if (fileBrowserMode === 'source') setSource(path);
                        else setDest(path);
                        setIsFileBrowserOpen(false);
                    }}
                    type={fileBrowserServer ? 'ssh' : 'local'}
                />
            )}
        </div>
    );
};

const Edit2Icon = ({ size }: { size: number }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
    </svg>
);
