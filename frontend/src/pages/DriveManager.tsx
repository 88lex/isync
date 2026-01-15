import { useState, useEffect } from 'react';
import { HardDrive, Plus, Folder, Link, Settings, Check, ChevronRight, AlertCircle, Play, RefreshCw, Cloud, Terminal, Info, Search, X } from 'lucide-react';
import {
    fetchConfig, DomainConfig,
    createSharedDrives, listDrives, createRcloneRemotes, createUnionRemote,
    generateSuffixes, listKeys, KeyInfo, DriveInfo,
    createDrivesUnified, checkDriveMethods, DriveMethod, MethodsResponse, listDrivesUnified,
    RcloneRemote, listLocalRemotes
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';

const DriveManager = () => {
    // Config state
    const [domains, setDomains] = useState<DomainConfig[]>([]);
    const [keys, setKeys] = useState<KeyInfo[]>([]);
    const [keysPath, setKeysPath] = useState('');

    // Wizard state
    const [activeTab, setActiveTab] = useState<'drives' | 'remotes' | 'unions'>('drives');
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [methodsAvailable, setMethodsAvailable] = useState<MethodsResponse | null>(null);
    const [localRemotes, setLocalRemotes] = useState<RcloneRemote[]>([]);

    // Step 1: Domain & Auth + Method Selection
    const [method, setMethod] = useState<DriveMethod>('fclone');
    const [selectedDomain, setSelectedDomain] = useState<DomainConfig | null>(null);
    // fclone-specific
    const [gdriveRemote, setGdriveRemote] = useState('');
    const [memberTemplate, setMemberTemplate] = useState('');
    // google_api-specific
    const [serviceAccountFile, setServiceAccountFile] = useState('');
    const [impersonateEmail, setImpersonateEmail] = useState('');

    // Step 2: Drive Names
    const [baseName, setBaseName] = useState('');
    const [suffixStart, setSuffixStart] = useState(10);
    const [suffixCount, setSuffixCount] = useState(5);
    const [suffixIncrement, setSuffixIncrement] = useState(10);
    const [suffixPadding, setSuffixPadding] = useState(4);
    const [useSuffixes, setUseSuffixes] = useState(true);
    const [suffixes, setSuffixes] = useState<string[]>([]);
    const [delaySeconds, setDelaySeconds] = useState(10);

    // Step 3: Created drives
    const [createdDrives, setCreatedDrives] = useState<DriveInfo[]>([]);
    const [createErrors, setCreateErrors] = useState<{ name: string; error: string }[]>([]);

    // Step 4: Rclone remotes
    const [saDir, setSaDir] = useState('/opt/sa');
    const [saStartCount, setSaStartCount] = useState(1);

    // Step 5: Union remote
    const [createUnion, setCreateUnion] = useState(false);
    const [unionName, setUnionName] = useState('');
    const [actionPolicy, setActionPolicy] = useState('rand');
    const [createPolicy, setCreatePolicy] = useState('eprand');
    const [unionSaPath, setUnionSaPath] = useState('/opt/sa');

    // Query drives for Step 4
    const [queryPrefix, setQueryPrefix] = useState('');
    const [queriedDrives, setQueriedDrives] = useState<DriveInfo[]>([]);
    const [queryLoading, setQueryLoading] = useState(false);
    const [showOnlyMissing, setShowOnlyMissing] = useState(false);

    // Load initial data
    useEffect(() => {
        const loadData = async () => {
            try {
                const config = await fetchConfig();
                setDomains(config.domains || []);

                const keysData = await listKeys();
                setKeys(keysData.keys);
                setKeysPath(keysData.path);

                // Set default SA file if available
                if (keysData.keys.length > 0) {
                    setServiceAccountFile(keysData.keys[0].path);
                }

                // Check available methods
                const methods = await checkDriveMethods();
                setMethodsAvailable(methods);

                // Load local remotes
                const remotesRes = await listLocalRemotes();
                setLocalRemotes(remotesRes.remotes || []);
            } catch (e) {
                console.error('Failed to load data', e);
            }
        };
        loadData();
    }, []);

    // Auto-populate fields when domain is selected
    useEffect(() => {
        if (selectedDomain) {
            // Set impersonate email from domain admin
            if (selectedDomain.admin_email) {
                setImpersonateEmail(selectedDomain.admin_email);
            }
            // Find matching key from available keys by matching filename
            if (selectedDomain.sa_json_path && keys.length > 0) {
                // Extract filename from domain's sa_json_path
                const domainKeyName = selectedDomain.sa_json_path.split('/').pop() || '';
                // Find matching key from available keys
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

    // Generate suffixes preview
    const handleGenerateSuffixes = async () => {
        try {
            const result = await generateSuffixes({
                start: suffixStart,
                count: suffixCount,
                increment: suffixIncrement,
                padding: suffixPadding,
                prefix: '-'
            });
            setSuffixes(result.suffixes);
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
    };

    // Create shared drives (unified - supports both methods)
    const handleCreateDrives = async () => {
        // Validate based on method
        if (method === 'fclone' && !gdriveRemote) {
            alert('Please enter GDrive Auth Remote');
            return;
        }
        if (method === 'google_api' && (!serviceAccountFile || !impersonateEmail)) {
            alert('Please enter Service Account File and Impersonate Email');
            return;
        }
        if (!baseName || suffixes.length === 0) {
            alert('Please fill in base name and generate suffixes');
            return;
        }

        setLoading(true);
        setLogs([`Using method: ${method}`]);
        setCreatedDrives([]);
        setCreateErrors([]);

        try {
            const result = await createDrivesUnified({
                method: method,
                base_name: baseName,
                suffixes: suffixes,
                delay_seconds: delaySeconds,
                gdrive_remote: method === 'fclone' ? gdriveRemote : undefined,
                member_template: method === 'fclone' ? memberTemplate || undefined : undefined,
                service_account_file: method === 'google_api' ? serviceAccountFile : undefined,
                impersonate_email: method === 'google_api' ? impersonateEmail : undefined
            });

            setLogs(prev => [...prev, ...result.logs]);

            // For API method, created has {name, id} directly
            if (result.created && result.created.length > 0) {
                // Check if result.created contains objects or strings
                if (typeof result.created[0] === 'object') {
                    setCreatedDrives(result.created as any);
                } else {
                    // fclone returns just names, need to list to get IDs
                    if (method === 'fclone' && gdriveRemote) {
                        const drivesResult = await listDrives(gdriveRemote, baseName);
                        const createdNames = new Set(result.created);
                        const filtered = drivesResult.drives.filter(d => createdNames.has(d.name));
                        setCreatedDrives(filtered);
                    }
                }
            }

            setCreateErrors(result.failed || []);

            if (result.status === 'ok' || result.status === 'partial') {
                setStep(4); // Move to rclone remotes step
            }
        } catch (e: any) {
            setLogs(prev => [...prev, `Error: ${e.message}`]);
        } finally {
            setLoading(false);
        }
    };

    // Create rclone remotes
    const handleCreateRemotes = async () => {
        if (createdDrives.length === 0) {
            alert('No drives to create remotes for');
            return;
        }

        setLoading(true);
        try {
            const remotes = createdDrives.map(d => ({
                name: d.name,
                team_drive_id: d.id
            }));

            const result = await createRcloneRemotes({
                remotes,
                sa_dir: saDir,
                start_count: saStartCount
            });

            setLogs(prev => [...prev, '--- Creating Rclone Remotes ---', ...result.logs]);

            if (result.status === 'ok' || result.status === 'partial') {
                setStep(5); // Move to union step
            }
        } catch (e: any) {
            setLogs(prev => [...prev, `Error creating remotes: ${e.message}`]);
        } finally {
            setLoading(false);
        }
    };

    const handleQueryDrives = async () => {
        setQueryLoading(true);
        try {
            const result = await listDrivesUnified({
                method,
                prefix: queryPrefix || undefined,
                gdrive_remote: method === 'fclone' ? gdriveRemote : undefined,
                service_account_file: method === 'google_api' ? serviceAccountFile : undefined,
                impersonate_email: method === 'google_api' ? impersonateEmail : undefined
            });
            setQueriedDrives(result.drives || []);
            if (result.drives?.length === 0) {
                setLogs(prev => [...prev, 'No drives found matching query.']);
            }
        } catch (e: any) {
            setLogs(prev => [...prev, `Error querying drives: ${e.message}`]);
        } finally {
            setQueryLoading(false);
        }
    };

    const toggleDrivesSelection = (drive: DriveInfo) => {
        setCreatedDrives(prev => {
            const exists = prev.find(d => d.id === drive.id);
            if (exists) {
                return prev.filter(d => d.id !== drive.id);
            } else {
                return [...prev, drive];
            }
        });
    };

    const hasRemote = (driveId: string) => {
        return localRemotes.some(r => r.config?.team_drive === driveId);
    };

    const filteredQueriedDrives = showOnlyMissing
        ? queriedDrives.filter(d => !hasRemote(d.id))
        : queriedDrives;

    // Create union remote
    const handleCreateUnion = async () => {
        if (!unionName || createdDrives.length === 0) {
            alert('Please provide a union name');
            return;
        }

        setLoading(true);
        try {
            const result = await createUnionRemote({
                name: unionName,
                upstreams: createdDrives.map(d => d.name),
                action_policy: actionPolicy,
                create_policy: createPolicy,
                sa_file_path: unionSaPath || undefined
            });

            setLogs(prev => [...prev, '--- Creating Union Remote ---', result.message]);

            if (result.status === 'ok') {
                alert('✅ All operations completed successfully!');
            }
        } catch (e: any) {
            setLogs(prev => [...prev, `Error creating union: ${e.message}`]);
        } finally {
            setLoading(false);
        }
    };

    // Reset wizard
    const handleReset = () => {
        setStep(1);
        setLogs([]);
        setCreatedDrives([]);
        setCreateErrors([]);
        setSuffixes([]);
        setUseSuffixes(true);
        setBaseName('');
        setUnionName('');
        setCreateUnion(false);
    };

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            <PageHeader
                icon={HardDrive}
                title="Drive Manager"
                subtitle="Create Shared Drives and rclone remotes"
                gradient="from-violet-600 to-purple-600"
            />

            {/* Tab Navigation */}
            <div className="flex border-b border-zinc-800 mb-6 overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('drives')}
                    className={`px-6 py-3 text-sm font-medium transition whitespace-nowrap border-b-2 ${activeTab === 'drives'
                        ? 'border-violet-500 text-violet-400 bg-violet-500/5'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Folder size={18} />
                        <span>Create Shared Drives</span>
                    </div>
                </button>
                <button
                    onClick={() => {
                        setActiveTab('remotes');
                        listLocalRemotes().then(res => setLocalRemotes(res.remotes || []));
                    }}
                    className={`px-6 py-3 text-sm font-medium transition whitespace-nowrap border-b-2 ${activeTab === 'remotes'
                        ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Link size={18} />
                        <span>Manage Rclone Remotes</span>
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('unions')}
                    className={`px-6 py-3 text-sm font-medium transition whitespace-nowrap border-b-2 ${activeTab === 'unions'
                        ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Plus size={18} />
                        <span>Union Remotes</span>
                    </div>
                </button>
            </div>

            {/* TAB: Create Shared Drives */}
            {activeTab === 'drives' && (
                <div className="space-y-6">
                    {/* Progress Steps */}
                    <div className="flex items-center gap-2 mb-4 px-4 py-2 bg-zinc-900/30 rounded-lg">
                        {[1, 2, 3].map(s => (
                            <div key={s} className="flex items-center">
                                <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition
                                        ${step === s ? 'bg-violet-500 text-white' :
                                            step > s ? 'bg-violet-700 text-violet-300' : 'bg-zinc-700 text-zinc-400'}`}
                                >
                                    {step > s ? <Check size={14} /> : s}
                                </div>
                                {s < 3 && <ChevronRight size={14} className="text-zinc-700 mx-1" />}
                            </div>
                        ))}
                        <span className="ml-2 text-xs font-medium text-zinc-500">
                            {step === 1 ? 'Configuration' : step === 2 ? 'Names & Suffixes' : 'Confirmation'}
                        </span>
                        <div className="ml-auto">
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition"
                            >
                                <RefreshCw size={12} /> Reset
                            </button>
                        </div>
                    </div>

                    {step === 1 && (
                        <Card>
                            <h3 className="text-lg font-bold text-violet-400 mb-4 flex items-center gap-2">
                                <Settings size={18} /> Step 1: Configuration
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-2">Creation Method</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setMethod('fclone')}
                                            className={`p-3 rounded-lg border-2 transition flex items-center gap-2 ${method === 'fclone' ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'}`}
                                        >
                                            <Terminal size={18} className={method === 'fclone' ? 'text-violet-400' : 'text-zinc-400'} />
                                            <div className="text-left">
                                                <div className="font-medium text-sm">fclone CLI</div>
                                                <div className="text-xs text-zinc-500">Uses rclone fork</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => setMethod('google_api')}
                                            className={`p-3 rounded-lg border-2 transition flex items-center gap-2 ${method === 'google_api' ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'}`}
                                        >
                                            <Cloud size={18} className={method === 'google_api' ? 'text-violet-400' : 'text-zinc-400'} />
                                            <div className="text-left">
                                                <div className="font-medium text-sm">Google API</div>
                                                <div className="text-xs text-zinc-500">Requires DWD</div>
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">Domain (optional)</label>
                                    <select
                                        value={selectedDomain?.domain_name || ''}
                                        onChange={e => setSelectedDomain(domains.find(d => d.domain_name === e.target.value) || null)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                    >
                                        <option value="">-- Select Domain --</option>
                                        {domains.map(d => (
                                            <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>
                                        ))}
                                    </select>
                                </div>

                                {method === 'fclone' ? (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm text-zinc-400 mb-1">GDrive Auth Remote <span className="text-red-400">*</span></label>
                                            <input
                                                type="text"
                                                value={gdriveRemote}
                                                onChange={e => setGdriveRemote(e.target.value)}
                                                placeholder="gdriveO:"
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-zinc-400 mb-1">Member Template (optional)</label>
                                            <input
                                                type="text"
                                                value={memberTemplate}
                                                onChange={e => setMemberTemplate(e.target.value)}
                                                placeholder="template-drive:"
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm text-zinc-400 mb-1">Service Account JSON <span className="text-red-400">*</span></label>
                                            <select
                                                value={serviceAccountFile}
                                                onChange={e => setServiceAccountFile(e.target.value)}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                                            >
                                                <option value="">-- Select Key --</option>
                                                {keys.map(k => (
                                                    <option key={k.path} value={k.path}>{k.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm text-zinc-400 mb-1">Impersonate Email <span className="text-red-400">*</span></label>
                                            <input
                                                type="email"
                                                value={impersonateEmail}
                                                onChange={e => setImpersonateEmail(e.target.value)}
                                                placeholder="admin@domain.com"
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end mt-6">
                                <button
                                    onClick={() => setStep(2)}
                                    disabled={method === 'fclone' ? !gdriveRemote : (!serviceAccountFile || !impersonateEmail)}
                                    className="px-6 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition"
                                >
                                    Next
                                </button>
                            </div>
                        </Card>
                    )}

                    {step === 2 && (
                        <Card>
                            <h3 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
                                <Folder size={18} /> Step 2: Drive Names
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">Base Name <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={baseName}
                                        onChange={e => setBaseName(e.target.value)}
                                        placeholder="fcl-movies"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono"
                                    />
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={useSuffixes}
                                        onChange={e => {
                                            setUseSuffixes(e.target.checked);
                                            if (!e.target.checked) setSuffixes(['']);
                                            else setSuffixes([]);
                                        }}
                                        className="w-4 h-4 accent-violet-500"
                                    />
                                    <span className="text-sm text-zinc-300">Use numeric suffixes</span>
                                </label>
                                {useSuffixes && (
                                    <div className="grid grid-cols-4 gap-3">
                                        <div><label className="block text-[10px] text-zinc-500 uppercase">Start</label><input type="number" value={suffixStart} onChange={e => setSuffixStart(parseInt(e.target.value) || 0)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs" /></div>
                                        <div><label className="block text-[10px] text-zinc-500 uppercase">Count</label><input type="number" value={suffixCount} onChange={e => setSuffixCount(parseInt(e.target.value) || 1)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs" /></div>
                                        <div><label className="block text-[10px] text-zinc-500 uppercase">Inc</label><input type="number" value={suffixIncrement} onChange={e => setSuffixIncrement(parseInt(e.target.value) || 1)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs" /></div>
                                        <div><label className="block text-[10px] text-zinc-500 uppercase">Pad</label><input type="number" value={suffixPadding} onChange={e => setSuffixPadding(parseInt(e.target.value) || 2)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs" /></div>
                                    </div>
                                )}
                                {useSuffixes && (
                                    <button onClick={handleGenerateSuffixes} className="text-xs text-zinc-500 hover:text-zinc-300 underline">Generate Preview</button>
                                )}
                                {((useSuffixes && suffixes.length > 0) || (!useSuffixes && baseName)) && (
                                    <div className="bg-zinc-900/50 p-3 rounded text-[10px] font-mono text-amber-500/70 max-h-24 overflow-y-auto">
                                        {useSuffixes ? suffixes.map(s => `${baseName}${s}`).join(', ') : baseName}
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-between mt-6">
                                <button onClick={() => setStep(1)} className="px-4 py-2 bg-zinc-700 text-white rounded-lg text-sm">Back</button>
                                <button onClick={() => setStep(3)} disabled={!baseName} className="px-6 py-2 bg-violet-600 text-white rounded-lg font-medium text-sm">Next</button>
                            </div>
                        </Card>
                    )}

                    {step === 3 && (
                        <Card>
                            <h3 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
                                <Play size={18} /> Step 3: Confirmation
                            </h3>
                            <div className="space-y-4">
                                <div className="bg-zinc-800/50 p-4 rounded-lg text-sm text-zinc-400">
                                    <p>Method: <span className="text-white">{method}</span></p>
                                    <p>Domain: <span className="text-white">{selectedDomain?.domain_name || 'None'}</span></p>
                                    <p>Creating <span className="text-emerald-400 font-bold">{useSuffixes ? suffixes.length : 1}</span> Shared Drives starting with <span className="text-white">{baseName}</span></p>
                                </div>
                                {logs.length > 0 && (
                                    <div className="bg-zinc-900 p-4 rounded-lg text-[10px] font-mono text-zinc-300 max-h-40 overflow-y-auto">
                                        {logs.map((l, i) => <div key={i}>{l}</div>)}
                                    </div>
                                )}
                                <div className="flex justify-between mt-6">
                                    <button onClick={() => setStep(2)} className="px-4 py-2 bg-zinc-700 text-white rounded-lg text-sm">Back</button>
                                    <button onClick={handleCreateDrives} disabled={loading} className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm">
                                        {loading ? 'Processing...' : 'Start Creation'}
                                    </button>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>
            )}

            {/* TAB: Manage Rclone Remotes */}
            {activeTab === 'remotes' && (
                <div className="space-y-6">
                    <Card>
                        <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                            <Link size={18} /> Manage Rclone Remotes
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 space-y-3">
                                    <h4 className="text-xs font-bold text-zinc-500 uppercase">Query Auth</h4>
                                    <select
                                        value={selectedDomain?.domain_name || ''}
                                        onChange={e => setSelectedDomain(domains.find(d => d.domain_name === e.target.value) || null)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                                    >
                                        <option value="">-- Select Domain --</option>
                                        {domains.map(d => <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>)}
                                    </select>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={queryPrefix}
                                            onChange={e => setQueryPrefix(e.target.value)}
                                            placeholder="Prefix filter..."
                                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                                        />
                                        <button
                                            onClick={handleQueryDrives}
                                            disabled={queryLoading}
                                            className="px-4 py-2 bg-blue-600 text-white text-sm rounded transition"
                                        >
                                            {queryLoading ? '...' : 'Search'}
                                        </button>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={showOnlyMissing} onChange={e => setShowOnlyMissing(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                                        <span className="text-xs text-zinc-400">Drives without local remote</span>
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-4 flex flex-col h-full">
                                <div className="flex-1 min-h-[300px] border border-zinc-800 rounded bg-zinc-900/50 p-2 overflow-y-auto">
                                    {filteredQueriedDrives.length === 0 ? (
                                        <div className="text-center py-20 text-zinc-600 text-xs italic">No drives found. Search to begin.</div>
                                    ) : (
                                        <div className="space-y-1">
                                            {filteredQueriedDrives.map(d => {
                                                const isSelected = !!createdDrives.find(cd => cd.id === d.id);
                                                const remoteExists = hasRemote(d.id);
                                                return (
                                                    <div
                                                        key={d.id}
                                                        onClick={() => toggleDrivesSelection(d)}
                                                        className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs ${isSelected ? 'bg-blue-600/20 text-blue-300' : 'hover:bg-zinc-800 text-zinc-500'}`}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-mono">{d.name}</span>
                                                            <span className="text-[10px] opacity-30">{d.id}</span>
                                                        </div>
                                                        {remoteExists && <span className="text-[9px] px-1 bg-emerald-500/20 text-emerald-500 rounded">Remote OK</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                {createdDrives.length > 0 && (
                                    <div className="p-3 bg-zinc-800/50 rounded border border-zinc-700 space-y-3">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div><label className="text-[9px] text-zinc-500 uppercase">SA Dir</label><input type="text" value={saDir} onChange={e => setSaDir(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono" /></div>
                                            <div><label className="text-[9px] text-zinc-500 uppercase">Start #</label><input type="number" value={saStartCount} onChange={e => setSaStartCount(parseInt(e.target.value) || 1)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs" /></div>
                                        </div>
                                        <button onClick={handleCreateRemotes} disabled={loading} className="w-full py-2 bg-blue-600 text-white text-sm font-bold rounded">
                                            Create Remotes ({createdDrives.length})
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* TAB: Union Remotes */}
            {activeTab === 'unions' && (
                <div className="space-y-6">
                    <Card>
                        <h3 className="text-lg font-bold text-purple-400 mb-4 flex items-center gap-2">
                            <Plus size={18} /> Union Remotes
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between"><label className="text-xs font-bold text-zinc-500 uppercase">Drives for Union</label></div>
                                <div className="h-[300px] overflow-y-auto border border-zinc-800 rounded bg-zinc-900/50 p-2">
                                    {queriedDrives.map(d => (
                                        <div key={d.id} onClick={() => toggleDrivesSelection(d)} className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs ${createdDrives.some(cd => cd.id === d.id) ? 'bg-purple-600/20 text-purple-300' : 'hover:bg-zinc-800 text-zinc-500'}`}>
                                            <span className="font-mono">{d.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div><label className="text-sm text-zinc-400">Union Name</label><input type="text" value={unionName} onChange={e => setUnionName(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono" /></div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-[10px] text-zinc-500 uppercase">Action</label><select value={actionPolicy} onChange={e => setActionPolicy(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"><option value="rand">rand</option><option value="all">all</option></select></div>
                                    <div><label className="text-[10px] text-zinc-500 uppercase">Create</label><select value={createPolicy} onChange={e => setCreatePolicy(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"><option value="eprand">eprand</option><option value="mfs">mfs</option></select></div>
                                </div>
                                <button onClick={handleCreateUnion} disabled={loading || !unionName || createdDrives.length === 0} className="w-full py-3 bg-purple-600 text-white text-sm font-bold rounded transition">Create Union Remote</button>
                            </div>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default DriveManager;
