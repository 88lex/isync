import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Pause, Play, Clock, AlertCircle, Server, ChevronDown, ChevronUp, FileCode, CheckCircle, RefreshCw, X } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Card } from '../components/Card';
import { formatDate } from '../utils/formatters';
import {
    fetchSchedules,
    createSchedule,
    deleteSchedule,
    pauseSchedule,
    resumeSchedule,
    Schedule,
    CreateScheduleRequest,
    fetchSSHServers,
    SSHServer,
    getCronPresets,
    CronPreset,
    getServerCrontab,
    initServerCrontab,
    addCrontabEntry,
    deleteCrontabEntry,
    generateCrontabFile,
    CrontabConfig,
    CrontabEntry,
    listSavedBatches,
    listBatchGroups,
    BatchFile,
    BatchGroup,
    installCrontab
} from '../api';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useDataTable } from '../hooks/useDataTable';

// Common cron presets
const CRON_PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every day at midnight', value: '0 0 * * *' },
    { label: 'Every day at 2 AM', value: '0 2 * * *' },
    { label: 'Every day at 6 AM', value: '0 6 * * *' },
    { label: 'Every Sunday at midnight', value: '0 0 * * 0' },
    { label: 'Every Monday at 3 AM', value: '0 3 * * 1' },
    { label: 'First of month at midnight', value: '0 0 1 * *' },
];

interface SchedulesPageProps {
    activeSection?: string | null;
}

const SchedulesPage: React.FC<SchedulesPageProps> = ({ activeSection }) => {
    // Scroll to section when activeSection changes
    useEffect(() => {
        if (activeSection) {
            const element = document.getElementById(activeSection);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [activeSection]);

    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);

    // Form state
    const [formName, setFormName] = useState('');
    const [formSource, setFormSource] = useState('');
    const [formDest, setFormDest] = useState('');
    const [formCron, setFormCron] = useState('0 2 * * *');
    const [formDryRun, setFormDryRun] = useState(false);
    const [formSubmitting, setFormSubmitting] = useState(false);

    // Remote Crontab State
    const [showRemoteSection, setShowRemoteSection] = useState(true);
    const [servers, setServers] = useState<SSHServer[]>([]);
    const [selectedServer, setSelectedServer] = useState<SSHServer | null>(null);
    const [serverCrontab, setServerCrontab] = useState<CrontabConfig | null>(null);
    const [cronPresets, setCronPresets] = useState<CronPreset[]>([]);
    const [savedBatches, setSavedBatches] = useState<BatchFile[]>([]);
    const [batchGroups, setBatchGroups] = useState<BatchGroup[]>([]);
    const [remoteCronLoading, setRemoteCronLoading] = useState(false);

    // New crontab entry form
    const [showCronEntryForm, setShowCronEntryForm] = useState(false);
    const [cronEntryType, setCronEntryType] = useState<'batch' | 'group'>('batch');
    const [cronEntryCommand, setCronEntryCommand] = useState('');
    const [cronEntryCron, setCronEntryCron] = useState('0 0 * * *');
    const [cronEntryAnnotation, setCronEntryAnnotation] = useState('');

    const loadRemoteData = async () => {
        try {
            const srvs = await fetchSSHServers();
            setServers(srvs || []);
        } catch (e) { console.error('Failed to load servers', e); }

        try {
            const presets = await getCronPresets();
            setCronPresets(presets.presets || []);
        } catch (e) { console.error('Failed to load cron presets', e); }

        try {
            const batches = await listSavedBatches();
            setSavedBatches(batches || []);
        } catch (e) { console.error('Failed to load saved batches', e); }

        try {
            const groups = await listBatchGroups();
            setBatchGroups(groups || []);
        } catch (e) { console.error('Failed to load batch groups', e); }
    };

    const loadServerCrontab = async (server: SSHServer) => {
        setSelectedServer(server);
        setRemoteCronLoading(true);
        try {
            let config = await getServerCrontab(server.id);
            if (!config.entries) {
                await initServerCrontab(server.id, server.name);
                config = await getServerCrontab(server.id);
            }
            setServerCrontab(config);
        } catch (e: any) {
            console.error('Failed to load crontab', e);
        } finally {
            setRemoteCronLoading(false);
        }
    };

    const handleAddCronEntry = async () => {
        if (!selectedServer || !cronEntryCommand || !cronEntryCron) return;
        setRemoteCronLoading(true);
        try {
            await addCrontabEntry(selectedServer.id, {
                command_type: cronEntryType,
                command_name: cronEntryCommand,
                cron_expression: cronEntryCron,
                annotation: cronEntryAnnotation
            });
            setCronEntryCommand('');
            setCronEntryCron('0 0 * * *');
            setCronEntryAnnotation('');
            setShowCronEntryForm(false);
            await loadServerCrontab(selectedServer);
        } catch (e: any) {
            alert(`Failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setRemoteCronLoading(false);
        }
    };

    const handleDeleteCronEntry = async (entryId: string) => {
        if (!selectedServer || !confirm('Delete this crontab entry?')) return;
        try {
            await deleteCrontabEntry(selectedServer.id, entryId);
            await loadServerCrontab(selectedServer);
        } catch (e: any) {
            alert(`Failed: ${e.message}`);
        }
    };

    const handleGenerateCrontab = async () => {
        if (!selectedServer) return;
        setRemoteCronLoading(true);
        try {
            const result = await generateCrontabFile(selectedServer.id);
            alert(`✅ Crontab generated!\n${result.entry_count} entries`);
        } catch (e: any) {
            alert(`Failed: ${e.message}`);
        } finally {
            setRemoteCronLoading(false);
        }
    };

    const handleInstallCrontab = async () => {
        if (!selectedServer) return;
        if (!confirm(`Are you sure you want to install this crontab to ${selectedServer.name}? This will overwrite the existing crontab.`)) return;

        setRemoteCronLoading(true);
        try {
            await installCrontab(selectedServer.id);
            alert('Crontab installed successfully!');
        } catch (e: any) {
            alert(`Failed to install: ${e.message}`);
        } finally {
            setRemoteCronLoading(false);
        }
    };

    const loadSchedules = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchSchedules();
            if (data.error) {
                setError(data.error);
            }
            setSchedules(data.schedules || []);
        } catch (err) {
            setError('Failed to fetch schedules');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSchedule = async () => {
        if (!formName || !formSource || !formDest || !formCron) {
            alert('Please fill in all required fields');
            return;
        }

        setFormSubmitting(true);
        try {
            const req: CreateScheduleRequest = {
                name: formName,
                source: formSource,
                dest: formDest,
                cron_expression: formCron,
                dry_run: formDryRun,
            };

            await createSchedule(req);
            setFormName('');
            setFormSource('');
            setFormDest('');
            setFormCron('0 2 * * *');
            setFormDryRun(false);
            setShowForm(false);
            loadSchedules();
        } catch (err: any) {
            console.error(err);
            alert(err.response?.data?.detail || 'Failed to create schedule');
        } finally {
            setFormSubmitting(false);
        }
    };

    const handleDeleteSchedule = async (id: string) => {
        if (!confirm('Are you sure you want to delete this schedule?')) return;
        try {
            await deleteSchedule(id);
            loadSchedules();
        } catch (err) {
            console.error(err);
        }
    };

    const handleToggleSchedule = async (id: string, enabled: boolean) => {
        try {
            if (enabled) {
                await pauseSchedule(id);
            } else {
                await resumeSchedule(id);
            }
            loadSchedules();
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        loadSchedules();
        loadRemoteData();
    }, []);

    // Local Schedules DataTable
    const localColumns: ColumnConfig<Schedule>[] = [
        {
            key: 'enabled',
            header: 'Status',
            render: (enabled) => (
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-zinc-600'}`} />
                    <span className="text-xs text-zinc-400">{enabled ? 'Active' : 'Paused'}</span>
                </div>
            ),
            sortable: true,
            filterable: true
        },
        { key: 'name', header: 'Schedule Name', sortable: true },
        {
            key: 'cron_expression',
            header: 'Cron',
            render: (val, item) => (
                <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono">{val}</span>
                    {item.dry_run && <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded uppercase font-bold">Dry Run</span>}
                </div>
            ),
            sortable: true
        },
        {
            key: 'source',
            header: 'Source → Dest',
            render: (_, item) => (
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-blue-400 font-mono truncate max-w-[120px]">{item.source}</span>
                    <span className="text-zinc-500">→</span>
                    <span className="text-emerald-400 font-mono truncate max-w-[120px]">{item.dest}</span>
                </div>
            )
        },
        {
            key: 'next_run',
            header: 'Next Run',
            render: (val) => (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Clock size={12} />
                    {formatDate(val)}
                </div>
            ),
            sortable: true
        },
        {
            key: 'last_run',
            header: 'Last Run',
            render: (val) => <div className="text-xs text-zinc-500">{formatDate(val)}</div>,
            sortable: true
        },
        {
            key: 'actions',
            header: 'Actions',
            render: (_, item) => (
                <div className="flex gap-1">
                    <button
                        onClick={() => handleToggleSchedule(item.id, item.enabled)}
                        className={`p-1.5 rounded transition ${item.enabled ? 'text-yellow-400 hover:bg-yellow-400/10' : 'text-green-400 hover:bg-green-400/10'}`}
                        title={item.enabled ? 'Pause' : 'Resume'}
                    >
                        {item.enabled ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button
                        onClick={() => handleDeleteSchedule(item.id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition"
                        title="Delete"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            )
        }
    ];

    const localTable = useDataTable({
        data: schedules,
        columns: localColumns,
        persistentKey: 'local_schedules_list'
    });

    // Remote Crontab DataTable
    const remoteColumns: ColumnConfig<CrontabEntry>[] = [
        {
            key: 'command_type',
            header: 'Type',
            render: (val) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${val === 'batch' ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30' : 'bg-purple-600/20 text-purple-400 border border-purple-600/30'}`}>
                    {val}
                </span>
            ),
            sortable: true,
            filterable: true
        },
        { key: 'command_name', header: 'Command', sortable: true, render: (val) => <span className="text-white font-mono text-xs">{val}</span> },
        { key: 'cron_expression', header: 'Cron Expression', sortable: true, render: (val) => <span className="text-cyan-400 font-mono text-xs">{val}</span> },
        { key: 'annotation', header: 'Annotation', render: (val) => <span className="text-xs text-zinc-500 italic">{val || '-'}</span> },
        {
            key: 'actions',
            header: 'Actions',
            render: (_, item) => (
                <button
                    onClick={() => handleDeleteCronEntry(item.id)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition"
                    title="Delete"
                >
                    <Trash2 size={14} />
                </button>
            )
        }
    ];

    const remoteTable = useDataTable({
        data: serverCrontab?.entries || [],
        columns: remoteColumns,
        persistentKey: 'remote_crontab_list'
    });

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <LoadingSpinner size="lg" message="Loading schedules..." />
            </div>
        );
    }

    return (
        <div className="page-container pb-8">
            <PageHeader
                icon={Calendar}
                title="Scheduled Jobs"
                subtitle="Automate sync operations with cron-like scheduling"
                gradient="from-orange-600 to-amber-600"
            >
                <button
                    onClick={loadSchedules}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition text-sm flex items-center gap-2"
                >
                    <RefreshCw size={14} />
                    Refresh
                </button>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition text-sm"
                >
                    <Plus size={16} />
                    New Schedule
                </button>
            </PageHeader>

            {/* Error Message */}
            {error && (
                <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-center gap-3">
                    <AlertCircle className="text-yellow-500" size={20} />
                    <div>
                        <div className="text-yellow-400 font-medium">Scheduler Notice</div>
                        <div className="text-yellow-300/80 text-sm">{error}</div>
                    </div>
                </div>
            )}

            {/* Add Schedule Form */}
            {showForm && (
                <Card className="mb-6">
                    <h3 className="text-lg font-medium text-white mb-4">Create New Schedule</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Schedule Name *</label>
                            <input
                                type="text"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g., Daily Backup"
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Cron Expression *</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={formCron}
                                    onChange={(e) => setFormCron(e.target.value)}
                                    placeholder="0 2 * * *"
                                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                                />
                                <select
                                    onChange={(e) => e.target.value && setFormCron(e.target.value)}
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm"
                                >
                                    <option value="">Presets...</option>
                                    {CRON_PRESETS.map((p) => (
                                        <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Source Path *</label>
                            <input
                                type="text"
                                value={formSource}
                                onChange={(e) => setFormSource(e.target.value)}
                                placeholder="e.g., gdrive:MyFolder"
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Destination Path *</label>
                            <input
                                type="text"
                                value={formDest}
                                onChange={(e) => setFormDest(e.target.value)}
                                placeholder="e.g., backup:Archive"
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-4 mb-6">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={formDryRun}
                                onChange={(e) => setFormDryRun(e.target.checked)}
                                className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Dry Run (test without making changes)</span>
                        </label>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleCreateSchedule}
                            disabled={formSubmitting}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-bold transition shadow-lg shadow-blue-900/20"
                        >
                            {formSubmitting ? 'Creating...' : 'Create'}
                        </button>
                        <button
                            onClick={() => setShowForm(false)}
                            className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                        >
                            Cancel
                        </button>
                    </div>
                </Card>
            )}

            {/* Local Schedules Table */}
            <div id="local-schedules" className="space-y-4">
                <div className="flex items-center justify-between px-1">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Calendar size={18} className="text-blue-400" />
                        Local Schedules
                    </h2>
                </div>

                <div className="card p-0 overflow-hidden">
                    <DataTable
                        data={localTable.data}
                        columns={localColumns}
                        handleSort={localTable.handleSort}
                        SortIcon={localTable.SortIcon}
                        columnFilters={localTable.columnFilters}
                        onToggleColumnFilter={localTable.toggleColumnFilter}
                        onClearColumnFilter={localTable.clearColumnFilter}
                        getUniqueValues={localTable.getUniqueValues}
                        selectedItems={localTable.selectedItems}
                        onToggleItem={localTable.toggleItem}
                        onSelectAll={localTable.selectAll}
                        onInvertSelection={localTable.invertSelection}
                        emptyMessage="No local schedules found."
                    />
                </div>
            </div>

            {/* Remote Schedules Section */}
            <div id="remote-schedules" className="mt-12 space-y-4">
                <button
                    onClick={() => setShowRemoteSection(!showRemoteSection)}
                    className="flex items-center gap-2 text-lg font-bold text-cyan-400 hover:text-cyan-300 transition px-1"
                >
                    {showRemoteSection ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    <Server size={18} />
                    Remote Crontab Manager
                </button>

                {showRemoteSection && (
                    <div className="space-y-4">
                        <div className="flex gap-2 flex-wrap min-h-[40px]">
                            {servers.map((srv) => (
                                <button
                                    key={srv.id}
                                    onClick={() => loadServerCrontab(srv)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 border ${selectedServer?.id === srv.id
                                        ? 'bg-cyan-600 border-cyan-500 text-white shadow-lg shadow-cyan-900/20'
                                        : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                                        }`}
                                >
                                    <Server size={14} />
                                    {srv.name}
                                </button>
                            ))}
                            {servers.length === 0 && (
                                <div className="text-zinc-500 text-sm italic py-2 px-1 flex items-center gap-2">
                                    <AlertCircle size={14} />
                                    No SSH servers configured.
                                </div>
                            )}
                        </div>

                        {selectedServer && (
                            <div className="space-y-4">
                                <Card>
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex flex-col">
                                            <h3 className="font-bold text-white text-lg">
                                                Crontab: {selectedServer.name}
                                            </h3>
                                            <p className="text-xs text-zinc-500 font-mono">{selectedServer.host}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setShowCronEntryForm(true)}
                                                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-cyan-900/20"
                                            >
                                                <Plus size={14} /> Add Entry
                                            </button>
                                            <button
                                                onClick={handleGenerateCrontab}
                                                disabled={remoteCronLoading}
                                                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
                                            >
                                                <FileCode size={14} /> Preview
                                            </button>
                                            <button
                                                onClick={handleInstallCrontab}
                                                disabled={remoteCronLoading}
                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-emerald-900/20"
                                            >
                                                <CheckCircle size={14} /> Install to Server
                                            </button>
                                        </div>
                                    </div>

                                    {remoteCronLoading ? (
                                        <div className="text-center py-12">
                                            <LoadingSpinner size="md" message="Refreshing crontab..." />
                                        </div>
                                    ) : (
                                        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/20">
                                            <DataTable
                                                data={remoteTable.data}
                                                columns={remoteColumns}
                                                handleSort={remoteTable.handleSort}
                                                SortIcon={remoteTable.SortIcon}
                                                columnFilters={remoteTable.columnFilters}
                                                onToggleColumnFilter={remoteTable.toggleColumnFilter}
                                                onClearColumnFilter={remoteTable.clearColumnFilter}
                                                getUniqueValues={remoteTable.getUniqueValues}
                                                selectedItems={remoteTable.selectedItems}
                                                onToggleItem={remoteTable.toggleItem}
                                                onSelectAll={remoteTable.selectAll}
                                                onInvertSelection={remoteTable.invertSelection}
                                                emptyMessage="No crontab entries for this server."
                                            />
                                        </div>
                                    )}

                                    {/* Add Entry Modal/Form */}
                                    {showCronEntryForm && (
                                        <div className="mt-8 p-6 bg-zinc-900/50 rounded-xl border border-zinc-700 shadow-xl">
                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="text-sm font-bold text-white uppercase tracking-wider">New Crontab Entry</h4>
                                                <button onClick={() => setShowCronEntryForm(false)} className="text-zinc-500 hover:text-white transition">
                                                    <X size={18} />
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                                <div>
                                                    <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Execution Type</label>
                                                    <select
                                                        value={cronEntryType}
                                                        onChange={(e) => setCronEntryType(e.target.value as 'batch' | 'group')}
                                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                                                    >
                                                        <option value="batch">Single Batch File</option>
                                                        <option value="group">Batch Group (Parallel)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Select Target</label>
                                                    <select
                                                        value={cronEntryCommand}
                                                        onChange={(e) => setCronEntryCommand(e.target.value)}
                                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                                                    >
                                                        <option value="">Choose a command...</option>
                                                        {cronEntryType === 'batch'
                                                            ? savedBatches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)
                                                            : batchGroups.map((g) => <option key={g.id} value={`group_${g.name.replace(/\s+/g, '_').toLowerCase()}.sh`}>{g.name}</option>)
                                                        }
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                                <div>
                                                    <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Cron Schedule</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={cronEntryCron}
                                                            onChange={(e) => setCronEntryCron(e.target.value)}
                                                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
                                                            placeholder="* * * * *"
                                                        />
                                                        <select
                                                            onChange={(e) => e.target.value && setCronEntryCron(e.target.value)}
                                                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-xs text-white"
                                                        >
                                                            <option value="">Quick Presets...</option>
                                                            {cronPresets.map((p) => <option key={p.expression} value={p.expression}>{p.name}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider font-bold">Annotation</label>
                                                    <input
                                                        type="text"
                                                        value={cronEntryAnnotation}
                                                        onChange={(e) => setCronEntryAnnotation(e.target.value)}
                                                        placeholder="e.g., Nightly sync of marketing data"
                                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handleAddCronEntry}
                                                    disabled={!cronEntryCommand || !cronEntryCron}
                                                    className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition shadow-lg shadow-cyan-900/20"
                                                >
                                                    Add Entry
                                                </button>
                                                <button
                                                    onClick={() => setShowCronEntryForm(false)}
                                                    className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm transition"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </Card>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SchedulesPage;
