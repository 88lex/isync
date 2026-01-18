import React, { useState, useEffect } from 'react';
import { X, Folder, Server, HardDrive, Save } from 'lucide-react';
import { SyncPairWithBatch, Config, SSHServer, createSyncPair, updateSyncPair } from '../../api';
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
    const [sourceServer, setSourceServer] = useState('');
    const [destServer, setDestServer] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // File Browser State
    const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
    const [fileBrowserMode, setFileBrowserMode] = useState<'source' | 'dest'>('source');
    const [fileBrowserPath, setFileBrowserPath] = useState('');
    const [fileBrowserServer, setFileBrowserServer] = useState<SSHServer | undefined>(undefined);

    // Initialize/Reset form when opening
    useEffect(() => {
        if (isOpen) {
            if (editingPair) {
                // Parse source/dest for server prefixes if needed
                // Assuming format like "remote:path" for rclone remotes if using that, 
                // but the UI implies using the server ID separately?
                // The backend stores explicit strings. The wizard constructs them.
                // Re-reading logic in parent might be needed, but assuming simple strings for now as per previous code.
                setSource(editingPair.source);
                setDest(editingPair.dest);
                setDomain(editingPair.domain_reference || '');
                // We don't easily know strictly which server ID it corresponds to without parsing,
                // but for now let's assume raw paths.
                setSourceServer(''); // Todo: parse if needed
                setDestServer('');
            } else {
                setSource('');
                setDest('');
                setDomain('');
                setSourceServer('');
                setDestServer('');
            }
        }
    }, [isOpen, editingPair]);

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
                domain: domain || undefined
            };

            if (editingPair && editingPair.id) {
                await updateSyncPair(editingPair.id, payload);
            } else {
                await createSyncPair(payload);
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
        const currentServerId = mode === 'source' ? sourceServer : destServer;
        setFileBrowserPath(currentPath || (currentServerId ? '/' : '')); // Default to root if switching context
        setFileBrowserServer(sshServers.find(s => s.id === currentServerId));
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
                    <div className="bg-zinc-950/50 p-4 rounded-lg border border-zinc-800/50">
                        <label className="block text-xs font-bold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Folder size={14} /> Source Path
                        </label>
                        <div className="flex gap-2 mb-2">
                            <div className="w-1/3">
                                <select
                                    value={sourceServer}
                                    onChange={(e) => setSourceServer(e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-300 focus:border-orange-500 transition"
                                >
                                    <option value="">Local Execution Environment</option>
                                    {sshServers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} (SSH)</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex-1 flex gap-2">
                                <input
                                    type="text"
                                    value={source}
                                    onChange={(e) => setSource(e.target.value)}
                                    placeholder="/path/to/source"
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

                    {/* Destination */}
                    <div className="bg-zinc-950/50 p-4 rounded-lg border border-zinc-800/50">
                        <label className="block text-xs font-bold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <HardDrive size={14} /> Destination Path
                        </label>
                        <div className="flex gap-2 mb-2">
                            <div className="w-1/3">
                                <select
                                    value={destServer}
                                    onChange={(e) => setDestServer(e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-300 focus:border-blue-500 transition"
                                >
                                    <option value="">Local Execution Environment</option>
                                    {sshServers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} (SSH)</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex-1 flex gap-2">
                                <input
                                    type="text"
                                    value={dest}
                                    onChange={(e) => setDest(e.target.value)}
                                    placeholder="remote:/path/to/dest"
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
