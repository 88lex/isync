import React, { useState, useEffect } from 'react';
import { History, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { StatusBadge } from '../components/StatusBadge';
import { formatDate, formatBytes, formatDuration } from '../utils/formatters';
import { fetchJobHistory, fetchJobLogs, JobRun, JobLog } from '../api';
import { Button } from '../components/ui';

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
        if (logs[runId]) return;
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
            <div className="page-container flex items-center justify-center min-h-[300px]">
                <LoadingSpinner size="lg" message="Loading history..." />
            </div>
        );
    }

    return (
        <div className="page-container">
            {/* Header */}
            <header className="page-header">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center">
                        <History size={16} className="text-white" />
                    </div>
                    <div>
                        <h1 className="page-title">Job History</h1>
                        <p className="text-xs text-zinc-400">{runs.length} jobs</p>
                    </div>
                </div>
                <Button variant="secondary" size="sm" onClick={loadHistory} icon={<RefreshCw size={12} />}>
                    Refresh
                </Button>
            </header>

            {/* Empty State */}
            {runs.length === 0 && (
                <div className="card text-center py-8">
                    <History size={32} className="mx-auto text-zinc-600 mb-2" />
                    <div className="text-zinc-400 text-sm">No job history yet</div>
                </div>
            )}

            {/* Job Table */}
            {runs.length > 0 && (
                <div className="card p-0 overflow-hidden">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th className="w-8"></th>
                                <th>Status</th>
                                <th>Source → Dest</th>
                                <th className="text-right">Transferred</th>
                                <th className="text-right">Users</th>
                                <th className="text-right">Duration</th>
                                <th className="text-right">Started</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => {
                                const isExpanded = expandedId === run.id;
                                return (
                                    <React.Fragment key={run.id}>
                                        <tr
                                            onClick={() => toggleExpand(run.id)}
                                            className={`cursor-pointer ${isExpanded ? 'bg-zinc-800/30' : ''}`}
                                        >
                                            <td className="w-8">
                                                {isExpanded ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
                                            </td>
                                            <td>
                                                <StatusBadge status={run.status} />
                                            </td>
                                            <td>
                                                <div className="font-mono text-xs truncate max-w-xs">
                                                    <span className="text-blue-400">{run.source}</span>
                                                    <span className="text-zinc-600 mx-1">→</span>
                                                    <span className="text-emerald-400">{run.dest}</span>
                                                </div>
                                            </td>
                                            <td className="text-right font-mono text-xs">{formatBytes(run.total_bytes_transferred)}</td>
                                            <td className="text-right">{run.users_processed}</td>
                                            <td className="text-right text-xs text-zinc-400">{formatDuration(run.started_at, run.ended_at)}</td>
                                            <td className="text-right text-xs text-zinc-500">{formatDate(run.started_at)}</td>
                                        </tr>
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={7} className="bg-zinc-900/50 p-3">
                                                    {run.error_message && (
                                                        <div className="mb-3 p-2 bg-red-500/10 border border-red-900/50 rounded text-xs">
                                                            <span className="text-red-400 font-medium">Error: </span>
                                                            <span className="text-red-300">{run.error_message}</span>
                                                        </div>
                                                    )}
                                                    <div className="text-xs text-zinc-500 uppercase mb-1">Logs</div>
                                                    {logsLoading === run.id ? (
                                                        <LoadingSpinner size="sm" message="Loading logs..." />
                                                    ) : (
                                                        <div className="max-h-48 overflow-y-auto bg-zinc-950 rounded p-2 font-mono text-xs space-y-0.5 scrollbar-thin">
                                                            {(logs[run.id] || []).length === 0 ? (
                                                                <div className="text-zinc-500">No logs available</div>
                                                            ) : (
                                                                (logs[run.id] || []).map(log => (
                                                                    <div key={log.id} className="flex gap-2">
                                                                        <span className="text-zinc-600 w-16 flex-shrink-0">
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
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default HistoryPage;
