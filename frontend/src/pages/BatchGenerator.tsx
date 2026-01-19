import { useState, useEffect } from 'react';
import { Terminal, Copy, Play, Zap, Save, Users, Layers, X, Plus, Trash2, FileCode, ChevronDown, ChevronRight } from 'lucide-react';
import {
    fetchConfig, fetchSyncList, generateBatch, startJob, saveBatch, listSavedBatches,
    getBatchFile, SyncPair, Config, BatchFile, getBatchUsers,
    BatchUsersResponse, BatchCompareResponse, deleteSyncPair,
    fetchSSHServers, SSHServer, generateRandomBatch, getUserBatchSummary,
    RandomBatchResponse, UserSummaryResponse, listBatchGroups, createBatchGroup,
    deleteBatchGroup, generateGroupScript, BatchGroup, pushBatch, pushBatchGroup,
    getGroupScript, regenerateBatch, getSyncPairsWithBatches, bulkGenerateBatches, SyncPairWithBatch,
    checkGroupRemote, pullGroupRemote, deleteGroupRemote
} from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useDataTable } from '../hooks/useDataTable';

// Imported Components
import { RandomBatchSettings } from '../components/batch/RandomBatchSettings';
import { SyncPairList } from '../components/batch/SyncPairList';
import { BatchList } from '../components/batch/BatchList';
import { BatchWizard } from '../components/batch/BatchWizard';

interface BatchGeneratorProps {
    activeSection?: string | null;
}

const BatchGenerator: React.FC<BatchGeneratorProps> = ({ activeSection }) => {
    // Scroll to section when activeSection changes
    useEffect(() => {
        if (activeSection) {
            const element = document.getElementById(activeSection);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [activeSection]);

    // Data State
    const [config, setConfig] = useState<Config>({});
    const [unifiedPairs, setUnifiedPairs] = useState<SyncPairWithBatch[]>([]);

    // Shared States
    const [selectedUsers] = useState<Set<string>>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.SELECTED_USERS);
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });

    // Table Hook for Sync Pairs
    const {
        data: sortedFilteredPairs,
        columnFilters: pairFilters,
        toggleColumnFilter: togglePairFilter,
        clearColumnFilter: clearPairFilter,
        getUniqueValues: getPairUniqueValues,
        selectedItems: selectedPairIndices,
        toggleItem: togglePair,
        selectAll: selectAllPairs,
        invertSelection: invertPairs,
        handleSort: handlePairSort,
        SortIcon: PairSortIcon
    } = useDataTable({
        data: unifiedPairs,
        columns: [
            { key: 'source', header: 'Source Path', sortable: true },
            { key: 'dest', header: 'Destination', sortable: true },
            { key: 'status', header: 'Batch Status', filterable: true }
        ],
        persistentKey: 'bg_sync_pairs',
        rowIdKey: 'index'
    });

    // Batch Results State
    const [batchResults, setBatchResults] = useState<Record<string, string>>({});
    const [batchLoading, setBatchLoading] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [saveFilename, setSaveFilename] = useState('');
    const [saving, setSaving] = useState(false);

    // Saved Batches State
    const [savedBatches, setSavedBatches] = useState<BatchFile[]>([]);
    const [batchContentCache, setBatchContentCache] = useState<Record<string, string>>({});
    const [remoteStatusCache, setRemoteStatusCache] = useState<Record<string, Record<string, boolean>>>({});
    const [batchOperationLoading, setBatchOperationLoading] = useState<string | null>(null);

    // Modals
    const [showBatchUsersModal, setShowBatchUsersModal] = useState(false);
    const [batchUsersFilename, setBatchUsersFilename] = useState<string | null>(null);
    const [batchUsersData, setBatchUsersData] = useState<BatchUsersResponse | null>(null);
    const [showWizard, setShowWizard] = useState(false);
    const [editingPair, setEditingPair] = useState<SyncPairWithBatch | null>(null);
    const [showUserSummary, setShowUserSummary] = useState(false);
    const [userSummaryData, setUserSummaryData] = useState<UserSummaryResponse | null>(null);
    const [loadingUserSummary, setLoadingUserSummary] = useState(false);

    // Random Settings
    const [randomUserCount, setRandomUserCount] = useState(() => {
        const saved = localStorage.getItem('isync_bg_random_count');
        return saved ? parseInt(saved) : 10;
    });
    const [selectedDomains, setSelectedDomains] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem('isync_bg_domains');
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch { return new Set(); }
    });
    const [randomOrder, setRandomOrder] = useState(() => {
        return localStorage.getItem('isync_random_order') === 'true';
    });
    const [randomBatchResult, setRandomBatchResult] = useState<RandomBatchResponse | null>(null);

    // Groups
    const [batchGroups, setBatchGroups] = useState<BatchGroup[]>([]);
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDescription, setNewGroupDescription] = useState('');
    const [selectedBatchesForGroup, setSelectedBatchesForGroup] = useState<Set<string>>(new Set());
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [groupScriptCache, setGroupScriptCache] = useState<Record<string, string>>({});
    const [groupRemoteStatus, setGroupRemoteStatus] = useState<Record<string, Record<string, boolean>>>({});
    const [groupOperationLoading, setGroupOperationLoading] = useState<string | null>(null);

    // SSH
    const [sshServers, setSshServers] = useState<SSHServer[]>([]);
    const [showPushModal, setShowPushModal] = useState(false);
    const [pushTargetType, setPushTargetType] = useState<'batch' | 'group'>('batch');
    const [pushTargetId, setPushTargetId] = useState('');
    const [selectedServerId, setSelectedServerId] = useState('');
    const [selectedPushServers, setSelectedPushServers] = useState<Set<string>>(new Set());
    const [pushing, setPushing] = useState(false);
    const [pushResults, setPushResults] = useState<any[]>([]);
    const [showPushResults, setShowPushResults] = useState(false);
    const [pushStatus, setPushStatus] = useState<string>('');

    // Persistence
    useEffect(() => { localStorage.setItem('isync_bg_random_count', String(randomUserCount)); }, [randomUserCount]);
    useEffect(() => { localStorage.setItem('isync_bg_domains', JSON.stringify([...selectedDomains])); }, [selectedDomains]);
    useEffect(() => { localStorage.setItem('isync_random_order', String(randomOrder)); }, [randomOrder]);

    // Initial Load
    const loadData = async () => {
        const c = await fetchConfig();
        setConfig(c);
        await loadBatchGroups();
        await loadUnifiedPairs();
        try {
            const s = await fetchSSHServers();
            setSshServers(s);
            if (s.length > 0) setSelectedServerId(s[0].id);
        } catch (e) { console.error(e) }
        await loadSavedBatches();
    };

    const loadUnifiedPairs = async () => {
        try {
            const data = await getSyncPairsWithBatches();
            setUnifiedPairs(data.pairs);
        } catch (e) { console.error('Failed to load unified pairs', e); }
    };

    const loadSavedBatches = async () => {
        try {
            const files = await listSavedBatches();
            setSavedBatches(files);
        } catch (e) { console.error('Failed to load saved batches', e); }
    };

    const loadBatchGroups = async () => {
        try {
            const groups = await listBatchGroups();
            setBatchGroups(groups);
        } catch (e) { console.error('Failed to load batch groups', e); }
    };

    useEffect(() => { loadData(); }, []);

    useEffect(() => {
        if (config.domains && config.domains.length > 0 && selectedDomains.size === 0) {
            const saved = localStorage.getItem('isync_bg_domains');
            if (!saved) {
                const all = new Set(config.domains.map(d => d.domain_name));
                setSelectedDomains(all);
            }
        }
    }, [config.domains]);

    // Handlers
    const toggleDomainSelection = (domain: string) => {
        const next = new Set(selectedDomains);
        if (next.has(domain)) next.delete(domain); else next.add(domain);
        setSelectedDomains(next);
    };

    const generateRandomBatchHandler = async (dryRun: boolean) => {
        if (selectedPairIndices.size === 0) return alert("Select at least one sync pair.");
        if (selectedDomains.size === 0) return alert("Select at least one domain.");
        if (randomUserCount < 0) return alert("User count must be non-negative.");

        setBatchLoading(true);
        if (dryRun) { setBatchResults({}); setRandomBatchResult(null); }

        try {
            const selectedP = unifiedPairs.filter(p => selectedPairIndices.has(p.index)).map(p => ({
                id: p.id, index: p.index, source: p.source, dest: p.dest, domain: p.domain_reference
            }));

            const res = await generateRandomBatch({
                pairs: selectedP,
                user_count: randomUserCount,
                domains: Array.from(selectedDomains),
                dry_run: dryRun,
                random_order: randomOrder
            });

            if (dryRun) {
                setBatchResults(res.commands);
                setRandomBatchResult(res);
            } else {
                const result = await bulkGenerateBatches(Array.from(selectedPairIndices) as number[], randomOrder, false, res.selected_users);
                if (result.failed > 0) alert(`Generated ${result.generated} batches. ${result.failed} failed.`);
                else alert(`Successfully generated and saved ${result.generated} batch file(s) with ${res.user_count} random users.`);
                await loadData();
            }
        } catch (e: any) { alert(`Failed: ${e.response?.data?.detail || e.message}`); }
        finally { setBatchLoading(false); }
    };

    const generatePreview = async () => {
        if (selectedPairIndices.size === 0) return alert("Select at least one sync pair.");
        setBatchLoading(true);
        setBatchResults({});
        try {
            const selectedP = unifiedPairs.filter(p => selectedPairIndices.has(p.index)).map(p => ({
                id: p.id, index: p.index, source: p.source, dest: p.dest, domain: p.domain_reference
            }));
            const res = await generateBatch({
                pairs: selectedP,
                dry_run: true,
                selected_users: selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined,
                random_order: randomOrder
            });
            setBatchResults(res.commands);
        } catch (e: any) { alert(`Failed: ${e.message}`); }
        finally { setBatchLoading(false); }
    };

    const handleGenerate = async () => {
        if (selectedPairIndices.size === 0) return alert("Select at least one sync pair.");
        setBatchLoading(true);

        try {
            if (selectedPairIndices.size === 1) {
                const idx = Array.from(selectedPairIndices)[0] as number;
                const pair = unifiedPairs.find(p => p.index === idx);

                if (pair && !pair.batch.exists) {
                    const safeSource = pair.source.split('/').filter(Boolean).pop() || 'source';
                    const safeDest = pair.dest.split(':').pop()?.split('/').filter(Boolean).pop() || 'dest';
                    const defaultName = `batch_${safeSource}_to_${safeDest}.sh`;

                    const name = prompt("Enter filename for new batch:", defaultName);
                    if (!name) { setBatchLoading(false); return; }

                    const res = await generateBatch({
                        pairs: [{ id: pair.id, index: pair.index, source: pair.source, dest: pair.dest, domain_reference: pair.domain_reference }],
                        dry_run: false,
                        selected_users: selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined,
                        random_order: randomOrder
                    });

                    await saveBatch({ filename: name, commands: res.commands, include_header: true });
                    await loadData();
                    setBatchLoading(false);
                    return;
                }
            }

            const usersArray = selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined;
            const result = await bulkGenerateBatches(Array.from(selectedPairIndices) as number[], randomOrder, false, usersArray);

            if (result.failed > 0) alert(`Generated ${result.generated} batches. ${result.failed} failed.`);
            else alert(`Successfully generated and saved ${result.generated} batch file(s).`);
            await loadData();
        } catch (e: any) { alert(`Generate failed: ${e.response?.data?.detail || e.message}`); }
        finally { setBatchLoading(false); }
    };

    const runBatch = async (dryRun: boolean) => {
        if (!confirm(`Are you sure you want to START ${dryRun ? "TEST" : "REAL"} execution for ${selectedPairIndices.size} pair(s)?`)) return;
        setBatchLoading(true);
        try {
            const selectedP = unifiedPairs.filter(p => selectedPairIndices.has(p.index)).map(p => ({
                id: p.id, index: p.index, source: p.source, dest: p.dest, domain: p.domain_reference
            }));
            if (selectedP.length === 0) return alert("Select at least one sync pair.");

            await startJob({
                pairs: selectedP,
                dry_run: dryRun,
                selected_users: selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined
            });
            alert("✅ Batch Job Started! Check 'Dashboard' for progress.");
        } catch (e: any) { alert(`Failed to start batch: ${e.message}`); }
        finally { setBatchLoading(false); }
    };

    const handleSaveBatch = async () => {
        if (Object.keys(batchResults).length === 0) return alert('Generate commands first.');
        setSaving(true);
        try {
            const filename = saveFilename.trim() || `batch_${new Date().toISOString().slice(0, 10)}`;
            await saveBatch({ filename, commands: batchResults, include_header: true });
            setShowSaveDialog(false); setSaveFilename('');
            await loadSavedBatches(); await loadUnifiedPairs();
        } catch (e: any) { alert(`Failed to save: ${e.message}`); }
        finally { setSaving(false); }
    };

    const loadUserSummary = async () => {
        setLoadingUserSummary(true);
        try {
            const data = await getUserBatchSummary();
            setUserSummaryData(data); setShowUserSummary(true);
        } catch (e: any) { alert(`Failed: ${e.message}`); }
        finally { setLoadingUserSummary(false); }
    };

    const handleDeleteSyncPair = async (id: string, source: string, dest: string) => {
        if (!confirm(`Delete sync pair?\n${source} → ${dest}`)) return;
        try { await deleteSyncPair(id); await loadData(); }
        catch (e: any) { alert(`Failed to delete: ${e.message}`); }
    };

    const openWizard = () => { setEditingPair(null); setShowWizard(true); };
    const handleEditSyncPair = (p: SyncPairWithBatch) => { setEditingPair(p); setShowWizard(true); };

    const openBatchUsersModal = async (filename: string) => {
        setBatchUsersFilename(filename); setBatchUsersData(null); setShowBatchUsersModal(true);
        try { const data = await getBatchUsers(filename); setBatchUsersData(data); }
        catch (e: any) { alert(`Failed to load: ${e.message}`); }
    };

    const handleOpenPushModal = (type: 'batch' | 'group', id: string) => {
        setPushTargetType(type); setPushTargetId(id);
        if (sshServers.length > 0 && selectedPushServers.size === 0) {
            setSelectedPushServers(new Set([sshServers[0].id]));
        }
        setShowPushModal(true);
        setPushResults([]);
        setShowPushResults(false);
        setPushStatus('');
    };

    const togglePushServer = (id: string) => {
        const next = new Set(selectedPushServers);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedPushServers(next);
    };

    const handlePush = async () => {
        if (selectedPushServers.size === 0) return alert('Select at least one server');
        setPushing(true);
        setPushStatus('Starting push...');
        setPushResults([]);
        setShowPushResults(true);

        const results: any[] = [];

        try {
            for (const serverId of Array.from(selectedPushServers)) {
                const serverName = sshServers.find(s => s.id === serverId)?.name || serverId;
                setPushStatus(`Pushing to ${serverName}...`);
                try {
                    let res;
                    if (pushTargetType === 'batch') {
                        res = await pushBatch(pushTargetId, serverId);
                    } else {
                        res = await pushBatchGroup(pushTargetId, serverId);
                    }
                    results.push({ server: serverName, status: 'success', message: 'Pushed successfully' });
                } catch (e: any) {
                    results.push({ server: serverName, status: 'error', message: e.message });
                }
            }
            setPushResults(results);
            setPushStatus('Completed');
            // Don't close modal immediately so user can see results
        } catch (e: any) {
            alert(`Push failed: ${e.message}`);
        } finally {
            setPushing(false);
        }
    };

    // Group Handlers
    const handleCreateGroupReal = async () => {
        if (!newGroupName.trim()) return alert('Enter a group name');
        setGroupsLoading(true);
        try {
            await createBatchGroup({ name: newGroupName.trim(), description: newGroupDescription.trim(), batch_files: Array.from(selectedBatchesForGroup) });
            setNewGroupName(''); setNewGroupDescription(''); setSelectedBatchesForGroup(new Set());
            setShowCreateGroupModal(false); await loadBatchGroups();
        } catch (e: any) { alert(`Failed: ${e.message}`); } finally { setGroupsLoading(false); }
    };
    const handleDeleteGroup = async (id: string) => {
        if (!confirm('Delete group?')) return;
        try { await deleteBatchGroup(id); await loadBatchGroups(); } catch (e: any) { alert(`Failed: ${e.message}`); }
    };
    const handleGenerateGroupScript = async (id: string) => {
        try { await generateGroupScript(id); await loadBatchGroups(); } catch (e: any) { alert(`Failed: ${e.message}`); }
    };
    const handleExpandGroup = async (id: string) => {
        if (expandedGroup === id) { setExpandedGroup(null); return; }
        setExpandedGroup(id);
        if (!groupScriptCache[id]) {
            try { const r = await getGroupScript(id); if (r.exists) setGroupScriptCache(p => ({ ...p, [id]: r.content })); } catch { }
        }
    };
    const toggleBatchForGroup = (f: string) => {
        const next = new Set(selectedBatchesForGroup);
        if (next.has(f)) next.delete(f); else next.add(f);
        setSelectedBatchesForGroup(next);
    };
    const handleCheckGroupRemote = async (gid: string, sid: string) => {
        setGroupOperationLoading(`check-${gid}`);
        try { const r = await checkGroupRemote(gid, sid); setGroupRemoteStatus(p => ({ ...p, [gid]: { ...p[gid], [sid]: r.exists } })); } finally { setGroupOperationLoading(null); }
    };
    const handlePullGroupRemote = async (gid: string, sid: string) => {
        setGroupOperationLoading(`pull-${gid}`);
        try { await pullGroupRemote(gid, sid); const r = await getGroupScript(gid); if (r.exists) setGroupScriptCache(p => ({ ...p, [gid]: r.content })); } finally { setGroupOperationLoading(null); }
    };
    const handleDeleteGroupRemote = async (gid: string, sid: string) => {
        if (!confirm('Delete remote?')) return;
        setGroupOperationLoading(`delete-${gid}`);
        try { await deleteGroupRemote(gid, sid); setGroupRemoteStatus(p => ({ ...p, [gid]: { ...p[gid], [sid]: false } })); } finally { setGroupOperationLoading(null); }
    };

    return (
        <div className="page-container space-y-6 pb-32">
            <PageHeader
                title="Batch Generator"
                subtitle="Generate and execute rclone commands"
                gradient="from-amber-600 to-orange-600"
                icon={Terminal}
            />

            <div className="space-y-6">
                <Card id="generator">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-amber-400">
                            <Terminal size={18} /> Command Generator
                        </h2>
                        <div className="flex gap-2">
                            <button onClick={generatePreview} disabled={batchLoading} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-amber-400 text-xs font-bold uppercase tracking-wider transition flex items-center gap-2">
                                <Zap size={14} /> Dry Run
                            </button>
                            <button onClick={handleGenerate} disabled={batchLoading} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-200 text-xs font-bold uppercase tracking-wider transition">
                                Generate
                            </button>
                            <div className="w-px bg-zinc-700 mx-2"></div>
                            <button onClick={() => runBatch(false)} disabled={batchLoading || selectedPairIndices.size === 0} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-white text-xs font-bold uppercase tracking-wider transition shadow-lg shadow-indigo-900/20 flex items-center gap-2">
                                <Play size={12} /> Run Batch
                            </button>
                        </div>
                    </div>

                    <RandomBatchSettings
                        config={config}
                        randomUserCount={randomUserCount}
                        setRandomUserCount={setRandomUserCount}
                        randomOrder={randomOrder}
                        setRandomOrder={setRandomOrder}
                        selectedDomains={selectedDomains}
                        setSelectedDomains={setSelectedDomains}
                        toggleDomainSelection={toggleDomainSelection}
                        selectedUsers={selectedUsers}
                        batchLoading={batchLoading}
                        loadingUserSummary={loadingUserSummary}
                        loadUserSummary={loadUserSummary}
                        generateRandomBatchHandler={generateRandomBatchHandler}
                        randomBatchResult={randomBatchResult}
                    />

                    <SyncPairList
                        unifiedPairs={sortedFilteredPairs}
                        selectedPairs={selectedPairIndices as Set<number>}
                        togglePair={togglePair}
                        selectAllPairs={selectAllPairs}
                        invertSelection={invertPairs}
                        openWizard={openWizard}
                        handleEditSyncPair={handleEditSyncPair}
                        handleDeleteSyncPair={handleDeleteSyncPair}
                        randomOrder={randomOrder}
                        loadData={loadData}
                        handleSort={handlePairSort}
                        SortIcon={PairSortIcon}
                        columnFilters={pairFilters}
                        onToggleColumnFilter={togglePairFilter}
                        onClearColumnFilter={clearPairFilter}
                        getUniqueValues={getPairUniqueValues}
                    />

                    {Object.keys(batchResults).length > 0 && (
                        <div className="mt-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-zinc-300">Generated Commands</h3>
                                <div className="flex gap-2">
                                    <button onClick={() => {
                                        const allCmds = Object.entries(batchResults).map(([label, cmd]) => `# ${label}\n${cmd}`).join('\n\n');
                                        navigator.clipboard.writeText(allCmds);
                                    }} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">
                                        <Copy size={14} /> Copy All
                                    </button>
                                    <button onClick={() => setShowSaveDialog(true)} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                                        <Save size={14} /> Save Batch
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                {Object.entries(batchResults).map(([label, cmd]) => (
                                    <div key={label} className="bg-black/50 rounded-lg border border-zinc-800 overflow-hidden">
                                        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
                                            <span className="text-xs font-mono text-zinc-400">{label}</span>
                                            <button onClick={() => { navigator.clipboard.writeText(cmd); }} className="text-xs text-zinc-500 hover:text-white"><Copy size={12} /></button>
                                        </div>
                                        <pre className="p-3 text-xs font-mono text-zinc-300 whitespace-pre-wrap overflow-x-auto">{cmd}</pre>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Card>

                <BatchList
                    savedBatches={savedBatches}
                    loadSavedBatches={loadSavedBatches}
                    sshServers={sshServers}
                    selectedUsers={selectedUsers}
                    randomOrder={randomOrder}
                    batchContentCache={batchContentCache}
                    setBatchContentCache={setBatchContentCache}
                    remoteStatusCache={remoteStatusCache}
                    setRemoteStatusCache={setRemoteStatusCache}
                    openBatchUsersModal={openBatchUsersModal}
                    handleOpenPushModal={handleOpenPushModal}
                    batchOperationLoading={batchOperationLoading}
                    setBatchOperationLoading={setBatchOperationLoading}
                />

                <Card id="batch-groups">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-indigo-400">
                            <Layers size={18} /> Batch Groups
                        </h2>
                        <button onClick={() => setShowCreateGroupModal(true)} className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs">
                            <Plus size={14} /> Create Group
                        </button>
                    </div>
                    <div className="space-y-3">
                        {batchGroups.map(g => (
                            <div key={g.id} className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg overflow-hidden">
                                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-800/50" onClick={() => handleExpandGroup(g.id)}>
                                    <div className="flex items-center gap-3">
                                        {expandedGroup === g.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        <div>
                                            <div className="text-sm font-bold text-indigo-200">{g.name}</div>
                                            <div className="text-xs text-zinc-500">{g.batch_files.length} batches</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); handleGenerateGroupScript(g.id) }} className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded"><FileCode size={14} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id) }} className="p-1 text-red-400 hover:bg-red-400/10 rounded"><Trash2 size={14} /></button>
                                    </div>
                                </div>
                                {expandedGroup === g.id && (
                                    <div className="p-3 bg-black/20 border-t border-zinc-800 text-xs">
                                        <div className="text-zinc-400 mb-2">{g.description || 'No description'}</div>
                                        <div className="flex flex-wrap gap-1 mb-3">
                                            {g.batch_files.map(f => <span key={f} className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">{f}</span>)}
                                        </div>
                                        <div className="flex gap-2 items-center mb-2">
                                            <select value={selectedServerId} onChange={(e) => setSelectedServerId(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300">
                                                {sshServers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                            <button onClick={() => handleCheckGroupRemote(g.id, selectedServerId)} className="px-2 py-1 bg-zinc-700 rounded">Check</button>
                                            <button onClick={() => handleOpenPushModal('group', g.id)} className="px-2 py-1 bg-cyan-900 text-cyan-200 rounded">Push</button>
                                            <button onClick={() => handlePullGroupRemote(g.id, selectedServerId)} className="px-2 py-1 bg-emerald-900 text-emerald-200 rounded">Pull</button>
                                            <button onClick={() => handleDeleteGroupRemote(g.id, selectedServerId)} className="px-2 py-1 bg-red-900 text-red-200 rounded">Del</button>
                                        </div>
                                        {groupScriptCache[g.id] && <pre className="p-2 bg-black rounded text-zinc-500 overflow-x-auto">{groupScriptCache[g.id]}</pre>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            <BatchWizard isOpen={showWizard} onClose={() => setShowWizard(false)} editingPair={editingPair} config={config} sshServers={sshServers} onSuccess={async () => { await loadData(); }} />

            {showCreateGroupModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md space-y-4">
                        <h3 className="text-lg font-bold text-white">Create Batch Group</h3>
                        <input className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-white" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                        <textarea className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-white" placeholder="Description" value={newGroupDescription} onChange={e => setNewGroupDescription(e.target.value)} />
                        <div className="max-h-40 overflow-y-auto space-y-1 bg-zinc-950 p-2 rounded border border-zinc-800">
                            {savedBatches.map(b => (
                                <label key={b.name} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer hover:bg-zinc-900 p-1 rounded">
                                    <input type="checkbox" checked={selectedBatchesForGroup.has(b.name)} onChange={() => toggleBatchForGroup(b.name)} />
                                    {b.name}
                                </label>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setShowCreateGroupModal(false)} className="px-3 py-1.5 text-zinc-400">Cancel</button>
                            <button onClick={handleCreateGroupReal} disabled={groupsLoading} className="px-3 py-1.5 bg-indigo-600 rounded text-white font-bold">Create</button>
                        </div>
                    </div>
                </div>
            )}

            {showSaveDialog && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[50]">
                    <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-lg w-96 space-y-4 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">Save Batch File</h3>
                        <input value={saveFilename} onChange={e => setSaveFilename(e.target.value)} placeholder="filename.sh" className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm" />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowSaveDialog(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition">Cancel</button>
                            <button onClick={handleSaveBatch} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold transition">Save Script</button>
                        </div>
                    </div>
                </div>
            )}

            {showPushModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[50]">
                    <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-lg w-[500px] space-y-4 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">Push {pushTargetType === 'batch' ? 'Batch' : 'Group'} to Remote</h3>

                        <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar bg-zinc-950 p-3 rounded border border-zinc-800">
                            <div className="text-xs text-zinc-500 mb-2 uppercase font-bold">Select Target Servers</div>
                            {sshServers.map(s => (
                                <label key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition ${selectedPushServers.has(s.id) ? 'bg-cyan-600/20 border border-cyan-500/50' : 'hover:bg-zinc-900 border border-transparent'}`}>
                                    <input
                                        type="checkbox"
                                        checked={selectedPushServers.has(s.id)}
                                        onChange={() => togglePushServer(s.id)}
                                        className="rounded accent-cyan-500"
                                    />
                                    <span className={selectedPushServers.has(s.id) ? 'text-white' : 'text-zinc-400'}>{s.name}</span>
                                </label>
                            ))}
                        </div>

                        {/* Status Area */}
                        {(pushStatus || pushResults.length > 0) && (
                            <div className="bg-zinc-950 p-3 rounded border border-zinc-800 max-h-40 overflow-y-auto text-xs space-y-1">
                                {pushStatus && <div className="text-cyan-400 font-bold mb-2">{pushStatus}</div>}
                                {pushResults.map((r, i) => (
                                    <div key={i} className={`flex justify-between ${r.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        <span>{r.server}</span>
                                        <span>{r.status === 'success' ? '✓ OK' : '✗ Failed'}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setShowPushModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Close</button>
                            <button onClick={handlePush} disabled={pushing || selectedPushServers.size === 0} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-bold transition disabled:opacity-50 flex items-center gap-2">
                                {pushing && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                                {pushing ? 'Pushing...' : `Push to ${selectedPushServers.size} Server(s)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showBatchUsersModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[50] p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Users size={16} /> Batch Users: {batchUsersFilename}</h3>
                            <button onClick={() => setShowBatchUsersModal(false)}><X size={18} className="text-zinc-500 hover:text-white transition" /></button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-4 max-h-[70vh]">
                            {batchUsersData ? (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-zinc-800/50 p-3 rounded-lg border border-zinc-700">
                                            <div className="text-[10px] text-zinc-500 uppercase font-bold">Total Users</div>
                                            <div className="text-2xl font-bold text-white">{batchUsersData.count}</div>
                                        </div>
                                        <div className="bg-zinc-800/50 p-3 rounded-lg border border-zinc-700">
                                            <div className="text-[10px] text-zinc-500 uppercase font-bold">Domain</div>
                                            <div className="text-2xl font-bold text-indigo-400 truncate">{batchUsersData.domain || 'N/A'}</div>
                                        </div>
                                    </div>
                                    <div className="bg-black/50 rounded-lg border border-zinc-800 overflow-hidden">
                                        <div className="max-h-60 overflow-y-auto p-4 custom-scrollbar">
                                            <div className="grid grid-cols-1 gap-1 text-xs font-mono">
                                                {batchUsersData.users.map((u, i) => (
                                                    <div key={i} className="text-zinc-400 py-0.5 border-b border-zinc-900 hover:text-indigo-300 transition-colors uppercase tracking-tighter">{u}</div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (<div className="flex flex-col items-center py-12 text-zinc-500 gap-3"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>Loading users...</div>)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchGenerator;