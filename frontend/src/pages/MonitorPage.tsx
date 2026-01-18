import React, { useState, useEffect } from 'react';
import {
    Activity, AlertTriangle, CheckCircle, RefreshCw, Plus,
    ChevronRight, HardDrive, Loader2, XCircle
} from 'lucide-react';
import {
    runCapacityCheck,
    getActiveAlerts,
    resolveAlert,
    listUnionGroups,
    expandUnionGroup,
    CapacityCheckResult,
    CapacityAlert,
    UnionGroupInfo
} from '../api';
import { Button } from '../components/ui';

const MonitorPage: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [scanResult, setScanResult] = useState<CapacityCheckResult | null>(null);
    const [alerts, setAlerts] = useState<CapacityAlert[]>([]);
    const [unionGroups, setUnionGroups] = useState<UnionGroupInfo[]>([]);
    const [expandingId, setExpandingId] = useState<number | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadData = async () => {
        try {
            const [alertRes, unionRes] = await Promise.all([
                getActiveAlerts(),
                listUnionGroups()
            ]);
            setAlerts(alertRes.alerts);
            setUnionGroups(unionRes.groups);
        } catch (err) {
            console.error('Failed to load data:', err);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleRunCheck = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const result = await runCapacityCheck();
            setScanResult(result);
            if (result.alerts_created > 0) {
                setMessage({ type: 'error', text: `${result.alerts_created} new alert(s) created!` });
            } else {
                setMessage({ type: 'success', text: `Scanned ${result.drives_scanned} drives. All OK.` });
            }
            await loadData();
        } catch (err) {
            setMessage({ type: 'error', text: 'Capacity check failed.' });
        } finally {
            setLoading(false);
        }
    };

    const handleResolve = async (alertId: number) => {
        try {
            await resolveAlert(alertId);
            setAlerts(prev => prev.filter(a => a.id !== alertId));
        } catch (err) {
            console.error('Failed to resolve alert:', err);
        }
    };

    const handleExpand = async (unionId: number) => {
        setExpandingId(unionId);
        try {
            const result = await expandUnionGroup(unionId);
            if (result.status === 'ok') {
                setMessage({ type: 'success', text: `Created new drive: ${result.new_drive?.name}` });
                await loadData();
            } else {
                setMessage({ type: 'error', text: result.message || 'Expansion failed' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Expansion failed.' });
        } finally {
            setExpandingId(null);
        }
    };

    const getAlertLevel = (fileCount: number): 'ok' | 'warning' | 'critical' => {
        if (fileCount >= 380000) return 'critical';
        if (fileCount >= 320000) return 'warning';
        return 'ok';
    };

    const alertLevelColors = {
        ok: 'text-emerald-400',
        warning: 'text-amber-400',
        critical: 'text-red-400'
    };

    return (
        <div className="page-container">
            {/* Header */}
            <header className="page-header">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center">
                        <Activity size={16} className="text-white" />
                    </div>
                    <div>
                        <h1 className="page-title">Capacity Monitor</h1>
                        <p className="text-xs text-zinc-400">On-demand health checks</p>
                    </div>
                </div>
                <Button
                    onClick={handleRunCheck}
                    loading={loading}
                    icon={<RefreshCw size={14} />}
                >
                    Run Health Check
                </Button>
            </header>

            {/* Message */}
            {message && (
                <div className={`p-2.5 rounded-lg flex items-center gap-2 text-sm mb-4 ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                    {message.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Alerts Section */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title flex items-center gap-1.5">
                            <AlertTriangle size={14} className="text-amber-400" />
                            Active Alerts ({alerts.length})
                        </h2>
                    </div>
                    {alerts.length === 0 ? (
                        <div className="text-zinc-500 text-xs py-4 text-center">No active alerts</div>
                    ) : (
                        <div className="space-y-2">
                            {alerts.map(alert => (
                                <div key={alert.id} className="flex items-center justify-between p-2 bg-zinc-800/50 rounded border border-zinc-700 text-xs">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle size={14} className="text-amber-400" />
                                        <div>
                                            <div className="font-medium text-zinc-200">{alert.drive_name}</div>
                                            <div className="text-zinc-500">{alert.message}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Button variant="ghost" size="xs" onClick={() => handleResolve(alert.id)}>Dismiss</Button>
                                        <Button variant="primary" size="xs" icon={<Plus size={10} />}>Expand</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Scan Results */}
                {scanResult && (
                    <div className="card">
                        <div className="card-header">
                            <h2 className="card-title">Last Scan</h2>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="p-2 bg-zinc-800 rounded">
                                <div className="text-lg font-bold text-zinc-100">{scanResult.drives_scanned}</div>
                                <div className="text-xs text-zinc-500">Scanned</div>
                            </div>
                            <div className="p-2 bg-zinc-800 rounded">
                                <div className={`text-lg font-bold ${scanResult.alerts_created > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {scanResult.alerts_created}
                                </div>
                                <div className="text-xs text-zinc-500">Alerts</div>
                            </div>
                            <div className="p-2 bg-zinc-800 rounded">
                                <div className={`text-lg font-bold ${scanResult.errors.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {scanResult.errors.length}
                                </div>
                                <div className="text-xs text-zinc-500">Errors</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Union Groups Section */}
            <div className="card mt-4">
                <div className="card-header">
                    <h2 className="card-title flex items-center gap-1.5">
                        <HardDrive size={14} />
                        Union Groups ({unionGroups.length})
                    </h2>
                </div>
                {unionGroups.length === 0 ? (
                    <div className="text-zinc-500 text-xs py-4 text-center">No Union Groups defined</div>
                ) : (
                    <div className="space-y-3">
                        {unionGroups.map(group => (
                            <div key={group.id} className="p-3 bg-zinc-800/50 rounded border border-zinc-700">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <div className="font-semibold text-sm text-zinc-100">{group.name}</div>
                                        <div className="text-xs text-zinc-500">{group.drive_count} drives • {group.remote_name}</div>
                                    </div>
                                    <Button
                                        onClick={() => handleExpand(group.id)}
                                        loading={expandingId === group.id}
                                        size="sm"
                                        icon={<Plus size={12} />}
                                    >
                                        Add Drive
                                    </Button>
                                </div>
                                {group.drives.length > 0 && (
                                    <div className="space-y-1">
                                        {group.drives.map(drive => {
                                            const level = getAlertLevel(drive.file_count);
                                            return (
                                                <div key={drive.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-zinc-900/50">
                                                    <div className="flex items-center gap-1.5">
                                                        <ChevronRight size={12} className="text-zinc-600" />
                                                        <span className="text-zinc-300">{drive.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className={alertLevelColors[level]}>
                                                            {drive.file_count.toLocaleString()} files
                                                        </span>
                                                        {drive.is_full && (
                                                            <span className="badge badge-danger">FULL</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MonitorPage;
