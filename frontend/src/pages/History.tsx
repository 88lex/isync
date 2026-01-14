import React, { useState, useEffect } from 'react';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { Card } from '../components/Card';
import { formatDate, formatBytes, formatDuration } from '../utils/formatters';
import { fetchJobHistory, fetchJobLogs, JobRun, JobLog } from '../api';

const HistoryPage: React.FC = () => {
    const [runs, setRuns] = useState<JobRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [logs, setLogs] = useState<Record<number, JobLog[]>>({});
    const [logsLoading, setLogsLoading] = useState<number | null>(null);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const data = await fetchJobHistory(50);
            setRuns(data.runs || []);
        } catch (err) {
            console.error('Failed to fetch history:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadLogs = async (runId: number) => {
        if (logs[runId]) return; // Already loaded
        
        setLogsLoading(runId);
        try {
            const data = await fetchJobLogs(runId);
            setLogs(prev => ({ ...prev, [runId]: data.logs || [] }));
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLogsLoading(null);
        }
    };

    const toggleExpand = (runId: number) => {
        if (expandedId === runId) {
            setExpandedId(null);
        } else {
            setExpandedId(runId);
            loadLogs(runId);
        }
    };

    useEffect(() => {
        loadHistory();
    }, []);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <LoadingSpinner size="lg" message="Loading job history..." />
            </div>
        );
    }

    return (
        <div className="p-8">
            <PageHeader
                icon={History}
                title="Job History"
                subtitle="View past sync operations and logs"
                gradient="from-purple-600 to-indigo-600"
            >
                <button
                    onClick={loadHistory}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition text-sm"
                >
                    Refresh
                </button>
            </PageHeader>

            {/* Empty State */}
            {runs.length === 0 && (
                <EmptyState
                    icon={History}
                    title="No job history yet"
                    description="Run a sync job to see it appear here."
                />
            )}

            {/* Job List */}
            <div className="space-y-3">
                {runs.map(run => {
                    const isExpanded = expandedId === run.id;
                    
                    return (
                        <Card key={run.id} padding="none" className="overflow-hidden">
                            {/* Row Header */}
                            <div
                                onClick={() => toggleExpand(run.id)}
                                className="p-4 cursor-pointer hover:bg-zinc-800/50 transition flex items-center gap-4"
                            >
                                <button className="text-zinc-400">
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                </button>
                                
                                {/* Status Badge */}
                                <StatusBadge status={run.status} />
                                
                                {/* Source/Dest */}
                                <div className="flex-1 min-w-0">
                                    <div className="font-mono text-sm truncate text-blue-400" title={run.source}>
                                        {run.source}
                                    </div>
                                    <div className="font-mono text-sm truncate text-emerald-400" title={run.dest}>
                                        → {run.dest}
                                    </div>
                                </div>
                                
                                {/* Stats */}
                                <div className="text-right text-sm">
                                    <div className="text-zinc-300">{formatBytes(run.total_bytes_transferred)}</div>
                                    <div className="text-zinc-500 text-xs">{run.users_processed} users</div>
                                </div>
                                
                                {/* Duration */}
                                <div className="text-right text-sm w-24">
                                    <div className="text-zinc-400">{formatDuration(run.started_at, run.ended_at)}</div>
                                    <div className="text-zinc-500 text-xs">{formatDate(run.started_at)}</div>
                                </div>
                                
                                {run.dry_run && (
                                    <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 text-xs rounded">
                                        DRY RUN
                                    </span>
                                )}
                            </div>
                            
                            {/* Expanded Content */}
                            {isExpanded && (
                                <div className="border-t border-zinc-800 p-4 bg-zinc-950">
                                    {run.error_message && (
                                        <div className="mb-4 p-3 bg-red-500/10 border border-red-900/50 rounded-lg">
                                            <div className="text-red-400 text-sm font-medium mb-1">Error</div>
                                            <div className="text-red-300 text-sm">{run.error_message}</div>
                                        </div>
                                    )}
                                    
                                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Logs</div>
                                    
                                    {logsLoading === run.id ? (
                                        <LoadingSpinner size="sm" message="Loading logs..." />
                                    ) : (
                                        <div className="max-h-64 overflow-y-auto bg-zinc-900 rounded-lg p-3 font-mono text-xs space-y-1">
                                            {(logs[run.id] || []).length === 0 ? (
                                                <div className="text-zinc-500">No logs available</div>
                                            ) : (
                                                (logs[run.id] || []).map(log => (
                                                    <div key={log.id} className="flex gap-2">
                                                        <span className="text-zinc-600 w-20 flex-shrink-0">
                                                            {new Date(log.timestamp).toLocaleTimeString()}
                                                        </span>
                                                        <span className={
                                                            log.level === 'ERROR' ? 'text-red-400' :
                                                            log.level === 'WARNING' ? 'text-yellow-400' :
                                                            'text-zinc-300'
                                                        }>
                                                            {log.message}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};

export default HistoryPage;
