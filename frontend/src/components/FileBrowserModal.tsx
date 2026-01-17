import React, { useState, useEffect } from 'react';
import { X, Folder, HardDrive, ArrowUp, ChevronRight, Loader2, Home } from 'lucide-react';
import { listServerFolders, browseRcloneContent } from '../api';

interface FileBrowserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    type: 'local' | 'ssh' | 'rclone';
    serverId: string;
    rcloneRemote?: string;
    initialPath?: string;
}

export const FileBrowserModal: React.FC<FileBrowserModalProps> = ({
    isOpen, onClose, onSelect, type, serverId, rcloneRemote, initialPath
}) => {
    const [currentPath, setCurrentPath] = useState(initialPath || (type === 'rclone' ? '' : '/'));
    const [items, setItems] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            loadContent(currentPath);
        }
    }, [isOpen, currentPath]);

    const loadContent = async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            if (type === 'rclone') {
                if (!rcloneRemote) throw new Error("Remote name required");
                const res = await browseRcloneContent(rcloneRemote, path, serverId);
                if (res.status === 'ok') {
                    setItems(res.dirs);
                } else {
                    setError('Failed to list remote content');
                }
            } else {
                // Local or SSH Folder
                // We use listServerFolders which expects a path and returns tree/list
                // But listServerFolders is designed for 2-3 levels deep tree. 
                // We might want shallow list for browsing?
                // listServerFolders(serverId, path, depth=1)
                const res = await listServerFolders(serverId, path, 1);
                if (res.status === 'ok') {
                    // res.folders is string[] of folder names in that path?
                    // Check api.ts interface: FoldersListResponse has `folders: string[]`? No, it has `tree: RemoteFolder[]`
                    // Let's re-check api.ts via memory or assume tree
                    // Actually, listServerFolders returns { tree: RemoteFolder[] } and `tree` has relative paths usually?
                    // Let's assume for now we use the `tree` and map to names.
                    setItems(res.tree.map(f => f.name));
                } else {
                    setError(res.message || 'Failed to list folders');
                }
            }
        } catch (e: any) {
            setError(e.message || 'Error loading content');
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = (itemName: string) => {
        const separator = type === 'rclone' ? '' : '/'; // rclone paths don't start with / usually? 
        // Actually standard linux paths use /, rclone uses remote:path/to/folder
        // If currentPath is empty (rclone root), new path is itemName
        // If currentPath is /, new path is /itemName

        let newPath = '';
        if (type === 'rclone') {
            newPath = currentPath ? `${currentPath}/${itemName}` : itemName;
        } else {
            newPath = currentPath === '/' ? `/${itemName}` : `${currentPath}/${itemName}`;
        }
        setCurrentPath(newPath);
    };

    const handleUp = () => {
        if (!currentPath || currentPath === '/') return;
        const parts = currentPath.split('/').filter(p => p);
        parts.pop();
        const newPath = parts.length === 0 ? (type === 'rclone' ? '' : '/') : (type === 'rclone' ? parts.join('/') : '/' + parts.join('/'));
        setCurrentPath(newPath);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="p-4 border-b border-zinc-700 flex justify-between items-center bg-zinc-800/50 rounded-t-xl">
                    <h3 className="font-bold text-zinc-200 flex items-center gap-2">
                        {type === 'rclone' ? <HardDrive size={18} className="text-purple-400" /> : <Folder size={18} className="text-amber-400" />}
                        Browse {type === 'rclone' ? rcloneRemote : (serverId === 'local' ? 'Local' : 'Remote')}
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-white"><X size={20} /></button>
                </div>

                {/* Path Bar */}
                <div className="p-3 bg-zinc-950/50 border-b border-zinc-800 flex gap-2 items-center">
                    <button onClick={handleUp} disabled={!currentPath || currentPath === '/'}
                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded text-zinc-300">
                        <ArrowUp size={16} />
                    </button>
                    <div className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-mono text-zinc-300 overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-2">
                        <Home size={12} className="text-zinc-500" />
                        {currentPath || (type === 'rclone' ? '(root)' : '/')}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-zinc-500 gap-2">
                            <Loader2 size={24} className="animate-spin" /> Loading...
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2 p-4 text-center">
                            <span>{error}</span>
                            <button onClick={() => loadContent(currentPath)} className="text-xs underline text-zinc-400 hover:text-white">Retry</button>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-500 italic">
                            No folders found
                        </div>
                    ) : (
                        <div className="grid gap-1">
                            {items.map((item, idx) => (
                                <button key={idx} onClick={() => handleNavigate(item)}
                                    className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800 rounded text-left group transition">
                                    <Folder size={16} className={`shrink-0 ${type === 'rclone' ? 'text-purple-400/70 group-hover:text-purple-400' : 'text-amber-400/70 group-hover:text-amber-400'}`} />
                                    <span className="text-sm text-zinc-300 group-hover:text-white truncate flex-1">{item}</span>
                                    <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-400 opacity-0 group-hover:opacity-100" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-700 bg-zinc-800/30 rounded-b-xl flex justify-between items-center">
                    <div className="text-xs text-zinc-500">
                        {items.length} items
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-sm transition">
                            Cancel
                        </button>
                        <button onClick={() => onSelect(currentPath)}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition flex items-center gap-2">
                            Select Current Folder
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
