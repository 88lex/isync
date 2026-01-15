import { useState, useEffect } from 'react';
import { Terminal, Copy, Play, FileCode, Zap, Save, FolderOpen, Users, BarChart3, ChevronDown, ChevronUp, X, Plus, Trash2, Edit2, Server, HardDrive, Folder, ChevronRight, Check, Shuffle, List, Layers, GripVertical } from 'lucide-react';
import {
    fetchConfig, fetchSyncList, generateBatch, startJob, saveBatch, listSavedBatches,
    getBatchFile, SyncPair, Config, BatchFile, getBatchUsers, compareBatchUsers,
    BatchUsersResponse, BatchCompareResponse, deleteBatchFile, deleteSyncPair,
    fetchSSHServers, SSHServer, listServerFolders, listServerRemotes, listRemotePath,
    RemoteFolder, RcloneRemote, createSyncPair, generateRandomBatch, getUserBatchSummary,
    RandomBatchResponse, UserSummaryResponse, listBatchGroups, createBatchGroup,
    deleteBatchGroup, updateBatchGroup, generateGroupScript, BatchGroup, pushBatch, pushBatchGroup,
    updateBatchContent, checkBatchRemote, pullBatch, deleteBatchRemote, deleteBatchLocal,
    checkGroupRemote, pullGroupRemote, deleteGroupRemote, getGroupScript, regenerateBatch,
    getSyncPairsWithBatches, bulkGenerateBatches, SyncPairWithBatch, renameBatchFile
} from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useSetToggle } from '../hooks/useSetToggle';

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

    const [config, setConfig] = useState<Config>({});
    const [pairs, setPairs] = useState<SyncPair[]>([]);

    // Unified sync pairs with batch status
    const [unifiedPairs, setUnifiedPairs] = useState<SyncPairWithBatch[]>([]);
    const [bulkGenerating, setBulkGenerating] = useState(false);

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
    const [batchContentCache, setBatchContentCache] = useState<Record<string, string>>({});
    const [editingBatch, setEditingBatch] = useState<string | null>(null);
    const [editBatchContent, setEditBatchContent] = useState('');
    const [renamingBatch, setRenamingBatch] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [remoteStatusCache, setRemoteStatusCache] = useState<Record<string, Record<string, boolean>>>({});
    const [batchOperationLoading, setBatchOperationLoading] = useState<string | null>(null);

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

    // Random Batch Generation State
    const [randomUserCount, setRandomUserCount] = useState(10);
    const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
    const [useRandomMode, setUseRandomMode] = useState(false);
    const [randomBatchResult, setRandomBatchResult] = useState<RandomBatchResponse | null>(null);

    // Random Order (shuffle) - separate from random user selection
    const [randomOrder, setRandomOrder] = useState(false);

    // Get ALL users count from session storage (set by User Management page)
    const allUsersCount = (() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.USERS);
        if (saved) {
            try {
                const users = JSON.parse(saved);
                return Array.isArray(users) ? users.length : 0;
            } catch { return 0; }
        }
        return 0;
    })();

    // User Summary State
    const [showUserSummary, setShowUserSummary] = useState(false);
    const [userSummaryData, setUserSummaryData] = useState<UserSummaryResponse | null>(null);
    const [loadingUserSummary, setLoadingUserSummary] = useState(false);

    // Collapsible Sections State
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    const toggleSection = (section: string) => {
        const next = new Set(collapsedSections);
        if (next.has(section)) {
            next.delete(section);
        } else {
            next.add(section);
        }
        setCollapsedSections(next);
    };

    const toggleDomainSelection = (domain: string) => {
        const next = new Set(selectedDomains);
        if (next.has(domain)) {
            next.delete(domain);
        } else {
            next.add(domain);
        }
        setSelectedDomains(next);
    };

    // Batch Groups State
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

    // Remote Push State
    const [sshServers, setSshServers] = useState<SSHServer[]>([]);
    const [showPushModal, setShowPushModal] = useState(false);
    const [pushTargetType, setPushTargetType] = useState<'batch' | 'group'>('batch');
    const [pushTargetId, setPushTargetId] = useState('');
    const [selectedServerId, setSelectedServerId] = useState('');
    const [pushing, setPushing] = useState(false);

    const handleOpenPushModal = (type: 'batch' | 'group', id: string) => {
        setPushTargetType(type);
        setPushTargetId(id);
        setSelectedServerId(sshServers.length > 0 ? sshServers[0].id : '');
        setShowPushModal(true);
    };

    const handlePush = async () => {
        if (!selectedServerId) return alert('Select a server');
        setPushing(true);
        try {
            if (pushTargetType === 'batch') {
                await pushBatch(pushTargetId, selectedServerId);
            } else {
                await pushBatchGroup(pushTargetId, selectedServerId);
            }
            alert(`Successfully pushed ${pushTargetType} to remote!`);
            setShowPushModal(false);
        } catch (e: any) {
            alert(`Push failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setPushing(false);
        }
    };

    const loadBatchGroups = async () => {
        try {
            const groups = await listBatchGroups();
            setBatchGroups(groups);
        } catch (e) {
            console.error('Failed to load batch groups', e);
        }
    };

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return alert('Enter a group name');
        setGroupsLoading(true);
        try {
            await createBatchGroup({
                name: newGroupName.trim(),
                description: newGroupDescription.trim(),
                batch_files: Array.from(selectedBatchesForGroup)
            });
            setNewGroupName('');
            setNewGroupDescription('');
            setSelectedBatchesForGroup(new Set());
            setShowCreateGroupModal(false);
            await loadBatchGroups();
        } catch (e: any) {
            alert(`Failed to create group: ${e.response?.data?.detail || e.message}`);
        } finally {
            setGroupsLoading(false);
        }
    };

    const handleDeleteGroup = async (groupId: string) => {
        if (!confirm('Delete this batch group?')) return;
        try {
            await deleteBatchGroup(groupId);
            await loadBatchGroups();
        } catch (e: any) {
            alert(`Failed to delete: ${e.message}`);
        }
    };

    const handleGenerateGroupScript = async (groupId: string) => {
        setGroupsLoading(true);
        try {
            const result = await generateGroupScript(groupId);
            alert(`✅ Group script generated!\n${result.filename}\n${result.batch_count} batches`);
            await loadBatchGroups();
        } catch (e: any) {
            alert(`Failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setGroupsLoading(false);
        }
    };

    const handleExpandGroup = async (groupId: string) => {
        if (expandedGroup === groupId) {
            setExpandedGroup(null);
            return;
        }
        setExpandedGroup(groupId);
        if (!groupScriptCache[groupId]) {
            try {
                const result = await getGroupScript(groupId);
                if (result.exists) {
                    setGroupScriptCache(prev => ({ ...prev, [groupId]: result.content }));
                }
            } catch (e) {
                console.error('Failed to load group script', e);
            }
        }
    };

    const handleCheckGroupRemote = async (groupId: string, serverId: string) => {
        try {
            setGroupOperationLoading(`check-${groupId}`);
            const res = await checkGroupRemote(groupId, serverId);
            setGroupRemoteStatus(prev => ({
                ...prev,
                [groupId]: { ...prev[groupId], [serverId]: res.exists }
            }));
        } catch (e: any) {
            console.error('Check failed', e);
        } finally {
            setGroupOperationLoading(null);
        }
    };

    const handlePullGroupRemote = async (groupId: string, serverId: string) => {
        try {
            setGroupOperationLoading(`pull-${groupId}`);
            await pullGroupRemote(groupId, serverId);
            // Refresh script cache
            const result = await getGroupScript(groupId);
            if (result.exists) {
                setGroupScriptCache(prev => ({ ...prev, [groupId]: result.content }));
            }
        } catch (e: any) {
            alert(`Pull failed: ${e.message}`);
        } finally {
            setGroupOperationLoading(null);
        }
    };

    const handleDeleteGroupRemote = async (groupId: string, serverId: string) => {
        if (!confirm('Delete group script from remote server?')) return;
        try {
            setGroupOperationLoading(`delete-${groupId}`);
            await deleteGroupRemote(groupId, serverId);
            setGroupRemoteStatus(prev => ({
                ...prev,
                [groupId]: { ...prev[groupId], [serverId]: false }
            }));
        } catch (e: any) {
            alert(`Delete failed: ${e.message}`);
        } finally {
            setGroupOperationLoading(null);
        }
    };

    const toggleBatchForGroup = (filename: string) => {
        const next = new Set(selectedBatchesForGroup);
        if (next.has(filename)) {
            next.delete(filename);
        } else {
            next.add(filename);
        }
        setSelectedBatchesForGroup(next);
    };

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const c = await fetchConfig();
        setConfig(c);
        const p = await fetchSyncList();
        setPairs(p);
        await loadBatchGroups();
        await loadUnifiedPairs();
        try {
            const s = await fetchSSHServers();
            setSshServers(s);
        } catch (e) { console.error(e) }
    };

    const loadUnifiedPairs = async () => {
        try {
            const data = await getSyncPairsWithBatches();
            setUnifiedPairs(data.pairs);
        } catch (e) {
            console.error('Failed to load unified pairs', e);
        }
    };

    const handleBulkGenerate = async () => {
        if (selectedPairs.size === 0) return alert("Select at least one sync pair.");
        setBulkGenerating(true);
        try {
            // Pass selected users from User Management if any
            const usersArray = selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined;
            const result = await bulkGenerateBatches(Array.from(selectedPairs), randomOrder, false, usersArray);
            if (result.failed > 0) {
                alert(`Generated ${result.generated} batches, ${result.failed} failed.`);
            } else {
                alert(`Successfully generated ${result.generated} batch file(s)!`);
            }
            await loadUnifiedPairs();
            await loadSavedBatches();
        } catch (e: any) {
            alert(`Bulk generate failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setBulkGenerating(false);
        }
    };

    const selectAllPairs = () => {
        if (selectedPairs.size === unifiedPairs.length) {
            clearPairs();
        } else {
            selectAllPairsSet(unifiedPairs.map((p) => p.index));
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
                selected_users: selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined,
                random_order: randomOrder
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

    const generateRandomBatchHandler = async (dryRun: boolean) => {
        if (selectedPairs.size === 0) return alert("Select at least one sync pair.");
        if (selectedDomains.size === 0) return alert("Select at least one domain.");
        if (randomUserCount < 1) return alert("User count must be at least 1.");

        setBatchLoading(true);
        setBatchResults({});
        setRandomBatchResult(null);

        try {
            const selectedP = pairs.filter((_, i) => selectedPairs.has(i));
            const res = await generateRandomBatch({
                pairs: selectedP,
                user_count: randomUserCount,
                domains: Array.from(selectedDomains),
                dry_run: dryRun
            });
            setBatchResults(res.commands);
            setRandomBatchResult(res);
        } catch (e: any) {
            alert(`Failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setBatchLoading(false);
        }
    };

    const loadUserSummary = async () => {
        setLoadingUserSummary(true);
        try {
            const data = await getUserBatchSummary();
            setUserSummaryData(data);
            setShowUserSummary(true);
        } catch (e: any) {
            alert(`Failed to load user summary: ${e.message}`);
        } finally {
            setLoadingUserSummary(false);
        }
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

    const handleExpandBatch = async (filename: string) => {
        if (expandedBatchFile === filename) {
            setExpandedBatchFile(null);
            setEditingBatch(null);
            return;
        }
        setExpandedBatchFile(filename);
        if (!batchContentCache[filename]) {
            try {
                const data = await getBatchFile(filename);
                setBatchContentCache(prev => ({ ...prev, [filename]: data.content }));
            } catch (e: any) {
                console.error('Failed to load batch content', e);
            }
        }
    };

    const handleStartEdit = (filename: string) => {
        setEditingBatch(filename);
        setEditBatchContent(batchContentCache[filename] || '');
    };

    const handleSaveEdit = async (filename: string) => {
        try {
            setBatchOperationLoading(`edit-${filename}`);
            await updateBatchContent(filename, editBatchContent);
            setBatchContentCache(prev => ({ ...prev, [filename]: editBatchContent }));
            setEditingBatch(null);
            await loadSavedBatches();
        } catch (e: any) {
            alert(`Failed to save: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handleCheckRemote = async (filename: string, serverId: string) => {
        try {
            setBatchOperationLoading(`check-${filename}`);
            const res = await checkBatchRemote(filename, serverId);
            setRemoteStatusCache(prev => ({
                ...prev,
                [filename]: { ...prev[filename], [serverId]: res.exists }
            }));
        } catch (e: any) {
            console.error('Check failed', e);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handlePullBatch = async (filename: string, serverId: string) => {
        try {
            setBatchOperationLoading(`pull-${filename}`);
            await pullBatch(filename, serverId);
            await loadSavedBatches();
            // Refresh content cache
            const data = await getBatchFile(filename);
            setBatchContentCache(prev => ({ ...prev, [filename]: data.content }));
        } catch (e: any) {
            alert(`Pull failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handleDeleteRemote = async (filename: string, serverId: string) => {
        if (!confirm(`Delete ${filename} from remote server?`)) return;
        try {
            setBatchOperationLoading(`delete-remote-${filename}`);
            await deleteBatchRemote(filename, serverId);
            setRemoteStatusCache(prev => ({
                ...prev,
                [filename]: { ...prev[filename], [serverId]: false }
            }));
        } catch (e: any) {
            alert(`Delete failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handleDeleteLocal = async (filename: string) => {
        if (!confirm(`Delete ${filename} locally?`)) return;
        try {
            setBatchOperationLoading(`delete-local-${filename}`);
            await deleteBatchLocal(filename);
            await loadSavedBatches();
            await loadUnifiedPairs();
            if (expandedBatchFile === filename) setExpandedBatchFile(null);
        } catch (e: any) {
            alert(`Delete failed: ${e.message}`);
        } finally {
            setBatchOperationLoading(null);
        }
    };

    const handleRename = async (oldName: string, newName: string) => {
        if (!newName.trim() || newName === oldName) {
            setRenamingBatch(null);
            return;
        }
        try {
            setBatchOperationLoading(`rename-${oldName}`);
            await renameBatchFile(oldName, newName);
            await loadSavedBatches();
            await loadUnifiedPairs();
            if (expandedBatchFile === oldName) setExpandedBatchFile(newName);
            setRenamingBatch(null);
        } catch (e: any) {
            alert(`Rename failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setBatchOperationLoading(null);
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
        loadBatchGroups();
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
                <Card id="generator">
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

                    {/* User Selection Mode */}
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 mb-6">
                        {/* Mode Toggle */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => setUseRandomMode(false)}
                                    className={`px-3 py-1.5 rounded text-sm font-medium transition ${!useRandomMode
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                >
                                    <Users size={14} className="inline mr-1" /> Manual Selection
                                </button>
                                <button
                                    onClick={() => setUseRandomMode(true)}
                                    className={`px-3 py-1.5 rounded text-sm font-medium transition ${useRandomMode
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                >
                                    <Shuffle size={14} className="inline mr-1" /> Random Users
                                </button>
                            </div>
                            <button
                                onClick={loadUserSummary}
                                disabled={loadingUserSummary}
                                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition"
                            >
                                <List size={14} /> User Summary
                            </button>
                        </div>

                        {/* Manual Mode Info */}
                        {!useRandomMode && (
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${selectedUsers.size > 0 ? 'bg-emerald-500' : 'bg-zinc-600'}`}></div>
                                <span className="text-sm text-zinc-300">
                                    {selectedUsers.size > 0 ? (
                                        <>Generating for <span className="text-indigo-400 font-bold">{selectedUsers.size} selected users</span> from User Management</>
                                    ) : (
                                        <>Generating for <span className="text-zinc-400">ALL users{allUsersCount > 0 ? ` (${allUsersCount})` : ''}</span> in source</>
                                    )}
                                </span>
                                {/* Random Order Toggle */}
                                <label className="flex items-center gap-2 ml-auto cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={randomOrder}
                                        onChange={(e) => setRandomOrder(e.target.checked)}
                                        className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500"
                                    />
                                    <span className="text-sm text-zinc-400"><Shuffle size={14} className="inline mr-1" />Random Order</span>
                                </label>
                            </div>
                        )}

                        {/* Random Mode Controls */}
                        {useRandomMode && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <div>
                                        <label className="block text-xs text-zinc-500 mb-1">User Count</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="100"
                                            value={randomUserCount}
                                            onChange={(e) => setRandomUserCount(parseInt(e.target.value) || 1)}
                                            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-purple-500"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-xs text-zinc-500 mb-1">Select Domains</label>
                                        <div className="flex flex-wrap gap-2">
                                            {config.domains?.map((d) => (
                                                <button
                                                    key={d.domain_name}
                                                    onClick={() => toggleDomainSelection(d.domain_name)}
                                                    className={`px-3 py-1 rounded text-xs font-medium transition ${selectedDomains.has(d.domain_name)
                                                        ? 'bg-purple-600 text-white'
                                                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                                        }`}
                                                >
                                                    {d.domain_name}
                                                </button>
                                            ))}
                                            {(!config.domains || config.domains.length === 0) && (
                                                <span className="text-xs text-zinc-500 italic">No domains configured</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-zinc-500">
                                        Will select <span className="text-purple-400 font-bold">{randomUserCount}</span> random users from <span className="text-purple-400 font-bold">{selectedDomains.size}</span> domain(s)
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => generateRandomBatchHandler(true)}
                                            disabled={batchLoading || selectedDomains.size === 0}
                                            className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded text-amber-400 text-xs font-medium transition"
                                        >
                                            <Zap size={12} className="inline mr-1" /> Dry Run
                                        </button>
                                        <button
                                            onClick={() => generateRandomBatchHandler(false)}
                                            disabled={batchLoading || selectedDomains.size === 0}
                                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-white text-xs font-medium transition"
                                        >
                                            <Shuffle size={12} className="inline mr-1" /> Generate Random
                                        </button>
                                    </div>
                                </div>
                                {randomBatchResult && (
                                    <div className="bg-purple-900/20 border border-purple-500/30 rounded p-3 mt-2">
                                        <div className="text-xs text-purple-300">
                                            Generated batch with <span className="font-bold">{randomBatchResult.user_count}</span> random users from: {randomBatchResult.domains_queried.join(', ')}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Unified Sync Pairs + Batch Status */}
                    <div className="mb-4 flex items-center justify-between">
                        <span className="text-sm text-zinc-400">
                            Sync Pairs & Batches ({selectedPairs.size} of {unifiedPairs.length} selected)
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
                                {selectedPairs.size === unifiedPairs.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                        {unifiedPairs.length === 0 ? (
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
                            unifiedPairs.map((p) => (
                                <div
                                    key={p.index}
                                    className={`flex items-center gap-3 p-3 rounded-lg border transition ${selectedPairs.has(p.index)
                                        ? 'bg-indigo-900/20 border-indigo-500/50'
                                        : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                                        }`}
                                >
                                    <div
                                        onClick={() => togglePair(p.index)}
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition cursor-pointer flex-shrink-0 ${selectedPairs.has(p.index) ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'
                                            }`}>
                                        {selectedPairs.has(p.index) && <div className="w-2 h-2 bg-white rounded-sm" />}
                                    </div>
                                    <div
                                        onClick={() => togglePair(p.index)}
                                        className="flex-1 grid grid-cols-3 gap-2 text-sm font-mono cursor-pointer min-w-0"
                                    >
                                        <div className="text-orange-300 truncate" title={p.source}>
                                            {p.source}
                                        </div>
                                        <div className="text-blue-300 truncate" title={p.dest}>
                                            {p.dest}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {p.batch.exists ? (
                                                <>
                                                    <span className="text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
                                                        {p.batch.user_count || 0} users
                                                    </span>
                                                    <span className="text-xs text-zinc-500 truncate" title={p.batch.filename}>
                                                        {p.batch.filename}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="text-xs text-amber-500/80 italic">No batch file</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSyncPair(p.index); }}
                                        className="text-zinc-600 hover:text-red-400 transition p-1 flex-shrink-0"
                                        title="Delete sync pair"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Bulk Generate Button */}
                    {unifiedPairs.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={randomOrder}
                                    onChange={(e) => setRandomOrder(e.target.checked)}
                                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500"
                                />
                                <span className="text-sm text-zinc-400"><Shuffle size={14} className="inline mr-1" />Random Order</span>
                            </label>
                            <button
                                onClick={handleBulkGenerate}
                                disabled={selectedPairs.size === 0 || bulkGenerating}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
                            >
                                {bulkGenerating ? (
                                    <>Generating...</>
                                ) : (
                                    <><Zap size={16} /> Generate Selected ({selectedPairs.size})</>
                                )}
                            </button>
                        </div>
                    )}
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
                            Save {Object.keys(batchResults).length} commands to a file in <code className="bg-zinc-800 px-1 rounded">batch/</code> folder
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
                <Card id="saved-batches">
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
                    <div className="space-y-2">
                        {savedBatches.map((f) => {
                            const isExpanded = expandedBatchFile === f.name;
                            const isEditing = editingBatch === f.name;
                            const content = batchContentCache[f.name] || '';
                            const isLoading = batchOperationLoading?.includes(f.name);

                            return (
                                <div
                                    key={f.name}
                                    className={`bg-zinc-800/50 border rounded-lg transition ${isExpanded ? 'border-cyan-500/50' : 'border-zinc-700'}`}
                                >
                                    {/* Header Row */}
                                    <div
                                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-800/80"
                                        onClick={() => handleExpandBatch(f.name)}
                                    >
                                        <div className="flex items-center gap-3">
                                            {isExpanded ? <ChevronDown size={16} className="text-cyan-400" /> : <ChevronRight size={16} className="text-zinc-500" />}
                                            <FileCode size={16} className="text-amber-400" />
                                            {renamingBatch === f.name ? (
                                                <input
                                                    autoFocus
                                                    value={renameValue}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRename(f.name, renameValue);
                                                        if (e.key === 'Escape') setRenamingBatch(null);
                                                    }}
                                                    onBlur={() => handleRename(f.name, renameValue)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-sm font-medium bg-zinc-900 border border-indigo-500 rounded px-2 py-0.5 text-white focus:outline-none"
                                                />
                                            ) : (
                                                <span
                                                    className="text-sm font-medium text-zinc-200 hover:text-indigo-400 cursor-pointer"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRenamingBatch(f.name);
                                                        setRenameValue(f.name);
                                                    }}
                                                    title="Click to rename"
                                                >
                                                    {f.name}
                                                </span>
                                            )}
                                            {f.user_count !== undefined && f.user_count > 0 && (
                                                <span className="text-xs bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">{f.user_count} users</span>
                                            )}
                                            {f.sync_pair && (
                                                <span className="text-xs text-zinc-500 truncate max-w-[200px]" title={`${f.sync_pair.source} → ${f.sync_pair.dest}`}>
                                                    {f.sync_pair.source.split('/').pop()} → {f.sync_pair.dest.split(':')[0]}
                                                </span>
                                            )}
                                            <span className="text-xs text-zinc-600">{(f.size / 1024).toFixed(1)} KB</span>
                                        </div>
                                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => openBatchUsersModal(f.name)}
                                                className="flex items-center gap-1 px-2 py-1 bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white rounded text-xs transition"
                                                title="View/Compare Users"
                                            >
                                                <Users size={12} /> Users
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    if (!confirm(`Regenerate ${f.name} with current users?\n\nThis will overwrite the file with fresh commands.`)) return;
                                                    try {
                                                        setBatchOperationLoading(`regen-${f.name}`);
                                                        await regenerateBatch(f.name, randomOrder);
                                                        await loadSavedBatches();
                                                        // Refresh content cache
                                                        const data = await getBatchFile(f.name);
                                                        setBatchContentCache(prev => ({ ...prev, [f.name]: data.content }));
                                                    } catch (e: any) {
                                                        alert(`Regeneration failed: ${e.response?.data?.detail || e.message}`);
                                                    } finally {
                                                        setBatchOperationLoading(null);
                                                    }
                                                }}
                                                disabled={isLoading || !f.sync_pair}
                                                className="flex items-center gap-1 px-2 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                title={f.sync_pair ? `Regenerate with current users${randomOrder ? ' (Random Order)' : ''}` : 'No sync pair found'}
                                            >
                                                <Shuffle size={12} /> Regen
                                            </button>
                                            <button
                                                onClick={() => handleDeleteLocal(f.name)}
                                                disabled={isLoading}
                                                className="flex items-center gap-1 px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                title="Delete Local"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Content */}
                                    {isExpanded && (
                                        <div className="border-t border-zinc-700 p-3 space-y-3">
                                            {/* Server Operations Row */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <select
                                                    value={selectedServerId}
                                                    onChange={(e) => setSelectedServerId(e.target.value)}
                                                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                                                >
                                                    {sshServers.length === 0 && <option value="">No servers</option>}
                                                    {sshServers.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => handleCheckRemote(f.name, selectedServerId)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Check
                                                </button>
                                                <button
                                                    onClick={() => handleOpenPushModal('batch', f.name)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Push
                                                </button>
                                                <button
                                                    onClick={() => handlePullBatch(f.name, selectedServerId)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Pull
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteRemote(f.name, selectedServerId)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Del Remote
                                                </button>
                                                {remoteStatusCache[f.name]?.[selectedServerId] !== undefined && (
                                                    <span className={`text-xs px-2 py-0.5 rounded ${remoteStatusCache[f.name][selectedServerId] ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                                                        {remoteStatusCache[f.name][selectedServerId] ? '✓ Exists' : '✗ Missing'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Content Area */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-zinc-500">Content</span>
                                                    {!isEditing ? (
                                                        <button
                                                            onClick={() => handleStartEdit(f.name)}
                                                            className="flex items-center gap-1 px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition"
                                                        >
                                                            <Edit2 size={10} /> Edit
                                                        </button>
                                                    ) : (
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => handleSaveEdit(f.name)}
                                                                disabled={isLoading}
                                                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs transition disabled:opacity-50"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingBatch(null)}
                                                                className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                {isEditing ? (
                                                    <textarea
                                                        value={editBatchContent}
                                                        onChange={(e) => setEditBatchContent(e.target.value)}
                                                        className="w-full h-48 bg-zinc-900 border border-zinc-700 rounded p-2 text-xs font-mono text-zinc-300 focus:border-cyan-500 outline-none"
                                                    />
                                                ) : (
                                                    <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-400 max-h-48 overflow-auto whitespace-pre-wrap">
                                                        {content || 'Loading...'}
                                                    </pre>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* Batch Groups Card */}
            <Card id="batch-groups">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold flex items-center gap-2 text-purple-400">
                        <Layers size={18} /> Batch Groups
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={loadBatchGroups}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={() => setShowCreateGroupModal(true)}
                            className="flex items-center gap-1 px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs text-white font-medium transition"
                        >
                            <Plus size={14} /> New Group
                        </button>
                    </div>
                </div>

                {batchGroups.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-zinc-500 italic mb-3">No batch groups created yet.</div>
                        <button
                            onClick={() => setShowCreateGroupModal(true)}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 mx-auto"
                        >
                            <Plus size={16} /> Create First Group
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {batchGroups.map((group) => {
                            const isExpanded = expandedGroup === group.id;
                            const scriptContent = groupScriptCache[group.id] || '';
                            const isLoading = groupOperationLoading?.includes(group.id);

                            return (
                                <div
                                    key={group.id}
                                    className={`bg-zinc-800/50 border rounded-lg transition ${isExpanded ? 'border-purple-500/50' : 'border-zinc-700'}`}
                                >
                                    {/* Header Row */}
                                    <div
                                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-800/80"
                                        onClick={() => handleExpandGroup(group.id)}
                                    >
                                        <div className="flex items-center gap-3">
                                            {isExpanded ? <ChevronDown size={16} className="text-purple-400" /> : <ChevronRight size={16} className="text-zinc-500" />}
                                            <Layers size={16} className="text-purple-400" />
                                            <span className="text-sm font-medium text-zinc-200">{group.name}</span>
                                            <span className="bg-purple-600/20 text-purple-400 px-2 py-0.5 rounded text-xs">
                                                {group.batch_files.length} batches
                                            </span>
                                        </div>
                                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleGenerateGroupScript(group.id)}
                                                disabled={groupsLoading || group.batch_files.length === 0}
                                                className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                            >
                                                <FileCode size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteGroup(group.id)}
                                                className="px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Content */}
                                    {isExpanded && (
                                        <div className="border-t border-zinc-700 p-3 space-y-3">
                                            {/* Batch files in group */}
                                            <div>
                                                <span className="text-xs text-zinc-500 block mb-2">Batches in Order</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {group.batch_files.map((file, idx) => (
                                                        <span
                                                            key={file}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded text-xs"
                                                        >
                                                            <span className="text-zinc-500">{idx + 1}.</span>
                                                            {file}
                                                        </span>
                                                    ))}
                                                    {group.batch_files.length === 0 && (
                                                        <span className="text-xs text-zinc-500 italic">No batches in group</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Server Operations Row */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <select
                                                    value={selectedServerId}
                                                    onChange={(e) => setSelectedServerId(e.target.value)}
                                                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                                                >
                                                    {sshServers.length === 0 && <option value="">No servers</option>}
                                                    {sshServers.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => handleCheckGroupRemote(group.id, selectedServerId)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Check
                                                </button>
                                                <button
                                                    onClick={() => handleOpenPushModal('group', group.id)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Push
                                                </button>
                                                <button
                                                    onClick={() => handlePullGroupRemote(group.id, selectedServerId)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Pull
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteGroupRemote(group.id, selectedServerId)}
                                                    disabled={!selectedServerId || isLoading}
                                                    className="px-2 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition disabled:opacity-50"
                                                >
                                                    Del Remote
                                                </button>
                                                {groupRemoteStatus[group.id]?.[selectedServerId] !== undefined && (
                                                    <span className={`text-xs px-2 py-0.5 rounded ${groupRemoteStatus[group.id][selectedServerId] ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>
                                                        {groupRemoteStatus[group.id][selectedServerId] ? '✓ Exists' : '✗ Missing'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Script Preview */}
                                            {scriptContent && (
                                                <div className="space-y-2">
                                                    <span className="text-xs text-zinc-500">Generated Script</span>
                                                    <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-400 max-h-48 overflow-auto whitespace-pre-wrap">
                                                        {scriptContent}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {/* Create Group Modal */}
            {showCreateGroupModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Layers size={20} className="text-purple-400" />
                            Create Batch Group
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">Group Name</label>
                                <input
                                    type="text"
                                    value={newGroupName}
                                    onChange={(e) => setNewGroupName(e.target.value)}
                                    placeholder="e.g., Weekend Migration"
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">Description (optional)</label>
                                <input
                                    type="text"
                                    value={newGroupDescription}
                                    onChange={(e) => setNewGroupDescription(e.target.value)}
                                    placeholder="Describe this batch group"
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">
                                    Select Batches ({selectedBatchesForGroup.size} selected)
                                </label>
                                <div className="max-h-40 overflow-y-auto bg-zinc-800 rounded border border-zinc-700 p-2">
                                    {savedBatches.length === 0 ? (
                                        <div className="text-xs text-zinc-500 italic py-2 text-center">
                                            No saved batches available
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {savedBatches.map((batch) => (
                                                <label
                                                    key={batch.name}
                                                    className="flex items-center gap-2 p-1 hover:bg-zinc-700/50 rounded cursor-pointer"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedBatchesForGroup.has(batch.name)}
                                                        onChange={() => toggleBatchForGroup(batch.name)}
                                                        className="rounded bg-zinc-700 border-zinc-600"
                                                    />
                                                    <span className="text-sm text-zinc-300">{batch.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => {
                                    setShowCreateGroupModal(false);
                                    setNewGroupName('');
                                    setNewGroupDescription('');
                                    setSelectedBatchesForGroup(new Set());
                                }}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateGroup}
                                disabled={groupsLoading || !newGroupName.trim()}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
                            >
                                {groupsLoading ? 'Creating...' : 'Create Group'}
                            </button>
                        </div>
                    </div>
                </div>
            )}


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

            {/* Wizard Placeholder - Commented out for debugging 
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

            {/* User Summary Modal */}
            {showUserSummary && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 overflow-y-auto p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-4xl shadow-2xl my-8">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <List size={20} className="text-cyan-400" />
                                User Summary - Batch File Presence
                            </h3>
                            <button
                                onClick={() => setShowUserSummary(false)}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {!userSummaryData ? (
                            <div className="text-center py-8 text-zinc-400">Loading user summary...</div>
                        ) : (
                            <>
                                {/* Summary Stats */}
                                <div className="flex items-center gap-4 mb-4 text-sm">
                                    <div className="bg-cyan-600/20 px-3 py-2 rounded">
                                        <span className="text-cyan-400 font-bold">{userSummaryData.total_users}</span>
                                        <span className="text-zinc-400 ml-2">unique users</span>
                                    </div>
                                    <div className="bg-zinc-800 px-3 py-2 rounded">
                                        <span className="text-zinc-400">Across</span>
                                        <span className="text-amber-400 ml-2 font-bold">{userSummaryData.total_batches}</span>
                                        <span className="text-zinc-400 ml-2">batch files</span>
                                    </div>
                                </div>

                                {/* User Table */}
                                <div className="max-h-96 overflow-y-auto bg-zinc-800/50 rounded border border-zinc-700">
                                    <table className="w-full text-sm">
                                        <thead className="bg-zinc-800 sticky top-0">
                                            <tr>
                                                <th className="text-left px-4 py-2 text-zinc-400 font-medium">User Email</th>
                                                <th className="text-left px-4 py-2 text-zinc-400 font-medium">Present In Batches</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(userSummaryData.users).map(([email, batches]) => (
                                                <tr key={email} className="border-t border-zinc-700 hover:bg-zinc-800/50">
                                                    <td className="px-4 py-2 text-cyan-300 font-mono text-xs">{email}</td>
                                                    <td className="px-4 py-2">
                                                        <div className="flex flex-wrap gap-1">
                                                            {batches.map((batch) => (
                                                                <span key={batch} className="px-2 py-0.5 bg-amber-600/20 text-amber-400 rounded text-xs">
                                                                    {batch}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {Object.keys(userSummaryData.users).length === 0 && (
                                        <div className="text-center py-8 text-zinc-500 italic">
                                            No users found in batch files
                                        </div>
                                    )}
                                </div>

                                {/* Batch List */}
                                <div className="mt-4">
                                    <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Batch Files</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {userSummaryData.batches.map((batch) => (
                                            <span key={batch} className="px-3 py-1 bg-zinc-800 text-zinc-300 rounded text-xs">
                                                {batch}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="flex justify-end mt-4">
                            <button
                                onClick={() => setShowUserSummary(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Push Modal */}
            {showPushModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Server size={20} className="text-cyan-400" />
                            Push to Remote
                        </h3>
                        <p className="text-sm text-zinc-400 mb-4">
                            Pushing <span className="font-mono text-white">{pushTargetId}</span> to remote server.
                        </p>

                        <div className="mb-6">
                            <label className="block text-xs text-zinc-500 mb-1">Select Server</label>
                            <select
                                value={selectedServerId}
                                onChange={(e) => setSelectedServerId(e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
                            >
                                {sshServers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowPushModal(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePush}
                                disabled={pushing}
                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                            >
                                {pushing ? 'Pushing...' : 'Push'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchGenerator;