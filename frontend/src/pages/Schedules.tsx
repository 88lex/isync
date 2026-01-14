import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Pause, Play, Clock, AlertCircle } from 'lucide-react';
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
    CreateScheduleRequest 
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

const SchedulesPage: React.FC = () => {
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
            <div className="space-y-3">
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
                                    className={`p-2 rounded-lg transition ${
                                        schedule.enabled 
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
        </div>
    );
};

export default SchedulesPage;
