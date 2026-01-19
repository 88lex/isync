import React, { useState, useEffect } from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { StatusBadge } from '../components/StatusBadge';
import { formatDate, formatBytes, formatDuration } from '../utils/formatters';
import { fetchJobHistory, fetchJobLogs, JobRun, JobLog } from '../api';
import { Button } from '../components/ui';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useDataTable } from '../hooks/useDataTable';

const JobLogsExpansion: React.FC<{
    run: JobRun;
    loadLogs: (id: number) => void;
    logs: JobLog[];
    loading: boolean;
}> = ({ run, loadLogs, logs, loading }) => {
    useEffect(() => {
        loadLogs(run.id);
    }, [run.id, loadLogs]);

    return (
        <div className="bg-zinc-900/50 p-3">
            {run.error_message && (
                <div className="mb-3 p-2 bg-red-500/10 border border-red-900/50 rounded text-xs">
                    <span className="text-red-400 font-medium">Error: </span>
                    <span className="text-red-300">{run.error_message}</span>
                </div>
            )}
            <div className="text-xs text-zinc-500 uppercase mb-1">Logs</div>
            {loading ? (
                <LoadingSpinner size="sm" message="Loading logs..." />
            ) : (
                <div className="max-h-48 overflow-y-auto bg-zinc-950 rounded p-2 font-mono text-xs space-y-0.5 scrollbar-thin">
                    {logs.length === 0 ? (
                        <div className="text-zinc-500">No logs available</div>
                    ) : (
                        logs.map(log => (
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
        </div>
    );
};

const HistoryPage: React.FC = () => {
    const [runs, setRuns] = useState<JobRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<Record<number, JobLog[]>>({});
    const [logsLoading, setLogsLoading] = useState<Record<number, boolean>>({});

    const loadHistory = async () => {
        setLoading(true);
        try {
            const data = await fetchJobHistory(100);
            setRuns(data.runs || []);
        } catch (err) {
            console.error('Failed to fetch history:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadLogs = async (runId: number) => {
        if (logs[runId]) return;
        setLogsLoading(prev => ({ ...prev, [runId]: true }));
        try {
            const data = await fetchJobLogs(runId);
            setLogs(prev => ({ ...prev, [runId]: data.logs || [] }));
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLogsLoading(prev => ({ ...prev, [runId]: false }));
        }
    };

    useEffect(() => {
        loadHistory();
    }, []);

    const columns: ColumnConfig<JobRun>[] = [
        {
            key: 'status',
            header: 'Status',
            render: (status) => <StatusBadge status={status} />,
            sortable: true,
            filterable: true
        },
        {
            key: 'source',
            header: 'Source → Dest',
            render: (_, run) => (
                <div className="font-mono text-xs truncate max-w-xs">
                    <span className="text-blue-400">{run.source}</span>
                    <span className="text-zinc-600 mx-1">→</span>
                    <span className="text-emerald-400">{run.dest}</span>
                </div>
            ),
            sortable: true
        },
        {
            key: 'total_bytes_transferred',
            header: 'Transferred',
            render: (bytes) => <div className="text-right font-mono text-xs">{formatBytes(bytes)}</div>,
            sortable: true
        },
        {
            key: 'users_processed',
            header: 'Users',
            render: (val) => <div className="text-right">{val}</div>,
            sortable: true
        },
        {
            key: 'duration',
            header: 'Duration',
            render: (_, run) => <div className="text-right text-xs text-zinc-400">{formatDuration(run.started_at || '', run.ended_at || '')}</div>,
            sortable: true
        },
        {
            key: 'started_at',
            header: 'Started',
            render: (val) => <div className="text-right text-xs text-zinc-500">{formatDate(val)}</div>,
            sortable: true
        }
    ];

    const {
        data: filteredRuns,
        handleSort,
        SortIcon,
        columnFilters,
        toggleColumnFilter,
        clearColumnFilter,
        getUniqueValues,
        selectedItems,
        toggleItem,
        selectAll,
        invertSelection
    } = useDataTable({
        data: runs,
        columns,
        initialSortColumn: 'started_at',
        initialSortDirection: 'desc',
        persistentKey: 'job_history_table'
    });

    if (loading) {
        return (
            <div className="page-container flex items-center justify-center min-h-[300px]">
                <LoadingSpinner size="lg" message="Loading history..." />
            </div>
        );
    }

    return (
        <div className="page-container">
            <header className="page-header">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center">
                        <History size={16} className="text-white" />
                    </div>
                    <div>
                        <h1 className="page-title">Job History</h1>
                        <p className="text-xs text-zinc-400">{runs.length} jobs retrieved</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={loadHistory} icon={<RefreshCw size={12} />}>
                        Refresh
                    </Button>
                </div>
            </header>

            <div className="card p-0 overflow-hidden">
                <DataTable<JobRun>
                    data={filteredRuns}
                    columns={columns}
                    handleSort={handleSort}
                    SortIcon={SortIcon}
                    columnFilters={columnFilters}
                    onToggleColumnFilter={toggleColumnFilter}
                    onClearColumnFilter={clearColumnFilter}
                    getUniqueValues={getUniqueValues}
                    selectedItems={selectedItems}
                    onToggleItem={toggleItem}
                    onSelectAll={selectAll}
                    onInvertSelection={invertSelection}
                    renderExpansion={(run) => (
                        <JobLogsExpansion
                            run={run as JobRun}
                            loadLogs={loadLogs}
                            logs={logs[run.id] || []}
                            loading={logsLoading[run.id] || false}
                        />
                    )}
                    emptyMessage="No job history matching filters."
                />
            </div>
        </div>
    );
};

export default HistoryPage;
