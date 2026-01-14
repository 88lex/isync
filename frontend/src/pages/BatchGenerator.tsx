import { useState, useEffect } from 'react';
import { Terminal, Copy, Play, FileCode, Zap, Save, FolderOpen, Users, BarChart3, ChevronDown, ChevronUp, X, Plus, Trash2, Edit2, Server, HardDrive, Folder, ChevronRight, Check } from 'lucide-react';
import {
    fetchConfig, fetchSyncList, generateBatch, startJob, saveBatch, listSavedBatches,
    getBatchFile, SyncPair, Config, BatchFile, getBatchUsers, compareBatchUsers,
    BatchUsersResponse, BatchCompareResponse, deleteBatchFile, deleteSyncPair,
    fetchSSHServers, SSHServer, listServerFolders, listServerRemotes, listRemotePath,
    RemoteFolder, RcloneRemote, createSyncPair
} from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useSetToggle } from '../hooks/useSetToggle';

const BatchGenerator = () => {
    const [config, setConfig] = useState<Config>({});
    const [pairs, setPairs] = useState<SyncPair[]>([]);

    // Get selected users from session storage (shared with User Management)
    const [selectedUsers] = useState<Set<string>>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.SELECTED_USERS);
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });

    // Batch State - using shared hook
    const { set: selectedPairs, toggle: togglePair, clear: clearPairs, addAll: selectAllPairsSet } = useSetToggle<number>(new Set());
    const [batchResults, setBatchResults] = useState<Record<string, string>>({});
    const [batchLoading, setBatchLoading] = useState(false);

    // Save Batch State
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [saveFilename, setSaveFilename] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedBatches, setSavedBatches] = useState<BatchFile[]>([]);
    const [showLoadDialog, setShowLoadDialog] = useState(false);
    const [loadedContent, setLoadedContent] = useState<string | null>(null);

    // Batch Users Comparison State
    const [showBatchUsersModal, setShowBatchUsersModal] = useState(false);
    const [batchUsersFilename, setBatchUsersFilename] = useState<string | null>(null);
    const [batchUsersData, setBatchUsersData] = useState<BatchUsersResponse | null>(null);
    const [compareResult, setCompareResult] = useState<BatchCompareResponse | null>(null);
    const [comparingUsers, setComparingUsers] = useState(false);
    const [expandedBatchFile, setExpandedBatchFile] = useState<string | null>(null);

    // Sync Pair Wizard State
    const [showWizard, setShowWizard] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [servers, setServers] = useState<SSHServer[]>([]);
    const [selectedServer, setSelectedServer] = useState<string | null>(null);
    const [browseBasePath, setBrowseBasePath] = useState('/');
    const [browseDepth, setBrowseDepth] = useState(2);
    const [folderTree, setFolderTree] = useState<RemoteFolder[]>([]);
    const [selectedSourceFolder, setSelectedSourceFolder] = useState<string | null>(null);
    const [rcloneRemotes, setRcloneRemotes] = useState<RcloneRemote[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
    const [targetPath, setTargetPath] = useState('');
    const [wizardLoading, setWizardLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const c = await fetchConfig();
        setConfig(c);
        const p = await fetchSyncList();
        setPairs(p);
    };

    const selectAllPairs = () => {
        if (selectedPairs.size === pairs.length) {
            clearPairs();
        } else {
            selectAllPairsSet(pairs.map((_, i) => i));
        }
    };

    const generate = async (dryRun: boolean) => {
        if (selectedPairs.size === 0) return alert("Select at least one sync pair.");
        setBatchLoading(true);
        setBatchResults({});
        try {
            const selectedP = pairs.filter((_, i) => selectedPairs.has(i));

            const res = await generateBatch({
                pairs: selectedP,
                dry_run: dryRun,
                selected_users: selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined
            });
            setBatchResults(res.commands);
        } catch (e: any) {
            alert(`Failed: ${e.message}`);
        } finally {
            setBatchLoading(false);
        }
    };

    const runBatch = async (dryRun: boolean) => {
        if (!confirm(`Are you sure you want to START ${dryRun ? "TEST" : "REAL"} execution for ${selectedPairs.size} pair(s)?`)) return;
        setBatchLoading(true);
        try {
            const selectedP = pairs.filter((_, i) => selectedPairs.has(i));
            if (selectedP.length === 0) return alert("Select at least one sync pair.");

            await startJob({
                pairs: selectedP,
                dry_run: dryRun,
                selected_users: selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined
            });
            alert("✅ Batch Job Started! Check 'Dashboard' for progress.");
        } catch (e: any) {
            alert(`Failed to start batch: ${e.message}`);
        } finally {
            setBatchLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const copyAllCommands = () => {
        const allCmds = Object.entries(batchResults).map(([label, cmd]) => `# ${label}\n${cmd}`).join('\n\n');
        navigator.clipboard.writeText(allCmds);
        alert(`Copied ${Object.keys(batchResults).length} commands to clipboard!`);
    };

    const handleSaveBatch = async () => {
        if (Object.keys(batchResults).length === 0) {
            return alert('Generate commands first before saving.');
        }
        setSaving(true);
        try {
            const filename = saveFilename.trim() || `batch_${new Date().toISOString().slice(0, 10)}`;
            const result = await saveBatch({
                filename,
                commands: batchResults,
                include_header: true
            });
            alert(`✅ Saved ${result.commands_saved} commands to ${result.file}`);
            setShowSaveDialog(false);
            setSaveFilename('');
            loadSavedBatches();
        } catch (e: any) {
            alert(`Failed to save: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const loadSavedBatches = async () => {
        try {
            const files = await listSavedBatches();
            setSavedBatches(files);
        } catch (e) {
            console.error('Failed to load saved batches', e);
        }
    };

    const handleLoadBatch = async (filename: string) => {
        try {
            const data = await getBatchFile(filename);
            setLoadedContent(data.content);
        } catch (e: any) {
            alert(`Failed to load: ${e.message}`);
        }
    };

    const openBatchUsersModal = async (filename: string) => {
        setBatchUsersFilename(filename);
        setBatchUsersData(null);
        setCompareResult(null);
        setShowBatchUsersModal(true);

        try {
            const data = await getBatchUsers(filename);
            setBatchUsersData(data);
        } catch (e: any) {
            alert(`Failed to load batch users: ${e.message}`);
        }
    };

    const handleCompareWithSelected = async () => {
        if (!batchUsersFilename) return;

        setComparingUsers(true);
        try {
            // Compare with selected users from User Management
            const compareUsers = selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined;
            const result = await compareBatchUsers({
                filename: batchUsersFilename,
                compare_users: compareUsers
            });
            setCompareResult(result);
        } catch (e: any) {
            alert(`Comparison failed: ${e.message}`);
        } finally {
            setComparingUsers(false);
        }
    };

    const handleCompareWithDomain = async () => {
        if (!batchUsersFilename || !batchUsersData?.domain) return;

        setComparingUsers(true);
        try {
            const result = await compareBatchUsers({
                filename: batchUsersFilename,
                domain: batchUsersData.domain
            });
            setCompareResult(result);
        } catch (e: any) {
            alert(`Comparison failed: ${e.message}`);
        } finally {
            setComparingUsers(false);
        }
    };

    // Delete handlers
    const handleDeleteBatch = async (filename: string) => {
        if (!confirm(`Delete batch file "${filename}"?`)) return;
        try {
            await deleteBatchFile(filename);
            await loadSavedBatches();
        } catch (e: any) {
            alert(`Failed to delete: ${e.message}`);
        }
    };

    const handleDeleteSyncPair = async (index: number) => {
        const pair = pairs[index];
        if (!confirm(`Delete sync pair?\n${pair.source} → ${pair.dest}`)) return;
        try {
            await deleteSyncPair(index);
            const p = await fetchSyncList();
            setPairs(p);
        } catch (e: any) {
            alert(`Failed to delete: ${e.message}`);
        }
    };

    // Wizard handlers
    const openWizard = async () => {
        setShowWizard(true);
        setWizardStep(1);
        setSelectedServer(null);
        setFolderTree([]);
        setSelectedSourceFolder(null);
        setRcloneRemotes([]);
        setSelectedRemote(null);
        setTargetPath('');
        setBrowseBasePath('/');

        // Load servers
        try {
            const srv = await fetchSSHServers();
            setServers(srv);
        } catch (e) {
            console.error('Failed to load servers', e);
        }
    };

    const loadFolders = async () => {
        if (!selectedServer) return;
        setWizardLoading(true);
        try {
            const result = await listServerFolders(selectedServer, browseBasePath, browseDepth);
            if (result.status === 'ok') {
                setFolderTree(result.tree);
            } else {
                alert('Failed to list folders: ' + (result.message || 'Unknown error'));
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            setWizardLoading(false);
        }
    };

    const loadRemotes = async () => {
        if (!selectedServer) return;
        setWizardLoading(true);
        try {
            const result = await listServerRemotes(selectedServer);
            if (result.status === 'ok') {
                setRcloneRemotes(result.remotes);
            } else {
                alert('Failed to list remotes');
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            setWizardLoading(false);
        }
    };

    const handleCreateSyncPair = async () => {
        if (!selectedSourceFolder || !selectedRemote) {
            alert('Please select source folder and rclone remote');
            return;
        }

        const newPair: SyncPair = {
            source: selectedSourceFolder,
            dest: `${selectedRemote}:${targetPath}`
        };

        setWizardLoading(true);
        try {
            await createSyncPair(newPair);
            const p = await fetchSyncList();
            setPairs(p);
            setShowWizard(false);
            alert(`✅ Sync pair created!\n${newPair.source} → ${newPair.dest}`);
        } catch (e: any) {
            if (e.response?.status === 409) {
                alert('This sync pair already exists!');
            } else {
                alert(`Failed to create: ${e.message}`);
            }
        } finally {
            setWizardLoading(false);
        }
    };

    useEffect(() => {
        loadSavedBatches();
    }, []);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">

            {/* Header */}
            <PageHeader
                icon={FileCode}
                title="Batch Generator"
                subtitle="Generate and execute rclone commands"
                gradient="from-amber-600 to-orange-600"
            />

            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                {/* Main Card */}
                <Card>
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-amber-400">
                            <Terminal size={18} /> Command Generator
                        </h2>
                        <div className="flex gap-2">
                            <button
                                onClick={() => generate(true)}
                                disabled={batchLoading}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-amber-400 text-xs font-bold uppercase tracking-wider transition flex items-center gap-2"
                            >
                                <Zap size={14} /> Dry Run
                            </button>
                            <button
                                onClick={() => generate(false)}
                                disabled={batchLoading}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-200 text-xs font-bold uppercase tracking-wider transition"
                            >
                                Generate Cmds
                            </button>
                            <div className="w-px bg-zinc-700 mx-2"></div>
                            <button
                                onClick={() => runBatch(false)}
                                disabled={batchLoading || selectedPairs.size === 0}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-white text-xs font-bold uppercase tracking-wider transition shadow-lg shadow-indigo-900/20 flex items-center gap-2"
                            >
                                <Play size={12} /> Run Batch
                            </button>
                        </div>
                    </div>

                    {/* User Selection Info */}
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${selectedUsers.size > 0 ? 'bg-emerald-500' : 'bg-zinc-600'}`}></div>
                                <span className="text-sm text-zinc-300">
                                    {selectedUsers.size > 0 ? (
                                        <>Generating for <span className="text-indigo-400 font-bold">{selectedUsers.size} selected users</span> from User Management</>
                                    ) : (
                                        <>Generating for <span className="text-zinc-400">ALL users</span> in source</>
                                    )}
                                </span>
                            </div>
                            {selectedUsers.size > 0 && (
                                <span className="text-xs text-zinc-500">
                                    (Selection persists from User Management page)
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Sync Pairs Selection */}
                    <div className="mb-4 flex items-center justify-between">
                        <span className="text-sm text-zinc-400">
                            Select sync pairs ({selectedPairs.size} of {pairs.length} selected)
                        </span>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={openWizard}
                                className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
                            >
                                <Plus size={14} /> New Sync Pair
                            </button>
                            <button
                                onClick={selectAllPairs}
                                className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                            >
                                {selectedPairs.size === pairs.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                        {pairs.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="text-zinc-500 italic mb-3">No sync pairs configured.</div>
                                <button
                                    onClick={openWizard}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 mx-auto"
                                >
                                    <Plus size={16} /> Create First Sync Pair
                                </button>
                            </div>
                        ) : (
                            pairs.map((p, i) => (
                                <div
                                    key={i}
                                    className={`flex items-center gap-3 p-4 rounded-lg border transition ${selectedPairs.has(i)
                                        ? 'bg-indigo-900/20 border-indigo-500/50'
                                        : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                                        }`}
                                >
                                    <div
                                        onClick={() => togglePair(i)}
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition cursor-pointer ${selectedPairs.has(i) ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'
                                            }`}>
                                        {selectedPairs.has(i) && <div className="w-2 h-2 bg-white rounded-sm" />}
                                    </div>
                                    <div
                                        onClick={() => togglePair(i)}
                                        className="flex-1 grid grid-cols-2 gap-4 text-sm font-mono cursor-pointer"
                                    >
                                        <div className="text-orange-300 truncate" title={p.source}>
                                            <span className="text-zinc-500 text-xs mr-2">SRC:</span>
                                            {p.source}
                                        </div>
                                        <div className="text-blue-300 truncate" title={p.dest}>
                                            <span className="text-zinc-500 text-xs mr-2">DST:</span>
                                            {p.dest}
                                        </div>
                                    </div>
                                    {p.domain_reference && (
                                        <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                                            {p.domain_reference}
                                        </span>
                                    )}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSyncPair(i); }}
                                        className="text-zinc-600 hover:text-red-400 transition p-1"
                                        title="Delete sync pair"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </Card>

                {/* Output Section */}
                {Object.keys(batchResults).length > 0 && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">
                                Generated Commands ({Object.keys(batchResults).length})
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowSaveDialog(true)}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-xs text-white font-medium transition"
                                >
                                    <Save size={14} /> Save Batch
                                </button>
                                <button
                                    onClick={copyAllCommands}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 font-medium transition"
                                >
                                    <Copy size={14} /> Copy All
                                </button>
                            </div>
                        </div>

                        {Object.entries(batchResults).map(([label, cmd]) => (
                            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
                                <div className="bg-zinc-800/50 px-4 py-3 border-b border-zinc-800 flex justify-between items-center">
                                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{label}</span>
                                    <button
                                        onClick={() => copyToClipboard(cmd)}
                                        className="flex items-center gap-1 text-zinc-500 hover:text-white transition text-xs"
                                        title="Copy to Clipboard"
                                    >
                                        <Copy size={14} /> Copy
                                    </button>
                                </div>
                                <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto">
                                    {cmd}
                                </pre>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Save Batch Dialog */}
            {showSaveDialog && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Save size={20} className="text-emerald-400" />
                            Save Batch Commands
                        </h3>
                        <p className="text-sm text-zinc-400 mb-4">
                            Save {Object.keys(batchResults).length} commands to a file in <code className="bg-zinc-800 px-1 rounded">isync_batch/</code> folder
                        </p>
                        <input
                            type="text"
                            value={saveFilename}
                            onChange={(e) => setSaveFilename(e.target.value)}
                            placeholder="Enter filename (e.g., migration_jan2026)"
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 mb-4 focus:outline-none focus:border-emerald-500"
                        />
                        <p className="text-xs text-zinc-500 mb-4">
                            File will be saved as <span className="text-emerald-400">{saveFilename || 'batch_YYYYMMDD'}.sh</span>
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowSaveDialog(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveBatch}
                                disabled={saving}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                            >
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>

                        {/* Show previously saved batches */}
                        {savedBatches.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-zinc-800">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                    Previously Saved ({savedBatches.length})
                                </h4>
                                <div className="max-h-32 overflow-y-auto space-y-1">
                                    {savedBatches.slice(0, 5).map((f) => (
                                        <div key={f.name} className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-800/50 px-2 py-1 rounded">
                                            <span className="truncate">{f.name}</span>
                                            <span className="text-zinc-600">{(f.size / 1024).toFixed(1)} KB</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Saved Batches Card */}
            {savedBatches.length > 0 && (
                <Card>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-cyan-400">
                            <FolderOpen size={18} /> Saved Batches
                        </h2>
                        <button
                            onClick={loadSavedBatches}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                        >
                            Refresh
                        </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {savedBatches.map((f) => (
                            <div
                                key={f.name}
                                className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <FileCode size={16} className="text-amber-400" />
                                        <span className="text-sm font-medium text-zinc-200">{f.name}</span>
                                        <span className="text-xs text-zinc-600">
                                            {(f.size / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => openBatchUsersModal(f.name)}
                                            className="flex items-center gap-1 px-2 py-1 bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white rounded text-xs transition"
                                            title="View/Compare Users"
                                        >
                                            <Users size={12} /> Users
                                        </button>
                                        <button
                                            onClick={() => handleLoadBatch(f.name)}
                                            className="flex items-center gap-1 px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition"
                                            title="View Content"
                                        >
                                            <Copy size={12} /> View
                                        </button>
                                        <button
                                            onClick={() => handleDeleteBatch(f.name)}
                                            className="flex items-center gap-1 px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition"
                                            title="Delete Batch"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>

                                {/* Loaded Content Preview */}
                                {loadedContent && f.name === batchUsersFilename && (
                                    <div className="mt-3 bg-zinc-900 rounded border border-zinc-800 p-2 max-h-40 overflow-y-auto">
                                        <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap">
                                            {loadedContent.slice(0, 1000)}
                                            {loadedContent.length > 1000 && '...'}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Batch Users Modal */}
            {showBatchUsersModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 overflow-y-auto p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-3xl shadow-2xl my-8">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Users size={20} className="text-purple-400" />
                                Batch Users - {batchUsersFilename}
                            </h3>
                            <button
                                onClick={() => setShowBatchUsersModal(false)}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {!batchUsersData ? (
                            <div className="text-center py-8 text-zinc-400">Loading users...</div>
                        ) : (
                            <>
                                {/* User Count Summary */}
                                <div className="flex items-center gap-4 mb-4 text-sm">
                                    <div className="bg-purple-600/20 px-3 py-2 rounded">
                                        <span className="text-purple-400 font-bold">{batchUsersData.count}</span>
                                        <span className="text-zinc-400 ml-2">users in batch</span>
                                    </div>
                                    {batchUsersData.domain && (
                                        <div className="bg-zinc-800 px-3 py-2 rounded">
                                            <span className="text-zinc-400">Domain:</span>
                                            <span className="text-cyan-400 ml-2 font-medium">{batchUsersData.domain}</span>
                                        </div>
                                    )}
                                    {selectedUsers.size > 0 && (
                                        <div className="bg-emerald-600/20 px-3 py-2 rounded">
                                            <span className="text-emerald-400 font-bold">{selectedUsers.size}</span>
                                            <span className="text-zinc-400 ml-2">selected in User Mgmt</span>
                                        </div>
                                    )}
                                </div>

                                {/* Compare Actions */}
                                <div className="flex gap-2 mb-4">
                                    {selectedUsers.size > 0 && (
                                        <button
                                            onClick={handleCompareWithSelected}
                                            disabled={comparingUsers}
                                            className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-medium transition"
                                        >
                                            <BarChart3 size={14} />
                                            Compare with {selectedUsers.size} Selected Users
                                        </button>
                                    )}
                                    {batchUsersData.domain && (
                                        <button
                                            onClick={handleCompareWithDomain}
                                            disabled={comparingUsers}
                                            className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded text-sm font-medium transition"
                                        >
                                            <BarChart3 size={14} />
                                            Compare with All {batchUsersData.domain} Users
                                        </button>
                                    )}
                                </div>

                                {/* Comparison Results */}
                                {compareResult && (
                                    <div className="mb-4 bg-zinc-800/50 p-4 rounded-lg border border-zinc-700">
                                        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                                            <BarChart3 size={14} className="text-emerald-400" />
                                            Comparison Results
                                        </h4>

                                        <div className="grid grid-cols-3 gap-4 mb-4">
                                            <div className="bg-zinc-900 p-3 rounded text-center">
                                                <div className="text-2xl font-bold text-emerald-400">{compareResult.in_both.length}</div>
                                                <div className="text-xs text-zinc-400">In Both</div>
                                            </div>
                                            <div className="bg-zinc-900 p-3 rounded text-center">
                                                <div className="text-2xl font-bold text-amber-400">{compareResult.in_batch_only.length}</div>
                                                <div className="text-xs text-zinc-400">Batch Only</div>
                                            </div>
                                            <div className="bg-zinc-900 p-3 rounded text-center">
                                                <div className="text-2xl font-bold text-red-400">{compareResult.in_compare_only.length}</div>
                                                <div className="text-xs text-zinc-400">Missing from Batch</div>
                                            </div>
                                        </div>

                                        {/* Coverage Bar */}
                                        <div className="mb-4">
                                            <div className="flex justify-between text-xs text-zinc-400 mb-1">
                                                <span>Batch Coverage</span>
                                                <span>{compareResult.batch_coverage}%</span>
                                            </div>
                                            <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-500 transition-all"
                                                    style={{ width: `${compareResult.batch_coverage}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Missing Users List */}
                                        {compareResult.in_compare_only.length > 0 && (
                                            <div>
                                                <h5 className="text-xs font-bold text-red-400 mb-2">
                                                    Missing from Batch ({compareResult.in_compare_only.length}):
                                                </h5>
                                                <div className="max-h-24 overflow-y-auto bg-zinc-900 rounded p-2">
                                                    <div className="flex flex-wrap gap-1">
                                                        {compareResult.in_compare_only.slice(0, 50).map((email) => (
                                                            <span key={email} className="text-xs bg-red-600/20 text-red-400 px-2 py-0.5 rounded">
                                                                {email.split('@')[0]}
                                                            </span>
                                                        ))}
                                                        {compareResult.in_compare_only.length > 50 && (
                                                            <span className="text-xs text-zinc-500">
                                                                +{compareResult.in_compare_only.length - 50} more
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* User List */}
                                <div>
                                    <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                        Users in Batch ({batchUsersData.users.length})
                                    </h4>
                                    <div className="max-h-48 overflow-y-auto bg-zinc-800/50 rounded p-3">
                                        <div className="flex flex-wrap gap-1">
                                            {batchUsersData.users.map((email) => {
                                                const inSelected = selectedUsers.has(email);
                                                return (
                                                    <span
                                                        key={email}
                                                        className={`text-xs px-2 py-0.5 rounded ${inSelected
                                                            ? 'bg-emerald-600/30 text-emerald-400'
                                                            : 'bg-zinc-700 text-zinc-300'
                                                            }`}
                                                        title={email}
                                                    >
                                                        {email.split('@')[0]}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="flex justify-end mt-4">
                            <button
                                onClick={() => setShowBatchUsersModal(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sync Pair Wizard Modal */}
            {showWizard && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 overflow-y-auto p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl my-8">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Plus size={20} className="text-emerald-400" />
                                New Sync Pair - Step {wizardStep} of 4
                            </h3>
                            <button
                                onClick={() => setShowWizard(false)}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Step Indicator */}
                        <div className="flex gap-2 mb-6">
                            {[1, 2, 3, 4].map(step => (
                                <div
                                    key={step}
                                    className={`flex-1 h-2 rounded ${step === wizardStep ? 'bg-emerald-500' : step < wizardStep ? 'bg-emerald-700' : 'bg-zinc-700'}`}
                                />
                            ))}
                        </div>

                        {/* Step 1: Select Server */}
                        {wizardStep === 1 && (
                            <div className="space-y-4">
                                <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <Server size={16} className="text-cyan-400" /> Select Remote Server
                                </h4>
                                {servers.length === 0 ? (
                                    <div className="text-center py-8 text-zinc-500">
                                        No SSH servers configured. Add them in Remote Servers page.
                                    </div>
                                ) : (
                                    <div className="grid gap-2 max-h-64 overflow-y-auto">
                                        {servers.map(srv => (
                                            <button
                                                key={srv.id}
                                                onClick={() => setSelectedServer(srv.id)}
                                                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition ${selectedServer === srv.id
                                                    ? 'bg-cyan-900/30 border-cyan-500'
                                                    : 'border-zinc-700 hover:border-zinc-600'
                                                    }`}
                                            >
                                                <Server size={16} className={selectedServer === srv.id ? 'text-cyan-400' : 'text-zinc-500'} />
                                                <div>
                                                    <div className="text-sm font-medium text-zinc-200">{srv.name}</div>
                                                    <div className="text-xs text-zinc-500">{srv.alias || srv.host}</div>
                                                </div>
                                                {selectedServer === srv.id && <Check size={16} className="text-cyan-400 ml-auto" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 2: Browse Folders */}
                        {wizardStep === 2 && (
                            <div className="space-y-4">
                                <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <Folder size={16} className="text-amber-400" /> Select Source Folder
                                </h4>
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="text"
                                        value={browseBasePath}
                                        onChange={e => setBrowseBasePath(e.target.value)}
                                        placeholder="Base path (e.g. /zmedia)"
                                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                                    />
                                    <select
                                        value={browseDepth}
                                        onChange={e => setBrowseDepth(parseInt(e.target.value))}
                                        className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                                    >
                                        <option value={1}>1 Level</option>
                                        <option value={2}>2 Levels</option>
                                        <option value={3}>3 Levels</option>
                                    </select>
                                    <button
                                        onClick={loadFolders}
                                        disabled={wizardLoading}
                                        className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
                                    >
                                        {wizardLoading ? 'Loading...' : 'Browse'}
                                    </button>
                                </div>
                                <div className="max-h-64 overflow-y-auto bg-zinc-800/50 rounded-lg p-2">
                                    {folderTree.length === 0 ? (
                                        <div className="text-center py-4 text-zinc-500 text-sm">
                                            Enter a path and click Browse to list folders
                                        </div>
                                    ) : (
                                        folderTree.map((f, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setSelectedSourceFolder(f.path)}
                                                className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded text-sm transition ${selectedSourceFolder === f.path
                                                    ? 'bg-amber-600/30 text-amber-300'
                                                    : 'hover:bg-zinc-700 text-zinc-300'
                                                    }`}
                                                style={{ paddingLeft: `${12 + f.depth * 16}px` }}
                                            >
                                                <Folder size={14} className={selectedSourceFolder === f.path ? 'text-amber-400' : 'text-zinc-500'} />
                                                {f.name}
                                                {selectedSourceFolder === f.path && <Check size={14} className="ml-auto text-amber-400" />}
                                            </button>
                                        ))
                                    )}
                                </div>
                                {selectedSourceFolder && (
                                    <div className="text-sm text-zinc-400">
                                        Selected: <span className="text-amber-300 font-mono">{selectedSourceFolder}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 3: Select Rclone Remote */}
                        {wizardStep === 3 && (
                            <div className="space-y-4">
                                <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <HardDrive size={16} className="text-purple-400" /> Select Rclone Remote
                                </h4>
                                <button
                                    onClick={loadRemotes}
                                    disabled={wizardLoading}
                                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
                                >
                                    {wizardLoading ? 'Loading...' : 'Load Remotes from Server'}
                                </button>
                                <div className="max-h-64 overflow-y-auto bg-zinc-800/50 rounded-lg p-2">
                                    {rcloneRemotes.length === 0 ? (
                                        <div className="text-center py-4 text-zinc-500 text-sm">
                                            Click "Load Remotes" to fetch rclone configuration
                                        </div>
                                    ) : (
                                        rcloneRemotes.map((r, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setSelectedRemote(r.name)}
                                                className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded text-sm transition ${selectedRemote === r.name
                                                    ? 'bg-purple-600/30 text-purple-300'
                                                    : 'hover:bg-zinc-700 text-zinc-300'
                                                    }`}
                                            >
                                                <HardDrive size={14} className={selectedRemote === r.name ? 'text-purple-400' : 'text-zinc-500'} />
                                                <span className="font-mono">{r.name}</span>
                                                <span className="text-xs text-zinc-500 ml-2">({r.type})</span>
                                                {selectedRemote === r.name && <Check size={14} className="ml-auto text-purple-400" />}
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Step 4: Target Path & Review */}
                        {wizardStep === 4 && (
                            <div className="space-y-4">
                                <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                    <ChevronRight size={16} className="text-blue-400" /> Target Path & Review
                                </h4>
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Target Path in Remote (optional)</label>
                                    <input
                                        type="text"
                                        value={targetPath}
                                        onChange={e => setTargetPath(e.target.value)}
                                        placeholder="e.g. Backups/Media"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                                    />
                                </div>

                                <div className="bg-zinc-800/50 p-4 rounded-lg border border-zinc-700 mt-4">
                                    <h5 className="text-xs font-bold text-zinc-400 uppercase mb-3">Preview</h5>
                                    <div className="space-y-2 text-sm font-mono">
                                        <div className="flex items-center gap-2">
                                            <span className="text-zinc-500">Source:</span>
                                            <span className="text-amber-300">{selectedSourceFolder || '(not selected)'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-zinc-500">Destination:</span>
                                            <span className="text-blue-300">{selectedRemote}:{targetPath}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Navigation */}
                        <div className="flex justify-between mt-6">
                            <button
                                onClick={() => setWizardStep(Math.max(1, wizardStep - 1))}
                                disabled={wizardStep === 1}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Back
                            </button>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowWizard(false)}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                                >
                                    Cancel
                                </button>
                                {wizardStep < 4 ? (
                                    <button
                                        onClick={() => setWizardStep(wizardStep + 1)}
                                        disabled={
                                            (wizardStep === 1 && !selectedServer) ||
                                            (wizardStep === 2 && !selectedSourceFolder) ||
                                            (wizardStep === 3 && !selectedRemote)
                                        }
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
                                    >
                                        Next
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleCreateSyncPair}
                                        disabled={wizardLoading || !selectedSourceFolder || !selectedRemote}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                                    >
                                        <Check size={16} />
                                        {wizardLoading ? 'Creating...' : 'Create Sync Pair'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchGenerator;
