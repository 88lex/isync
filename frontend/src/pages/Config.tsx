import { useEffect, useState } from 'react';
import { Save, RefreshCw, Server, Shield, Globe, Terminal, Upload, Download, Trash2, Plus, Activity, CheckCircle, Settings, Database, HardDrive, AlertCircle } from 'lucide-react';
import { approveSSH, fetchConfig, updateConfig, Config, DomainConfig, listProfiles, loadProfile, saveProfile, resetProfile, testSSH, testDomainAuth } from '../api';
import { Button, Input as UIInput, Select as UISelect, Textarea } from '../components/ui';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

type ConfigTab = 'general' | 'rclone' | 'domains' | 'advanced' | 'database';

// Database Maintenance Tab Component
interface DbStats {
    database_file: string;
    file_size_bytes: number;
    tables: Record<string, number>;
    last_modified: string;
}

interface MaintenanceResult {
    status: string;
    message?: string;
    [key: string]: any;
}

const DatabaseMaintenanceTab = () => {
    const [stats, setStats] = useState<DbStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<MaintenanceResult | null>(null);
    const [logDays, setLogDays] = useState(30);

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_BASE}/admin/maintenance/stats`);
            setStats(res.data);
        } catch (e: any) {
            console.error('Failed to load stats:', e);
        } finally {
            setLoading(false);
        }
    };

    const runAction = async (action: string, params?: any) => {
        setActionLoading(action);
        setLastResult(null);
        try {
            let res;
            if (action === 'check') {
                res = await axios.post(`${API_BASE}/admin/maintenance/check`);
            } else if (action === 'vacuum') {
                res = await axios.post(`${API_BASE}/admin/maintenance/vacuum`);
            } else if (action === 'clean-logs') {
                res = await axios.post(`${API_BASE}/admin/maintenance/clean-logs?days=${logDays}`);
            } else if (action === 'clean-cache') {
                res = await axios.post(`${API_BASE}/admin/maintenance/clean-cache`);
            } else if (action === 'validate') {
                res = await axios.post(`${API_BASE}/admin/maintenance/validate`);
            } else if (action === 'full') {
                res = await axios.post(`${API_BASE}/admin/maintenance/full?days=${logDays}`);
            }
            setLastResult(res?.data);
            await loadStats();
        } catch (e: any) {
            setLastResult({ status: 'error', message: e.message });
        } finally {
            setActionLoading(null);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    return (
        <div className="space-y-4">
            {/* Stats Card */}
            <section className="card">
                <div className="card-header">
                    <h2 className="card-title flex items-center gap-1.5">
                        <HardDrive size={14} className="text-blue-400" /> Database Statistics
                    </h2>
                    <Button variant="ghost" size="xs" onClick={loadStats} loading={loading} icon={<RefreshCw size={10} />}>Refresh</Button>
                </div>
                {stats ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-zinc-800/50 p-3 rounded">
                            <div className="text-xs text-zinc-500">File Size</div>
                            <div className="text-lg font-bold text-white">{formatBytes(stats.file_size_bytes)}</div>
                        </div>
                        <div className="bg-zinc-800/50 p-3 rounded">
                            <div className="text-xs text-zinc-500">SSH Servers</div>
                            <div className="text-lg font-bold text-cyan-400">{stats.tables.ssh_servers || 0}</div>
                        </div>
                        <div className="bg-zinc-800/50 p-3 rounded">
                            <div className="text-xs text-zinc-500">Schedules</div>
                            <div className="text-lg font-bold text-purple-400">{stats.tables.schedules || 0}</div>
                        </div>
                        <div className="bg-zinc-800/50 p-3 rounded">
                            <div className="text-xs text-zinc-500">Cache Entries</div>
                            <div className="text-lg font-bold text-amber-400">{stats.tables.data_cache || 0}</div>
                        </div>
                        <div className="col-span-2 md:col-span-4 text-xs text-zinc-500">
                            Last Modified: {stats.last_modified ? new Date(stats.last_modified).toLocaleString() : 'N/A'}
                        </div>
                    </div>
                ) : (
                    <div className="text-zinc-500 text-sm">Loading...</div>
                )}
            </section>

            {/* Maintenance Actions */}
            <section className="card">
                <div className="card-header">
                    <h2 className="card-title flex items-center gap-1.5">
                        <Activity size={14} className="text-green-400" /> Maintenance Actions
                    </h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => runAction('check')}
                        loading={actionLoading === 'check'}
                        icon={<CheckCircle size={12} />}
                    >
                        Integrity Check
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => runAction('validate')}
                        loading={actionLoading === 'validate'}
                        icon={<AlertCircle size={12} />}
                    >
                        Validate References
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => runAction('vacuum')}
                        loading={actionLoading === 'vacuum'}
                        icon={<HardDrive size={12} />}
                    >
                        Vacuum DB
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => runAction('clean-cache')}
                        loading={actionLoading === 'clean-cache'}
                        icon={<Trash2 size={12} />}
                    >
                        Clean Cache
                    </Button>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={logDays}
                            onChange={e => setLogDays(parseInt(e.target.value) || 30)}
                            className="input w-16 text-center"
                            min={1}
                        />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => runAction('clean-logs')}
                            loading={actionLoading === 'clean-logs'}
                            icon={<Trash2 size={12} />}
                        >
                            Clean Logs ({logDays}d)
                        </Button>
                    </div>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => runAction('full')}
                        loading={actionLoading === 'full'}
                        icon={<Activity size={12} />}
                    >
                        Full Maintenance
                    </Button>
                </div>
            </section>

            {/* Result Display */}
            {lastResult && (
                <section className="card">
                    <div className="card-header">
                        <h2 className={`card-title flex items-center gap-1.5 ${lastResult.status === 'healthy' || lastResult.status === 'success' ? 'text-green-400' : 'text-amber-400'}`}>
                            {lastResult.status === 'healthy' || lastResult.status === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                            Result: {lastResult.status}
                        </h2>
                    </div>
                    <pre className="bg-zinc-950 p-3 rounded text-xs font-mono text-zinc-300 overflow-x-auto max-h-48 overflow-y-auto">
                        {JSON.stringify(lastResult, null, 2)}
                    </pre>
                </section>
            )}
        </div>
    );
};

const ConfigPage = () => {

    const [config, setConfig] = useState<Config>({});
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [profiles, setProfiles] = useState<string[]>([]);
    const [selectedProfile, setSelectedProfile] = useState("");
    const [newProfileName, setNewProfileName] = useState("");
    const [sshStatus, setSshStatus] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<ConfigTab>('general');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const c = await fetchConfig();
        setConfig(c);
        const p = await listProfiles();
        setProfiles(p);
        setDirty(false);
    };

    const handleChange = (key: string, val: any) => {
        setConfig(prev => ({ ...prev, [key]: val }));
        setDirty(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateConfig(config);
            setDirty(false);
            alert("Configuration saved!");
        } catch (e: any) {
            alert(`Save failed: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleLoadProfile = async () => {
        if (!selectedProfile) return;
        if (!confirm(`Load profile '${selectedProfile}'?`)) return;
        try {
            const newCfg = await loadProfile(selectedProfile);
            setConfig(newCfg);
            setDirty(false);
        } catch (e) { alert("Failed to load profile"); }
    };

    const handleSaveProfile = async () => {
        const name = newProfileName || selectedProfile;
        if (!name) return alert("Enter a name for the profile");
        try {
            await saveProfile(name);
            await loadData();
            alert(`Saved to ${name}`);
        } catch (e) { alert("Failed to save profile"); }
    };

    const handleReset = async () => {
        if (!confirm("Reset to defaults?")) return;
        await resetProfile();
        await loadData();
    };

    const updateDomain = (idx: number, field: keyof DomainConfig, val: string) => {
        const domains = [...(config.domains || [])];
        if (!domains[idx]) domains[idx] = { domain_name: '', admin_email: '', sa_json_path: '', group_email: '' };
        domains[idx] = { ...domains[idx], [field]: val };
        handleChange('domains', domains);
    };

    const addDomain = () => {
        const domains = [...(config.domains || [])];
        domains.push({ domain_name: '', admin_email: '', sa_json_path: '', group_email: '' });
        handleChange('domains', domains);
    };

    const removeDomain = (idx: number) => {
        const domains = [...(config.domains || [])];
        domains.splice(idx, 1);
        handleChange('domains', domains);
    };

    const handleTestSSH = async () => {
        setSshStatus("Testing...");
        const sshReq = {
            host: config.ssh_host || '',
            user: config.ssh_user,
            key_path: config.ssh_key_path,
            timeout: config.ssh_connect_timeout
        };
        try {
            const res = await testSSH(sshReq);
            if (res.status === 'success') {
                setSshStatus("✓ Connected");
            } else if (res.status === 'verification_required') {
                setSshStatus("⚠ Verify host");
                if (confirm(`Verify host fingerprint?\n${res.details}`)) {
                    await handleApproveSSH(sshReq);
                } else {
                    setSshStatus("✗ Cancelled");
                }
            } else {
                setSshStatus(`✗ ${res.message}`);
            }
        } catch (e: any) {
            setSshStatus(`✗ ${e.message}`);
        }
    };

    const handleApproveSSH = async (req: any) => {
        try {
            const res = await approveSSH(req);
            if (res.status === 'success') {
                await handleTestSSH();
            } else {
                setSshStatus(`✗ ${res.message}`);
            }
        } catch (e: any) {
            setSshStatus(`✗ ${e.message}`);
        }
    };

    const handleTestAuth = async () => {
        setAuthStatus(["Testing..."]);
        try {
            const res = await testDomainAuth();
            if (Array.isArray(res)) setAuthStatus(res);
            else setAuthStatus(["✓ All checks passed"]);
        } catch (e: any) {
            setAuthStatus([`✗ ${e.message}`]);
        }
    };

    const protectedUsersText = (config.protected_users || []).join('\n');
    const handleProtectedUsersChange = (text: string) => {
        handleChange('protected_users', text.split('\n').map(s => s.trim()).filter(Boolean));
    };

    const tabs: { id: ConfigTab; label: string; icon: React.ReactNode }[] = [
        { id: 'general', label: 'General', icon: <Activity size={14} /> },
        { id: 'rclone', label: 'Rclone', icon: <Terminal size={14} /> },
        { id: 'domains', label: 'Domains', icon: <Globe size={14} /> },
        { id: 'advanced', label: 'Advanced', icon: <Settings size={14} /> },
        { id: 'database', label: 'Database', icon: <Database size={14} /> },
    ];


    return (
        <div className="page-container pb-16">
            {/* Header */}
            <header className="page-header">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-orange-600 to-red-600 flex items-center justify-center">
                        <Settings size={16} className="text-white" />
                    </div>
                    <div>
                        <h1 className="page-title">Configuration</h1>
                        <p className="text-xs text-zinc-400">Settings & profiles</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => loadData()} icon={<RefreshCw size={12} />} />
                    <Button
                        variant={dirty ? 'success' : 'secondary'}
                        size="sm"
                        onClick={handleSave}
                        disabled={!dirty}
                        loading={saving}
                        icon={<Save size={12} />}
                    >
                        Save
                    </Button>
                </div>
            </header>

            {/* Profile Manager */}
            <section className="card mb-4">
                <div className="card-header">
                    <h2 className="card-title">Profile Manager</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex gap-2">
                        <select
                            value={selectedProfile}
                            onChange={e => setSelectedProfile(e.target.value)}
                            className="select flex-1"
                        >
                            <option value="">Select Profile...</option>
                            {profiles.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <Button variant="secondary" size="sm" onClick={handleLoadProfile} icon={<Upload size={12} />} />
                    </div>
                    <div className="flex gap-2">
                        <input
                            placeholder="New profile name"
                            value={newProfileName}
                            onChange={e => setNewProfileName(e.target.value)}
                            className="input flex-1"
                        />
                        <Button variant="secondary" size="sm" onClick={handleSaveProfile} icon={<Download size={12} />} />
                    </div>
                    <div className="flex items-center justify-end">
                        <button onClick={handleReset} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1">
                            <Trash2 size={12} /> Reset
                        </button>
                    </div>
                </div>
            </section>

            {/* Tab Navigation */}
            <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 mb-4">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition flex-1 justify-center ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div>
                {/* General Tab */}
                {activeTab === 'general' && (
                    <div className="space-y-4">
                        <section className="card">
                            <div className="card-header">
                                <h2 className="card-title flex items-center gap-1.5"><Activity size={14} className="text-blue-400" /> Limits & Core</h2>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <UIInput label="Upload Limit" value={config.upload_limit || ''} onChange={e => handleChange('upload_limit', e.target.value)} placeholder="700G" />
                                <UIInput label="Transfers" type="number" value={config.transfers || ''} onChange={e => handleChange('transfers', parseInt(e.target.value))} />
                                <UIInput label="Max Users/Cycle" type="number" value={config.max_users_per_cycle || ''} onChange={e => handleChange('max_users_per_cycle', parseInt(e.target.value))} />
                                <UISelect
                                    label="Rotation Strategy"
                                    value={config.rotation_strategy || 'standard'}
                                    onChange={e => handleChange('rotation_strategy', e.target.value)}
                                    options={[
                                        { value: 'standard', label: 'Temp Users' },
                                        { value: 'existing', label: 'Existing Users' }
                                    ]}
                                />
                                <UIInput label="Company Name" value={config.company_name || ''} onChange={e => handleChange('company_name', e.target.value)} />
                                <UIInput label="Users File" value={config.existing_users_file || ''} onChange={e => handleChange('existing_users_file', e.target.value)} />
                            </div>
                            <div className="mt-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={config.step_check || false} onChange={e => handleChange('step_check', e.target.checked)} className="checkbox" />
                                    <span className="text-xs text-zinc-300">Enable Step Check</span>
                                </label>
                            </div>
                        </section>

                        <section className="card">
                            <div className="card-header">
                                <h2 className="card-title flex items-center gap-1.5"><Shield size={14} className="text-purple-400" /> Safety</h2>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer mb-2">
                                <input type="checkbox" checked={config.include_protected_users || false} onChange={e => handleChange('include_protected_users', e.target.checked)} className="checkbox" />
                                <span className="text-xs text-zinc-300">Include Protected Users</span>
                            </label>
                            <Textarea
                                label="Protected Users (one per line)"
                                value={protectedUsersText}
                                onChange={e => handleProtectedUsersChange(e.target.value)}
                                rows={4}
                                className="font-mono"
                            />
                        </section>
                    </div>
                )}

                {/* Rclone Tab */}
                {activeTab === 'rclone' && (
                    <section className="card">
                        <div className="card-header">
                            <h2 className="card-title flex items-center gap-1.5"><Terminal size={14} className="text-yellow-400" /> Rclone Settings</h2>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <UISelect
                                label="Command"
                                value={config.rclone_command || 'copy'}
                                onChange={e => handleChange('rclone_command', e.target.value)}
                                options={[
                                    { value: 'copy', label: 'Copy' },
                                    { value: 'sync', label: 'Sync' },
                                    { value: 'move', label: 'Move' }
                                ]}
                            />
                            <UIInput label="Stall Timeout (min)" type="number" value={config.stall_timeout_minutes || ''} onChange={e => handleChange('stall_timeout_minutes', parseInt(e.target.value))} />
                            <UIInput label="Chunk Size" value={config.rclone_chunk_size || ''} onChange={e => handleChange('rclone_chunk_size', e.target.value)} />
                            <UIInput label="Stats Interval" value={config.rclone_stats_interval || ''} onChange={e => handleChange('rclone_stats_interval', e.target.value)} />
                            <div className="col-span-2">
                                <UIInput label="Global Flags" value={config.global_rclone_flags || ''} onChange={e => handleChange('global_rclone_flags', e.target.value)} />
                            </div>
                            <div className="col-span-2">
                                <UIInput label="Webhook URL" value={config.webhook_url || ''} onChange={e => handleChange('webhook_url', e.target.value)} />
                            </div>
                        </div>
                    </section>
                )}

                {/* Domains Tab */}
                {activeTab === 'domains' && (
                    <section className="card">
                        <div className="card-header">
                            <div className="flex items-center gap-2">
                                <h2 className="card-title flex items-center gap-1.5"><Globe size={14} className="text-cyan-400" /> Domains</h2>
                                <Button variant="ghost" size="xs" onClick={handleTestAuth} icon={<CheckCircle size={10} />}>Test API</Button>
                            </div>
                            <Button variant="ghost" size="xs" onClick={addDomain} icon={<Plus size={10} />}>Add</Button>
                        </div>

                        {authStatus.length > 0 && (
                            <div className="bg-zinc-950 p-2 rounded border border-zinc-800 text-xs font-mono mb-3 text-zinc-400">
                                {authStatus.map((s, i) => <div key={i}>{s}</div>)}
                            </div>
                        )}

                        <div className="space-y-3">
                            {(!config.domains || config.domains.length === 0) && <p className="text-zinc-600 text-xs italic">No domains configured.</p>}
                            {config.domains?.map((d, i) => (
                                <div key={i} className="bg-zinc-800/50 p-3 rounded border border-zinc-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-zinc-300">#{i + 1}: {d.domain_name || 'New'}</span>
                                        <button onClick={() => removeDomain(i)} className="text-zinc-500 hover:text-red-400 text-xs"><Trash2 size={12} /></button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <UIInput inputSize="sm" label="Domain Name" value={d.domain_name} onChange={e => updateDomain(i, 'domain_name', e.target.value)} />
                                        <UIInput inputSize="sm" label="Admin Email" value={d.admin_email} onChange={e => updateDomain(i, 'admin_email', e.target.value)} />
                                        <UIInput inputSize="sm" label="Group Email" value={d.group_email} onChange={e => updateDomain(i, 'group_email', e.target.value)} />
                                        <UIInput inputSize="sm" label="JSON Key Path" value={d.sa_json_path} onChange={e => updateDomain(i, 'sa_json_path', e.target.value)} />
                                        <div className="col-span-2">
                                            <UIInput inputSize="sm" label="Remote JSON Path (optional)" value={d.remote_sa_json_path || ''} onChange={e => updateDomain(i, 'remote_sa_json_path', e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Advanced Tab */}
                {activeTab === 'advanced' && (
                    <section className="card">
                        <div className="card-header">
                            <h2 className="card-title flex items-center gap-1.5"><Server size={14} className="text-green-400" /> SSH / Remote</h2>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={config.ssh_enabled || false} onChange={e => handleChange('ssh_enabled', e.target.checked)} className="checkbox" />
                                <span className="text-xs text-zinc-400">Enable</span>
                            </label>
                        </div>
                        <div className={`grid grid-cols-2 gap-3 ${!config.ssh_enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="col-span-2">
                                <UIInput label="SSH Host" value={config.ssh_host || ''} onChange={e => handleChange('ssh_host', e.target.value)} />
                            </div>
                            <UIInput label="SSH User" value={config.ssh_user || ''} onChange={e => handleChange('ssh_user', e.target.value)} />
                            <UIInput label="Key Path" value={config.ssh_key_path || ''} onChange={e => handleChange('ssh_key_path', e.target.value)} />
                            <div className="col-span-2">
                                <UIInput label="Remote Path" value={config.ssh_remote_path || ''} onChange={e => handleChange('ssh_remote_path', e.target.value)} />
                            </div>
                            <UIInput label="Timeout (s)" type="number" value={config.ssh_connect_timeout || ''} onChange={e => handleChange('ssh_connect_timeout', parseInt(e.target.value))} />
                            <div className="flex items-end gap-2">
                                <Button variant="secondary" size="sm" onClick={handleTestSSH} icon={<Terminal size={12} />}>Test</Button>
                                {sshStatus && <span className="text-xs font-mono text-zinc-400">{sshStatus}</span>}
                            </div>
                        </div>
                    </section>
                )}

                {/* Database Tab */}
                {activeTab === 'database' && <DatabaseMaintenanceTab />}
            </div>


            {/* Floating Save Bar */}
            {dirty && (
                <div className="fixed bottom-0 left-64 right-0 p-3 bg-zinc-900/95 border-t border-zinc-800 backdrop-blur flex justify-end gap-3 z-50">
                    <span className="self-center text-xs font-bold text-amber-400">Unsaved changes</span>
                    <Button variant="success" size="sm" onClick={handleSave} loading={saving} icon={<Save size={12} />}>
                        Save Changes
                    </Button>
                </div>
            )}
        </div>
    );
};

export default ConfigPage;
