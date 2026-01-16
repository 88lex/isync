import { useState, useEffect, useMemo } from 'react';
import { HardDrive, Plus, Folder, Link, Settings, Check, ChevronDown, ChevronRight, AlertCircle, Play, RefreshCw, Cloud, Terminal, Users, Send, Zap, X, Server, Layers } from 'lucide-react';
import {
    fetchConfig, DomainConfig,
    listDrives, listKeys, KeyInfo, DriveInfo,
    createDrivesUnified, checkDriveMethods, DriveMethod, MethodsResponse, listDrivesUnified,
    RcloneRemote, listLocalRemotes, fetchSSHServers, SSHServer,
    testRcloneConnection, createDriveRemote, createUnionRemoteDirect, addDriveManagers, listKnownGroups,
    listUnionRemotes, getUnionDetails, expandUnion, UnionInfo, UnionDetails
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';

// Collapsible Panel Component
const Panel = ({
    title,
    icon: Icon,
    children,
    defaultOpen = true,
    status,
    statusColor = 'zinc'
}: {
    title: string;
    icon: any;
    children: React.ReactNode;
    defaultOpen?: boolean;
    status?: string;
    statusColor?: 'zinc' | 'emerald' | 'amber' | 'red';
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const colors = {
        zinc: 'text-zinc-500',
        emerald: 'text-emerald-400',
        amber: 'text-amber-400',
        red: 'text-red-400'
    };

    return (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800/50 transition text-left"
            >
                {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                <Icon size={16} className="text-violet-400" />
                <span className="text-sm font-medium text-white flex-1">{title}</span>
                {status && <span className={`text-xs ${colors[statusColor]}`}>{status}</span>}
            </button>
            {isOpen && <div className="px-4 pb-4 space-y-3">{children}</div>}
        </div>
    );
};

// Drive Preview Card
const DriveCard = ({
    name,
    driveId,
    status,
    groups,
    saFile
}: {
    name: string;
    driveId?: string;
    status: 'pending' | 'created' | 'remote_ok' | 'error';
    groups?: string[];
    saFile?: string;
}) => {
    const statusConfig = {
        pending: { icon: '⏳', color: 'border-zinc-600 bg-zinc-800/60', text: 'Pending', textColor: 'text-zinc-400' },
        created: { icon: '✓', color: 'border-amber-600 bg-amber-900/30', text: 'Drive Created', textColor: 'text-amber-400' },
        remote_ok: { icon: '🔗', color: 'border-emerald-600 bg-emerald-900/30', text: 'Remote OK', textColor: 'text-emerald-400' },
        error: { icon: '✗', color: 'border-red-600 bg-red-900/30', text: 'Error', textColor: 'text-red-400' }
    };
    const cfg = statusConfig[status];

    return (
        <div className={`border rounded-lg p-4 ${cfg.color}`}>
            <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{cfg.icon}</span>
                <span className="font-mono text-white text-base font-semibold">{name}</span>
                <span className={`ml-auto text-xs ${cfg.textColor}`}>{cfg.text}</span>
            </div>
            <div className="text-xs text-zinc-300 space-y-1 font-mono bg-zinc-900/50 rounded p-2">
                <div><span className="text-zinc-500">type</span> = <span className="text-cyan-400">drive</span></div>
                <div><span className="text-zinc-500">scope</span> = <span className="text-cyan-400">drive</span></div>
                <div><span className="text-zinc-500">team_drive</span> = <span className={driveId ? 'text-emerald-400' : 'text-zinc-500'}>{driveId || '(pending)'}</span></div>
                {saFile && <div><span className="text-zinc-500">service_account_file</span> = <span className="text-amber-400">{saFile.split('/').pop()}</span></div>}
            </div>
            {groups && groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {groups.map(g => (
                        <span key={g} className="px-2 py-1 bg-purple-800/40 text-purple-300 border border-purple-600/50 rounded text-xs">{g}</span>
                    ))}
                </div>
            )}
        </div>
    );
};

const DriveManager = () => {
    // Config state
    const [domains, setDomains] = useState<DomainConfig[]>([]);
    const [keys, setKeys] = useState<KeyInfo[]>([]);
    const [methodsAvailable, setMethodsAvailable] = useState<MethodsResponse | null>(null);
    const [sshServers, setSshServers] = useState<SSHServer[]>([]);
    const [knownGroups, setKnownGroups] = useState<string[]>([]);
    const [localRemotes, setLocalRemotes] = useState<RcloneRemote[]>([]);

    // Builder state - Configuration
    const [method, setMethod] = useState<DriveMethod>('google_api');
    const [selectedDomain, setSelectedDomain] = useState<DomainConfig | null>(null);
    const [serviceAccountFile, setServiceAccountFile] = useState('');
    const [impersonateEmail, setImpersonateEmail] = useState('');
    const [gdriveRemote, setGdriveRemote] = useState('');

    // Builder state - Drive Names
    const [baseName, setBaseName] = useState('');
    const [driveCount, setDriveCount] = useState(1);
    const [suffixSeparator, setSuffixSeparator] = useState('-');
    const [suffixPadding, setSuffixPadding] = useState(2);
    const [suffixStart, setSuffixStart] = useState(1);

    // Builder state - Groups
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    const [newGroupEmail, setNewGroupEmail] = useState('');

    // Builder state - Options
    const [createUnion, setCreateUnion] = useState(false);
    const [unionName, setUnionName] = useState('');
    const [actionPolicy, setActionPolicy] = useState('rand');
    const [createPolicy, setCreatePolicy] = useState('eprand');
    const [delaySeconds, setDelaySeconds] = useState(5);

    // Execution state
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [createdDrives, setCreatedDrives] = useState<DriveInfo[]>([]);
    const [createdRemotes, setCreatedRemotes] = useState<string[]>([]);
    const [connectionTests, setConnectionTests] = useState<Record<string, 'pending' | 'ok' | 'error'>>({});
    const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
    const [pushResults, setPushResults] = useState<{ server: string; status: string }[]>([]);

    // Tab state
    const [activeTab, setActiveTab] = useState<'builder' | 'expand' | 'existing'>('builder');

    // Expand Union state
    const [unionList, setUnionList] = useState<UnionInfo[]>([]);
    const [selectedUnion, setSelectedUnion] = useState<UnionDetails | null>(null);
    const [expandCount, setExpandCount] = useState(1);
    const [expandLogs, setExpandLogs] = useState<string[]>([]);
    const [expandLoading, setExpandLoading] = useState(false);

    // Existing remotes tab state
    const [queryPrefix, setQueryPrefix] = useState('');
    const [queriedDrives, setQueriedDrives] = useState<DriveInfo[]>([]);
    const [queryLoading, setQueryLoading] = useState(false);

    // Load initial data
    useEffect(() => {
        const loadData = async () => {
            try {
                const [config, keysData, methods, servers, groupsRes, remotesRes, unionsRes] = await Promise.all([
                    fetchConfig(),
                    listKeys(),
                    checkDriveMethods(),
                    fetchSSHServers(),
                    listKnownGroups(),
                    listLocalRemotes(),
                    listUnionRemotes()
                ]);

                setDomains(config.domains || []);
                setKeys(keysData.keys);
                setMethodsAvailable(methods);
                setSshServers(servers);
                setKnownGroups(groupsRes.groups || []);
                setLocalRemotes(remotesRes.remotes || []);
                setUnionList(unionsRes.unions || []);

                if (keysData.keys.length > 0) {
                    setServiceAccountFile(keysData.keys[0].path);
                }
            } catch (e) {
                console.error('Failed to load data', e);
            }
        };
        loadData();
    }, []);

    // Auto-populate fields when domain is selected
    useEffect(() => {
        if (selectedDomain) {
            if (selectedDomain.admin_email) {
                setImpersonateEmail(selectedDomain.admin_email);
            }
            if (selectedDomain.sa_json_path && keys.length > 0) {
                const domainKeyName = selectedDomain.sa_json_path.split('/').pop() || '';
                const matchingKey = keys.find(k => {
                    const keyName = k.name || k.path.split('/').pop() || '';
                    return keyName === domainKeyName || k.path === selectedDomain.sa_json_path;
                });
                if (matchingKey) {
                    setServiceAccountFile(matchingKey.path);
                }
            }
        }
    }, [selectedDomain, keys]);

    // Generate drive names based on current settings
    const generatedDriveNames = useMemo(() => {
        if (!baseName) return [];
        if (driveCount <= 1) return [baseName];

        const names: string[] = [];
        for (let i = 0; i < driveCount; i++) {
            const num = suffixStart + i;
            const padded = String(num).padStart(suffixPadding, '0');
            names.push(`${baseName}${suffixSeparator}${padded}`);
        }
        return names;
    }, [baseName, driveCount, suffixSeparator, suffixPadding, suffixStart]);

    // Validation
    const configValid = useMemo(() => {
        if (method === 'google_api') {
            return !!selectedDomain && !!serviceAccountFile && !!impersonateEmail;
        }
        return !!gdriveRemote;
    }, [method, selectedDomain, serviceAccountFile, impersonateEmail, gdriveRemote]);

    const namesValid = useMemo(() => baseName.length > 0, [baseName]);
    const canCreateDrives = configValid && namesValid && !loading;
    const canCreateRemotes = createdDrives.length > 0 && !loading;
    const canPushToServers = createdRemotes.length > 0 && selectedServers.size > 0 && !loading;

    // Get drive status
    const getDriveStatus = (name: string): 'pending' | 'created' | 'remote_ok' | 'error' => {
        if (connectionTests[name] === 'ok') return 'remote_ok';
        if (connectionTests[name] === 'error') return 'error';
        if (createdRemotes.includes(name)) return 'remote_ok';
        if (createdDrives.find(d => d.name === name)) return 'created';
        return 'pending';
    };

    // Actions
    const handleCreateDrives = async () => {
        setLoading(true);
        setLogs([`Creating ${generatedDriveNames.length} Shared Drive(s)...`]);
        setCreatedDrives([]);

        try {
            const suffixes = driveCount <= 1 ? [''] :
                Array.from({ length: driveCount }, (_, i) => {
                    const num = suffixStart + i;
                    return `${suffixSeparator}${String(num).padStart(suffixPadding, '0')}`;
                });

            const result = await createDrivesUnified({
                method,
                base_name: baseName,
                suffixes,
                delay_seconds: delaySeconds,
                gdrive_remote: method === 'fclone' ? gdriveRemote : undefined,
                service_account_file: method === 'google_api' ? serviceAccountFile : undefined,
                impersonate_email: method === 'google_api' ? impersonateEmail : undefined
            });

            setLogs(prev => [...prev, ...result.logs]);

            let drives: DriveInfo[] = [];
            if (result.created && result.created.length > 0) {
                if (typeof result.created[0] === 'object') {
                    drives = result.created as any;
                } else if (method === 'fclone' && gdriveRemote) {
                    const drivesResult = await listDrives(gdriveRemote, baseName);
                    const createdNames = new Set(result.created);
                    drives = drivesResult.drives.filter(d => createdNames.has(d.name));
                }
                setCreatedDrives(drives);
            }

            // Add group managers if selected
            if (selectedGroups.length > 0 && drives.length > 0 && method === 'google_api') {
                setLogs(prev => [...prev, '--- Adding Group Managers ---']);
                for (const drive of drives) {
                    try {
                        const res = await addDriveManagers({
                            drive_id: drive.id,
                            service_account_file: serviceAccountFile,
                            impersonate_email: impersonateEmail,
                            group_emails: selectedGroups
                        });
                        setLogs(prev => [...prev, `✓ Added ${res.added?.length || 0} managers to ${drive.name}`]);
                    } catch (e: any) {
                        setLogs(prev => [...prev, `✗ Failed: ${drive.name} - ${e.message}`]);
                    }
                }
            }
        } catch (e: any) {
            setLogs(prev => [...prev, `Error: ${e.message}`]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRemotes = async () => {
        setLoading(true);
        setLogs(prev => [...prev, '--- Creating Rclone Remotes ---']);

        for (const drive of createdDrives) {
            try {
                await createDriveRemote({
                    name: drive.name,
                    team_drive_id: drive.id,
                    service_account_file: serviceAccountFile
                });
                setCreatedRemotes(prev => [...prev, drive.name]);
                setLogs(prev => [...prev, `✓ Created remote: ${drive.name}`]);

                // Test connection
                setConnectionTests(prev => ({ ...prev, [drive.name]: 'pending' }));
                const testResult = await testRcloneConnection(drive.name);
                setConnectionTests(prev => ({
                    ...prev,
                    [drive.name]: testResult.status === 'ok' ? 'ok' : 'error'
                }));
                setLogs(prev => [...prev, `  ${testResult.status === 'ok' ? '✓' : '✗'} Test: ${testResult.message}`]);
            } catch (e: any) {
                setLogs(prev => [...prev, `✗ Failed: ${drive.name} - ${e.message}`]);
                setConnectionTests(prev => ({ ...prev, [drive.name]: 'error' }));
            }
        }

        // Create union if enabled
        if (createUnion && (unionName || baseName)) {
            try {
                await createUnionRemoteDirect({
                    name: unionName || baseName,
                    upstreams: createdDrives.map(d => d.name),
                    action_policy: actionPolicy,
                    create_policy: createPolicy,
                    service_account_file_path: serviceAccountFile
                });
                setLogs(prev => [...prev, `✓ Created union: ${unionName || baseName}`]);
            } catch (e: any) {
                setLogs(prev => [...prev, `✗ Union failed: ${e.message}`]);
            }
        }

        setLoading(false);
    };

    const handlePushToServers = async () => {
        setLoading(true);
        const remoteNamesToSync = [...createdRemotes];
        if (createUnion && unionName) remoteNamesToSync.push(unionName);

        const results: { server: string; status: string }[] = [];
        for (const serverId of Array.from(selectedServers)) {
            const server = sshServers.find(s => s.id === serverId);
            try {
                const res = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000/api'}/rclone/remote/push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ server_id: serverId, remote_names: remoteNamesToSync })
                });
                const data = await res.json();
                results.push({ server: server?.name || serverId, status: data.status || 'ok' });
                setLogs(prev => [...prev, `✓ Pushed to ${server?.name}`]);
            } catch (e: any) {
                results.push({ server: server?.name || serverId, status: 'error' });
                setLogs(prev => [...prev, `✗ Push failed: ${server?.name}`]);
            }
        }
        setPushResults(results);
        setLoading(false);
    };

    const handleReset = () => {
        setBaseName('');
        setDriveCount(1);
        setSelectedGroups([]);
        setCreateUnion(false);
        setUnionName('');
        setLogs([]);
        setCreatedDrives([]);
        setCreatedRemotes([]);
        setConnectionTests({});
        setSelectedServers(new Set());
        setPushResults([]);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <PageHeader
                icon={HardDrive}
                title="Drive Manager"
                subtitle="Create Shared Drives and rclone remotes"
                gradient="from-violet-600 to-purple-600"
            />

            {/* Tab Navigation */}
            <div className="flex border-b border-zinc-800 mb-6">
                <button
                    onClick={() => setActiveTab('builder')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'builder' ? 'border-violet-500 text-violet-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <div className="flex items-center gap-2">
                        <Plus size={16} />
                        Build New
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('expand')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'expand' ? 'border-purple-500 text-purple-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <div className="flex items-center gap-2">
                        <Layers size={16} />
                        Expand Union
                        {unionList.length > 0 && <span className="text-xs bg-purple-600/30 px-1.5 rounded">{unionList.length}</span>}
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('existing')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'existing' ? 'border-blue-500 text-blue-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <div className="flex items-center gap-2">
                        <Folder size={16} />
                        Existing Drives
                    </div>
                </button>
            </div>

            {activeTab === 'builder' && (
                <div className="space-y-4">
                    {/* Union Mode Toggle - Top Level */}
                    <div className="flex items-center justify-between bg-gradient-to-r from-purple-900/30 to-zinc-900/50 border border-purple-700/50 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                            <Link size={20} className="text-purple-400" />
                            <div>
                                <div className="text-sm font-medium text-white">Create Union Remote</div>
                                <div className="text-xs text-zinc-500">Bundle multiple drives into one unified remote</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={createUnion}
                                onChange={e => {
                                    setCreateUnion(e.target.checked);
                                    if (e.target.checked) {
                                        if (driveCount < 2) setDriveCount(3);
                                        if (!unionName && baseName) setUnionName(baseName);
                                    }
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                        </label>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* LEFT: Configuration Panels */}
                        <div className="space-y-4">
                            {/* Configuration Panel */}
                            <Panel
                                title="Configuration"
                                icon={Settings}
                                status={configValid ? '✓ Ready' : '⚠ Required'}
                                statusColor={configValid ? 'emerald' : 'amber'}
                            >
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Domain</label>
                                    <select
                                        value={selectedDomain?.domain_name || ''}
                                        onChange={e => setSelectedDomain(domains.find(d => d.domain_name === e.target.value) || null)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                                    >
                                        <option value="">Select Domain</option>
                                        {domains.map(d => <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>)}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setMethod('google_api')}
                                        className={`p-2 rounded border text-xs ${method === 'google_api' ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-700 text-zinc-400'}`}
                                    >
                                        <Cloud size={14} className="mx-auto mb-1" />
                                        Google API
                                    </button>
                                    <button
                                        onClick={() => setMethod('fclone')}
                                        className={`p-2 rounded border text-xs ${method === 'fclone' ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-700 text-zinc-400'}`}
                                    >
                                        <Terminal size={14} className="mx-auto mb-1" />
                                        fclone CLI
                                    </button>
                                </div>

                                {method === 'google_api' && (
                                    <>
                                        <div>
                                            <label className="block text-xs text-zinc-500 mb-1">Service Account Key</label>
                                            <select
                                                value={serviceAccountFile}
                                                onChange={e => setServiceAccountFile(e.target.value)}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                                            >
                                                {keys.map(k => <option key={k.path} value={k.path}>{k.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-zinc-500 mb-1">Impersonate Email</label>
                                            <input
                                                type="email"
                                                value={impersonateEmail}
                                                onChange={e => setImpersonateEmail(e.target.value)}
                                                placeholder="admin@domain.com"
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                                            />
                                        </div>
                                    </>
                                )}

                                {method === 'fclone' && (
                                    <div>
                                        <label className="block text-xs text-zinc-500 mb-1">GDrive Remote</label>
                                        <input
                                            type="text"
                                            value={gdriveRemote}
                                            onChange={e => setGdriveRemote(e.target.value)}
                                            placeholder="gdriveO:"
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                                        />
                                    </div>
                                )}
                            </Panel>

                            {/* Drive Names Panel */}
                            <Panel
                                title="Drive Names"
                                icon={Folder}
                                status={namesValid ? `${generatedDriveNames.length} drive(s)` : '⚠ Required'}
                                statusColor={namesValid ? 'emerald' : 'amber'}
                            >
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Base Name</label>
                                    <input
                                        type="text"
                                        value={baseName}
                                        onChange={e => setBaseName(e.target.value)}
                                        placeholder="fcg-tv-70s"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                                    />
                                </div>

                                <div className="grid grid-cols-4 gap-2">
                                    <div>
                                        <label className="block text-[10px] text-zinc-500 uppercase">Count</label>
                                        <input
                                            type="number"
                                            value={driveCount}
                                            onChange={e => setDriveCount(Math.max(1, parseInt(e.target.value) || 1))}
                                            min={1}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-zinc-500 uppercase">Sep</label>
                                        <input
                                            type="text"
                                            value={suffixSeparator}
                                            onChange={e => setSuffixSeparator(e.target.value)}
                                            maxLength={2}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-zinc-500 uppercase">Pad</label>
                                        <input
                                            type="number"
                                            value={suffixPadding}
                                            onChange={e => setSuffixPadding(parseInt(e.target.value) || 1)}
                                            min={1}
                                            max={4}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-zinc-500 uppercase">Start</label>
                                        <input
                                            type="number"
                                            value={suffixStart}
                                            onChange={e => setSuffixStart(parseInt(e.target.value) || 1)}
                                            min={1}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                                        />
                                    </div>
                                </div>
                            </Panel>

                            {/* Group Managers Panel */}
                            <Panel title="Group Managers" icon={Users} defaultOpen={false} status="Optional">
                                {knownGroups.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {knownGroups.map(g => (
                                            <label
                                                key={g}
                                                className={`px-2 py-1 rounded text-xs cursor-pointer border transition ${selectedGroups.includes(g)
                                                    ? 'bg-purple-600/30 text-purple-300 border-purple-500'
                                                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600'
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedGroups.includes(g)}
                                                    onChange={e => {
                                                        if (e.target.checked) setSelectedGroups([...selectedGroups, g]);
                                                        else setSelectedGroups(selectedGroups.filter(x => x !== g));
                                                    }}
                                                    className="hidden"
                                                />
                                                {g}
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <input
                                        type="email"
                                        value={newGroupEmail}
                                        onChange={e => setNewGroupEmail(e.target.value)}
                                        placeholder="group@domain.com"
                                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs"
                                    />
                                    <button
                                        onClick={() => {
                                            if (newGroupEmail && !selectedGroups.includes(newGroupEmail)) {
                                                setSelectedGroups([...selectedGroups, newGroupEmail]);
                                                setNewGroupEmail('');
                                            }
                                        }}
                                        disabled={!newGroupEmail}
                                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-xs"
                                    >
                                        Add
                                    </button>
                                </div>
                                {selectedGroups.length > 0 && (
                                    <div className="text-xs text-zinc-500">
                                        {selectedGroups.length} group(s) selected
                                    </div>
                                )}
                            </Panel>

                            {/* Options Panel */}
                            <Panel title="Options" icon={Settings} defaultOpen={false} status="Optional">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={createUnion}
                                        onChange={e => {
                                            setCreateUnion(e.target.checked);
                                            if (e.target.checked && !unionName) setUnionName(baseName);
                                        }}
                                        className="w-4 h-4 accent-purple-500"
                                    />
                                    <span className="text-sm text-zinc-300">Create union remote</span>
                                </label>
                                {createUnion && (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            value={unionName}
                                            onChange={e => setUnionName(e.target.value)}
                                            placeholder="Union name"
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                                        />
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[10px] text-zinc-500 uppercase">Action Policy</label>
                                                <select value={actionPolicy} onChange={e => setActionPolicy(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs">
                                                    <option value="rand">rand</option>
                                                    <option value="all">all</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-zinc-500 uppercase">Create Policy</label>
                                                <select value={createPolicy} onChange={e => setCreatePolicy(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs">
                                                    <option value="eprand">eprand</option>
                                                    <option value="mfs">mfs</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Delay between creations (seconds)</label>
                                    <input
                                        type="number"
                                        value={delaySeconds}
                                        onChange={e => setDelaySeconds(parseInt(e.target.value) || 5)}
                                        min={1}
                                        className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"
                                    />
                                </div>
                            </Panel>

                            {/* Push to Servers Panel */}
                            <Panel title="Push to Servers" icon={Send} defaultOpen={false} status={selectedServers.size > 0 ? `${selectedServers.size} selected` : 'Optional'}>
                                <div className="grid grid-cols-2 gap-2">
                                    {sshServers.map(server => (
                                        <label
                                            key={server.id}
                                            className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-xs ${selectedServers.has(server.id)
                                                ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                                                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedServers.has(server.id)}
                                                onChange={e => {
                                                    const next = new Set(selectedServers);
                                                    if (e.target.checked) next.add(server.id);
                                                    else next.delete(server.id);
                                                    setSelectedServers(next);
                                                }}
                                                className="hidden"
                                            />
                                            <Server size={12} />
                                            {server.name}
                                        </label>
                                    ))}
                                </div>
                                {pushResults.length > 0 && (
                                    <div className="space-y-1">
                                        {pushResults.map((r, i) => (
                                            <div key={i} className={`text-xs ${r.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {r.status === 'ok' ? '✓' : '✗'} {r.server}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Panel>
                        </div>

                        {/* RIGHT: Builder Preview */}
                        <div className="lg:sticky lg:top-6 space-y-4">
                            <Card>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                                        <HardDrive size={16} className="text-violet-400" />
                                        Builder Preview
                                    </h3>
                                    <button
                                        onClick={handleReset}
                                        className="text-xs text-zinc-500 hover:text-white flex items-center gap-1"
                                    >
                                        <RefreshCw size={12} /> Reset
                                    </button>
                                </div>

                                {/* Drive Cards */}
                                <div className="space-y-2 max-h-[400px] overflow-y-auto mb-4">
                                    {generatedDriveNames.length === 0 ? (
                                        <div className="text-center py-8 text-zinc-600 text-sm">
                                            Enter a base name to preview
                                        </div>
                                    ) : (
                                        <>
                                            {generatedDriveNames.map(name => {
                                                const created = createdDrives.find(d => d.name === name);
                                                return (
                                                    <DriveCard
                                                        key={name}
                                                        name={name}
                                                        driveId={created?.id}
                                                        status={getDriveStatus(name)}
                                                        groups={selectedGroups.length > 0 ? selectedGroups : undefined}
                                                        saFile={serviceAccountFile}
                                                    />
                                                );
                                            })}

                                            {/* Union Preview */}
                                            {createUnion && driveCount > 1 && (
                                                <div className="border border-purple-500 bg-purple-900/30 rounded-lg p-4 mt-3">
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <Link size={16} className="text-purple-400" />
                                                        <span className="font-mono text-purple-200 text-base font-semibold">{unionName || baseName}</span>
                                                        <span className="ml-auto text-xs text-purple-400">Union Remote</span>
                                                    </div>
                                                    <div className="text-xs text-zinc-300 font-mono bg-zinc-900/50 rounded p-2 space-y-1">
                                                        <div><span className="text-zinc-500">type</span> = <span className="text-purple-400">union</span></div>
                                                        <div><span className="text-zinc-500">upstreams</span> = <span className="text-cyan-400">{generatedDriveNames.join(': ')}:</span></div>
                                                        <div><span className="text-zinc-500">action_policy</span> = <span className="text-amber-400">{actionPolicy}</span></div>
                                                        <div><span className="text-zinc-500">create_policy</span> = <span className="text-amber-400">{createPolicy}</span></div>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Action Buttons */}
                                <div className="space-y-2 border-t border-zinc-800 pt-4">
                                    <button
                                        onClick={handleCreateDrives}
                                        disabled={!canCreateDrives}
                                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                                        {loading ? 'Creating...' : `Create ${generatedDriveNames.length} Drive(s)`}
                                    </button>

                                    <button
                                        onClick={handleCreateRemotes}
                                        disabled={!canCreateRemotes}
                                        className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        <Zap size={14} />
                                        Create Remotes & Test
                                    </button>

                                    <button
                                        onClick={handlePushToServers}
                                        disabled={!canPushToServers}
                                        className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        <Send size={14} />
                                        Push to {selectedServers.size} Server(s)
                                    </button>
                                </div>
                            </Card>

                            {/* Logs */}
                            {logs.length > 0 && (
                                <Card>
                                    <h4 className="text-xs font-medium text-zinc-500 mb-2">Activity Log</h4>
                                    <div className="bg-zinc-900 rounded p-3 text-[10px] font-mono text-zinc-400 max-h-48 overflow-y-auto">
                                        {logs.map((log, i) => (
                                            <div key={i} className={log.startsWith('✓') ? 'text-emerald-400' : log.startsWith('✗') ? 'text-red-400' : ''}>{log}</div>
                                        ))}
                                    </div>
                                </Card>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* EXPAND UNION TAB */}
            {activeTab === 'expand' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* LEFT: Union Selection & Current State */}
                    <div className="space-y-4">
                        <Card>
                            <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                                <Layers size={16} className="text-purple-400" />
                                Select Union Remote
                            </h3>
                            <select
                                value={selectedUnion?.name || ''}
                                onChange={async (e) => {
                                    if (!e.target.value) {
                                        setSelectedUnion(null);
                                        return;
                                    }
                                    try {
                                        const details = await getUnionDetails(e.target.value);
                                        setSelectedUnion(details);
                                        // Auto-detect next suffix
                                        if (details.drives.length > 0) {
                                            const lastDrive = details.drives[details.drives.length - 1];
                                            const match = lastDrive.remote_name.match(/-(\d+)$/);
                                            if (match) {
                                                setExpandCount(1);
                                            }
                                        }
                                    } catch (err) {
                                        console.error(err);
                                    }
                                }}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                            >
                                <option value="">Select a union remote...</option>
                                {unionList.map(u => (
                                    <option key={u.name} value={u.name}>{u.name} ({u.upstream_count} drives)</option>
                                ))}
                            </select>
                        </Card>

                        {selectedUnion && (
                            <Card>
                                <h3 className="text-sm font-medium text-white mb-3">Union Configuration</h3>
                                <div className="text-xs font-mono bg-zinc-900/50 rounded p-3 space-y-1">
                                    <div><span className="text-zinc-500">type</span> = <span className="text-purple-400">union</span></div>
                                    <div><span className="text-zinc-500">action_policy</span> = <span className="text-amber-400">{selectedUnion.action_policy}</span></div>
                                    <div><span className="text-zinc-500">create_policy</span> = <span className="text-amber-400">{selectedUnion.create_policy}</span></div>
                                    {selectedUnion.service_account_file && (
                                        <div><span className="text-zinc-500">service_account_file</span> = <span className="text-cyan-400">{selectedUnion.service_account_file.split('/').pop()}</span></div>
                                    )}
                                </div>

                                <h4 className="text-xs font-medium text-zinc-400 mt-4 mb-2">Current Upstreams ({selectedUnion.drives.length})</h4>
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {selectedUnion.drives.map((d, i) => (
                                        <div key={d.remote_name} className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-zinc-500">{i + 1}.</span>
                                                <span className="font-mono text-sm text-white">{d.remote_name}</span>
                                                <span className={`ml-auto text-[10px] ${d.type === 'drive' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {d.type}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-zinc-500 font-mono mt-1">
                                                team_drive = {d.team_drive || '(unknown)'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </div>

                    {/* RIGHT: Add New Drives */}
                    <div className="space-y-4">
                        {selectedUnion ? (
                            <>
                                <Card>
                                    <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                                        <Plus size={16} className="text-emerald-400" />
                                        Add Drives to Union
                                    </h3>

                                    {/* Auto-detected base name */}
                                    <div className="bg-zinc-900/50 rounded p-3 mb-4">
                                        <div className="text-xs text-zinc-500 mb-1">Detected pattern</div>
                                        <div className="font-mono text-sm text-white">
                                            {selectedUnion.drives.length > 0
                                                ? selectedUnion.drives[0].remote_name.replace(/-\d+$/, '')
                                                : selectedUnion.name
                                            }-{String(selectedUnion.drives.length + 1).padStart(2, '0')}
                                        </div>
                                    </div>

                                    <div className="flex gap-3 items-end mb-4">
                                        <div className="flex-1">
                                            <label className="block text-xs text-zinc-500 mb-1">New drives to add</label>
                                            <input
                                                type="number"
                                                value={expandCount}
                                                onChange={e => setExpandCount(Math.max(1, parseInt(e.target.value) || 1))}
                                                min={1}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                                            />
                                        </div>
                                    </div>

                                    {/* Preview of new drives */}
                                    <div className="text-xs text-zinc-500 mb-2">Will create:</div>
                                    <div className="space-y-1 mb-4">
                                        {Array.from({ length: expandCount }, (_, i) => {
                                            const basePattern = selectedUnion.drives.length > 0
                                                ? selectedUnion.drives[0].remote_name.replace(/-\d+$/, '')
                                                : selectedUnion.name;
                                            const nextNum = selectedUnion.drives.length + 1 + i;
                                            return (
                                                <div key={i} className="flex items-center gap-2 text-xs font-mono">
                                                    <span className="text-emerald-400">+</span>
                                                    <span className="text-white">{basePattern}-{String(nextNum).padStart(2, '0')}</span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <button
                                        onClick={async () => {
                                            if (!selectedUnion) return;
                                            setExpandLoading(true);
                                            setExpandLogs(['Starting expansion...']);

                                            const basePattern = selectedUnion.drives.length > 0
                                                ? selectedUnion.drives[0].remote_name.replace(/-\d+$/, '')
                                                : selectedUnion.name;
                                            const saFile = selectedUnion.drives[0]?.service_account_file || serviceAccountFile;

                                            const newRemoteNames: string[] = [];

                                            for (let i = 0; i < expandCount; i++) {
                                                const nextNum = selectedUnion.drives.length + 1 + i;
                                                const newName = `${basePattern}-${String(nextNum).padStart(2, '0')}`;
                                                newRemoteNames.push(newName);

                                                try {
                                                    // Create Shared Drive
                                                    setExpandLogs(prev => [...prev, `Creating drive: ${newName}...`]);
                                                    const driveResult = await createDrivesUnified({
                                                        method: 'google_api',
                                                        base_name: newName,
                                                        suffixes: [''],
                                                        delay_seconds: 2,
                                                        service_account_file: saFile,
                                                        impersonate_email: impersonateEmail || selectedDomain?.admin_email
                                                    });

                                                    if (driveResult.created && driveResult.created.length > 0) {
                                                        const created = driveResult.created[0] as any;
                                                        setExpandLogs(prev => [...prev, `✓ Created drive: ${newName} (${created.id})`]);

                                                        // Create rclone remote
                                                        await createDriveRemote({
                                                            name: newName,
                                                            team_drive_id: created.id,
                                                            service_account_file: saFile
                                                        });
                                                        setExpandLogs(prev => [...prev, `✓ Created remote: ${newName}`]);
                                                    } else {
                                                        setExpandLogs(prev => [...prev, `✗ Failed to create drive: ${newName}`]);
                                                    }
                                                } catch (e: any) {
                                                    setExpandLogs(prev => [...prev, `✗ Error: ${e.message}`]);
                                                }
                                            }

                                            // Update union
                                            try {
                                                setExpandLogs(prev => [...prev, `Updating union: ${selectedUnion.name}...`]);
                                                await expandUnion(selectedUnion.name, newRemoteNames);
                                                setExpandLogs(prev => [...prev, `✓ Union updated with ${newRemoteNames.length} new upstreams`]);

                                                // Refresh union details
                                                const updated = await getUnionDetails(selectedUnion.name);
                                                setSelectedUnion(updated);
                                            } catch (e: any) {
                                                setExpandLogs(prev => [...prev, `✗ Failed to update union: ${e.message}`]);
                                            }

                                            setExpandLoading(false);
                                        }}
                                        disabled={expandLoading}
                                        className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        {expandLoading ? <RefreshCw size={14} className="animate-spin" /> : <Layers size={14} />}
                                        {expandLoading ? 'Expanding...' : `Expand Union (+${expandCount} drives)`}
                                    </button>
                                </Card>

                                {expandLogs.length > 0 && (
                                    <Card>
                                        <h4 className="text-xs font-medium text-zinc-500 mb-2">Activity Log</h4>
                                        <div className="bg-zinc-900 rounded p-3 text-[10px] font-mono text-zinc-400 max-h-48 overflow-y-auto">
                                            {expandLogs.map((log, i) => (
                                                <div key={i} className={log.startsWith('✓') ? 'text-emerald-400' : log.startsWith('✗') ? 'text-red-400' : ''}>{log}</div>
                                            ))}
                                        </div>
                                    </Card>
                                )}
                            </>
                        ) : (
                            <Card>
                                <div className="text-center py-12 text-zinc-600">
                                    <Layers size={48} className="mx-auto mb-4 opacity-50" />
                                    <p>Select a union remote to expand</p>
                                </div>
                            </Card>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'existing' && (
                <Card>
                    <h3 className="text-lg font-medium text-white mb-4">Existing Shared Drives</h3>
                    <p className="text-sm text-zinc-500">Query and manage existing drives (coming soon)</p>
                </Card>
            )}
        </div>
    );
};

export default DriveManager;
