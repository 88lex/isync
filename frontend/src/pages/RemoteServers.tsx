import { useState, useEffect } from 'react';
import {
    Server, Plus, Trash2, Edit2, Check, X, RefreshCw, Play, Square,
    RotateCcw, Wifi, WifiOff, Star, ExternalLink, Terminal, Copy, Upload, Package,
    CheckCircle, AlertTriangle, Clock, FileText, HardDrive, Folder, Settings, ChevronDown, ChevronUp, Download
} from 'lucide-react';
import {
    fetchSSHServers, addSSHServer, updateSSHServer, deleteSSHServer,
    testSSHServer, getSSHServerStatus, startRemoteISync, stopRemoteISync,
    restartRemoteISync, deployISync, SSHServer, SSHServerStatus, DeployResult,
    verifyServer, FullVerification, getServerCron, deployServerCron, clearServerCron,
    listServerFiles, getFilePushPreview, pushFilesToServers, ServerFilesResponse, PushPreview,
    pullFilesFromServers, PullResult
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useDataTable } from '../hooks/useDataTable';

const RemoteServers = () => {
    const [servers, setServers] = useState<SSHServer[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingServer, setEditingServer] = useState<SSHServer | null>(null);
    const [serverStatuses, setServerStatuses] = useState<Record<string, SSHServerStatus>>({});
    const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

    // Deploy state
    const [showDeployModal, setShowDeployModal] = useState(false);
    const [deployServerId, setDeployServerId] = useState<string | null>(null);
    const [deploying, setDeploying] = useState(false);
    const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
    const [deployOptions, setDeployOptions] = useState({
        install_deps: true,
        sync_config: true,
        sync_keys: false
    });

    const {
        data: filteredServers,
        searchTerm: filterQuery,
        setSearchTerm: setFilterQuery,
        selectedItems: selectedServers,
        toggleItem: handleServerClick,
        selectAll: selectAllServers,
        invertSelection
    } = useDataTable({
        data: servers,
        columns: [
            { key: 'name', header: 'Name', sortable: true },
            { key: 'host', header: 'Host', sortable: true }
        ],
        persistentKey: 'remote_servers_list',
        filterFn: (s, search) => (
            s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.alias?.toLowerCase().includes(search.toLowerCase()) ||
            s.host.toLowerCase().includes(search.toLowerCase()) ||
            s.user?.toLowerCase().includes(search.toLowerCase())
        )
    });

    // Orchestrator state
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [serverVerifications, setServerVerifications] = useState<Record<string, FullVerification>>({});
    const [showCronModal, setShowCronModal] = useState(false);
    const [cronServerId, setCronServerId] = useState<string | null>(null);
    const [cronContent, setCronContent] = useState('');
    const [cronLoading, setCronLoading] = useState(false);
    const [showPushModal, setShowPushModal] = useState(false);
    const [serverFiles, setServerFiles] = useState<ServerFilesResponse | null>(null);
    const [pushFileTypes, setPushFileTypes] = useState<string[]>(['rclone', 'keys', 'batch', 'scripts']);
    const [pushPreviews, setPushPreviews] = useState<PushPreview[]>([]);
    const [pushing, setPushing] = useState(false);

    // Pull state
    const [showPullModal, setShowPullModal] = useState(false);
    const [pullFileTypes, setPullFileTypes] = useState<string[]>(['rclone', 'keys', 'batch', 'scripts', 'cron']);
    const [pulling, setPulling] = useState(false);
    const [pullResults, setPullResults] = useState<PullResult[]>([]);

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        alias: '',
        host: '',
        port: 22,
        user: '',
        key_path: '',
        remote_path: '~/isync',
        is_default: false
    });

    const [verificationFilters, setVerificationFilters] = useState<Record<string, string>>({});

    useEffect(() => {
        loadServers();
    }, []);

    const loadServers = async () => {
        setLoading(true);
        try {
            const data = await fetchSSHServers();
            setServers(data);
        } catch (e) {
            console.error('Failed to load servers', e);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            alias: '',
            host: '',
            port: 22,
            user: '',
            key_path: '',
            remote_path: '~/isync',
            is_default: false
        });
    };

    const handleSaveServer = async () => {
        try {
            if (editingServer) {
                await updateSSHServer(editingServer.id, formData);
            } else {
                await addSSHServer(formData);
            }
            await loadServers();
            setShowAddModal(false);
            setEditingServer(null);
            resetForm();
        } catch (e: any) {
            alert('Failed to save: ' + (e.message || 'Unknown error'));
        }
    };

    const handleDeleteServer = async (id: string) => {
        if (!confirm('Delete this server?')) return;
        try {
            await deleteSSHServer(id);
            await loadServers();
        } catch (e: any) {
            alert('Failed to delete: ' + (e.message || 'Unknown error'));
        }
    };

    const handleEditServer = (server: SSHServer) => {
        setEditingServer(server);
        setFormData({
            name: server.name,
            alias: server.alias || '',
            host: server.host || '',
            port: server.port || 22,
            user: server.user || '',
            key_path: server.key_path || '',
            remote_path: server.remote_path || '~/isync',
            is_default: server.is_default || false
        });
        setShowAddModal(true);
    };

    const handleAction = async (serverId: string, action: string, fn: () => Promise<any>) => {
        setActionLoading(prev => ({ ...prev, [serverId]: action }));
        try {
            const result = await fn();
            if (result.status === 'error') {
                alert(result.message);
            } else {
                // Refresh status after action
                const status = await getSSHServerStatus(serverId);
                setServerStatuses(prev => ({ ...prev, [serverId]: status }));
            }
        } catch (e: any) {
            alert('Action failed: ' + (e.message || 'Unknown error'));
        } finally {
            setActionLoading(prev => ({ ...prev, [serverId]: '' }));
        }
    };

    const handleTestConnection = (serverId: string) => {
        handleAction(serverId, 'test', async () => {
            const result = await testSSHServer(serverId);
            alert(result.status === 'ok' ? '✅ Connection successful!' : '❌ ' + result.message);
            return result;
        });
    };

    const handleCheckStatus = async (serverId: string) => {
        setActionLoading(prev => ({ ...prev, [serverId]: 'status' }));
        try {
            const status = await getSSHServerStatus(serverId);
            setServerStatuses(prev => ({ ...prev, [serverId]: status }));
        } catch (e: any) {
            setServerStatuses(prev => ({
                ...prev,
                [serverId]: { status: 'error', connected: false, message: e.message }
            }));
        } finally {
            setActionLoading(prev => ({ ...prev, [serverId]: '' }));
        }
    };

    const handleStart = (serverId: string) => {
        handleAction(serverId, 'start', () => startRemoteISync(serverId));
    };

    const handleStop = (serverId: string) => {
        if (!confirm('Stop ISync on this server?')) return;
        handleAction(serverId, 'stop', () => stopRemoteISync(serverId));
    };

    const handleRestart = (serverId: string) => {
        if (!confirm('Restart ISync on this server?')) return;
        handleAction(serverId, 'restart', () => restartRemoteISync(serverId));
    };

    const copySSHCommand = (server: SSHServer) => {
        let cmd = 'ssh ';
        if (server.alias) {
            cmd += server.alias;
        } else {
            if (server.key_path) cmd += `-i ${server.key_path} `;
            if (server.port && server.port !== 22) cmd += `-p ${server.port} `;
            if (server.user) cmd += `${server.user}@`;
            cmd += server.host || '';
        }
        navigator.clipboard.writeText(cmd);
        alert('SSH command copied to clipboard!');
    };

    const copyTunnelCommand = (server: SSHServer) => {
        let cmd = 'ssh -L 5173:localhost:5173 -L 8000:localhost:8000 ';
        if (server.alias) {
            cmd += server.alias;
        } else {
            if (server.key_path) cmd += `-i ${server.key_path} `;
            if (server.port && server.port !== 22) cmd += `-p ${server.port} `;
            if (server.user) cmd += `${server.user}@`;
            cmd += server.host || '';
        }
        navigator.clipboard.writeText(cmd);
        alert('SSH tunnel command copied to clipboard!');
    };

    const handleDeploy = async () => {
        if (!deployServerId) return;
        setDeploying(true);
        setDeployResult(null);
        try {
            const result = await deployISync(deployServerId, deployOptions);
            setDeployResult(result);
        } catch (e: any) {
            setDeployResult({
                status: 'error',
                message: e.message || 'Deployment failed',
                steps_completed: [],
                errors: [e.message || 'Unknown error']
            });
        } finally {
            setDeploying(false);
        }
    };

    const openDeployModal = (serverId: string) => {
        setDeployServerId(serverId);
        setDeployResult(null);
        setDeployOptions({ install_deps: true, sync_config: true, sync_keys: false });
        setShowDeployModal(true);
    };

    const getStatusBadge = (status: SSHServerStatus | undefined) => {
        if (!status) return null;

        if (status.status === 'error' || !status.connected) {
            return (
                <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/20 px-2 py-1 rounded-full">
                    <WifiOff size={12} /> Disconnected
                </span>
            );
        }

        if (status.isync_running) {
            return (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded-full">
                    <Wifi size={12} /> Running
                </span>
            );
        }

        return (
            <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/20 px-2 py-1 rounded-full">
                <Wifi size={12} /> Stopped
            </span>
        );
    };

    // Orchestrator Functions
    const handleVerifyServer = async (serverId: string) => {
        setActionLoading(prev => ({ ...prev, [serverId]: 'verify' }));
        try {
            const result = await verifyServer(serverId);
            setServerVerifications(prev => ({ ...prev, [serverId]: result }));
            setExpandedServer(serverId);
        } catch (e: any) {
            alert('Verification failed: ' + (e.message || 'Unknown error'));
        } finally {
            setActionLoading(prev => ({ ...prev, [serverId]: '' }));
        }
    };

    const openCronModal = async (serverId: string) => {
        setCronServerId(serverId);
        setCronLoading(true);
        setShowCronModal(true);
        try {
            const data = await getServerCron(serverId);
            setCronContent(data.remote.content || data.local_template.content || '');
        } catch (e) {
            setCronContent('# Crontab\n# Add your scheduled tasks here\n');
        } finally {
            setCronLoading(false);
        }
    };

    const handleDeployCron = async () => {
        if (!cronServerId) return;
        setCronLoading(true);
        try {
            const result = await deployServerCron(cronServerId, cronContent, true);
            if (result.status === 'ok') {
                alert('✅ Crontab deployed successfully!');
                setShowCronModal(false);
            } else {
                alert('❌ ' + result.message);
            }
        } catch (e: any) {
            alert('Failed: ' + (e.message || 'Unknown error'));
        } finally {
            setCronLoading(false);
        }
    };

    const handleClearCron = async () => {
        if (!cronServerId || !confirm('Clear crontab on this server?')) return;
        setCronLoading(true);
        try {
            await clearServerCron(cronServerId);
            setCronContent('');
            alert('✅ Crontab cleared');
        } catch (e: any) {
            alert('Failed: ' + (e.message || 'Unknown error'));
        } finally {
            setCronLoading(false);
        }
    };

    const openPushModal = async () => {
        setShowPushModal(true);
        setPushPreviews([]);
        try {
            const files = await listServerFiles();
            setServerFiles(files);
        } catch (e) {
            console.error('Failed to load server files', e);
        }
    };

    const previewPush = async () => {
        try {
            const serverIds = Array.from(selectedServers).map(String);
            const result = await getFilePushPreview(serverIds, pushFileTypes);
            setPushPreviews(result.previews);
        } catch (e: any) {
            alert('Preview failed: ' + (e.message || 'Unknown error'));
        }
    };

    const executePush = async (dryRun: boolean = false) => {
        const serverIds = Array.from(selectedServers).map(String);
        if (serverIds.length === 0) return;

        setPushing(true);
        try {
            const result = await pushFilesToServers(serverIds, pushFileTypes, dryRun);
            if (result.status === 'ok') {
                alert(`✅ Files pushed to ${result.success}/${result.total} servers`);
                if (!dryRun) setShowPushModal(false);
            } else {
                alert(`⚠️ Partial success: ${result.success}/${result.total} servers`);
            }
        } catch (e: any) {
            alert('Push failed: ' + (e.message || 'Unknown error'));
        } finally {
            setPushing(false);
        }
    };

    const openPullModal = () => {
        setPullResults([]);
        setShowPullModal(true);
    };

    const executePull = async () => {
        const serverIds = Array.from(selectedServers).map(String);
        if (serverIds.length === 0) {
            alert('Select at least one server');
            return;
        }

        setPulling(true);
        setPullResults([]);
        try {
            const result = await pullFilesFromServers(serverIds, pullFileTypes);
            setPullResults(result.results);
            if (result.status === 'ok') {
                alert(`✅ Files pulled from ${result.success}/${result.total} servers`);
            } else {
                alert(`⚠️ Partial success: ${result.success}/${result.total} servers`);
            }
        } catch (e: any) {
            alert('Pull failed: ' + (e.message || 'Unknown error'));
        } finally {
            setPulling(false);
        }
    };

    return (
        <div className="page-container space-y-4">
            <PageHeader
                icon={Server}
                title="Remote Servers"
                subtitle="Manage SSH servers for remote ISync execution"
                gradient="from-cyan-600 to-blue-600"
            />

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Filter servers..."
                            value={filterQuery}
                            onChange={(e) => setFilterQuery(e.target.value)}
                            className="bg-zinc-900 border border-zinc-700 text-sm rounded-lg pl-3 pr-8 py-2 w-64 focus:outline-none focus:border-cyan-500 transition-colors"
                        />
                        {filterQuery && (
                            <button
                                onClick={() => setFilterQuery('')}
                                className="absolute right-2 top-2.5 text-zinc-500 hover:text-white"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {servers.length > 0 && (
                        <>
                            <button
                                onClick={selectAllServers}
                                className={`text-sm transition ${selectedServers.size === filteredServers.length && filteredServers.length > 0 ? 'text-cyan-400' : 'text-zinc-400 hover:text-white'}`}
                            >
                                {selectedServers.size === filteredServers.length && filteredServers.length > 0 ? 'Deselect All' : 'Select All'}
                            </button>
                            <button
                                onClick={invertSelection}
                                className="text-sm text-zinc-400 hover:text-white transition"
                            >
                                Invert Selection
                            </button>
                            {selectedServers.size > 0 && (
                                <>
                                    <button
                                        onClick={openPushModal}
                                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition"
                                    >
                                        <Upload size={16} /> Push Files
                                    </button>
                                    <button
                                        onClick={openPullModal}
                                        className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition"
                                    >
                                        <Download size={16} /> Pull/Backup
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </div>
                <button
                    onClick={() => {
                        resetForm();
                        setEditingServer(null);
                        setShowAddModal(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition"
                >
                    <Plus size={16} /> Add Server
                </button>
            </div>

            {loading ? (
                <div className="text-center text-zinc-500 py-12">Loading servers...</div>
            ) : servers.length === 0 ? (
                <Card>
                    <div className="text-center py-12 text-zinc-500">
                        <Server size={48} className="mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium">No remote servers configured</p>
                        <p className="text-sm mt-2">Add an SSH server to run ISync remotely</p>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {filteredServers.length === 0 ? (
                        <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                            <p>No servers match your filter.</p>
                            <button onClick={() => setFilterQuery('')} className="text-cyan-500 hover:underline mt-2 text-sm">Clear filter</button>
                        </div>
                    ) : (
                        filteredServers.map((server) => {
                            const status = serverStatuses[server.id];
                            const isLoading = actionLoading[server.id];
                            const isSelected = selectedServers.has(server.id);

                            return (
                                <div
                                    key={server.id}
                                    onClick={(e) => {
                                        if ((e.target as HTMLElement).closest('button')) return;
                                        handleServerClick(server.id, e);
                                    }}
                                    className={`bg-zinc-900 border rounded-xl p-4 transition-all cursor-pointer ${isSelected ? 'border-cyan-500/50 bg-cyan-900/10' : 'border-zinc-800 hover:border-zinc-700'}`}
                                >
                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                        {/* Server Selection Checkbox */}
                                        <div className="flex items-start gap-4">
                                            <div
                                                className={`w-5 h-5 mt-1 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-cyan-600 border-cyan-600' : 'border-zinc-600 bg-zinc-800'}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleServerClick(server.id, e);
                                                }}
                                            >
                                                {isSelected && <CheckCircle size={12} className="text-white" />}
                                            </div>
                                            {/* Server Info */}
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <div className={`w-3 h-3 rounded-full ${status?.isync_running ? 'bg-emerald-500' :
                                                        status?.connected ? 'bg-yellow-500' :
                                                            status ? 'bg-red-500' : 'bg-zinc-600'
                                                        }`} />
                                                    <h3 className="text-lg font-bold text-white">{server.name}</h3>
                                                    {server.is_default && (
                                                        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded">
                                                            <Star size={12} /> Default
                                                        </span>
                                                    )}
                                                    {getStatusBadge(status)}
                                                </div>

                                                <div className="text-sm text-zinc-400 space-y-1">
                                                    {server.alias ? (
                                                        <p>SSH Alias: <span className="text-cyan-400 font-mono">{server.alias}</span></p>
                                                    ) : (
                                                        <p>
                                                            <span className="text-cyan-400 font-mono">
                                                                {server.user && `${server.user}@`}{server.host}
                                                                {server.port !== 22 && `:${server.port}`}
                                                            </span>
                                                        </p>
                                                    )}
                                                    <p>Path: <span className="font-mono text-zinc-300">{server.remote_path}</span></p>
                                                </div>

                                                {status && status.connected && (
                                                    <div className="flex gap-4 mt-3 text-xs text-zinc-500">
                                                        <span className={status.backend_running ? 'text-emerald-400' : 'text-zinc-600'}>
                                                            Backend: {status.backend_running ? 'Running' : 'Stopped'}
                                                        </span>
                                                        <span className={status.frontend_running ? 'text-emerald-400' : 'text-zinc-600'}>
                                                            Frontend: {status.frontend_running ? 'Running' : 'Stopped'}
                                                        </span>
                                                        <span className={status.tmux_session ? 'text-emerald-400' : 'text-zinc-600'}>
                                                            Tmux: {status.tmux_session ? 'Active' : 'None'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    onClick={() => handleCheckStatus(server.id)}
                                                    disabled={!!isLoading}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded text-xs transition"
                                                >
                                                    <RefreshCw size={14} className={isLoading === 'status' ? 'animate-spin' : ''} />
                                                    Status
                                                </button>
                                                <button
                                                    onClick={() => handleTestConnection(server.id)}
                                                    disabled={!!isLoading}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded text-xs transition"
                                                >
                                                    <Wifi size={14} />
                                                    Test
                                                </button>

                                                {status?.isync_running ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleRestart(server.id)}
                                                            disabled={!!isLoading}
                                                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded text-xs transition"
                                                        >
                                                            <RotateCcw size={14} className={isLoading === 'restart' ? 'animate-spin' : ''} />
                                                            Restart
                                                        </button>
                                                        <button
                                                            onClick={() => handleStop(server.id)}
                                                            disabled={!!isLoading}
                                                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded text-xs transition"
                                                        >
                                                            <Square size={14} />
                                                            Stop
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => handleStart(server.id)}
                                                        disabled={!!isLoading}
                                                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-xs transition"
                                                    >
                                                        <Play size={14} />
                                                        {isLoading === 'start' ? 'Starting...' : 'Start'}
                                                    </button>
                                                )}

                                                <div className="border-l border-zinc-700 mx-1" />

                                                <button
                                                    onClick={() => copySSHCommand(server)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition"
                                                    title="Copy SSH command"
                                                >
                                                    <Terminal size={14} />
                                                </button>
                                                <button
                                                    onClick={() => copyTunnelCommand(server)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition"
                                                    title="Copy SSH tunnel command"
                                                >
                                                    <ExternalLink size={14} />
                                                </button>
                                                <button
                                                    onClick={() => openDeployModal(server.id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs transition"
                                                    title="Deploy/Install ISync"
                                                >
                                                    <Upload size={14} />
                                                    Deploy
                                                </button>
                                                <button
                                                    onClick={() => handleVerifyServer(server.id)}
                                                    disabled={!!isLoading}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs transition"
                                                    title="Full server verification"
                                                >
                                                    <CheckCircle size={14} className={isLoading === 'verify' ? 'animate-spin' : ''} />
                                                    Verify
                                                </button>
                                                <button
                                                    onClick={() => openCronModal(server.id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs transition"
                                                    title="Manage crontab"
                                                >
                                                    <Clock size={14} />
                                                    Cron
                                                </button>
                                                <button
                                                    onClick={() => handleEditServer(server)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteServer(server.id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-red-600 text-zinc-300 hover:text-white rounded text-xs transition"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Verification Panel */}
                                    {expandedServer === server.id && serverVerifications[server.id] && (
                                        <div className="mt-4 pt-4 border-t border-zinc-700">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                                                    <Settings size={14} /> Server Verification Details
                                                </h4>
                                                <button onClick={() => setExpandedServer(null)} className="text-zinc-400 hover:text-white text-xs">
                                                    <ChevronUp size={14} />
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs h-80">
                                                {/* Rclone */}
                                                <div className="bg-zinc-800/50 p-3 rounded flex flex-col border border-zinc-700/50">
                                                    <div className="flex justify-between items-center mb-2 shrink-0">
                                                        <div className="text-zinc-300 font-bold flex items-center gap-2"><HardDrive size={12} /> Rclone</div>
                                                        <span className={serverVerifications[server.id].rclone?.rclone_installed ? 'text-emerald-400' : 'text-red-400'}>
                                                            {serverVerifications[server.id].rclone?.rclone_installed ? 'Installed' : 'Missing'}
                                                        </span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Filter remotes..."
                                                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs mb-2 w-full focus:outline-none focus:border-cyan-500 shrink-0"
                                                        value={verificationFilters[`${server.id}-rclone`] || ''}
                                                        onChange={e => setVerificationFilters(prev => ({ ...prev, [`${server.id}-rclone`]: e.target.value }))}
                                                    />
                                                    <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                                        {(serverVerifications[server.id].rclone?.remotes || [])
                                                            .filter(r => !verificationFilters[`${server.id}-rclone`] || r.toLowerCase().includes(verificationFilters[`${server.id}-rclone`].toLowerCase()))
                                                            .map((r, i) => (
                                                                <div key={i} className="bg-zinc-900/50 px-2 py-1.5 rounded text-zinc-300 truncate border border-zinc-800/50 flex items-center gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/50"></div>
                                                                    {r}
                                                                </div>
                                                            ))}
                                                        {(!serverVerifications[server.id].rclone?.remotes?.length) && <div className="text-zinc-600 italic text-center py-2">No remotes found</div>}
                                                    </div>
                                                </div>

                                                {/* Files & Keys */}
                                                <div className="bg-zinc-800/50 p-3 rounded flex flex-col border border-zinc-700/50">
                                                    <div className="flex justify-between items-center mb-2 shrink-0">
                                                        <div className="text-zinc-300 font-bold flex items-center gap-2"><FileText size={12} /> Files</div>
                                                        <span className={serverVerifications[server.id].files?.path_exists ? 'text-emerald-400' : 'text-red-400'}>
                                                            {serverVerifications[server.id].files?.path_exists ? 'Path OK' : 'Missing'}
                                                        </span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Filter keys/groups..."
                                                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs mb-2 w-full focus:outline-none focus:border-cyan-500 shrink-0"
                                                        value={verificationFilters[`${server.id}-files`] || ''}
                                                        onChange={e => setVerificationFilters(prev => ({ ...prev, [`${server.id}-files`]: e.target.value }))}
                                                    />
                                                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                                                        <div>
                                                            <div className="text-zinc-500 font-semibold mb-1 uppercase text-[10px] tracking-wider">JSON Keys</div>
                                                            <div className="space-y-1">
                                                                {(serverVerifications[server.id].files?.keys_list || [])
                                                                    .filter(k => !verificationFilters[`${server.id}-files`] || k.toLowerCase().includes(verificationFilters[`${server.id}-files`].toLowerCase()))
                                                                    .map((k, i) => (
                                                                        <div key={i} className="bg-zinc-900/50 px-2 py-1 rounded text-amber-500/80 truncate border border-zinc-800/50 text-[11px]">{k}</div>
                                                                    ))}
                                                                {!serverVerifications[server.id].files?.keys_list?.length && <div className="text-zinc-700 italic">None</div>}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-zinc-500 font-semibold mb-1 uppercase text-[10px] tracking-wider">Batch Groups</div>
                                                            <div className="space-y-1">
                                                                {(serverVerifications[server.id].files?.groups_list || [])
                                                                    .filter(g => !verificationFilters[`${server.id}-files`] || g.toLowerCase().includes(verificationFilters[`${server.id}-files`].toLowerCase()))
                                                                    .map((g, i) => (
                                                                        <div key={i} className="bg-zinc-900/50 px-2 py-1 rounded text-purple-400/80 truncate border border-zinc-800/50 text-[11px]">{g}</div>
                                                                    ))}
                                                                {!serverVerifications[server.id].files?.groups_list?.length && <div className="text-zinc-700 italic">None</div>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Batch */}
                                                <div className="bg-zinc-800/50 p-3 rounded flex flex-col border border-zinc-700/50">
                                                    <div className="flex justify-between items-center mb-2 shrink-0">
                                                        <div className="text-zinc-300 font-bold flex items-center gap-2"><Terminal size={12} /> Batch</div>
                                                        <span className={serverVerifications[server.id].batch?.running ? 'text-amber-400 animate-pulse' : 'text-zinc-500'}>
                                                            {serverVerifications[server.id].batch?.running ? 'Running' : 'Idle'}
                                                        </span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Filter batch/processes..."
                                                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs mb-2 w-full focus:outline-none focus:border-cyan-500 shrink-0"
                                                        value={verificationFilters[`${server.id}-batch`] || ''}
                                                        onChange={e => setVerificationFilters(prev => ({ ...prev, [`${server.id}-batch`]: e.target.value }))}
                                                    />
                                                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                                                        {serverVerifications[server.id].batch?.processes?.length ? (
                                                            <div>
                                                                <div className="text-zinc-500 font-semibold mb-1 uppercase text-[10px] tracking-wider">Processes</div>
                                                                <div className="space-y-1">
                                                                    {serverVerifications[server.id].batch?.processes
                                                                        .filter(p => !verificationFilters[`${server.id}-batch`] || p.toLowerCase().includes(verificationFilters[`${server.id}-batch`].toLowerCase()))
                                                                        .map((p, i) => (
                                                                            <div key={i} className="bg-zinc-900/50 px-2 py-1 rounded text-emerald-400/80 truncate border border-zinc-800/50 text-[10px] font-mono">{p}</div>
                                                                        ))}
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                        <div>
                                                            <div className="text-zinc-500 font-semibold mb-1 uppercase text-[10px] tracking-wider">Batch Files ({serverVerifications[server.id].batch?.batch_count})</div>
                                                            <div className="space-y-1">
                                                                {(serverVerifications[server.id].batch?.batch_files_list || [])
                                                                    .filter(f => !verificationFilters[`${server.id}-batch`] || f.toLowerCase().includes(verificationFilters[`${server.id}-batch`].toLowerCase()))
                                                                    .map((f, i) => (
                                                                        <div key={i} className="bg-zinc-900/50 px-2 py-1 rounded text-zinc-400 truncate border border-zinc-800/50 text-[11px]">{f}</div>
                                                                    ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Cron */}
                                                <div className="bg-zinc-800/50 p-3 rounded flex flex-col border border-zinc-700/50">
                                                    <div className="flex justify-between items-center mb-2 shrink-0">
                                                        <div className="text-zinc-300 font-bold flex items-center gap-2"><Clock size={12} /> Cron</div>
                                                        <span className={serverVerifications[server.id].cron?.has_crontab ? 'text-emerald-400' : 'text-zinc-500'}>
                                                            {serverVerifications[server.id].cron?.has_crontab ? 'Active' : 'Empty'}
                                                        </span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Filter entries..."
                                                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs mb-2 w-full focus:outline-none focus:border-cyan-500 shrink-0"
                                                        value={verificationFilters[`${server.id}-cron`] || ''}
                                                        onChange={e => setVerificationFilters(prev => ({ ...prev, [`${server.id}-cron`]: e.target.value }))}
                                                    />
                                                    <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar font-mono text-[10px]">
                                                        {(serverVerifications[server.id].cron?.entries_list || [])
                                                            .filter(e => !verificationFilters[`${server.id}-cron`] || e.toLowerCase().includes(verificationFilters[`${server.id}-cron`].toLowerCase()))
                                                            .map((entry, i) => (
                                                                <div key={i} className="bg-zinc-900/50 px-2 py-1 rounded text-zinc-400 break-all border border-zinc-800/50">
                                                                    {entry}
                                                                </div>
                                                            ))}
                                                        {(!serverVerifications[server.id].cron?.entries_list?.length) && <div className="text-zinc-600 italic text-center py-2">No entries</div>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Server size={20} className="text-cyan-400" />
                            {editingServer ? 'Edit Server' : 'Add SSH Server'}
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Server Name *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., Production Server"
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                                />
                            </div>

                            <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                                <p className="text-xs text-zinc-500 mb-2">Use SSH Alias (from ~/.ssh/config) OR specify host details:</p>

                                <div className="mb-3">
                                    <label className="block text-sm text-zinc-400 mb-1">SSH Alias</label>
                                    <input
                                        type="text"
                                        value={formData.alias}
                                        onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                                        placeholder="e.g., myserver"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                                    />
                                </div>

                                <div className="text-center text-xs text-zinc-600 mb-3">— OR —</div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm text-zinc-400 mb-1">Host</label>
                                        <input
                                            type="text"
                                            value={formData.host}
                                            onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                                            placeholder="192.168.1.100"
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-zinc-400 mb-1">Port</label>
                                        <input
                                            type="number"
                                            value={formData.port}
                                            onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 22 })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-zinc-400 mb-1">User</label>
                                        <input
                                            type="text"
                                            value={formData.user}
                                            onChange={(e) => setFormData({ ...formData, user: e.target.value })}
                                            placeholder="admin"
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-zinc-400 mb-1">Key Path</label>
                                        <input
                                            type="text"
                                            value={formData.key_path}
                                            onChange={(e) => setFormData({ ...formData, key_path: e.target.value })}
                                            placeholder="~/.ssh/id_rsa"
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Remote ISync Path *</label>
                                <input
                                    type="text"
                                    value={formData.remote_path}
                                    onChange={(e) => setFormData({ ...formData, remote_path: e.target.value })}
                                    placeholder="~/isync"
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                                />
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.is_default}
                                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                                    className="w-4 h-4 rounded"
                                />
                                <span className="text-sm text-zinc-300">Set as default server</span>
                            </label>
                        </div>

                        <div className="flex gap-2 justify-end mt-6">
                            <button
                                onClick={() => {
                                    setShowAddModal(false);
                                    setEditingServer(null);
                                    resetForm();
                                }}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveServer}
                                disabled={!formData.name || (!formData.alias && !formData.host)}
                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                            >
                                <Check size={16} />
                                {editingServer ? 'Update' : 'Add Server'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Deploy Modal */}
            {showDeployModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Upload size={20} className="text-purple-400" />
                            Deploy ISync to Server
                        </h3>

                        {!deployResult ? (
                            <>
                                <p className="text-sm text-zinc-400 mb-4">
                                    This will sync the ISync application from your local machine to the remote server.
                                </p>

                                <div className="space-y-3 mb-6">
                                    <label className="flex items-center gap-3 cursor-pointer p-3 bg-zinc-800/50 rounded-lg border border-zinc-700 hover:border-zinc-600">
                                        <input
                                            type="checkbox"
                                            checked={deployOptions.install_deps}
                                            onChange={(e) => setDeployOptions({ ...deployOptions, install_deps: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <div>
                                            <span className="text-sm text-white font-medium">Install Dependencies</span>
                                            <p className="text-xs text-zinc-500">Run pip install and npm install on remote</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer p-3 bg-zinc-800/50 rounded-lg border border-zinc-700 hover:border-zinc-600">
                                        <input
                                            type="checkbox"
                                            checked={deployOptions.sync_config}
                                            onChange={(e) => setDeployOptions({ ...deployOptions, sync_config: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <div>
                                            <span className="text-sm text-white font-medium">Sync Configuration</span>
                                            <p className="text-xs text-zinc-500">Include config.yaml, synclist.yaml, profiles</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer p-3 bg-zinc-800/50 rounded-lg border border-amber-700/30 hover:border-amber-600/50">
                                        <input
                                            type="checkbox"
                                            checked={deployOptions.sync_keys}
                                            onChange={(e) => setDeployOptions({ ...deployOptions, sync_keys: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <div>
                                            <span className="text-sm text-amber-400 font-medium">⚠️ Sync Service Account Keys</span>
                                            <p className="text-xs text-zinc-500">Include keys/ directory (contains sensitive credentials!)</p>
                                        </div>
                                    </label>
                                </div>

                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setShowDeployModal(false)}
                                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleDeploy}
                                        disabled={deploying}
                                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                                    >
                                        {deploying ? (
                                            <>
                                                <RefreshCw size={16} className="animate-spin" />
                                                Deploying...
                                            </>
                                        ) : (
                                            <>
                                                <Upload size={16} />
                                                Deploy Now
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className={`p-4 rounded-lg mb-4 ${deployResult.status === 'ok' ? 'bg-emerald-500/20 border border-emerald-500/30' :
                                    deployResult.status === 'partial' ? 'bg-amber-500/20 border border-amber-500/30' :
                                        'bg-red-500/20 border border-red-500/30'
                                    }`}>
                                    <p className={`font-medium ${deployResult.status === 'ok' ? 'text-emerald-400' :
                                        deployResult.status === 'partial' ? 'text-amber-400' :
                                            'text-red-400'
                                        }`}>
                                        {deployResult.status === 'ok' ? '✅ ' : deployResult.status === 'partial' ? '⚠️ ' : '❌ '}
                                        {deployResult.message}
                                    </p>
                                </div>

                                {deployResult.steps_completed.length > 0 && (
                                    <div className="mb-4">
                                        <h4 className="text-xs font-bold text-zinc-500 uppercase mb-2">Steps Completed</h4>
                                        <ul className="space-y-1">
                                            {deployResult.steps_completed.map((step, i) => (
                                                <li key={i} className="text-sm text-emerald-400 flex items-center gap-2">
                                                    <Check size={14} /> {step}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {deployResult.errors && deployResult.errors.length > 0 && (
                                    <div className="mb-4">
                                        <h4 className="text-xs font-bold text-zinc-500 uppercase mb-2">Errors</h4>
                                        <ul className="space-y-1">
                                            {deployResult.errors.map((err, i) => (
                                                <li key={i} className="text-sm text-red-400 flex items-start gap-2">
                                                    <X size={14} className="mt-0.5 flex-shrink-0" />
                                                    <span className="break-all">{err}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setShowDeployModal(false)}
                                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                                    >
                                        Close
                                    </button>
                                    {deployResult.status !== 'ok' && (
                                        <button
                                            onClick={() => setDeployResult(null)}
                                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition"
                                        >
                                            Try Again
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Cron Editor Modal */}
            {showCronModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Clock size={20} className="text-amber-400" />
                            Crontab Editor - {servers.find(s => s.id === cronServerId)?.name}
                        </h3>

                        {cronLoading ? (
                            <div className="text-center py-8 text-zinc-400">Loading crontab...</div>
                        ) : (
                            <>
                                <textarea
                                    value={cronContent}
                                    onChange={(e) => setCronContent(e.target.value)}
                                    className="w-full h-64 bg-zinc-800 border border-zinc-700 rounded-lg p-4 text-sm font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                                    placeholder="# Crontab entries&#10;# Format: minute hour day month weekday command&#10;# Example: 0 2 * * * ~/isync/run_batch.sh"
                                />

                                <div className="flex gap-2 justify-end mt-4">
                                    <button
                                        onClick={handleClearCron}
                                        disabled={cronLoading}
                                        className="px-4 py-2 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-sm transition disabled:opacity-50"
                                    >
                                        Clear Crontab
                                    </button>
                                    <button
                                        onClick={() => setShowCronModal(false)}
                                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleDeployCron}
                                        disabled={cronLoading}
                                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                                    >
                                        Deploy Crontab
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Push Files Modal */}
            {showPushModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 overflow-y-auto p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-3xl shadow-2xl my-8">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Upload size={20} className="text-purple-400" />
                            Push Files to {selectedServers.size} Server{selectedServers.size > 1 ? 's' : ''}
                        </h3>

                        {/* File Types Selection */}
                        <div className="mb-4">
                            <label className="block text-sm text-zinc-400 mb-2">File Types to Push</label>
                            <div className="flex flex-wrap gap-3">
                                {['rclone', 'keys', 'batch', 'scripts', 'cron'].map(type => (
                                    <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={pushFileTypes.includes(type)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setPushFileTypes([...pushFileTypes, type]);
                                                } else {
                                                    setPushFileTypes(pushFileTypes.filter(t => t !== type));
                                                }
                                            }}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-zinc-300 capitalize">{type}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Available Files */}
                        {serverFiles && (
                            <div className="mb-4 bg-zinc-800/50 p-4 rounded-lg">
                                <h4 className="text-sm font-medium text-zinc-300 mb-2">Available Files in server_files/</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                                    {Object.entries(serverFiles).map(([type, files]) => (
                                        <div key={type}>
                                            <div className="text-zinc-400 mb-1 capitalize">{type}/</div>
                                            {files.length > 0 ? (
                                                files.slice(0, 3).map((f, i) => (
                                                    <div key={i} className="text-zinc-500 truncate">• {f.name}</div>
                                                ))
                                            ) : (
                                                <div className="text-zinc-600 italic">Empty</div>
                                            )}
                                            {files.length > 3 && (
                                                <div className="text-zinc-600">+{files.length - 3} more</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Preview Results */}
                        {pushPreviews.length > 0 && (
                            <div className="mb-4 bg-zinc-800/50 p-4 rounded-lg max-h-48 overflow-y-auto">
                                <h4 className="text-sm font-medium text-zinc-300 mb-2">Push Preview</h4>
                                {pushPreviews.map((preview, i) => (
                                    <div key={i} className="text-xs mb-2">
                                        <div className="text-cyan-400 font-medium">{preview.server_name}</div>
                                        <div className="text-zinc-500">
                                            {preview.files.length} files, {Math.round(preview.total_size / 1024)} KB
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowPushModal(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={previewPush}
                                disabled={pushing}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm transition disabled:opacity-50"
                            >
                                Preview
                            </button>
                            <button
                                onClick={() => executePush(true)}
                                disabled={pushing}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition disabled:opacity-50"
                            >
                                Dry Run
                            </button>
                            <button
                                onClick={() => executePush(false)}
                                disabled={pushing || pushFileTypes.length === 0}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                            >
                                {pushing ? 'Pushing...' : 'Push Files'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Pull Files Modal */}
            {showPullModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 overflow-y-auto p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl my-8">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Download size={20} className="text-teal-400" />
                            Pull/Backup Files from {selectedServers.size} Server{selectedServers.size > 1 ? 's' : ''}
                        </h3>

                        <p className="text-sm text-zinc-400 mb-4">
                            Download files from selected servers to local <code className="bg-zinc-800 px-1 rounded">pulled_backups/</code> folder.
                        </p>

                        {/* File Types Selection */}
                        <div className="mb-4">
                            <label className="block text-sm text-zinc-400 mb-2">File Types to Pull</label>
                            <div className="flex flex-wrap gap-3">
                                {['rclone', 'keys', 'batch', 'scripts', 'cron'].map(type => (
                                    <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={pullFileTypes.includes(type)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setPullFileTypes([...pullFileTypes, type]);
                                                } else {
                                                    setPullFileTypes(pullFileTypes.filter(t => t !== type));
                                                }
                                            }}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-zinc-300 capitalize">{type}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Pull Results */}
                        {pullResults.length > 0 && (
                            <div className="mb-4 bg-zinc-800/50 p-4 rounded-lg border border-zinc-700 max-h-64 overflow-y-auto">
                                <h4 className="text-sm font-medium text-zinc-300 mb-2">Pull Results</h4>
                                {pullResults.map((result, i) => (
                                    <div key={i} className="text-xs mb-3">
                                        <div className={`font-medium ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {result.success ? '✓' : '✗'} {result.server_name}
                                        </div>
                                        <div className="text-zinc-500 ml-4">
                                            Backup: {result.backup_name}
                                        </div>
                                        {result.files_pulled.map((f, j) => (
                                            <div key={j} className="text-zinc-600 ml-4">
                                                • {f.type}: {f.output}
                                            </div>
                                        ))}
                                        {result.errors.map((e, j) => (
                                            <div key={j} className="text-red-400 ml-4">
                                                ✗ {e.type}: {e.error}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowPullModal(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                            >
                                Close
                            </button>
                            <button
                                onClick={executePull}
                                disabled={pulling || pullFileTypes.length === 0}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                            >
                                {pulling ? 'Pulling...' : 'Pull Files'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RemoteServers;
