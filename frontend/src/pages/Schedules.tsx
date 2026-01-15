import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Pause, Play, Clock, AlertCircle, Server, ChevronDown, ChevronUp, FileCode } from 'lucide-react';
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
            const [srvs, presets, batches, groups] = await Promise.all([
                fetchSSHServers(),
                getCronPresets(),
                listSavedBatches(),
                listBatchGroups()
            ]);
            setServers(srvs);
            setCronPresets(presets.presets);
            setSavedBatches(batches);
            setBatchGroups(groups);
        } catch (e) {
            console.error('Failed to load remote data', e);
        }
    };

    const loadServerCrontab = async (server: SSHServer) => {
        setSelectedServer(server);
        setRemoteCronLoading(true);
        try {
            let config = await getServerCrontab(server.id);
            if (!config.entries) {
                // Initialize if not exists
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
            // Show preview in console
            console.log('Generated crontab:', result.content);
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

            // Reset form and refresh
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

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <LoadingSpinner size="lg" message="Loading schedules..." />
            </div>
        );
    }

    return (
        <div className="p-8">
            <PageHeader
                icon={Calendar}
                title="Scheduled Jobs"
                subtitle="Automate sync operations with cron-like scheduling"
                gradient="from-orange-600 to-amber-600"
            >
                <button
                    onClick={loadSchedules}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition text-sm"
                >
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
                        <div className="text-yellow-300/60 text-xs mt-1">
                            Install APScheduler: <code className="bg-zinc-800 px-1 rounded">pip install apscheduler</code>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Form */}
            {showForm && (
                <Card className="mb-6">
                    <h3 className="text-lg font-medium text-white mb-4">Create New Schedule</h3>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Schedule Name *</label>
                            <input
                                type="text"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g., Daily Backup"
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Cron Expression *</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={formCron}
                                    onChange={(e) => setFormCron(e.target.value)}
                                    placeholder="0 2 * * *"
                                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono placeholder-zinc-500"
                                />
                                <select
                                    onChange={(e) => e.target.value && setFormCron(e.target.value)}
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                >
                                    <option value="">Presets...</option>
                                    {CRON_PRESETS.map((p) => (
                                        <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Source Path *</label>
                            <input
                                type="text"
                                value={formSource}
                                onChange={(e) => setFormSource(e.target.value)}
                                placeholder="e.g., gdrive:MyFolder"
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono placeholder-zinc-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Destination Path *</label>
                            <input
                                type="text"
                                value={formDest}
                                onChange={(e) => setFormDest(e.target.value)}
                                placeholder="e.g., backup:Archive"
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono placeholder-zinc-500"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-4 mb-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formDryRun}
                                onChange={(e) => setFormDryRun(e.target.checked)}
                                className="w-4 h-4 rounded bg-zinc-800 border-zinc-700"
                            />
                            <span className="text-sm text-zinc-300">Dry Run (test without making changes)</span>
                        </label>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleCreateSchedule}
                            disabled={formSubmitting}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
                        >
                            {formSubmitting ? 'Creating...' : 'Create Schedule'}
                        </button>
                        <button
                            onClick={() => setShowForm(false)}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                        >
                            Cancel
                        </button>
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {schedules.length === 0 && !error && (
                <EmptyState
                    icon={Calendar}
                    title="No scheduled jobs"
                    description="Create a schedule to automate your sync operations."
                    action={{
                        label: 'Create First Schedule',
                        onClick: () => setShowForm(true)
                    }}
                />
            )}

            {/* Schedules List */}
            <div id="local-schedules" className="space-y-3">
                {schedules.map((schedule) => (
                    <Card
                        key={schedule.id}
                        padding="none"
                        className={schedule.enabled ? '' : 'opacity-60'}
                    >
                        <div className="p-4 flex items-center gap-4">
                            {/* Status Indicator */}
                            <div className={`w-3 h-3 rounded-full ${schedule.enabled ? 'bg-green-500' : 'bg-zinc-600'}`} />

                            {/* Main Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-white">{schedule.name}</span>
                                    <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono">
                                        {schedule.cron_expression}
                                    </span>
                                    {schedule.dry_run && (
                                        <span className="text-xs px-2 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">
                                            DRY RUN
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-blue-400 font-mono truncate" title={schedule.source}>
                                        {schedule.source}
                                    </span>
                                    <span className="text-zinc-500">→</span>
                                    <span className="text-emerald-400 font-mono truncate" title={schedule.dest}>
                                        {schedule.dest}
                                    </span>
                                </div>
                            </div>

                            {/* Timing Info */}
                            <div className="text-right text-sm w-48">
                                <div className="flex items-center gap-1 text-zinc-400 justify-end">
                                    <Clock size={14} />
                                    <span>Next: {formatDate(schedule.next_run)}</span>
                                </div>
                                <div className="text-zinc-500 text-xs">
                                    Last: {formatDate(schedule.last_run)}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleToggleSchedule(schedule.id, schedule.enabled)}
                                    className={`p-2 rounded-lg transition ${schedule.enabled
                                        ? 'bg-zinc-800 hover:bg-zinc-700 text-yellow-400'
                                        : 'bg-zinc-800 hover:bg-zinc-700 text-green-400'
                                        }`}
                                    title={schedule.enabled ? 'Pause' : 'Resume'}
                                >
                                    {schedule.enabled ? <Pause size={16} /> : <Play size={16} />}
                                </button>
                                <button
                                    onClick={() => handleDeleteSchedule(schedule.id)}
                                    className="p-2 bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400 rounded-lg transition"
                                    title="Delete"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Remote Schedules / Cronjobs Section */}
            <div id="remote-schedules" className="mt-8">
                <button
                    onClick={() => setShowRemoteSection(!showRemoteSection)}
                    className="flex items-center gap-2 text-lg font-bold text-cyan-400 mb-4 hover:text-cyan-300 transition"
                >
                    {showRemoteSection ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    <Server size={18} />
                    Remote Schedules / Cronjobs
                </button>

                {showRemoteSection && (
                    <div className="space-y-4">
                        {/* Server Selection */}
                        <div className="flex gap-2 flex-wrap">
                            {servers.map((srv) => (
                                <button
                                    key={srv.id}
                                    onClick={() => loadServerCrontab(srv)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${selectedServer?.id === srv.id
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                                        }`}
                                >
                                    {srv.name}
                                </button>
                            ))}
                            {servers.length === 0 && (
                                <div className="text-zinc-500 italic">No SSH servers configured. Add servers in Settings.</div>
                            )}
                        </div>

                        {/* Selected Server Crontab */}
                        {selectedServer && (
                            <Card>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-medium text-white">
                                        Crontab for {selectedServer.name}
                                    </h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setShowCronEntryForm(true)}
                                            className="flex items-center gap-1 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition"
                                        >
                                            <Plus size={14} /> Add Entry
                                        </button>
                                        <button
                                            onClick={handleGenerateCrontab}
                                            disabled={remoteCronLoading}
                                            className="flex items-center gap-1 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded text-xs font-medium transition"
                                        >
                                            <FileCode size={14} /> Generate
                                        </button>
                                        <button
                                            onClick={handleInstallCrontab}
                                            disabled={remoteCronLoading}
                                            className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-xs font-medium transition"
                                        >
                                            <Server size={14} /> Install
                                        </button>
                                    </div>
                                </div>

                                {remoteCronLoading ? (
                                    <div className="text-center py-4 text-zinc-500">Loading...</div>
                                ) : serverCrontab?.entries?.length === 0 ? (
                                    <div className="text-center py-4 text-zinc-500 italic">No crontab entries yet.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {serverCrontab?.entries?.map((entry) => (
                                            <div key={entry.id} className={`bg-zinc-800 rounded-lg p-3 ${!entry.enabled ? 'opacity-50' : ''}`}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${entry.command_type === 'batch' ? 'bg-amber-600/20 text-amber-400' : 'bg-purple-600/20 text-purple-400'
                                                            }`}>
                                                            {entry.command_type}
                                                        </span>
                                                        <span className="text-white font-mono text-sm">{entry.command_name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-cyan-400 font-mono text-sm">{entry.cron_expression}</span>
                                                        <button
                                                            onClick={() => handleDeleteCronEntry(entry.id)}
                                                            className="p-1 text-zinc-500 hover:text-red-400 transition"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                                {entry.annotation && (
                                                    <div className="text-xs text-zinc-500 mt-1">{entry.annotation}</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Add Entry Form */}
                                {showCronEntryForm && (
                                    <div className="mt-4 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                                        <h4 className="text-sm font-medium text-white mb-3">Add Crontab Entry</h4>
                                        <div className="grid grid-cols-2 gap-4 mb-3">
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Type</label>
                                                <select
                                                    value={cronEntryType}
                                                    onChange={(e) => setCronEntryType(e.target.value as 'batch' | 'group')}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
                                                >
                                                    <option value="batch">Batch</option>
                                                    <option value="group">Group</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Command</label>
                                                <select
                                                    value={cronEntryCommand}
                                                    onChange={(e) => setCronEntryCommand(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
                                                >
                                                    <option value="">Select...</option>
                                                    {cronEntryType === 'batch'
                                                        ? savedBatches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)
                                                        : batchGroups.map((g) => <option key={g.id} value={`group_${g.name.replace(/\s+/g, '_').toLowerCase()}.sh`}>{g.name}</option>)
                                                    }
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 mb-3">
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Cron Expression</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={cronEntryCron}
                                                        onChange={(e) => setCronEntryCron(e.target.value)}
                                                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm"
                                                    />
                                                    <select
                                                        onChange={(e) => e.target.value && setCronEntryCron(e.target.value)}
                                                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm text-white"
                                                    >
                                                        <option value="">Preset...</option>
                                                        {cronPresets.map((p) => <option key={p.expression} value={p.expression}>{p.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-zinc-500 mb-1">Annotation (optional)</label>
                                                <input
                                                    type="text"
                                                    value={cronEntryAnnotation}
                                                    onChange={(e) => setCronEntryAnnotation(e.target.value)}
                                                    placeholder="e.g., Daily backup"
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleAddCronEntry}
                                                disabled={!cronEntryCommand || !cronEntryCron}
                                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded text-sm font-medium transition"
                                            >
                                                Add Entry
                                            </button>
                                            <button
                                                onClick={() => setShowCronEntryForm(false)}
                                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm transition"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SchedulesPage;
