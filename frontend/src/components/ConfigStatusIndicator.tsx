import React, { useState, useEffect } from 'react';
import { Database, AlertTriangle, CheckCircle, RefreshCw, HardDrive } from 'lucide-react';
import { fetchConfigStatus, reloadConfig, ConfigStatus } from '../api';

interface ConfigStatusIndicatorProps {
    compact?: boolean;
}

export const ConfigStatusIndicator: React.FC<ConfigStatusIndicatorProps> = ({ compact = false }) => {
    const [status, setStatus] = useState<ConfigStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloading, setReloading] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const checkStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchConfigStatus();
            setStatus(data);
        } catch (err: any) {
            setError(err.message || 'Failed to check config status');
        } finally {
            setLoading(false);
        }
    };

    const handleReload = async () => {
        setReloading(true);
        try {
            await reloadConfig();
            await checkStatus();
        } catch (err: any) {
            setError('Failed to reload: ' + (err.message || 'Unknown error'));
        } finally {
            setReloading(false);
        }
    };

    useEffect(() => {
        checkStatus();
        // Re-check every 30 seconds
        const interval = setInterval(checkStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    // Determine health status
    const isHealthy = status?.config_file?.exists && status?.synclist_file?.exists;
    const hasData = status && (status.in_memory?.config_keys > 0 || status.in_memory?.domains > 0);

    if (loading && !status) {
        return (
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
                <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
                Checking...
            </div>
        );
    }

    // Compact mode for sidebar
    if (compact) {
        return (
            <div
                className="relative cursor-pointer"
                onClick={() => setShowDetails(!showDetails)}
            >
                <div className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs transition ${error ? 'text-red-400 bg-red-500/10' :
                    !isHealthy ? 'text-yellow-400 bg-yellow-500/10' :
                        'text-emerald-400 bg-emerald-500/10'
                    }`}>
                    {error ? <AlertTriangle size={14} /> :
                        !isHealthy ? <AlertTriangle size={14} /> :
                            <CheckCircle size={14} />}
                    <span>Config {isHealthy ? 'OK' : 'Issue'}</span>
                </div>

                {/* Dropdown Details */}
                {showDetails && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowDetails(false)} />
                        <div className="absolute left-0 bottom-full mb-2 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 p-4">
                            <ConfigDetails
                                status={status}
                                error={error}
                                onReload={handleReload}
                                reloading={reloading}
                                onRefresh={checkStatus}
                            />
                        </div>
                    </>
                )}
            </div>
        );
    }

    // Full mode
    return (
        <ConfigDetails
            status={status}
            error={error}
            onReload={handleReload}
            reloading={reloading}
            onRefresh={checkStatus}
        />
    );
};

interface ConfigDetailsProps {
    status: ConfigStatus | null;
    error: string | null;
    onReload: () => void;
    reloading: boolean;
    onRefresh: () => void;
}

const ConfigDetails: React.FC<ConfigDetailsProps> = ({ status, error, onReload, reloading, onRefresh }) => {
    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    if (error) {
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle size={16} />
                    <span className="font-medium">Configuration Error</span>
                </div>
                <p className="text-xs text-red-300">{error}</p>
                <div className="flex gap-2">
                    <button
                        onClick={onReload}
                        disabled={reloading}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
                    >
                        <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
                        {reloading ? 'Reloading...' : 'Recover Config'}
                    </button>
                </div>
            </div>
        );
    }

    if (!status) return null;

    const isHealthy = status.config_file?.exists && status.synclist_file?.exists;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Database size={16} className="text-zinc-400" />
                    <span className="font-medium text-white text-sm">Config Status</span>
                </div>
                <button
                    onClick={onRefresh}
                    className="p-1 hover:bg-zinc-800 rounded transition text-zinc-400 hover:text-white"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* File Status */}
            <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <HardDrive size={12} className="text-zinc-500" />
                        <span className="text-zinc-400">config.yaml</span>
                    </div>
                    <div className={`flex items-center gap-1 ${status.config_file?.exists ? 'text-emerald-400' : 'text-red-400'}`}>
                        {status.config_file?.exists ? (
                            <>
                                <CheckCircle size={12} />
                                <span>{formatBytes(status.config_file.size)}</span>
                            </>
                        ) : (
                            <>
                                <AlertTriangle size={12} />
                                <span>Missing</span>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <HardDrive size={12} className="text-zinc-500" />
                        <span className="text-zinc-400">synclist.yaml</span>
                    </div>
                    <div className={`flex items-center gap-1 ${status.synclist_file?.exists ? 'text-emerald-400' : 'text-yellow-400'}`}>
                        {status.synclist_file?.exists ? (
                            <>
                                <CheckCircle size={12} />
                                <span>{formatBytes(status.synclist_file.size)}</span>
                            </>
                        ) : (
                            <>
                                <AlertTriangle size={12} />
                                <span>Empty</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* In-Memory Stats */}
            <div className="pt-2 border-t border-zinc-800">
                <div className="text-[10px] uppercase text-zinc-500 tracking-wider mb-2">Loaded Data</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-zinc-800/50 rounded p-2">
                        <div className="text-lg font-bold text-white">{status.in_memory.domains}</div>
                        <div className="text-[10px] text-zinc-500">Domains</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-2">
                        <div className="text-lg font-bold text-white">{status.in_memory.sync_pairs}</div>
                        <div className="text-[10px] text-zinc-500">Sync Pairs</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-2">
                        <div className="text-lg font-bold text-white">{status.in_memory.config_keys}</div>
                        <div className="text-[10px] text-zinc-500">Settings</div>
                    </div>
                </div>
            </div>

            {/* Actions */}
            {!isHealthy && (
                <button
                    onClick={onReload}
                    disabled={reloading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
                >
                    <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
                    {reloading ? 'Reloading...' : 'Reload from Disk'}
                </button>
            )}
        </div>
    );
};

export default ConfigStatusIndicator;
