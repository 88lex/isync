/**
 * CacheStatus Component
 * Displays cache freshness with a refresh button.
 * Usage: <CacheStatus dataType="users" contextKey="example.com" onRefresh={handleRefresh} />
 */
import React from 'react';
import { RefreshCw, Clock } from 'lucide-react';
import { useCacheStatus, DataType } from '../contexts/IsyncDataContext';

interface CacheStatusProps {
    dataType: DataType;
    contextKey?: string;
    onRefresh: () => Promise<void> | void;
    label?: string;
    showLabel?: boolean;
    compact?: boolean;
}

export const CacheStatus: React.FC<CacheStatusProps> = ({
    dataType,
    contextKey = 'local',
    onRefresh,
    label,
    showLabel = true,
    compact = false
}) => {
    const { timeAgo, isLoading, hasData } = useCacheStatus(dataType, contextKey);
    const [refreshing, setRefreshing] = React.useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    };

    const isSpinning = isLoading || refreshing;

    if (compact) {
        return (
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Clock size={12} />
                <span>{timeAgo}</span>
                <button
                    onClick={handleRefresh}
                    disabled={isSpinning}
                    className="p-1 hover:bg-zinc-800 rounded transition disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw size={12} className={isSpinning ? 'animate-spin' : ''} />
                </button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-lg text-xs">
            {showLabel && (
                <span className="text-zinc-400 font-medium capitalize">
                    {label || dataType.replace('_', ' ')}
                </span>
            )}
            <div className="flex items-center gap-1.5 text-zinc-500">
                <Clock size={12} />
                <span className={hasData ? 'text-zinc-400' : 'text-amber-500/80'}>
                    {hasData ? timeAgo : 'Not loaded'}
                </span>
            </div>
            <button
                onClick={handleRefresh}
                disabled={isSpinning}
                className={`
                    flex items-center gap-1 px-2 py-0.5 rounded transition text-[10px] font-bold uppercase tracking-wider
                    ${isSpinning
                        ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                        : 'bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600 hover:text-white border border-cyan-500/30'
                    }
                `}
            >
                <RefreshCw size={10} className={isSpinning ? 'animate-spin' : ''} />
                {isSpinning ? 'Loading' : 'Refresh'}
            </button>
        </div>
    );
};

/**
 * RefreshAllButton Component
 * A button to trigger a full cache refresh across all datasets.
 */
interface RefreshAllButtonProps {
    onRefreshAll: () => Promise<void>;
    className?: string;
}

export const RefreshAllButton: React.FC<RefreshAllButtonProps> = ({ onRefreshAll, className }) => {
    const [refreshing, setRefreshing] = React.useState(false);

    const handleRefreshAll = async () => {
        setRefreshing(true);
        try {
            await onRefreshAll();
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <button
            onClick={handleRefreshAll}
            disabled={refreshing}
            className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition
                ${refreshing
                    ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                    : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30'
                }
                ${className || ''}
            `}
        >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh All'}
        </button>
    );
};
