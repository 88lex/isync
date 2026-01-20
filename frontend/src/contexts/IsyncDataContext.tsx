/**
 * IsyncDataContext - Centralized Cache Management
 * Provides local-first data access with persistent backend caching.
 */
import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../constants/config';

// --- Types ---

export interface CacheEntry<T> {
    data: T[];
    lastFetched: number | null;  // Unix timestamp (ms)
    isLoading: boolean;
    error?: string;
}

export type DataType =
    | 'users'
    | 'ssh_servers'
    | 'rclone_remotes'
    | 'shared_drives'
    | 'keys'
    | 'sync_pairs'
    | 'batch_files'
    | 'batch_groups'
    | 'schedules'
    | 'crontab_entries';

export interface CacheState {
    users: Record<string, CacheEntry<any>>;            // Keyed by domain
    ssh_servers: CacheEntry<any>;                      // Singleton
    rclone_remotes: Record<string, CacheEntry<any>>;   // Keyed by server ID or 'local'
    shared_drives: Record<string, CacheEntry<any>>;    // Keyed by domain
    keys: CacheEntry<any>;                             // Singleton
    sync_pairs: CacheEntry<any>;                       // Singleton
    batch_files: CacheEntry<any>;                      // Singleton
    batch_groups: CacheEntry<any>;                     // Singleton
    schedules: CacheEntry<any>;                        // Singleton
    crontab_entries: Record<string, CacheEntry<any>>;  // Keyed by server ID
}

interface IsyncDataContextType {
    cache: CacheState;
    getCached: <T>(dataType: DataType, contextKey?: string) => CacheEntry<T> | null;
    setCached: <T>(dataType: DataType, contextKey: string, data: T[], sourceInfo?: string) => void;
    setLoading: (dataType: DataType, contextKey: string, isLoading: boolean) => void;
    invalidate: (dataType: DataType, contextKey?: string) => void;
    refreshAll: () => Promise<void>;
    // Legacy support (to be deprecated)
    driveManager: { drives: any[]; localRemotes: any[]; lastUpdated: number };
    setDriveManager: React.Dispatch<React.SetStateAction<{ drives: any[]; localRemotes: any[]; lastUpdated: number }>>;
    rcloneManager: any;
    setRcloneManager: React.Dispatch<React.SetStateAction<any>>;
}

// --- Initial State ---

const createEmptyEntry = <T,>(): CacheEntry<T> => ({
    data: [],
    lastFetched: null,
    isLoading: false,
});

const initialCacheState: CacheState = {
    users: {},
    ssh_servers: createEmptyEntry(),
    rclone_remotes: {},
    shared_drives: {},
    keys: createEmptyEntry(),
    sync_pairs: createEmptyEntry(),
    batch_files: createEmptyEntry(),
    batch_groups: createEmptyEntry(),
    schedules: createEmptyEntry(),
    crontab_entries: {},
};

// --- Context ---

const IsyncDataContext = createContext<IsyncDataContextType | undefined>(undefined);

// --- Provider ---

export const IsyncDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [cache, setCache] = useState<CacheState>(initialCacheState);

    // Legacy state for backwards compatibility
    const [driveManager, setDriveManager] = useState({ drives: [], localRemotes: [], lastUpdated: 0 });
    const [rcloneManager, setRcloneManager] = useState({
        remotes: [], servers: [], source: 'local', selectedServer: '', searchFilter: '', statusFilter: 'all', lastUpdated: 0
    });

    // Load cache from backend on mount (non-blocking)
    useEffect(() => {
        const loadCacheFromBackend = async () => {
            try {
                // Use a short timeout to prevent blocking
                const res = await axios.get(`${API_BASE}/cache`, { timeout: 3000 });
                const entries = res.data;

                // Only process if we got an array
                if (!Array.isArray(entries)) return;

                // Populate cache state from backend
                setCache(prev => {
                    const newCache = { ...prev };
                    entries.forEach((entry: any) => {
                        const { data_type, context_key, payload_size } = entry;
                        // We just mark that we have data; actual payload is fetched on demand
                        if (payload_size > 0) {
                            // For keyed types
                            if (['users', 'rclone_remotes', 'shared_drives', 'crontab_entries'].includes(data_type)) {
                                (newCache as any)[data_type] = {
                                    ...(newCache as any)[data_type],
                                    [context_key]: { data: [], lastFetched: Date.now(), isLoading: false }
                                };
                            }
                        }
                    });
                    return newCache;
                });
            } catch (e) {
                // Silently fail - cache loading should not block the app
                console.warn('Cache loading skipped (backend may not be ready)');
            }
        };

        loadCacheFromBackend();
    }, []);

    const getCached = useCallback(<T,>(dataType: DataType, contextKey: string = 'local'): CacheEntry<T> | null => {
        const typeData = (cache as any)[dataType];
        if (!typeData) return null;

        // Singleton types
        if (['ssh_servers', 'keys', 'sync_pairs', 'batch_files', 'batch_groups', 'schedules'].includes(dataType)) {
            return typeData as CacheEntry<T>;
        }

        // Keyed types
        return typeData[contextKey] || null;
    }, [cache]);

    const setCached = useCallback(<T,>(dataType: DataType, contextKey: string, data: T[], sourceInfo?: string) => {
        const now = Date.now();

        setCache(prev => {
            const newCache = { ...prev };

            // Singleton types
            if (['ssh_servers', 'keys', 'sync_pairs', 'batch_files', 'batch_groups', 'schedules'].includes(dataType)) {
                (newCache as any)[dataType] = { data, lastFetched: now, isLoading: false };
            } else {
                // Keyed types
                (newCache as any)[dataType] = {
                    ...(newCache as any)[dataType],
                    [contextKey]: { data, lastFetched: now, isLoading: false }
                };
            }

            return newCache;
        });

        // Persist to backend
        axios.put(`${API_BASE}/cache/${dataType}/${contextKey}`, {
            payload: data,
            source_info: sourceInfo
        }).catch(e => console.error(`Failed to persist cache for ${dataType}/${contextKey}`, e));
    }, []);

    const setLoading = useCallback((dataType: DataType, contextKey: string, isLoading: boolean) => {
        setCache(prev => {
            const newCache = { ...prev };

            if (['ssh_servers', 'keys', 'sync_pairs', 'batch_files', 'batch_groups', 'schedules'].includes(dataType)) {
                (newCache as any)[dataType] = { ...(newCache as any)[dataType], isLoading };
            } else {
                const existing = (newCache as any)[dataType][contextKey] || createEmptyEntry();
                (newCache as any)[dataType] = {
                    ...(newCache as any)[dataType],
                    [contextKey]: { ...existing, isLoading }
                };
            }

            return newCache;
        });
    }, []);

    const invalidate = useCallback((dataType: DataType, contextKey?: string) => {
        setCache(prev => {
            const newCache = { ...prev };

            if (['ssh_servers', 'keys', 'sync_pairs', 'batch_files', 'batch_groups', 'schedules'].includes(dataType)) {
                (newCache as any)[dataType] = createEmptyEntry();
            } else if (contextKey) {
                const typeData = { ...(newCache as any)[dataType] };
                delete typeData[contextKey];
                (newCache as any)[dataType] = typeData;
            } else {
                (newCache as any)[dataType] = {};
            }

            return newCache;
        });

        // Invalidate in backend
        const endpoint = contextKey
            ? `${API_BASE}/cache/${dataType}/${contextKey}`
            : `${API_BASE}/cache?data_type=${dataType}`;
        axios.delete(endpoint).catch(e => console.error(`Failed to invalidate cache for ${dataType}`, e));
    }, []);

    const refreshAll = useCallback(async () => {
        // Clear all cache
        setCache(initialCacheState);

        try {
            await axios.delete(`${API_BASE}/cache`);
        } catch (e) {
            console.error('Failed to clear backend cache', e);
        }
    }, []);

    return (
        <IsyncDataContext.Provider value={{
            cache,
            getCached,
            setCached,
            setLoading,
            invalidate,
            refreshAll,
            // Legacy support
            driveManager,
            setDriveManager,
            rcloneManager,
            setRcloneManager,
        }}>
            {children}
        </IsyncDataContext.Provider>
    );
};

// --- Hook ---

export const useIsyncData = () => {
    const context = useContext(IsyncDataContext);
    if (!context) {
        throw new Error('useIsyncData must be used within an IsyncDataProvider');
    }
    return context;
};

// --- Utility Hook for Cache Status ---

export const useCacheStatus = (dataType: DataType, contextKey: string = 'local') => {
    const { getCached, setLoading } = useIsyncData();
    const entry = getCached(dataType, contextKey);

    const getTimeAgo = (timestamp: number | null): string => {
        if (!timestamp) return 'Never';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    return {
        data: entry?.data || [],
        lastFetched: entry?.lastFetched || null,
        isLoading: entry?.isLoading || false,
        timeAgo: getTimeAgo(entry?.lastFetched || null),
        hasData: (entry?.data?.length || 0) > 0,
    };
};
