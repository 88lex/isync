import { useState, useEffect } from 'react';
import { HardDrive, Plus, Folder, Link, Settings, Check, ChevronRight, AlertCircle, Play, RefreshCw, Cloud, Terminal, Info } from 'lucide-react';
import {
    fetchConfig, DomainConfig,
    createSharedDrives, listDrives, createRcloneRemotes, createUnionRemote,
    generateSuffixes, listKeys, KeyInfo, DriveInfo,
    createDrivesUnified, checkDriveMethods, DriveMethod, MethodsResponse
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';

const DriveManager = () => {
    // Config state
    const [domains, setDomains] = useState<DomainConfig[]>([]);
    const [keys, setKeys] = useState<KeyInfo[]>([]);
    const [keysPath, setKeysPath] = useState('');

    // Wizard state
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [methodsAvailable, setMethodsAvailable] = useState<MethodsResponse | null>(null);

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
            } catch (e) {
                console.error('Failed to load data', e);
            }
        };
        loadData();
    }, []);

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

            {/* Progress Steps */}
            <div className="flex items-center gap-2 mb-6">
                {[1, 2, 3, 4, 5].map(s => (
                    <div key={s} className="flex items-center">
                        <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition
                                ${step === s ? 'bg-violet-500 text-white' :
                                    step > s ? 'bg-violet-700 text-violet-300' : 'bg-zinc-700 text-zinc-400'}`}
                        >
                            {step > s ? <Check size={16} /> : s}
                        </div>
                        {s < 5 && <ChevronRight size={16} className="text-zinc-600 mx-1" />}
                    </div>
                ))}
                <div className="ml-auto">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition"
                    >
                        <RefreshCw size={14} /> Reset
                    </button>
                </div>
            </div>

            {/* Step 1: Domain & Auth */}
            {step === 1 && (
                <Card>
                    <h3 className="text-lg font-bold text-violet-400 mb-4 flex items-center gap-2">
                        <Settings size={18} /> Step 1: Configuration
                    </h3>

                    <div className="space-y-4">
                        {/* Method Selection */}
                        <div>
                            <label className="block text-sm text-zinc-400 mb-2">Creation Method</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setMethod('fclone')}
                                    className={`p-3 rounded-lg border-2 transition flex items-center gap-2 ${method === 'fclone'
                                            ? 'border-violet-500 bg-violet-500/10'
                                            : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                                        }`}
                                >
                                    <Terminal size={18} className={method === 'fclone' ? 'text-violet-400' : 'text-zinc-400'} />
                                    <div className="text-left">
                                        <div className="font-medium text-sm">fclone CLI</div>
                                        <div className="text-xs text-zinc-500">Uses rclone fork</div>
                                    </div>
                                    {methodsAvailable && (
                                        <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${methodsAvailable.fclone.available ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                                            {methodsAvailable.fclone.available ? '✓' : '✗'}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setMethod('google_api')}
                                    className={`p-3 rounded-lg border-2 transition flex items-center gap-2 ${method === 'google_api'
                                            ? 'border-violet-500 bg-violet-500/10'
                                            : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                                        }`}
                                >
                                    <Cloud size={18} className={method === 'google_api' ? 'text-violet-400' : 'text-zinc-400'} />
                                    <div className="text-left">
                                        <div className="font-medium text-sm">Google API</div>
                                        <div className="text-xs text-zinc-500">Requires DWD</div>
                                    </div>
                                    {methodsAvailable && (
                                        <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${methodsAvailable.google_api.available ? 'bg-emerald-600/20 text-emerald-400' : 'bg-amber-600/20 text-amber-400'}`}>
                                            {methodsAvailable.google_api.available ? '✓' : 'install'}
                                        </span>
                                    )}
                                </button>
                            </div>
                            {methodsAvailable && !methodsAvailable[method].available && (
                                <div className="mt-2 p-2 bg-amber-900/20 border border-amber-700 rounded text-xs text-amber-300 flex items-start gap-2">
                                    <Info size={14} className="mt-0.5 flex-shrink-0" />
                                    {methodsAvailable[method].message}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Domain (optional)</label>
                            <select
                                value={selectedDomain?.domain_name || ''}
                                onChange={e => setSelectedDomain(domains.find(d => d.domain_name === e.target.value) || null)}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                            >
                                <option value="">-- Select Domain --</option>
                                {domains.map(d => (
                                    <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>
                                ))}
                            </select>
                        </div>

                        {/* fclone-specific fields */}
                        {method === 'fclone' && (
                            <>
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">
                                        GDrive Auth Remote <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={gdriveRemote}
                                        onChange={e => setGdriveRemote(e.target.value)}
                                        placeholder="e.g., gdriveO: (remote with admin permissions)"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                                    />
                                    <p className="text-xs text-zinc-500 mt-1">
                                        An fclone remote with admin access to create Shared Drives
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">Member Template (optional)</label>
                                    <input
                                        type="text"
                                        value={memberTemplate}
                                        onChange={e => setMemberTemplate(e.target.value)}
                                        placeholder="e.g., 00-movies: (copy permissions from this drive)"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                                    />
                                    <p className="text-xs text-zinc-500 mt-1">
                                        Existing Shared Drive to copy members/permissions from
                                    </p>
                                </div>
                            </>
                        )}

                        {/* google_api-specific fields */}
                        {method === 'google_api' && (
                            <>
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">
                                        Service Account JSON <span className="text-red-400">*</span>
                                    </label>
                                    <select
                                        value={serviceAccountFile}
                                        onChange={e => setServiceAccountFile(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                                    >
                                        <option value="">-- Select Key --</option>
                                        {keys.map(k => (
                                            <option key={k.path} value={k.path}>{k.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        Service account with Domain-Wide Delegation enabled
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">
                                        Impersonate Email <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="email"
                                        value={impersonateEmail}
                                        onChange={e => setImpersonateEmail(e.target.value)}
                                        placeholder="admin@yourdomain.com"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                    />
                                    <p className="text-xs text-zinc-500 mt-1">
                                        Admin user to impersonate (must have Shared Drive creation rights)
                                    </p>
                                </div>
                            </>
                        )}

                        {keys.length > 0 && (
                            <div className="bg-zinc-800/50 rounded-lg p-3">
                                <p className="text-xs text-zinc-400 mb-2">Available keys in {keysPath}:</p>
                                <div className="flex flex-wrap gap-1">
                                    {keys.map(k => (
                                        <span key={k.name} className="text-xs bg-zinc-700 px-2 py-0.5 rounded font-mono">
                                            {k.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end mt-6">
                        <button
                            onClick={() => setStep(2)}
                            disabled={method === 'fclone' ? !gdriveRemote : (!serviceAccountFile || !impersonateEmail)}
                            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition"
                        >
                            Next
                        </button>
                    </div>
                </Card>
            )}

            {/* Step 2: Drive Names */}
            {step === 2 && (
                <Card>
                    <h3 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
                        <Folder size={18} /> Step 2: Drive Names
                    </h3>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">
                                Base Name <span className="text-red-400">*</span>
                            </label>
                            <input
                                type="text"
                                value={baseName}
                                onChange={e => setBaseName(e.target.value)}
                                placeholder="e.g., fcl-movies"
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                            />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Start Number</label>
                                <input
                                    type="number"
                                    value={suffixStart}
                                    onChange={e => setSuffixStart(parseInt(e.target.value) || 0)}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Count</label>
                                <input
                                    type="number"
                                    value={suffixCount}
                                    onChange={e => setSuffixCount(parseInt(e.target.value) || 1)}
                                    min={1}
                                    max={50}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Increment</label>
                                <input
                                    type="number"
                                    value={suffixIncrement}
                                    onChange={e => setSuffixIncrement(parseInt(e.target.value) || 1)}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Padding</label>
                                <input
                                    type="number"
                                    value={suffixPadding}
                                    onChange={e => setSuffixPadding(parseInt(e.target.value) || 2)}
                                    min={1}
                                    max={6}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleGenerateSuffixes}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm transition"
                        >
                            Generate Preview
                        </button>

                        {suffixes.length > 0 && (
                            <div className="bg-zinc-800/50 rounded-lg p-4">
                                <p className="text-sm text-zinc-400 mb-2">Preview ({suffixes.length} drives):</p>
                                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                                    {suffixes.map(s => (
                                        <span key={s} className="text-sm font-mono bg-amber-600/20 text-amber-300 px-2 py-1 rounded">
                                            {baseName}{s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Delay Between Creations (seconds)</label>
                            <input
                                type="number"
                                value={delaySeconds}
                                onChange={e => setDelaySeconds(parseInt(e.target.value) || 5)}
                                min={5}
                                max={60}
                                className="w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                            />
                        </div>
                    </div>

                    <div className="flex justify-between mt-6">
                        <button
                            onClick={() => setStep(1)}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                        >
                            Back
                        </button>
                        <button
                            onClick={() => setStep(3)}
                            disabled={!baseName || suffixes.length === 0}
                            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition"
                        >
                            Next
                        </button>
                    </div>
                </Card>
            )}

            {/* Step 3: Create Drives */}
            {step === 3 && (
                <Card>
                    <h3 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
                        <Play size={18} /> Step 3: Create Shared Drives
                    </h3>

                    <div className="bg-zinc-800/50 rounded-lg p-4 mb-4">
                        <h4 className="text-sm font-bold text-zinc-300 mb-2">Summary</h4>
                        <ul className="text-sm text-zinc-400 space-y-1">
                            <li>• Auth Remote: <span className="text-cyan-400 font-mono">{gdriveRemote}</span></li>
                            {memberTemplate && <li>• Member Template: <span className="text-cyan-400 font-mono">{memberTemplate}</span></li>}
                            <li>• Creating <span className="text-emerald-400 font-bold">{suffixes.length}</span> Shared Drives</li>
                            <li>• Names: <span className="text-amber-400 font-mono">{baseName}{suffixes[0]}</span> to <span className="text-amber-400 font-mono">{baseName}{suffixes[suffixes.length - 1]}</span></li>
                        </ul>
                    </div>

                    {logs.length > 0 && (
                        <div className="bg-zinc-900 rounded-lg p-4 mb-4 max-h-60 overflow-y-auto">
                            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                                {logs.join('\n')}
                            </pre>
                        </div>
                    )}

                    {createErrors.length > 0 && (
                        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4">
                            <h4 className="text-sm font-bold text-red-400 flex items-center gap-1 mb-2">
                                <AlertCircle size={14} /> Errors
                            </h4>
                            {createErrors.map((e, i) => (
                                <p key={i} className="text-xs text-red-300">{e.name}: {e.error}</p>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-between mt-6">
                        <button
                            onClick={() => setStep(2)}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                        >
                            Back
                        </button>
                        <button
                            onClick={handleCreateDrives}
                            disabled={loading}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition flex items-center gap-2"
                        >
                            {loading ? 'Creating...' : <><Play size={16} /> Create Drives</>}
                        </button>
                    </div>
                </Card>
            )}

            {/* Step 4: Create Rclone Remotes */}
            {step === 4 && (
                <Card>
                    <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                        <Link size={18} /> Step 4: Create Rclone Remotes
                    </h3>

                    <div className="bg-zinc-800/50 rounded-lg p-4 mb-4">
                        <p className="text-sm text-zinc-400 mb-2">
                            Created {createdDrives.length} Shared Drives. Now create rclone remotes for them.
                        </p>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                            {createdDrives.map(d => (
                                <span key={d.id} className="text-xs font-mono bg-blue-600/20 text-blue-300 px-2 py-1 rounded">
                                    {d.name}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Service Account Directory</label>
                            <input
                                type="text"
                                value={saDir}
                                onChange={e => setSaDir(e.target.value)}
                                placeholder="/opt/sa"
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Start SA Number</label>
                            <input
                                type="number"
                                value={saStartCount}
                                onChange={e => setSaStartCount(parseInt(e.target.value) || 1)}
                                min={1}
                                className="w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                            />
                            <p className="text-xs text-zinc-500 mt-1">
                                Will use {saDir}/{saStartCount}.json, {saDir}/{saStartCount + 1}.json, ...
                            </p>
                        </div>
                    </div>

                    {logs.length > 0 && (
                        <div className="bg-zinc-900 rounded-lg p-4 mt-4 max-h-40 overflow-y-auto">
                            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                                {logs.join('\n')}
                            </pre>
                        </div>
                    )}

                    <div className="flex justify-between mt-6">
                        <button
                            onClick={() => setStep(3)}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                        >
                            Back
                        </button>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setStep(5)}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                            >
                                Skip
                            </button>
                            <button
                                onClick={handleCreateRemotes}
                                disabled={loading || createdDrives.length === 0}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition flex items-center gap-2"
                            >
                                {loading ? 'Creating...' : <><Link size={16} /> Create Remotes</>}
                            </button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Step 5: Union Remote */}
            {step === 5 && (
                <Card>
                    <h3 className="text-lg font-bold text-purple-400 mb-4 flex items-center gap-2">
                        <Plus size={18} /> Step 5: Union Remote (Optional)
                    </h3>

                    <div className="space-y-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={createUnion}
                                onChange={e => setCreateUnion(e.target.checked)}
                                className="w-4 h-4 accent-purple-500"
                            />
                            <span className="text-sm text-zinc-300">Create union remote for all drives</span>
                        </label>

                        {createUnion && (
                            <div className="space-y-4 pl-6 border-l-2 border-purple-500/30">
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">Union Remote Name</label>
                                    <input
                                        type="text"
                                        value={unionName}
                                        onChange={e => setUnionName(e.target.value)}
                                        placeholder="e.g., fcl-movies"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm text-zinc-400 mb-1">Action Policy</label>
                                        <select
                                            value={actionPolicy}
                                            onChange={e => setActionPolicy(e.target.value)}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                        >
                                            <option value="rand">rand</option>
                                            <option value="all">all</option>
                                            <option value="epall">epall</option>
                                            <option value="epmfs">epmfs</option>
                                            <option value="eplfs">eplfs</option>
                                            <option value="eprand">eprand</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm text-zinc-400 mb-1">Create Policy</label>
                                        <select
                                            value={createPolicy}
                                            onChange={e => setCreatePolicy(e.target.value)}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
                                        >
                                            <option value="eprand">eprand</option>
                                            <option value="rand">rand</option>
                                            <option value="epmfs">epmfs</option>
                                            <option value="eplfs">eplfs</option>
                                            <option value="mfs">mfs</option>
                                            <option value="lfs">lfs</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">SA File Path (optional)</label>
                                    <input
                                        type="text"
                                        value={unionSaPath}
                                        onChange={e => setUnionSaPath(e.target.value)}
                                        placeholder="/opt/sa"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 font-mono"
                                    />
                                </div>

                                <div className="bg-zinc-800/50 rounded-lg p-3">
                                    <p className="text-xs text-zinc-400 mb-1">Upstreams ({createdDrives.length}):</p>
                                    <p className="text-xs font-mono text-purple-300 break-all">
                                        {createdDrives.map(d => `${d.name}:`).join(' ')}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {logs.length > 0 && (
                        <div className="bg-zinc-900 rounded-lg p-4 mt-4 max-h-40 overflow-y-auto">
                            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                                {logs.join('\n')}
                            </pre>
                        </div>
                    )}

                    <div className="flex justify-between mt-6">
                        <button
                            onClick={() => setStep(4)}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                        >
                            Back
                        </button>
                        <div className="flex gap-2">
                            <button
                                onClick={handleReset}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition"
                            >
                                Done
                            </button>
                            {createUnion && (
                                <button
                                    onClick={handleCreateUnion}
                                    disabled={loading || !unionName}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium transition flex items-center gap-2"
                                >
                                    {loading ? 'Creating...' : <><Plus size={16} /> Create Union</>}
                                </button>
                            )}
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default DriveManager;
