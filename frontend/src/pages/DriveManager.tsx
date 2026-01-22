import { useState, useEffect, useMemo, useRef } from 'react';
import { HardDrive, Plus, Folder, Link, Settings, Check, CheckCircle, ChevronDown, ChevronRight, AlertCircle, Play, RefreshCw, RefreshCcw, Cloud, Terminal, Users, Send, Zap, X, Server, Layers, Globe, Edit2, Trash2, UserPlus, Search, FileCode, ShieldAlert, Save } from 'lucide-react';
import {
    fetchConfig, DomainConfig,
    listDrives, listKeys, KeyInfo, DriveInfo,
    createDrivesUnified, checkDriveMethods, DriveMethod, MethodsResponse, listDrivesUnified,
    RcloneRemote, listLocalRemotes, listServerRemotes, fetchSSHServers, SSHServer,
    testRcloneConnection, createDriveRemote, createUnionRemoteDirect, addDriveManagers, listKnownGroups,
    listUnionRemotes, getUnionDetails, expandUnion, UnionInfo, UnionDetails, renameDrive, deleteDrive, updateLocalRemote, deleteRemoteWithConfirm, renameRemote,
    getDriveDetails, DriveDetails,
    analyzeUnionExpansion, executeUnionExpansion, ExpansionPlan, ExpansionProposal
} from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Dropdown } from '../components/Dropdown';
import { useDataTable } from '../hooks/useDataTable';
import { DataTable } from '../components/ui/DataTable';
import { useIsyncData, useCacheStatus } from '../contexts/IsyncDataContext';
import { CacheStatus } from '../components/CacheStatus';

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
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800/50 transition text-left rounded-t-lg"
            >
                {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                <Icon size={16} className="text-violet-400" />
                <span className="text-sm font-medium text-white flex-1">{title}</span>
                {status && <span className={`text-xs ${colors[statusColor]} `}>{status}</span>}
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
        <div className={`border rounded-lg p-4 ${cfg.color} `}>
            <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{cfg.icon}</span>
                <span className="font-mono text-white text-base font-semibold">{name}</span>
                <span className={`ml-auto text-xs ${cfg.textColor} `}>{cfg.text}</span>
            </div>
            <div className="text-[10px] text-zinc-300 space-y-0.5 font-mono bg-zinc-900/50 rounded p-2 border border-zinc-800/50">
                <div><span className="text-zinc-500">type</span> = <span className="text-cyan-400">drive</span></div>
                <div><span className="text-zinc-500">scope</span> = <span className="text-cyan-400">drive</span></div>
                <div><span className="text-zinc-500">team_drive</span> = <span className={driveId ? 'text-emerald-400' : 'text-zinc-500'}>{driveId || '(pending)'}</span></div>
                {saFile && <div><span className="text-zinc-500">service_account_file</span> = <span className="text-amber-400">{saFile}</span></div>}
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

// Drive Details Panel Component
const DriveDetailsPanel = ({
    drive,
    serviceAccountFile,
    impersonateEmail,
    onCreateRemote,
    onRenameRemote,
    onDeleteRemote,
    onEditRemote,
    onAddMember,
    refreshData,
    domains,
    keys
}: {
    drive: any;
    serviceAccountFile: string;
    impersonateEmail: string;
    onCreateRemote: (name: string, driveId: string, saPath: string) => void;
    onRenameRemote: (oldName: string) => void;
    onDeleteRemote: (name: string) => void;
    onEditRemote: (remote: any) => void;
    onAddMember: (driveId: string, email: string, role: string, customSA?: string, customImp?: string) => Promise<void>;
    refreshData?: () => void;
    domains: DomainConfig[];
    keys: KeyInfo[];
}) => {
    const [details, setDetails] = useState<DriveDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('organizer');

    // Remote creation form state
    const [remoteName, setRemoteName] = useState(drive.name);
    const [saPath, setSaPath] = useState(serviceAccountFile);
    const [impEmail, setImpEmail] = useState(impersonateEmail);

    useEffect(() => {
        setRemoteName(drive.name);
    }, [drive.name]);

    useEffect(() => {
        setSaPath(serviceAccountFile);
    }, [serviceAccountFile]);

    useEffect(() => {
        setImpEmail(impersonateEmail);
    }, [impersonateEmail]);

    // DOMAIN MATCHING LOGIC
    useEffect(() => {
        if (!details?.permissions || domains.length === 0) return;

        // Try to find a domain match from members
        const driveDomains = new Set(details.permissions.map(p => p.email.split('@')[1]).filter(Boolean));
        const matchedDomain = domains.find(d => driveDomains.has(d.domain_name));

        if (matchedDomain) {
            if (matchedDomain.sa_json_path) {
                const matchingKey = keys.find(k =>
                    k.path === matchedDomain.sa_json_path ||
                    (k.path.split('/').pop() === matchedDomain.sa_json_path.split('/').pop())
                );
                if (matchingKey) {
                    setSaPath(matchingKey.path);
                } else if (matchedDomain.sa_json_path.startsWith('/')) {
                    setSaPath(matchedDomain.sa_json_path);
                }
            }
            if (matchedDomain.admin_email) {
                setImpEmail(matchedDomain.admin_email);
            }
        }
    }, [details, domains, keys, drive.name]);

    const fetchDetails = async () => {
        // Use local state if set, else fall back to props
        const activeSA = saPath || serviceAccountFile;
        const activeImp = impEmail || impersonateEmail;

        if (!activeSA || !activeImp) {
            return;
        }

        setDetailsLoading(true);
        setError(null);
        try {
            const res = await getDriveDetails(drive.id, activeSA, activeImp);
            if (res.status === 'ok') {
                setDetails({
                    id: drive.id,
                    name: drive.name,
                    kind: 'drive',
                    createdTime: res.drive?.createdTime,
                    permissions: res.permissions || []
                });
            } else {
                const msg = res.message || 'Failed to load details';
                // Check for unauthorized_client specifically to give better feedback
                if (msg.includes('unauthorized_client')) {
                    setError(`Auth Error: The service account or impersonation email is not authorized for this domain. (Used: ${activeImp})`);
                } else {
                    setError(msg);
                }
                setDetails(null);
            }
        } catch (e: any) {
            setError(e.message || 'Error loading details');
            setDetails(null);
        } finally {
            setDetailsLoading(false);
        }
    };

    useEffect(() => {
        fetchDetails();
    }, [drive.id, serviceAccountFile, impersonateEmail]); // Still depend on props for external changes

    return (
        <>
            {/* LEFT COLUMN: Google Drive Info & Membership */}
            <div className="space-y-6">
                <div className="pt-0">
                    <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <HardDrive size={14} className="text-zinc-500" />
                        Google Drive Information
                    </h4>
                    <div className="bg-zinc-950/40 p-4 rounded border border-zinc-800/50 space-y-2 text-sm">
                        <div className="flex justify-between items-center bg-zinc-900/30 p-2 rounded"><span className="text-xs text-zinc-500">Name</span> <span className="text-white font-medium">{drive.name}</span></div>
                        <div className="flex justify-between items-center bg-zinc-900/30 p-2 rounded"><span className="text-xs text-zinc-500">ID</span> <span className="font-mono text-[10px] text-zinc-400">{drive.id}</span></div>
                        {details?.createdTime && (
                            <div className="flex justify-between items-center bg-zinc-900/30 p-2 rounded"><span className="text-xs text-zinc-500">Created</span> <span className="text-xs text-zinc-300">{new Date(details.createdTime).toLocaleString()}</span></div>
                        )}
                    </div>
                </div>

                {detailsLoading && <div className="text-xs text-zinc-500 animate-pulse flex items-center gap-2"><RefreshCw size={12} className="animate-spin" /> Loading members...</div>}
                {error && (
                    <div className="flex flex-col gap-3 mb-4">
                        <div className="text-xs text-red-500 bg-red-900/10 p-3 rounded border border-red-900/40 space-y-2">
                            <div className="font-bold flex items-center gap-2">
                                <AlertCircle size={14} />
                                Authentication Error
                            </div>
                            <div>{error}</div>
                            <div className="pt-2 mt-2 border-t border-red-900/20 text-[10px] text-red-400/80">
                                Try selecting a different domain if this drive belongs to another organizational unit.
                            </div>
                        </div>

                        <div className="flex gap-2 items-center">
                            <select
                                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:border-violet-500 outline-none flex-1"
                                onChange={(e) => {
                                    const dom = domains.find(d => d.domain_name === e.target.value);
                                    if (dom) {
                                        setImpEmail(dom.admin_email);
                                        // Match key
                                        const matchingKey = keys.find(k =>
                                            k.path === dom.sa_json_path ||
                                            k.path.split('/').pop() === dom.sa_json_path.split('/').pop()
                                        );
                                        if (matchingKey) setSaPath(matchingKey.path);
                                        else if (dom.sa_json_path) setSaPath(dom.sa_json_path);
                                    }
                                }}
                                value={domains.find(d => d.admin_email === impEmail)?.domain_name || ""}
                            >
                                <option value="">Select Domain...</option>
                                {domains.map(d => (
                                    <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => fetchDetails()}
                                className="flex items-center gap-2 text-xs font-bold text-white transition-all bg-violet-600 hover:bg-violet-500 px-4 py-1.5 rounded shadow-lg shadow-violet-900/20"
                            >
                                <RefreshCw size={14} className={detailsLoading ? 'animate-spin' : ''} />
                                {detailsLoading ? 'Retrying...' : 'Retry'}
                            </button>
                        </div>
                    </div>
                )}
                {(!serviceAccountFile || !impersonateEmail) && (
                    <div className="text-xs text-amber-500 bg-amber-900/10 p-2 rounded border border-amber-900/30 mb-4">
                        Service Account or Admin Email missing from global selection. Cannot load members list.
                    </div>
                )}

                {details && (
                    <div className="pt-2 border-t border-zinc-800/50">
                        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Users size={14} className="text-zinc-500" />
                            Current Members ({details.permissions?.length || 0})
                        </h4>
                        <div className="bg-zinc-950/40 rounded border border-zinc-800/50 max-h-60 overflow-y-auto custom-scrollbar">
                            {details.permissions && details.permissions.length > 0 ? details.permissions.map((p, i) => (
                                <div key={i} className="flex items-center justify-between p-2 border-b border-zinc-800/30 last:border-0 hover:bg-zinc-900/50">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-zinc-300">{p.email}</span>
                                        <span className="text-[10px] text-zinc-500">{p.name} {p.type === 'group' && '(Group)'}</span>
                                    </div>
                                    <span className="text-[10px] bg-zinc-900/80 px-1.5 py-0.5 rounded text-zinc-400 border border-zinc-800">
                                        {p.role === 'organizer' ? 'Manager' : p.role === 'fileOrganizer' ? 'Content Manager' : p.role === 'writer' ? 'Contributor' : p.role}
                                    </span>
                                </div>
                            )) : (
                                <div className="p-4 text-center text-xs text-zinc-600 italic">No members found or permission denied.</div>
                            )}
                        </div>
                    </div>
                )}

                <div className="pt-2 border-t border-zinc-800/50">
                    <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <UserPlus size={14} className="text-zinc-500" />
                        Membership Management
                    </h4>
                    <div className="bg-zinc-950 p-4 rounded border border-zinc-800 shadow-inner shadow-black/20">
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Add Member by Email</label>
                                <div className="flex gap-2">
                                    <input
                                        className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-violet-500"
                                        placeholder="user@example.com"
                                        list="known-emails-list"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                    />
                                    <select
                                        value={role}
                                        onChange={e => setRole(e.target.value)}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:border-violet-500 outline-none"
                                    >
                                        <option value="organizer">Manager</option>
                                        <option value="fileOrganizer">Content Manager</option>
                                        <option value="writer">Contributor</option>
                                        <option value="commenter">Commenter</option>
                                        <option value="reader">Viewer</option>
                                    </select>
                                    <button
                                        onClick={async () => {
                                            if (!email) return;
                                            await onAddMember(drive.id, email, role, saPath, impEmail);
                                            setEmail('');
                                            await fetchDetails();
                                            if (refreshData) refreshData();
                                        }}
                                        disabled={!email}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold disabled:opacity-50 disabled:bg-zinc-800"
                                    >
                                        <Plus size={12} className="inline mr-1" /> Add
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* RIGHT COLUMN: Rclone Remote Configuration */}
            <div className="space-y-6">
                <div>
                    <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3 flex justify-between items-center">
                        <span className="flex items-center gap-2">
                            <Layers size={14} className="text-zinc-500" />
                            Rclone Remote Configuration
                        </span>
                    </h4>

                    <div className="space-y-4">
                        {drive.remotes.map((r: any) => (
                            <div key={r.name} className="space-y-1">
                                <div className="flex items-center justify-between text-sm bg-zinc-950 px-3 py-1.5 rounded-t border border-zinc-800">
                                    <span className="font-mono text-zinc-300 font-bold">{r.name}</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => onEditRemote(r)} className="text-zinc-500 hover:text-blue-400 p-1" title="Edit Config"><Settings size={10} /></button>
                                        <button onClick={() => onRenameRemote(r.name)} className="text-zinc-500 hover:text-blue-400 p-1" title="Rename"><Edit2 size={10} /></button>
                                        <button onClick={() => onDeleteRemote(r.name)} className="text-zinc-500 hover:text-red-400 p-1" title="Delete"><Trash2 size={10} /></button>
                                    </div>
                                </div>
                                <div className="bg-zinc-900/40 p-3 rounded-b border-x border-b border-zinc-800/80 font-mono text-[10px] text-zinc-400 space-y-1 whitespace-pre-wrap overflow-x-auto custom-scrollbar">
                                    {Object.entries(r.config || {}).map(([key, val]) => (
                                        <div key={key} className="flex gap-2">
                                            <span className="text-zinc-500 w-32 shrink-0">{key}</span>
                                            <span className="text-zinc-600">=</span>
                                            <span className={key === 'service_account_file' ? 'text-amber-500/80 font-medium' : 'text-zinc-300'}>{String(val)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {drive.remotes.length === 0 && (
                            <div className="bg-red-900/10 border border-red-900/30 rounded-lg p-5">
                                <div className="flex items-center gap-3 mb-4">
                                    <ShieldAlert size={20} className="text-red-500" />
                                    <div>
                                        <h5 className="text-sm font-bold text-red-400">Missing Rclone Remote</h5>
                                        <p className="text-[11px] text-zinc-500 leading-relaxed">No rclone remote is associated with this drive in the central config. You should create one to enable syncing and management.</p>
                                    </div>
                                </div>

                                <div className="space-y-3 bg-zinc-950/50 p-4 rounded border border-zinc-800/50">
                                    <div className="grid grid-cols-1 gap-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Remote Name</label>
                                            <input
                                                value={remoteName}
                                                onChange={e => setRemoteName(e.target.value)}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-white focus:border-violet-500 transition-colors"
                                                placeholder="my-drive-remote"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Type</label>
                                                <input value="drive" disabled className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs font-mono text-zinc-500" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Scope</label>
                                                <input value="drive" disabled className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs font-mono text-zinc-500" />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Team Drive ID</label>
                                            <input value={drive.id} disabled className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs font-mono text-zinc-500" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Service Account File</label>
                                            <input
                                                value={saPath}
                                                onChange={e => setSaPath(e.target.value)}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-amber-400 focus:border-violet-500 transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => onCreateRemote(remoteName, drive.id, saPath)}
                                        className="w-full mt-2 bg-violet-600 hover:bg-violet-500 text-white py-2 rounded text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-violet-900/20 transition-all active:scale-[0.98]"
                                    >
                                        <Plus size={14} />
                                        Create Rclone Remote
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

const DriveManager = () => {
    // Config state
    const [domains, setDomains] = useState<DomainConfig[]>([]);
    const [keys, setKeys] = useState<KeyInfo[]>([]);
    const [methodsAvailable, setMethodsAvailable] = useState<MethodsResponse | null>(null);
    const [sshServers, setSshServers] = useState<SSHServer[]>([]);
    const [knownGroups, setKnownGroups] = useState<string[]>([]);

    // Persistence - Load from Session Storage
    const [method, setMethod] = useState<DriveMethod>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).method : 'google_api';
    });
    const [selectedDomain, setSelectedDomain] = useState<DomainConfig | null>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).selectedDomain : null;
    });
    const [serviceAccountFile, setServiceAccountFile] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).serviceAccountFile : '';
    });
    const [impersonateEmail, setImpersonateEmail] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).impersonateEmail : '';
    });
    const [gdriveRemote, setGdriveRemote] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).gdriveRemote : '';
    });

    const { setDriveManager, setCached, setLoading: setCacheLoading } = useIsyncData();
    const domainKey = selectedDomain?.domain_name || 'unknown';
    const driveCache = useCacheStatus('shared_drives', domainKey);
    const remoteCache = useCacheStatus('rclone_remotes', 'local');

    const localRemotes = remoteCache.data as RcloneRemote[];
    const existingDrives = driveCache.data as DriveInfo[];

    // Builder state - Drive Names
    const [baseName, setBaseName] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).baseName : '';
    });
    const [driveCount, setDriveCount] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).driveCount : 1;
    });
    const [suffixSeparator, setSuffixSeparator] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).suffixSeparator : '-';
    });
    const [suffixPadding, setSuffixPadding] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).suffixPadding : 2;
    });
    const [suffixStart, setSuffixStart] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).suffixStart : 1;
    });

    // Builder state - Groups
    const [selectedGroups, setSelectedGroups] = useState<string[]>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).selectedGroups : [];
    });
    const [newGroupEmail, setNewGroupEmail] = useState('');
    const [newGroupRole, setNewGroupRole] = useState('organizer');

    // Builder state - Options
    const [createUnion, setCreateUnion] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).createUnion : false;
    });
    const [unionName, setUnionName] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).unionName : '';
    });
    const [actionPolicy, setActionPolicy] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).actionPolicy : 'rand';
    });
    const [createPolicy, setCreatePolicy] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).createPolicy : 'eprand';
    });
    const [delaySeconds, setDelaySeconds] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE);
        return saved ? JSON.parse(saved).delaySeconds : 5;
    });

    // Execution state
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [createdDrives, setCreatedDrives] = useState<DriveInfo[]>([]);
    const [createdRemotes, setCreatedRemotes] = useState<string[]>([]);
    const [connectionTests, setConnectionTests] = useState<Record<string, 'pending' | 'ok' | 'error'>>({});
    const [alwaysIncludedManagers, setAlwaysIncludedManagers] = useState<{ email: string; role: string }[]>([]);

    // Manual Tool state
    const [manualDriveId, setManualDriveId] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_MANUAL_STATE);
        return saved ? JSON.parse(saved).manualDriveId : '';
    });
    const [manualEmail, setManualEmail] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_MANUAL_STATE);
        return saved ? JSON.parse(saved).manualEmail : '';
    });
    const [manualRole, setManualRole] = useState(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_MANUAL_STATE);
        return saved ? JSON.parse(saved).manualRole : 'organizer';
    });
    const [manualLoading, setManualLoading] = useState(false);
    const [manualLog, setManualLog] = useState<string | null>(null);
    const [selectedServers, setSelectedServers] = useState<Set<string>>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_MANUAL_STATE);
        return saved ? new Set(JSON.parse(saved).selectedServers) : new Set();
    });
    const [pushResults, setPushResults] = useState<{ server: string; status: string }[]>([]);

    // Existing Drives State
    const [excludedDrives, setExcludedDrives] = useState<string[]>([]);

    const [existingLoading, setExistingLoading] = useState(false);
    const [editingDriveId, setEditingDriveId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [managerLimit, setManagerLimit] = useState(() => parseInt(sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_LIMIT) || '50'));
    const [activeTab, setActiveTab] = useState<'builder' | 'manager' | 'manual' | 'expand'>(() =>
        (sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_ACTIVE_TAB) as any) || 'manager'
    );
    const [hiddenFilter, setHiddenFilter] = useState<'all' | 'hidden' | 'visible' | 'no_remote'>(() =>
        (sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_HIDDEN_FILTER) as any) || 'all'
    );

    // Remote Editing State
    const [editingRemote, setEditingRemote] = useState<string | null>(null);
    const [editConfig, setEditConfig] = useState('');
    const [unionNameInput, setUnionNameInput] = useState(() => sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_UNION_NAME_INPUT) || '');
    const [managerMode, setManagerMode] = useState<'view' | 'create_union'>(() => (sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_MANAGER_MODE) as any) || 'view');

    // Expand Union State
    const [expandServerId, setExpandServerId] = useState('local');
    const [expandUnionRemote, setExpandUnionRemote] = useState('');
    const [expandAnalysis, setExpandAnalysis] = useState<ExpansionPlan | null>(null);
    const [expandLoading, setExpandLoading] = useState(false);
    const [expandLogs, setExpandLogs] = useState<string[]>([]);
    const [expandCount, setExpandCount] = useState(1);
    const [expandProposals, setExpandProposals] = useState<ExpansionProposal[]>([]);
    const [expandRemotesList, setExpandRemotesList] = useState<string[]>([]); // To populate dropdown
    const [expandFetchingRemotes, setExpandFetchingRemotes] = useState(false);

    // Expand Union Handlers
    useEffect(() => {
        if (activeTab === 'expand') {
            const fetchRemotes = async () => {
                setExpandFetchingRemotes(true);
                try {
                    let res;
                    if (expandServerId === 'local') {
                        res = await listLocalRemotes();
                    } else {
                        res = await listServerRemotes(expandServerId);
                    }
                    if (res && res.remotes) {
                        const unions = res.remotes.filter((r: any) => r.type === 'union').map((r: any) => r.name);
                        setExpandRemotesList(unions);
                        if (!unions.includes(expandUnionRemote)) setExpandUnionRemote('');
                    }
                } catch (e) {
                    console.error("Failed to fetch remotes", e);
                    setExpandRemotesList([]);
                } finally {
                    setExpandFetchingRemotes(false);
                }
            };
            fetchRemotes();
        }
    }, [activeTab, expandServerId]);

    const handleAnalyzeUnion = async () => {
        if (!expandUnionRemote) return;
        setExpandLoading(true);
        setExpandAnalysis(null);
        setExpandProposals([]);
        setExpandLogs([]);
        try {
            const plan = await analyzeUnionExpansion(expandServerId, expandUnionRemote);
            setExpandAnalysis(plan);
            setExpandProposals(plan.proposals || []);
            setExpandCount(1);
            setExpandLogs(p => [...p, `✓ Analyzed ${expandUnionRemote}: Detected pattern "${plan.analysis.detected_pattern || 'none'}"`]);
        } catch (e: any) {
            setExpandLogs(p => [...p, `✗ Analysis failed: ${e.message}`]);
        } finally {
            setExpandLoading(false);
        }
    };

    const handleUpdateExpansionCount = (count: number) => {
        const newCount = Math.max(1, count);
        setExpandCount(newCount);
        if (!expandAnalysis) return;

        const analysis = expandAnalysis.analysis;
        // Re-generate proposals client-side to avoid round-trip
        // Assuming members are sorted or we rely on backend's "next_index"

        // Find template member (last one)
        const sortedMembers = [...analysis.members].sort((a, b) => a.name.localeCompare(b.name));
        const lastMember = sortedMembers[sortedMembers.length - 1];
        if (!lastMember) return;

        const baseName = lastMember.name;
        const startIdx = analysis.next_index || 1;

        const newProps: ExpansionProposal[] = [];

        for (let i = 0; i < newCount; i++) {
            let idx = startIdx + i;
            let newName = `${baseName}-${idx}`;

            // Simple pattern detection from baseName
            // If baseName ends in digits, increment them preserving padding
            const match = baseName.match(/^(.*?)(\d+)$/);
            if (match) {
                const base = match[1];
                const numStr = match[2];
                const width = numStr.length;
                newName = `${base}${String(idx).padStart(width, '0')}`;
            } else if (analysis.detected_pattern) {
                // Try to follow analysis pattern if possible?
                // For now regex match on baseName is safest default
            } else {
                newName = `${baseName}-${idx}`;
            }

            newProps.push({
                new_remote_name: newName,
                new_drive_name: newName,
                based_on_remote: baseName,
                service_account_file: lastMember.service_account_file,
                team_drive_id: lastMember.team_drive
            });
        }
        setExpandProposals(newProps);
    };

    const handleExecuteExpansion = async () => {
        if (!expandProposals.length) return;
        setExpandLoading(true);
        setExpandLogs(p => [...p, `Starting expansion for ${expandProposals.length} new items...`]);

        try {
            const res = await executeUnionExpansion(expandServerId, expandUnionRemote, expandProposals);
            if (res.status === 'ok') {
                setExpandLogs(p => [...p, ...res.logs, '✓ Expansion completed successfully!']);
                alert('Expansion Completed!');
                // Refresh?
                handleAnalyzeUnion(); // Refresh analysis
            } else {
                setExpandLogs(p => [...p, ...res.logs, `✗ Expansion failed`]);
            }
        } catch (e: any) {
            setExpandLogs(p => [...p, `✗ Expansion error: ${e.message}`]);
        } finally {
            setExpandLoading(false);
        }
    };


    // Persistence Effects
    useEffect(() => {
        const builderState = {
            method, selectedDomain, serviceAccountFile, impersonateEmail, gdriveRemote,
            baseName, driveCount, suffixSeparator, suffixPadding, suffixStart,
            selectedGroups, createUnion, unionName, actionPolicy, createPolicy, delaySeconds
        };
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_BUILDER_STATE, JSON.stringify(builderState));
    }, [method, selectedDomain, serviceAccountFile, impersonateEmail, gdriveRemote,
        baseName, driveCount, suffixSeparator, suffixPadding, suffixStart,
        selectedGroups, createUnion, unionName, actionPolicy, createPolicy, delaySeconds]);

    useEffect(() => {
        const manualState = {
            manualDriveId, manualEmail, manualRole,
            selectedServers: Array.from(selectedServers)
        };
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_MANUAL_STATE, JSON.stringify(manualState));
    }, [manualDriveId, manualEmail, manualRole, selectedServers]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_ACTIVE_TAB, activeTab);
    }, [activeTab]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_LIMIT, managerLimit.toString());
    }, [managerLimit]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_HIDDEN_FILTER, hiddenFilter);
    }, [hiddenFilter]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_UNION_NAME_INPUT, unionNameInput);
    }, [unionNameInput]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_MANAGER_MODE, managerMode);
    }, [managerMode]);

    const drivesWithRemotes = useMemo(() => {
        if (!existingDrives) return [];
        return existingDrives.map(drive => {
            const associated = localRemotes.filter(r => r.config && r.config.team_drive === drive.id);
            return { ...drive, remotes: associated };
        });
    }, [existingDrives, localRemotes]);

    const {
        data: filteredManagerItems,
        searchTerm: managerQuery,
        setSearchTerm: setManagerQuery,
        selectedItems: managerSelection,
        setSelectedItems: setManagerSelection,
        toggleItem: toggleManagerSelection,
        selectAll: handleSelectAllManager,
        invertSelection: handleInvertManager,
        handleSort,
        SortIcon,
        columnFilters,
        toggleColumnFilter,
        clearColumnFilter,
        getUniqueValues
    } = useDataTable({
        data: drivesWithRemotes,
        columns: [
            { key: 'name', header: 'Name', sortable: true },
            { key: 'id', header: 'ID', sortable: true }
        ],
        persistentKey: SESSION_KEYS.DRIVE_MANAGER_QUERY,
        filterFn: (d, search) => (
            (d.name.toLowerCase().includes(search.toLowerCase()) ||
                d.id.toLowerCase().includes(search.toLowerCase()) ||
                d.remotes.some(r => r.name.toLowerCase().includes(search.toLowerCase()))) &&
            (hiddenFilter === 'all' ||
                (hiddenFilter === 'hidden' ? d.hidden :
                    hiddenFilter === 'no_remote' ? (d.remotes.length === 0) :
                        !d.hidden))
        )
    });


    const handleCreateUnion = async () => {
        if (!unionNameInput) { alert('Name required'); return; }
        const upstreams: string[] = [];
        drivesWithRemotes.forEach(d => {
            if (managerSelection.has(d.id)) {
                d.remotes.forEach(r => upstreams.push(r.name));
            }
        });

        if (upstreams.length < 2) { alert('Selected drives must have associated rclone remotes to create a union.'); return; }

        try {
            setLogs(prev => [...prev, `Creating Union ${unionNameInput}...`]);
            await createUnionRemoteDirect({
                name: unionNameInput,
                upstreams: upstreams
            });
            setLogs(prev => [...prev, `✓ Union Created: ${unionNameInput} `]);
            alert(`Union "${unionNameInput}" Created!`);
            setManagerMode('view');
            setManagerSelection(new Set());
            setUnionNameInput('');
            refreshManagerData();
        } catch (e: any) {
            alert('Failed: ' + e.message);
            setLogs(prev => [...prev, `✗ Failed Union: ${e.message} `]);
        }
    };

    const refreshManagerData = async (force: boolean = false) => {
        if (!selectedDomain) return;

        // If not forced and we already have data in cache, skip
        if (!force && driveCache.hasData) return;

        setCacheLoading('shared_drives', domainKey, true);
        setCacheLoading('rclone_remotes', 'local', true);
        setExistingLoading(true);

        try {
            // Refresh Remotes
            const remotesRes = await listLocalRemotes().catch(e => ({ remotes: [] }));
            setCached('rclone_remotes', 'local', remotesRes.remotes || [], 'rclone_api');

            // Refresh Drives
            const sa = serviceAccountFile || keys[0]?.path;
            const imp = impersonateEmail || selectedDomain?.admin_email;

            const res = await listDrivesUnified({
                method: 'google_api',
                service_account_file: sa,
                impersonate_email: imp,
                limit: managerLimit > 0 ? managerLimit : undefined,
                prefix: managerQuery || undefined
            });

            setCached('shared_drives', domainKey, res.drives || [], 'google_api');

            // Legacy support sync (optional but good for stability)
            setDriveManager(prev => ({
                ...prev,
                localRemotes: remotesRes.remotes || [],
                drives: res.drives || [],
                lastUpdated: Date.now()
            }));

        } catch (e: any) {
            console.error(e);
            setManualLog(`Refresh failed: ${e.message} `);
        } finally {
            setCacheLoading('shared_drives', domainKey, false);
            setCacheLoading('rclone_remotes', 'local', false);
            setExistingLoading(false);
        }
    };

    const handleRenameDrive = async () => {
        if (managerSelection.size !== 1) { alert("Select exactly one drive to rename"); return; }
        const driveId = Array.from(managerSelection)[0];
        const drive = existingDrives?.find(d => d.id === driveId);
        if (!drive) return;

        const newName = window.prompt("Enter new name:", drive.name);
        if (!newName || newName === drive.name) return;

        const sa = serviceAccountFile || keys[0]?.path;
        const imp = impersonateEmail || selectedDomain?.admin_email;
        if (!sa || !imp) { alert("Service account/Email config missing"); return; }

        try {
            await renameDrive({
                drive_id: drive.id,
                new_name: newName,
                method: 'google_api',
                service_account_file: sa,
                impersonate_email: imp
            });
            refreshManagerData();
        } catch (e: any) { alert("Rename failed: " + e.message); }
    };

    const handleDeleteDrive = async () => {
        if (managerSelection.size === 0) return;
        if (!confirm(`Delete ${managerSelection.size} selected drive(s) ? `)) return;

        const sa = serviceAccountFile || keys[0]?.path;
        const imp = impersonateEmail || selectedDomain?.admin_email;
        if (!sa || !imp) { alert("Service account/Email config missing"); return; }

        try {
            for (const id of Array.from(managerSelection)) {
                await deleteDrive({
                    drive_id: String(id),
                    method: 'google_api',
                    service_account_file: sa,
                    impersonate_email: imp
                });
            }
            setManagerSelection(new Set());
            refreshManagerData();
        } catch (e: any) { alert("Delete failed: " + e.message); }
    };

    const handleExcludeDrives = async () => {
        if (managerSelection.size === 0) return;
        if (!confirm(`Exclude ${managerSelection.size} selected drive(s)?`)) return;

        const next = [...excludedDrives];
        let addedCount = 0;

        managerSelection.forEach(id => {
            const drive = existingDrives.find(d => d.id === id);
            // Prefer name if available, otherwise ID
            const val = drive ? (drive.name || drive.id) : String(id);
            if (!next.includes(val)) {
                next.push(val);
                addedCount++;
            }
        });

        if (addedCount === 0) return;

        try {
            setExcludedDrives(next);
            const api = await import('../api');
            await api.updateConfig({ excluded_drives: next } as any);
            setManagerSelection(new Set());
            refreshManagerData();
            alert(`Excluded ${addedCount} drives.`);
        } catch (e: any) { alert("Exclude failed: " + e.message); }
    };

    const handleRenameRemote = async (oldName: string) => {
        const newName = window.prompt("Enter new remote name:", oldName);
        if (!newName || newName === oldName) return;
        try {
            await renameRemote(oldName, newName);
            refreshManagerData();
        } catch (e: any) { alert("Rename remote failed: " + e.message); }
    };

    const handleDeleteRemote = async (name: string) => {
        if (!confirm(`Delete remote ${name}?`)) return;
        try {
            await deleteRemoteWithConfirm(name, true);
            refreshManagerData();
        } catch (e: any) { alert("Delete remote failed: " + e.message); }
    };

    const handleEditRemote = (remote: any) => {
        setEditingRemote(remote.name);
        setEditConfig(JSON.stringify(remote.config || {}, null, 2));
    };

    const handleSaveRemoteEdit = async () => {
        if (!editingRemote) return;
        try {
            const config = JSON.parse(editConfig);
            await updateLocalRemote(editingRemote, config);
            setEditingRemote(null);
            refreshManagerData();
            alert("Remote updated successfully");
        } catch (e: any) {
            alert("Failed to update remote: " + e.message);
        }
    };

    const handleAddMember = async (driveId: string, email: string, role: string, customSA?: string, customImp?: string) => {
        const sa = customSA || serviceAccountFile || keys[0]?.path;
        const imp = customImp || impersonateEmail || selectedDomain?.admin_email;

        if (!sa || !imp) { alert('Service account/Email config missing'); return; }

        const roleNames: Record<string, string> = {
            organizer: 'Manager',
            fileOrganizer: 'Content Manager',
            writer: 'Contributor',
            commenter: 'Commenter',
            reader: 'Viewer'
        };

        try {
            const res = await addDriveManagers({
                drive_id: driveId,
                service_account_file: sa,
                impersonate_email: imp,
                group_emails: [email],
                role: role
            });
            if (res.status === 'ok') {
                const roleName = roleNames[role] || role;
                setLogs(prev => [...prev, `✓ Added ${email} as ${roleName} to drive ${driveId} `]);
                // We do NOT refreshManagerData() here because that refreshes the LIST, but we want to refresh the DETAILS
                // The Panel's onAddMember wrapper will call refreshData passed to it, but that function REFRESHES THE LIST of drives.
                // Actually refreshing the list is fine, but it might not refresh the permissions inside the panel unless we trigger it.
                // The panel's local refreshData callback (if we passed one) is good. 
                // But wait, the Panel has its own state "details". It won't see this update unless we force re-fetch.
            } else {
                setLogs(prev => [...prev, `✗ Failed to add member: ${res.failed?.[0]?.error} `]);
                alert(`Failed: ${res.failed?.[0]?.error} `);
            }
        } catch (e: any) { alert("Add member failed: " + e.message); }
    };

    // Track previous domain to detect domain switches
    const prevDomainRef = useRef(domainKey);

    // Auto-refresh when entering manager tab or switching domains
    useEffect(() => {
        if (activeTab === 'manager' && selectedDomain) {
            // Force refresh if domain changed, otherwise just fill empty cache
            const domainChanged = prevDomainRef.current !== domainKey;
            prevDomainRef.current = domainKey;
            refreshManagerData(domainChanged);
        }
    }, [activeTab, selectedDomain, serviceAccountFile, keys, domainKey]);

    // Auto-select domain if not selected
    useEffect(() => {
        if (!selectedDomain && domains.length > 0) {
            setSelectedDomain(domains[0]);
        }
    }, [domains, selectedDomain]);





    // Existing remotes tab state
    const [queryPrefix, setQueryPrefix] = useState('');
    const [queriedDrives, setQueriedDrives] = useState<DriveInfo[]>([]);
    const [queryLoading, setQueryLoading] = useState(false);

    // Load initial data
    // Load initial data
    useEffect(() => {
        const loadData = async () => {
            // Priority 1: Configuration (Domains)
            try {
                const config = await fetchConfig();
                setDomains(config.domains || []);
                setAlwaysIncludedManagers(config.always_included_managers || []);
                setExcludedDrives(config.excluded_drives || []);

                // Domain Persistence
                const savedDomainName = sessionStorage.getItem(SESSION_KEYS.DRIVE_MANAGER_DOMAIN);
                if (config.domains && config.domains.length > 0) {
                    const matched = savedDomainName ? config.domains.find(d => d.domain_name === savedDomainName) : null;
                    setSelectedDomain(matched || config.domains[0]);
                }
            } catch (e) {
                console.error('Failed to load config', e);
            }

            // Priority 2: Other data (independent failures allowed)
            try {
                const keysData = await listKeys().catch(e => ({ keys: [] }));
                setKeys(keysData.keys || []);
                // Only set default if path is empty
                setServiceAccountFile(prev => {
                    if (prev) return prev;
                    return (keysData.keys && keysData.keys.length > 0) ? keysData.keys[0].path : '';
                });
            } catch (e) { console.error('Failed keys', e); }

            try {
                const methods = await checkDriveMethods().catch(e => null);
                setMethodsAvailable(methods);
            } catch (e) { console.error('Failed methods', e); }

            try {
                const servers = await fetchSSHServers().catch(e => []);
                setSshServers(servers || []);
            } catch (e) { console.error('Failed servers', e); }

            try {
                const groupsRes = await listKnownGroups().catch(e => ({ groups: [] }));
                setKnownGroups(groupsRes.groups || []);
            } catch (e) { console.error('Failed groups', e); }

            try {
                const remotesRes = await listLocalRemotes().catch(e => ({ remotes: [] }));
                setDriveManager(prev => ({ ...prev, localRemotes: remotesRes.remotes || [] }));
            } catch (e) { console.error('Failed remotes', e); }

        };
        loadData();
    }, []);

    // Persistence: Domain Selection
    useEffect(() => {
        if (selectedDomain) {
            sessionStorage.setItem(SESSION_KEYS.DRIVE_MANAGER_DOMAIN, selectedDomain.domain_name);
        }
    }, [selectedDomain]);

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
                impersonate_email: method === 'google_api' ? impersonateEmail : undefined,
                default_managers: [
                    ...selectedGroups.map(email => ({ email, role: 'organizer' })),
                    ...alwaysIncludedManagers
                ]
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
        } catch (e: any) {
            setLogs(prev => [...prev, `Error: ${e.message} `]);
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
                    drive_id: drive.id,
                    service_account_file: serviceAccountFile
                });
                setCreatedRemotes(prev => [...prev, drive.name]);
                setLogs(prev => [...prev, `✓ Created remote: ${drive.name} `]);

                // Test connection
                setConnectionTests(prev => ({ ...prev, [drive.name]: 'pending' }));
                const testResult = await testRcloneConnection(drive.name);
                setConnectionTests(prev => ({
                    ...prev,
                    [drive.name]: testResult.status === 'ok' ? 'ok' : 'error'
                }));
                setLogs(prev => [...prev, `  ${testResult.status === 'ok' ? '✓' : '✗'} Test: ${testResult.message} `]);
            } catch (e: any) {
                setLogs(prev => [...prev, `✗ Failed: ${drive.name} - ${e.message} `]);
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
                    create_policy: createPolicy
                });
                setLogs(prev => [...prev, `✓ Created union: ${unionName || baseName} `]);
            } catch (e: any) {
                setLogs(prev => [...prev, `✗ Union failed: ${e.message} `]);
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
                setLogs(prev => [...prev, `✓ Pushed to ${server?.name} `]);
            } catch (e: any) {
                results.push({ server: server?.name || serverId, status: 'error' });
                setLogs(prev => [...prev, `✗ Push failed: ${server?.name} `]);
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
        <div className="page-container space-y-4">
            <PageHeader
                icon={HardDrive}
                title="Drive Manager"
                subtitle="Create Shared Drives and rclone remotes"
                gradient="from-violet-600 to-purple-600"
            />
            <datalist id="known-emails-list">
                {knownGroups.map(email => (
                    <option key={email} value={email} />
                ))}
            </datalist>

            {/* Tab Navigation */}
            <div className="flex border-b border-zinc-800 mb-6">
                <button
                    onClick={() => setActiveTab('manager')}
                    className={`px-6 py-3 text-base font-bold border-b-2 transition-colors ${activeTab === 'manager' ? 'border-violet-500 text-violet-400 bg-zinc-900/50' : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30'}`}
                >
                    <div className="flex items-center gap-2">
                        <Layers size={18} />
                        Drives & Remotes
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('expand')}
                    className={`px-6 py-3 text-base font-bold border-b-2 transition-colors ${activeTab === 'expand' ? 'border-violet-500 text-violet-400 bg-zinc-900/50' : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30'}`}
                >
                    <div className="flex items-center gap-2">
                        <Plus size={18} />
                        Expand Union
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('builder')}
                    className={`px-6 py-3 text-base font-bold border-b-2 transition-colors ${activeTab === 'builder' ? 'border-violet-500 text-violet-400 bg-zinc-900/50' : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30'}`}
                >
                    <div className="flex items-center gap-2">
                        <Plus size={18} />
                        Build New
                    </div>
                </button>
            </div>

            {/* BUILDER TAB content always mounted but hidden if not active */}
            <div className={activeTab === 'builder' ? 'space-y-4' : 'hidden'}>
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
                                defaultOpen={true}
                                status={configValid ? '✓ Ready' : '⚠ Required'}
                                statusColor={configValid ? 'emerald' : 'amber'}
                            >
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Domain</label>
                                    <Dropdown
                                        fullWidth
                                        trigger={
                                            <div className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:border-zinc-700 transition">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <Globe className="text-indigo-400 shrink-0" size={18} />
                                                    <span className="text-sm truncate text-zinc-300">
                                                        {selectedDomain?.domain_name || 'Select Domain...'}
                                                    </span>
                                                </div>
                                                <ChevronDown size={14} className="text-zinc-500" />
                                            </div>
                                        }
                                        menuClassName="p-2 max-h-60 overflow-y-auto"
                                    >
                                        {domains.length === 0 ? (
                                            <div className="p-2 text-sm text-zinc-500 italic">No domains configured</div>
                                        ) : (
                                            domains.map(d => (
                                                <div
                                                    key={d.domain_name}
                                                    className={`flex items-center gap-2 p-2 hover: bg-zinc - 800 rounded cursor-pointer text-sm mb - 0.5 ${selectedDomain?.domain_name === d.domain_name ? 'text-white bg-zinc-800' : 'text-zinc-400'} `}
                                                    onClick={() => setSelectedDomain(d)}
                                                >
                                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedDomain?.domain_name === d.domain_name ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                                                        {selectedDomain?.domain_name === d.domain_name && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                    </div>
                                                    {d.domain_name}
                                                </div>
                                            ))
                                        )}
                                    </Dropdown>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setMethod('google_api')}
                                        className={`p-2 rounded border text-xs ${method === 'google_api' ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-700 text-zinc-400'} `}
                                    >
                                        <Cloud size={14} className="mx-auto mb-1" />
                                        Google API
                                    </button>
                                    <button
                                        onClick={() => setMethod('fclone')}
                                        className={`p-2 rounded border text-xs ${method === 'fclone' ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-700 text-zinc-400'} `}
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
                                                list="known-emails-list"
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
                                defaultOpen={true}
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

                            <Panel title="Members & Managers" icon={Users} defaultOpen={true} status={alwaysIncludedManagers.length > 0 ? `${alwaysIncludedManagers.length} auto - included` : "Optional"}>
                                {/* Quick Select Known Groups */}
                                {knownGroups.length > 0 && (
                                    <div className="mb-4">
                                        <h4 className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Manual Select (Manager role)</h4>
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
                                    </div>
                                )}

                                {/* Manual Email Add */}
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            list="known-emails-list"
                                            value={newGroupEmail}
                                            onChange={e => setNewGroupEmail(e.target.value)}
                                            placeholder="user@domain.com or group@..."
                                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs"
                                        />
                                        <select
                                            value={newGroupRole}
                                            onChange={e => setNewGroupRole(e.target.value)}
                                            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs outline-none"
                                        >
                                            <option value="organizer">Manager</option>
                                            <option value="fileOrganizer">Content Manager</option>
                                            <option value="writer">Contributor</option>
                                            <option value="commenter">Commenter</option>
                                            <option value="reader">Viewer</option>
                                        </select>
                                        <button
                                            onClick={() => {
                                                if (newGroupEmail && !selectedGroups.includes(newGroupEmail)) {
                                                    setSelectedGroups([...selectedGroups, newGroupEmail]);
                                                    setNewGroupEmail('');
                                                }
                                            }}
                                            disabled={!newGroupEmail}
                                            className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded text-xs disabled:opacity-50"
                                        >
                                            Add
                                        </button>
                                    </div>

                                    {/* Always Included Members Section */}
                                    <div className="bg-zinc-950/30 p-3 rounded-lg border border-zinc-800/50 mt-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-[10px] font-bold text-zinc-500 uppercase">Always Included Members</h4>
                                            <span className="text-[10px] text-zinc-600">Persistent across drives</span>
                                        </div>

                                        <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
                                            {alwaysIncludedManagers.map((mgr, idx) => (
                                                <div key={idx} className="flex items-center justify-between bg-zinc-900/50 px-2 py-1.5 rounded border border-zinc-800 text-xs hover:border-zinc-700 transition-colors">
                                                    <div className="flex flex-col">
                                                        <span className="text-zinc-300 font-medium">{mgr.email}</span>
                                                        <span className="text-[10px] text-zinc-500 uppercase">{mgr.role === 'organizer' ? 'Manager' : mgr.role}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const next = alwaysIncludedManagers.filter((_, i) => i !== idx);
                                                            setAlwaysIncludedManagers(next);
                                                            import('../api').then(api => api.updateConfig({ always_included_managers: next } as any));
                                                        }}
                                                        className="text-zinc-500 hover:text-red-400 p-1 transition-colors"
                                                        title="Remove from Always Included"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                            {alwaysIncludedManagers.length === 0 && (
                                                <div className="text-[10px] text-zinc-600 italic py-2 text-center">No persistent members configured</div>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                list="known-emails-list"
                                                id="default-mgr-email-consolidated"
                                                placeholder="email@domain.com"
                                                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px]"
                                            />
                                            <select
                                                id="default-mgr-role-consolidated"
                                                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] outline-none"
                                            >
                                                <option value="organizer">Manager</option>
                                                <option value="fileOrganizer">Content Manager</option>
                                                <option value="writer">Contributor</option>
                                                <option value="commenter">Commenter</option>
                                                <option value="reader">Viewer</option>
                                            </select>
                                            <button
                                                onClick={() => {
                                                    const emailInput = document.getElementById('default-mgr-email-consolidated') as HTMLInputElement;
                                                    const roleInput = document.getElementById('default-mgr-role-consolidated') as HTMLSelectElement;
                                                    if (emailInput.value) {
                                                        const next = [...alwaysIncludedManagers, { email: emailInput.value, role: roleInput.value }];
                                                        setAlwaysIncludedManagers(next);
                                                        import('../api').then(api => api.updateConfig({ always_included_managers: next } as any));
                                                        emailInput.value = '';
                                                    }
                                                }}
                                                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1.5 rounded transition border border-zinc-700 flex items-center justify-center"
                                                title="Add to Always Included"
                                            >
                                                <Plus size={12} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </Panel>


                            {/* Options Panel */}
                            <Panel title="Options" icon={Settings} defaultOpen={true} status="Optional">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={createUnion}
                                        onChange={e => {
                                            const checked = e.target.checked;
                                            setCreateUnion(checked);
                                            if (checked) {
                                                if (!unionName) setUnionName(baseName);
                                                setDriveCount(3);
                                            } else {
                                                setDriveCount(1);
                                            }
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
                            <Panel title="Push to Servers" icon={Send} defaultOpen={true} status={selectedServers.size > 0 ? `${selectedServers.size} selected` : 'Optional'}>
                                {sshServers.length > 0 && (
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-[10px] font-bold text-zinc-500 uppercase">Available Servers</h4>
                                        <button
                                            onClick={() => {
                                                if (selectedServers.size === sshServers.length) {
                                                    setSelectedServers(new Set());
                                                } else {
                                                    setSelectedServers(new Set(sshServers.map(s => s.id)));
                                                }
                                            }}
                                            className="text-[10px] text-purple-400 hover:text-purple-300 font-medium transition-colors"
                                        >
                                            {selectedServers.size === sshServers.length ? 'Select None' : 'Select All'}
                                        </button>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-2">
                                    {sshServers.map(server => (
                                        <label
                                            key={server.id}
                                            className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-xs ${selectedServers.has(server.id)
                                                ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                                                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                                                } `}
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
                                            <div key={i} className={`text-xs ${r.status === 'ok' ? 'text-emerald-400' : 'text-red-400'} `}>
                                                {r.status === 'ok' ? '✓' : '✗'} {r.server}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Panel>
                        </div>

                        {/* RIGHT: Builder Preview & Manual Tools */}
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
                                <div className="space-y-2 mb-4">
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
                                                        groups={[
                                                            ...selectedGroups,
                                                            ...alwaysIncludedManagers.map(m => m.email)
                                                        ]}
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



                            {/* Manual Action Card */}
                            <Card>
                                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                                    <Users size={16} className="text-amber-400" />
                                    Manual Member Add (Retry)
                                </h3>
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={manualDriveId}
                                        onChange={e => setManualDriveId(e.target.value)}
                                        placeholder="Drive ID (from logs)"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono"
                                    />
                                    <input
                                        type="email"
                                        list="known-emails-list"
                                        value={manualEmail}
                                        onChange={e => setManualEmail(e.target.value)}
                                        placeholder="Email to add"
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                                    />
                                    <select
                                        value={manualRole}
                                        onChange={e => setManualRole(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs"
                                    >
                                        <option value="organizer">Manager</option>
                                        <option value="fileOrganizer">Content Manager</option>
                                        <option value="writer">Contributor</option>
                                        <option value="commenter">Commenter</option>
                                        <option value="reader">Viewer</option>
                                    </select>
                                    <button
                                        onClick={async () => {
                                            if (!manualDriveId || !manualEmail) return;
                                            setManualLoading(true);
                                            setManualLog(null);
                                            try {
                                                const res = await addDriveManagers({
                                                    drive_id: manualDriveId,
                                                    group_emails: [manualEmail],
                                                    service_account_file: serviceAccountFile,
                                                    impersonate_email: impersonateEmail,
                                                    role: manualRole
                                                });
                                                if (res.status === 'ok') setManualLog(`✓ Added ${manualEmail} `);
                                                else setManualLog(`✗ Failed: ${res.failed?.[0]?.error || 'Unknown error'} `);
                                            } catch (e: any) {
                                                setManualLog(`✗ Error: ${e.message} `);
                                            } finally {
                                                setManualLoading(false);
                                            }
                                        }}
                                        disabled={manualLoading || !manualDriveId || !manualEmail}
                                        className="w-full py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded text-xs"
                                    >
                                        {manualLoading ? 'Adding...' : 'Add Manager/Member'}
                                    </button>
                                    {manualLog && (
                                        <div className={`text-[10px] ${manualLog.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'} `}>
                                            {manualLog}
                                        </div>
                                    )}
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
            </div>

            {/* MANAGER TAB content always mounted but hidden if not active */}
            <div className={activeTab === 'manager' ? '' : 'hidden'}>
                <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 min-h-[calc(100vh-250px)] items-start">
                    {/* LEFT COLUMN: List & Filter */}
                    <Card className="lg:col-span-3 flex flex-col h-[calc(100vh-2rem)] lg:sticky lg:top-4 overflow-hidden !p-0">
                        <div className="p-3 border-b border-zinc-700/50 space-y-3 bg-zinc-900/50">
                            {/* Domain Selector */}
                            <div className="flex justify-between items-center mb-1 pr-1">
                                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Domain</label>
                                <div className="flex items-center gap-2">
                                    <CacheStatus dataType="shared_drives" contextKey={domainKey} onRefresh={() => refreshManagerData(true)} />
                                    <button
                                        onClick={() => refreshManagerData(true)}
                                        className="text-zinc-500 hover:text-violet-400 transition-colors p-1"
                                        title="Refresh Drives & Remotes"
                                    >
                                        <RefreshCw size={12} className={existingLoading ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                            </div>
                            <select
                                value={selectedDomain?.domain_name || ''}
                                onChange={e => {
                                    const dom = domains.find(d => d.domain_name === e.target.value);
                                    if (dom) setSelectedDomain(dom);
                                }}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-300 focus:border-violet-500 outline-none"
                            >
                                <option value="" disabled>Select Domain</option>
                                {domains.map(d => <option key={d.domain_name} value={d.domain_name}>{d.domain_name}</option>)}
                            </select>
                        </div>

                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                            <input
                                type="text"
                                placeholder="Filter drives..."
                                value={managerQuery}
                                onChange={e => setManagerQuery(e.target.value)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded pl-9 pr-3 py-1.5 text-sm focus:border-violet-500 transition-colors"
                            />
                        </div>

                        <div className="flex rounded bg-zinc-900 border border-zinc-700 p-0.5">
                            {(['all', 'visible', 'hidden', 'no_remote'] as const).map(filter => (
                                <button
                                    key={filter}
                                    onClick={() => setHiddenFilter(filter)}
                                    className={`flex-1 text-[10px] uppercase font-bold py-1 rounded-sm transition-colors ${hiddenFilter === filter ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {filter === 'no_remote' ? 'No Remote' : filter}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                title="Max items (0 = all)"
                                value={managerLimit}
                                onChange={e => setManagerLimit(parseInt(e.target.value) || 0)}
                                className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center focus:border-violet-500 transition-colors text-zinc-300"
                            />
                            <button
                                onClick={handleSelectAllManager}
                                className={`flex-1 px-3 py-1.5 rounded transition-colors flex items-center justify-center gap-2 text-xs font-medium ${managerSelection.size === filteredManagerItems.length && filteredManagerItems.length > 0 ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                                title="Select All"
                            >
                                <CheckCircle size={14} />
                                <span>{managerSelection.size === filteredManagerItems.length && filteredManagerItems.length > 0 ? 'None' : 'All'}</span>
                            </button>
                            <button
                                onClick={handleInvertManager}
                                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors flex items-center justify-center gap-2 text-xs font-medium"
                                title="Invert Selection"
                            >
                                <RefreshCcw size={14} />
                                <span>Invert</span>
                            </button>
                            <button
                                onClick={handleExcludeDrives}
                                disabled={managerSelection.size === 0}
                                className="px-3 py-1.5 bg-orange-900/30 hover:bg-orange-800/50 disabled:opacity-50 disabled:cursor-not-allowed border border-orange-900/50 rounded text-orange-400 transition-colors flex items-center justify-center gap-2 text-xs font-medium"
                                title="Exclude Selected"
                            >
                                <ShieldAlert size={14} />
                                <span>Exclude</span>
                            </button>
                        </div>

                        <div className="flex items-center justify-between text-xs text-zinc-500">
                            <span>{filteredManagerItems.length} items</span>
                            <button onClick={() => setManagerSelection(new Set())} disabled={managerSelection.size === 0} className="hover:text-zinc-300 disabled:opacity-50">Clear</button>
                        </div>

                        <div className="flex-1 overflow-hidden flex flex-col">
                            <DataTable
                                className="flex-1 min-h-0"
                                compact={true}
                                data={filteredManagerItems}
                                columns={[
                                    {
                                        key: 'name',
                                        header: 'Name',
                                        sortable: true,
                                        render: (val, item) => (
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-medium truncate ${managerSelection.has(item.id) ? 'text-violet-200' : 'text-zinc-300'}`}>{val}</span>
                                                    {item.hidden && <span className="text-[10px] bg-red-900/30 text-red-300 px-1 py-0 rounded border border-red-900/50">Hidden</span>}
                                                </div>
                                            </div>
                                        )
                                    },
                                    {
                                        key: 'remotes',
                                        header: '',
                                        render: (_, item) => item.remotes.length > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 w-fit">
                                                    <Link size={10} /> {item.remotes.length}
                                                </span>
                                                {item.remotes[0].config?.service_account_file && (
                                                    <span className="text-[10px] text-zinc-500 font-mono hidden md:inline truncate max-w-[150px]" title={item.remotes[0].config.service_account_file}>
                                                        SA: {item.remotes[0].config.service_account_file.split('/').pop()}
                                                    </span>
                                                )}
                                            </div>
                                        )
                                    }
                                ]}
                                selectedItems={managerSelection}
                                onToggleItem={(id, e) => toggleManagerSelection(id, e)}
                                onSelectAll={handleSelectAllManager}
                                onInvertSelection={handleInvertManager}
                                handleSort={handleSort}
                                SortIcon={SortIcon}
                                columnFilters={columnFilters}
                                onToggleColumnFilter={toggleColumnFilter}
                                onClearColumnFilter={clearColumnFilter}
                                getUniqueValues={getUniqueValues}
                                rowIdKey="id"
                                isLoading={existingLoading}
                            />
                        </div>
                    </Card>

                    {/* RIGHT COLUMN: Actions */}
                    <Card className="lg:col-span-4 flex flex-col bg-zinc-900/30">
                        {
                            managerSelection.size === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 space-y-4">
                                    <Layers size={48} className="opacity-20" />
                                    <p>Select drives to manage</p>
                                </div>
                            ) : (
                                <div className="flex flex-col h-full p-6">
                                    <div className="flex items-center justify-between pb-6 border-b border-zinc-800 shrink-0">
                                        <h3 className="text-lg font-medium text-white flex items-center gap-2">
                                            <Check className="text-violet-500" size={20} />
                                            {managerSelection.size} Selected
                                        </h3>
                                        <div className="flex gap-2">
                                            {managerSelection.size > 1 && (
                                                <button
                                                    onClick={() => setManagerMode('create_union')}
                                                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded flex items-center gap-2"
                                                >
                                                    <Layers size={14} /> Create Union
                                                </button>
                                            )}
                                            <button onClick={handleRenameDrive} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded disabled:opacity-50" disabled={managerSelection.size !== 1}>Rename</button>
                                            <button onClick={handleDeleteDrive} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs rounded">Delete</button>
                                        </div>
                                    </div>

                                    <div className="flex-1 pt-6">
                                        {managerMode === 'view' && (
                                            <div className="space-y-8 pb-12">
                                                {filteredManagerItems
                                                    .filter(drive => managerSelection.has(drive.id))
                                                    .map(drive => (
                                                        <div key={drive.id} className="border-b border-zinc-700/50 pb-8 last:border-0 last:pb-0">
                                                            <div className="flex items-center gap-3 mb-4">
                                                                <div className="p-2 bg-zinc-800 rounded-lg">
                                                                    <HardDrive size={20} className="text-violet-400" />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-lg font-bold text-white">{drive.name}</h3>
                                                                    <p className="text-xs font-mono text-zinc-500">{drive.id}</p>
                                                                </div>
                                                            </div>

                                                            <DriveDetailsPanel
                                                                drive={drive}
                                                                serviceAccountFile={serviceAccountFile || keys[0]?.path}
                                                                impersonateEmail={impersonateEmail || selectedDomain?.admin_email}
                                                                domains={domains}
                                                                keys={keys}
                                                                onCreateRemote={async (name, driveId, saPath) => {
                                                                    try {
                                                                        setLogs(p => [...p, `Creating remote: ${name}...`]);
                                                                        await createDriveRemote({
                                                                            name,
                                                                            drive_id: driveId,
                                                                            service_account_file: saPath
                                                                        });
                                                                        setLogs(p => [...p, `✓ Created remote: ${name}`]);
                                                                        alert('Remote created! Refreshing data...');
                                                                        refreshManagerData();
                                                                    } catch (e: any) {
                                                                        alert(e.message);
                                                                    }
                                                                }}
                                                                onRenameRemote={handleRenameRemote}
                                                                onDeleteRemote={handleDeleteRemote}
                                                                onEditRemote={handleEditRemote}
                                                                onAddMember={handleAddMember}
                                                                refreshData={refreshManagerData}
                                                            />
                                                        </div>
                                                    ))}
                                                <div className="pt-2">
                                                    <button onClick={handleDeleteDrive} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs rounded">Delete Selected</button>
                                                </div>
                                            </div>
                                        )}
                                        {managerMode === 'create_union' && (
                                            <div className="bg-zinc-950 p-6 rounded border border-violet-500/30 max-w-lg mx-auto mt-10">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="p-2 bg-violet-500/20 rounded-full text-violet-400">
                                                        <Layers size={24} />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-lg font-medium text-white">Create Union Remote</h3>
                                                        <p className="text-sm text-zinc-400">Combine selected drives into a unified remote</p>
                                                    </div>
                                                </div>

                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="text-sm text-zinc-400 block mb-1">Union Name</label>
                                                        <input
                                                            value={unionNameInput}
                                                            onChange={e => setUnionNameInput(e.target.value)}
                                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-violet-500 transition-colors"
                                                            placeholder="e.g. movies-union"
                                                            autoFocus
                                                        />
                                                    </div>

                                                    <div className="bg-zinc-900/50 rounded p-3 text-xs text-zinc-500 space-y-3">
                                                        <div>Will include remotes from <strong>{managerSelection.size}</strong> selected drives.</div>
                                                        <div className="bg-zinc-950 p-2 rounded border border-zinc-800 font-mono text-[10px] space-y-0.5 text-zinc-400">
                                                            <div><span className="text-zinc-500">type</span> = <span className="text-purple-400">union</span></div>
                                                            <div><span className="text-zinc-500">action_policy</span> = <span className="text-amber-400">epall</span></div>
                                                            <div><span className="text-zinc-500">create_policy</span> = <span className="text-amber-400">eprand</span></div>
                                                        </div>
                                                    </div>

                                                    <div className="flex justify-end gap-3 pt-4">
                                                        <button
                                                            onClick={() => setManagerMode('view')}
                                                            className="px-4 py-2 text-zinc-400 hover:text-white text-sm"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={handleCreateUnion}
                                                            disabled={!unionNameInput}
                                                            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            Create Union
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                    </Card>
                </div>
            </div>

            {/* EXPAND UNION TAB */}
            <div className={activeTab === 'expand' ? '' : 'hidden'}>
                <div className="max-w-6xl mx-auto space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* LEFT: Config & Analysis */}
                        <Card className="lg:col-span-1 space-y-6">
                            <div>
                                <h3 className="text-sm font-medium text-white flex items-center gap-2 mb-4">
                                    <Server size={16} className="text-violet-400" />
                                    Source Selection
                                </h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Server</label>
                                        <select
                                            value={expandServerId}
                                            onChange={e => setExpandServerId(e.target.value)}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-2 text-sm text-white"
                                        >
                                            <option value="local">Local Server</option>
                                            {sshServers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Union Remote</label>
                                        <div className="flex gap-2">
                                            <select
                                                value={expandUnionRemote}
                                                onChange={e => setExpandUnionRemote(e.target.value)}
                                                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-2 text-sm text-white"
                                                disabled={expandFetchingRemotes}
                                            >
                                                <option value="" disabled>Select Union...</option>
                                                {expandRemotesList.map(r => <option key={r} value={r}>{r}</option>)}
                                            </select>
                                            <button
                                                onClick={() => setExpandServerId(expandServerId)} // Trigger re-fetch
                                                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
                                                title="Refresh Remotes"
                                            >
                                                <RefreshCw size={14} className={expandFetchingRemotes ? 'animate-spin' : ''} />
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleAnalyzeUnion}
                                        disabled={!expandUnionRemote || expandLoading}
                                        className="w-full py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded font-medium flex items-center justify-center gap-2"
                                    >
                                        {expandLoading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                                        Analyze Union
                                    </button>
                                </div>
                            </div>

                            {expandAnalysis && (
                                <div className="pt-4 border-t border-zinc-800">
                                    <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Analysis Results</h4>
                                    <div className="bg-zinc-950/50 rounded p-3 text-xs space-y-2 border border-zinc-800">
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Union Name</span>
                                            <span className="text-white font-mono">{expandAnalysis.analysis.union_name}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Current Members</span>
                                            <span className="text-white font-mono">{expandAnalysis.analysis.members.length}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Detected Pattern</span>
                                            <span className="text-purple-400 font-mono">{expandAnalysis.analysis.detected_pattern || 'None'}</span>
                                        </div>
                                    </div>

                                    <div className="mt-6">
                                        <label className="text-xs text-zinc-500 block mb-1">Drives to Add</label>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                value={expandCount}
                                                onChange={e => handleUpdateExpansionCount(parseInt(e.target.value))}
                                                className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white"
                                            />
                                            <span className="text-xs text-zinc-500">New Drives</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </Card>

                        {/* RIGHT: Proposals */}
                        <div className="lg:col-span-2 space-y-6">
                            {expandProposals.length > 0 && (
                                <Card>
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-medium text-white flex items-center gap-2">
                                            <Layers size={16} className="text-emerald-400" />
                                            Proposed Expansion
                                        </h3>
                                        <button
                                            onClick={handleExecuteExpansion}
                                            disabled={expandLoading}
                                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold flex items-center gap-2 shadow-lg shadow-emerald-900/20"
                                        >
                                            <Play size={14} />
                                            Execute Expansion
                                        </button>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="text-[10px] uppercase text-zinc-500 border-b border-zinc-800">
                                                    <th className="py-2 pl-2">#</th>
                                                    <th className="py-2">New Remote</th>
                                                    <th className="py-2">New Drive Name</th>
                                                    <th className="py-2">Cloning Permissions From</th>
                                                    <th className="py-2 pr-2">SA File</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-xs text-zinc-300 font-mono">
                                                {expandProposals.map((prop, i) => (
                                                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                                        <td className="py-2 pl-2 text-zinc-500">+{i + 1}</td>
                                                        <td className="py-2 text-emerald-400">{prop.new_remote_name}</td>
                                                        <td className="py-2">{prop.new_drive_name}</td>
                                                        <td className="py-2 text-zinc-500 flex items-center gap-1">
                                                            <Users size={10} />
                                                            {prop.team_drive_id || 'Unknown'} (via {prop.based_on_remote})
                                                        </td>
                                                        <td className="py-2 pr-2 text-amber-500/80 truncate max-w-[100px]" title={prop.service_account_file}>
                                                            {prop.service_account_file?.split('/').pop()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="mt-4 p-3 bg-blue-900/10 border border-blue-900/30 rounded text-[11px] text-blue-200 flex items-start gap-2">
                                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                        <div>
                                            This will create {expandProposals.length} new Google Shared Drives, create corresponding rclone remotes (copying config/SA from base), and add them to the <strong>{expandUnionRemote}</strong> union remote on the <strong>{expandServerId === 'local' ? 'Local' : 'Remote'}</strong> server.
                                        </div>
                                    </div>
                                </Card>
                            )}

                            {/* Logs */}
                            {expandLogs.length > 0 && (
                                <Card>
                                    <h4 className="text-xs font-medium text-zinc-500 mb-2">Expansion Log</h4>
                                    <div className="bg-zinc-950 rounded p-3 text-[10px] font-mono text-zinc-400 max-h-60 overflow-y-auto">
                                        {expandLogs.map((log, i) => (
                                            <div key={i} className={log.startsWith('✓') ? 'text-emerald-400' : log.startsWith('✗') ? 'text-red-400' : ''}>{log}</div>
                                        ))}
                                    </div>
                                </Card>
                            )}

                            {!expandProposals.length && !expandLoading && (
                                <div className="flex flex-col items-center justify-center py-20 text-zinc-600 space-y-4 border border-zinc-800/50 rounded-lg bg-zinc-900/20">
                                    <div className="p-4 bg-zinc-900 rounded-full">
                                        <Search size={32} className="opacity-50" />
                                    </div>
                                    <p className="text-sm">Select a union remote and click analyze to start.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit Remote Modal (Shared with Rclone Manager logic) */}
            {
                editingRemote && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Settings size={18} className="text-violet-400" />
                                    Edit Remote: <span className="text-violet-400 font-mono">{editingRemote}</span>
                                </h3>
                                <button onClick={() => setEditingRemote(null)} className="text-zinc-500 hover:text-white transition">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1 uppercase font-bold tracking-wider">Configuration (JSON)</label>
                                    <textarea
                                        value={editConfig}
                                        onChange={(e) => setEditConfig(e.target.value)}
                                        className="w-full h-80 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-xs focus:border-violet-500 outline-none custom-scrollbar"
                                        spellCheck={false}
                                    />
                                </div>

                                <div className="p-3 bg-violet-900/10 border border-violet-900/30 rounded">
                                    <div className="text-[10px] font-bold text-violet-500 uppercase mb-1">Detected Settings</div>
                                    <div className="text-[11px] text-zinc-300 font-mono break-all leading-relaxed h-10 overflow-y-auto">
                                        {(() => {
                                            try {
                                                const parsed = JSON.parse(editConfig);
                                                return `Drive ID: ${parsed.team_drive || 'N/A'}\nSA: ${parsed.service_account_file || 'N/A'}`;
                                            } catch (e) { return "Invalid JSON"; }
                                        })()}
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={handleSaveRemoteEdit}
                                    className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <Save size={16} />
                                    Save Changes
                                </button>
                                <button
                                    onClick={() => setEditingRemote(null)}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
};

export default DriveManager;
