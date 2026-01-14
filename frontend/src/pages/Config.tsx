import { useEffect, useState } from 'react';
import { Save, RefreshCw, Server, Shield, Globe, Terminal, Upload, Download, Trash2, Plus, Activity, CheckCircle, Settings, Key } from 'lucide-react';
import { approveSSH, fetchConfig, updateConfig, Config, DomainConfig, listProfiles, loadProfile, saveProfile, resetProfile, testSSH, testDomainAuth } from '../api';

type ConfigTab = 'general' | 'rclone' | 'domains' | 'advanced';

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

    // Initial Load
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
            alert("✅ Configuration Saved Successfully!");
        } catch (e: any) {
            alert(`❌ Save Failed: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    // Profiles
    const handleLoadProfile = async () => {
        if (!selectedProfile) return;
        if (!confirm(`Load profile '${selectedProfile}'? Unsaved changes will be lost.`)) return;
        try {
            const newCfg = await loadProfile(selectedProfile);
            setConfig(newCfg);
            setDirty(false);
            alert("Profile Loaded!");
        } catch (e) { alert("Failed to load profile"); }
    };

    const handleSaveProfile = async () => {
        const name = newProfileName || selectedProfile;
        if (!name) return alert("Enter a name for the profile");
        try {
            await saveProfile(name);
            await loadData(); // refresh list
            alert(`Saved to ${name}`);
        } catch (e) { alert("Failed to save profile"); }
    };

    const handleReset = async () => {
        if (!confirm("Reset to DEFAULTS? This cannot be undone.")) return;
        await resetProfile();
        await loadData();
    };

    // Domain Helpers
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

    // SSH Test
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
                setSshStatus("✅ Connected!");
            } else if (res.status === 'verification_required') {
                setSshStatus("⚠️ Waiting for approval...");
                if (confirm(`The authenticity of host '${config.ssh_host}' cannot be established.\nFingerprint: ${res.details}\n\nAre you sure you want to continue connecting?`)) {
                    await handleApproveSSH(sshReq);
                } else {
                    setSshStatus("❌ Connection aborted by user.");
                }
            } else {
                setSshStatus(`❌ ${res.message}`);
            }
        } catch (e: any) {
            setSshStatus(`❌ Error: ${e.message}`);
        }
    };

    const handleApproveSSH = async (req: any) => {
        setSshStatus("Approving host key...");
        try {
            const res = await approveSSH(req);
            if (res.status === 'success') {
                alert("Host key added! Retrying connection...");
                // Retry test immediately
                await handleTestSSH();
            } else {
                setSshStatus(`❌ Key add failed: ${res.message}`);
            }
        } catch (e: any) {
            setSshStatus(`❌ Error approving key: ${e.message}`);
        }
    };

    // Auth Test
    const handleTestAuth = async () => {
        setAuthStatus(["Testing APIs..."]);
        try {
            const res = await testDomainAuth();
            if (Array.isArray(res)) setAuthStatus(res);
            else setAuthStatus(["✅ All checks passed"]);
        } catch (e: any) {
            setAuthStatus([`❌ Error: ${e.message}`]);
        }
    };

    // Users List Parsing
    const protectedUsersText = (config.protected_users || []).join('\n');
    const handleProtectedUsersChange = (text: string) => {
        handleChange('protected_users', text.split('\n').map(s => s.trim()).filter(Boolean));
    };

    const tabs: { id: ConfigTab; label: string; icon: React.ReactNode }[] = [
        { id: 'general', label: 'General', icon: <Activity size={16} /> },
        { id: 'rclone', label: 'Rclone', icon: <Terminal size={16} /> },
        { id: 'domains', label: 'Domains', icon: <Globe size={16} /> },
        { id: 'advanced', label: 'Advanced', icon: <Settings size={16} /> },
    ];

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6 text-zinc-100 pb-20">
            {/* Header */}
            <header className="sticky top-0 bg-zinc-950/80 backdrop-blur-md pt-4 pb-4 border-b border-zinc-800 z-10 flex justify-between items-center -mx-8 px-8">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">Configuration</h1>
                    <p className="text-zinc-500 text-sm">Global settings, profiles, and integrations.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => loadData()} className="p-2 text-zinc-400 hover:text-white transition"><RefreshCw size={20} /></button>
                    <button
                        onClick={handleSave}
                        disabled={!dirty || saving}
                        className={`px-6 py-2 rounded-lg font-bold transition flex items-center gap-2 shadow-lg ${dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-500 opacity-50'}`}
                    >
                        <Save size={18} />
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </header>

            {/* Profile Manager - Always Visible */}
            <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4 border-b border-zinc-800 pb-2">Profile Manager</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-500">Load Profile</label>
                        <div className="flex gap-2">
                            <select
                                value={selectedProfile}
                                onChange={e => setSelectedProfile(e.target.value)}
                                className="bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm w-full outline-none focus:border-orange-500"
                            >
                                <option value="">Select Profile...</option>
                                {profiles.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <button onClick={handleLoadProfile} className="bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded text-zinc-300"><Upload size={16} /></button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-500">Save As</label>
                        <div className="flex gap-2">
                            <input
                                placeholder="New Profile Name"
                                value={newProfileName}
                                onChange={e => setNewProfileName(e.target.value)}
                                className="bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm w-full outline-none focus:border-orange-500"
                            />
                            <button onClick={handleSaveProfile} className="bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded text-zinc-300"><Download size={16} /></button>
                        </div>
                    </div>
                    <div className="flex items-end justify-end">
                        <button onClick={handleReset} className="text-red-400 hover:text-red-300 text-sm flex items-center gap-2">
                            <Trash2 size={14} /> Reset to Defaults
                        </button>
                    </div>
                </div>
            </section>

            {/* Tab Navigation */}
            <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition flex-1 justify-center ${activeTab === tab.id
                                ? 'bg-orange-500 text-white'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="animate-in fade-in duration-200">
                {/* General Tab */}
                {activeTab === 'general' && (
                    <div className="space-y-6">
                        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                            <h2 className="text-lg font-bold text-zinc-200 flex items-center gap-2"><Activity size={18} className="text-blue-400" /> Limits & Core</h2>
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="Upload Limit" value={config.upload_limit} onChange={(v: string) => handleChange('upload_limit', v)} placeholder="700G" />
                                <Input label="Rclone Transfers" type="number" value={config.transfers} onChange={(v: any) => handleChange('transfers', parseInt(v))} />
                                <Input label="Max Users / Cycle" type="number" value={config.max_users_per_cycle} onChange={(v: any) => handleChange('max_users_per_cycle', parseInt(v))} />
                                <Select label="Rotation Strategy" value={config.rotation_strategy} onChange={(v: string) => handleChange('rotation_strategy', v)}>
                                    <option value="standard">Temp Users (Create/Delete)</option>
                                    <option value="existing">Existing Users (Rotate)</option>
                                </Select>
                                <Input label="Company Name" value={config.company_name} onChange={(v: string) => handleChange('company_name', v)} />
                                <Input label="Users File" value={config.existing_users_file} onChange={(v: string) => handleChange('existing_users_file', v)} />
                            </div>
                            <div className="pt-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={config.step_check} onChange={e => handleChange('step_check', e.target.checked)} className="rounded bg-zinc-800 border-zinc-700 text-orange-500 focus:ring-0" />
                                    <span className="text-sm font-medium text-zinc-300">Enable Step Check (Pause before actions)</span>
                                </label>
                            </div>
                        </section>

                        {/* Safety */}
                        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                            <h2 className="text-lg font-bold text-zinc-200 flex items-center gap-2"><Shield size={18} className="text-purple-400" /> Safety</h2>
                            <label className="flex items-center gap-2 cursor-pointer mb-2">
                                <input type="checkbox" checked={config.include_protected_users} onChange={e => handleChange('include_protected_users', e.target.checked)} />
                                <span className="text-sm font-medium text-zinc-300">Include Protected Users in Rotation</span>
                            </label>
                            <div className="space-y-1">
                                <label className="block text-xs font-bold text-zinc-500 uppercase">Protected Users (One per line)</label>
                                <textarea
                                    value={protectedUsersText}
                                    onChange={e => handleProtectedUsersChange(e.target.value)}
                                    className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded p-2 text-sm focus:border-orange-500 outline-none font-mono"
                                />
                            </div>
                        </section>
                    </div>
                )}

                {/* Rclone Tab */}
                {activeTab === 'rclone' && (
                    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                        <h2 className="text-lg font-bold text-zinc-200 flex items-center gap-2"><Terminal size={18} className="text-yellow-400" /> Rclone Settings</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <Select label="Command Type" value={config.rclone_command} onChange={(v: string) => handleChange('rclone_command', v)}>
                                <option value="copy">Copy (Add Missing)</option>
                                <option value="sync">Sync (Mirror Source)</option>
                                <option value="move">Move (Delete Source)</option>
                            </Select>
                            <Input label="Stall Timeout (mins)" type="number" value={config.stall_timeout_minutes} onChange={(v: any) => handleChange('stall_timeout_minutes', parseInt(v))} />
                            <Input label="Chunk Size" value={config.rclone_chunk_size} onChange={(v: string) => handleChange('rclone_chunk_size', v)} />
                            <Input label="Stats Interval" value={config.rclone_stats_interval} onChange={(v: string) => handleChange('rclone_stats_interval', v)} />
                            <div className="col-span-2">
                                <Input label="Global Flags" value={config.global_rclone_flags} onChange={(v: string) => handleChange('global_rclone_flags', v)} placeholder="--s3-chunk-size=128M" />
                            </div>
                            <div className="col-span-2">
                                <Input label="Webhook URL" value={config.webhook_url} onChange={(v: string) => handleChange('webhook_url', v)} />
                            </div>
                        </div>
                    </section>
                )}

                {/* Domains Tab */}
                {activeTab === 'domains' && (
                    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                        <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                            <div className="flex items-center gap-4">
                                <h2 className="text-lg font-bold text-zinc-200 flex items-center gap-2"><Globe size={18} className="text-cyan-400" /> Workspace Domains</h2>
                                <button
                                    onClick={handleTestAuth}
                                    className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded text-zinc-300 flex items-center gap-2 transition"
                                >
                                    <CheckCircle size={14} className="text-green-500" /> Test API Permissions
                                </button>
                            </div>
                            <button onClick={addDomain} className="text-orange-500 hover:text-orange-400 text-sm flex items-center gap-1 font-bold"><Plus size={16} /> Add Domain</button>
                        </div>

                        {authStatus.length > 0 && (
                            <div className="bg-zinc-950 p-3 rounded border border-zinc-800 text-xs font-mono mb-4 text-zinc-400">
                                {authStatus.map((s, i) => <div key={i}>{s}</div>)}
                            </div>
                        )}

                        <div className="space-y-4">
                            {(!config.domains || config.domains.length === 0) && <p className="text-zinc-600 text-sm italic">No domains configured. Click "Add Domain" to get started.</p>}
                            {config.domains?.map((d, i) => (
                                <div key={i} className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-bold text-zinc-300">Domain #{i + 1}: {d.domain_name || 'New Domain'}</h3>
                                        <button onClick={() => removeDomain(i)} className="text-zinc-500 hover:text-red-500 text-xs flex items-center gap-1">
                                            <Trash2 size={12} /> Remove
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <Input label="Domain Name" value={d.domain_name} onChange={(v: string) => updateDomain(i, 'domain_name', v)} placeholder="example.com" />
                                        <Input label="Admin Email" value={d.admin_email} onChange={(v: string) => updateDomain(i, 'admin_email', v)} />
                                        <Input label="Group Email" value={d.group_email} onChange={(v: string) => updateDomain(i, 'group_email', v)} />
                                        <Input label="Local JSON Key" value={d.sa_json_path} onChange={(v: string) => updateDomain(i, 'sa_json_path', v)} />
                                        <div className="md:col-span-2">
                                            <Input label="Remote JSON Key Path" value={d.remote_sa_json_path} onChange={(v: string) => updateDomain(i, 'remote_sa_json_path', v)} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Advanced Tab */}
                {activeTab === 'advanced' && (
                    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-lg font-bold text-zinc-200 flex items-center gap-2"><Server size={18} className="text-green-400" /> SSH / Remote</h2>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={config.ssh_enabled} onChange={e => handleChange('ssh_enabled', e.target.checked)} />
                                <span className="text-xs uppercase font-bold text-zinc-500">Enable</span>
                            </label>
                        </div>

                        <div className={`grid grid-cols-2 gap-4 ${!config.ssh_enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="col-span-2"><Input label="SSH Host" value={config.ssh_host} onChange={(v: string) => handleChange('ssh_host', v)} /></div>
                            <Input label="SSH User" value={config.ssh_user} onChange={(v: string) => handleChange('ssh_user', v)} />
                            <Input label="SSH Key Path" value={config.ssh_key_path} onChange={(v: string) => handleChange('ssh_key_path', v)} />
                            <div className="col-span-2"><Input label="Remote ISync Path" value={config.ssh_remote_path} onChange={(v: string) => handleChange('ssh_remote_path', v)} /></div>
                            <Input label="Timeout (s)" type="number" value={config.ssh_connect_timeout} onChange={(v: any) => handleChange('ssh_connect_timeout', parseInt(v))} />
                            <div className="col-span-2 pt-2 flex items-center justify-between">
                                <button onClick={handleTestSSH} className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded text-zinc-200 text-sm font-bold flex items-center gap-2">
                                    <Terminal size={14} /> Test Connection
                                </button>
                                {sshStatus && <span className="text-sm font-mono">{sshStatus}</span>}
                            </div>
                        </div>
                    </section>
                )}
            </div>

            {/* Floating Bottom Bar for Visibility */}
            <div className={`fixed bottom-0 left-64 right-0 p-4 bg-zinc-950/90 border-t border-zinc-800 backdrop-blur flex justify-end gap-4 transition-transform duration-300 z-50 ${dirty ? 'translate-y-0' : 'translate-y-full'}`}>
                <span className="self-center text-sm font-bold text-orange-500 mr-4 animate-pulse">⚠️ Unsaved Changes</span>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-8 py-2 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-lg transition flex items-center gap-2"
                >
                    <Save size={18} />
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};

// UI Components for cleaner code
const Input = ({ label, value, onChange, type = "text", placeholder = "" }: any) => (
    <div>
        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">{label}</label>
        <input
            type={type}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm focus:border-orange-500 outline-none placeholder:text-zinc-700"
        />
    </div>
);

const Select = ({ label, value, onChange, children }: any) => (
    <div>
        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">{label}</label>
        <select
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm focus:border-orange-500 outline-none"
        >
            {children}
        </select>
    </div>
);

export default ConfigPage;
