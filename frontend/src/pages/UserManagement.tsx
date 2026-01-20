import { useState, useEffect, useMemo } from 'react';
import {
    RefreshCw, Terminal, Globe, Search, Copy,
    Shield, UserCheck, UserMinus, Users, CheckSquare
} from 'lucide-react';
import { listDomainUsers, fetchConfig, bulkUserOps, Config, BulkOpRequest } from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Dropdown } from '../components/Dropdown';
import { DataTable, ColumnConfig } from '../components/ui/DataTable';
import { useDataTable } from '../hooks/useDataTable';
import { CacheStatus } from '../components/CacheStatus';
import { useIsyncData } from '../contexts/IsyncDataContext';

const UserManagement = () => {
    const { getCached, setCached } = useIsyncData();
    const [config, setConfig] = useState<Config>({});
    const [selectedDomains, setSelectedDomains] = useState<Set<string>>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.SELECTED_DOMAINS);
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });

    // Use cached users or fallback to session storage
    const [users, setUsers] = useState<any[]>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.USERS);
        return saved ? JSON.parse(saved) : [];
    });
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [opStatus, setOpStatus] = useState<string | null>(null);

    // Initial load
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const c = await fetchConfig();
        setConfig(c);
        if (selectedDomains.size === 0 && c.domains && c.domains.length > 0) {
            if (users.length === 0) {
                setSelectedDomains(new Set([c.domains[0].domain_name]));
            }
        }
    };

    // Table Hook Integration
    const columns: ColumnConfig<any>[] = [
        {
            key: 'email',
            header: 'User',
            sortable: true,
            filterable: true,
            render: (email, u) => {
                const isProtected = config.protected_users?.includes(u.email);
                return (
                    <div className="flex flex-col">
                        <div
                            className="font-medium text-zinc-200 flex items-center gap-2 hover:text-white transition text-sm cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); copyText(u.name?.fullName || email.split('@')[0]); }}
                        >
                            {u.name?.fullName || email.split('@')[0]}
                            {u.isAdmin && (
                                <span
                                    className={`border text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 font-bold ${u.isDelegatedAdmin ? 'bg-amber-900/30 border-amber-500/30 text-amber-400' : 'bg-red-900/30 border-red-500/30 text-red-400'}`}
                                    title={u.isDelegatedAdmin ? "Admin (Delegated)" : "Super Admin"}
                                >
                                    <Shield size={10} />
                                    {u.isDelegatedAdmin ? "ADMIN" : "SUPER ADMIN"}
                                </span>
                            )}
                            {isProtected && !u.isAdmin && (
                                <span className="bg-purple-900/30 border border-purple-500/30 text-purple-400 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" title="Protected User">
                                    <Shield size={10} />
                                </span>
                            )}
                        </div>
                        <div
                            className="text-xs text-indigo-400/80 font-mono hover:text-indigo-300 transition cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); copyText(email); }}
                        >
                            {email}
                        </div>
                    </div>
                );
            },
            getFilterValue: (u) => u.isAdmin ? (u.isDelegatedAdmin ? "Admin" : "Super Admin") : "Regular"
        },
        {
            key: 'status',
            header: 'Status',
            sortable: true,
            filterable: true,
            render: (val, u) => (
                u.suspended ? (
                    <span className="px-2 py-1 rounded text-xs font-medium bg-red-900/20 text-red-400 border border-red-900/30">Suspended</span>
                ) : (
                    <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900/20 text-emerald-400 border border-emerald-900/30">Active</span>
                )
            ),
            getFilterValue: (u) => u.suspended ? "Suspended" : "Active"
        },
        {
            key: '_sourceDomain',
            header: 'Domain',
            sortable: true,
            filterable: true,
            render: (val) => <span className="text-sm text-zinc-300">{val || 'N/A'}</span>
        },
        {
            key: '_groupEmail',
            header: 'Group',
            sortable: true,
            filterable: true,
            render: (val, u) => (
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-zinc-400 truncate max-w-[150px]">{val}</span>
                    {val !== 'N/A' && (
                        u.in_group
                            ? <CheckSquare size={14} className="text-emerald-500" />
                            : <span className="text-red-500/80 font-bold text-xs">✕</span>
                    )}
                </div>
            ),
            getFilterValue: (u) => u.in_group ? "Member" : "Not Member"
        },
        {
            key: '_jsonKey',
            header: 'JSON Key',
            sortable: true,
            filterable: true,
            render: (val) => <span className="text-xs font-mono text-zinc-400">{val}</span>
        },
        {
            key: 'id',
            header: 'ID',
            sortable: true,
            render: (val) => <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[80px]" title={val}>{val}</span>
        },
        {
            key: 'actions',
            header: '',
            render: (_, u) => (
                <div className="text-right">
                    <button onClick={(e) => { e.stopPropagation(); copyText(u.email); }} className="text-zinc-500 hover:text-indigo-400 transition p-1.5 hover:bg-zinc-800 rounded">
                        <Copy size={16} />
                    </button>
                </div>
            )
        }
    ];

    const {
        data: sortedFilteredUsers,
        searchTerm,
        setSearchTerm,
        columnFilters,
        toggleColumnFilter,
        clearColumnFilter,
        getUniqueValues,
        selectedItems: selectedUsers,
        toggleItem,
        selectAll,
        invertSelection,
        handleSort,
        SortIcon,
        sortColumn,
        sortDirection
    } = useDataTable({
        data: users,
        columns,
        persistentKey: 'user_mgmt',
        rowIdKey: 'email',
        filterFn: (u, search) =>
            u.email.toLowerCase().includes(search.toLowerCase()) ||
            (u.name?.fullName || "").toLowerCase().includes(search.toLowerCase())
    });

    // Sync domain selection for persistence
    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.SELECTED_DOMAINS, JSON.stringify(Array.from(selectedDomains)));
    }, [selectedDomains]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.USERS, JSON.stringify(users));
    }, [users]);

    const fetchUsers = async () => {
        if (selectedDomains.size === 0) return alert("Select at least one domain.");
        setLoadingUsers(true);
        setUsers([]);
        let allUsers: any[] = [];
        let errors: string[] = [];

        try {
            for (const domain of Array.from(selectedDomains)) {
                try {
                    const res = await listDomainUsers(domain);
                    const domainUsers = (res.users || []).map((u: any) => ({
                        ...u,
                        _sourceDomain: domain,
                        _groupEmail: res.group_email || 'N/A',
                        _jsonKey: res.json_filename || 'N/A'
                    }));
                    allUsers = [...allUsers, ...domainUsers];
                } catch (e: any) {
                    errors.push(`${domain}: ${e.message}`);
                }
            }
            setUsers(allUsers);
            // Persist to cache for each domain
            for (const domain of Array.from(selectedDomains)) {
                const domainUsers = allUsers.filter(u => u._sourceDomain === domain);
                setCached('users', domain, domainUsers, 'google_workspace_api');
            }
            if (errors.length > 0) alert(`Loaded with errors:\n${errors.join("\n")}`);
            else setOpStatus(`Loaded ${allUsers.length} users from ${selectedDomains.size} domains.`);
        } catch (e: any) {
            alert(`Fatal error: ${e.message}`);
        } finally {
            setLoadingUsers(false);
        }
    };

    const toggleDomain = (domain: string) => {
        const next = new Set(selectedDomains);
        if (next.has(domain)) next.delete(domain);
        else next.add(domain);
        setSelectedDomains(next);
    };

    const toggleAllDomains = () => {
        if (!config.domains) return;
        if (selectedDomains.size === config.domains.length) setSelectedDomains(new Set());
        else setSelectedDomains(new Set(config.domains.map(d => d.domain_name)));
    };

    const runBulkOp = async (action: BulkOpRequest['action']) => {
        if (selectedUsers.size === 0) return alert("No users selected.");
        if (!confirm(`Are you sure you want to ${action} ${selectedUsers.size} users?`)) return;

        setOpStatus(`Running ${action}...`);
        const emailToDomain = new Map(users.map(u => [u.email, u._sourceDomain]));
        const usersByDomain: Record<string, string[]> = {};
        for (const email of Array.from(selectedUsers)) {
            const dom = emailToDomain.get(email as string);
            if (!dom) continue;
            if (!usersByDomain[dom]) usersByDomain[dom] = [];
            usersByDomain[dom].push(email as string);
        }

        try {
            let results: any = {};
            const domains = Object.entries(usersByDomain);
            for (const [dom, userList] of domains) {
                const res = await bulkUserOps({ action, domain: dom, users: userList });
                results = { ...results, ...res };
            }
            setOpStatus(`✅ Done processing bulk operation.`);
            if (['delete', 'protect', 'unsuspend', 'add_to_group'].includes(action)) {
                await loadData();
                await fetchUsers();
            }
        } catch (e: any) {
            setOpStatus(`❌ Error: ${e.message}`);
        }
    };

    const copyText = (text: string) => {
        if (!text || text === 'N/A') return;
        navigator.clipboard.writeText(text);
        setOpStatus(`📋 Copied: "${text}"`);
    };

    return (
        <div className="page-container">
            <header className="page-header">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center">
                        <Users size={16} className="text-white" />
                    </div>
                    <div>
                        <h1 className="page-title">User Manager</h1>
                        <p className="text-xs text-zinc-400">Manage Workspace users</p>
                    </div>
                </div>
            </header>

            <div className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                    <div className="lg:col-span-1">
                        <Dropdown
                            fullWidth
                            trigger={
                                <div className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:border-zinc-700 transition">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Globe className="text-indigo-400 shrink-0" size={18} />
                                        <span className="text-sm truncate">
                                            {selectedDomains.size === 0 ? "Select Domains..." :
                                                selectedDomains.size === config.domains?.length ? "All Domains" :
                                                    `${selectedDomains.size} Domains`}
                                        </span>
                                    </div>
                                    <RefreshCw size={14} className="text-zinc-500" />
                                </div>
                            }
                            menuClassName="p-2 max-h-60 overflow-y-auto"
                        >
                            <div className="flex items-center gap-2 p-2 hover:bg-zinc-800 rounded cursor-pointer text-sm font-bold text-zinc-300 border-b border-zinc-800 mb-1" onClick={toggleAllDomains}>
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedDomains.size === (config.domains?.length || 0) ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                                    {selectedDomains.size === (config.domains?.length || 0) && <CheckSquare size={10} className="text-white" />}
                                </div>
                                Select All
                            </div>
                            {config.domains?.map(d => (
                                <div key={d.domain_name} className="flex items-center gap-2 p-2 hover:bg-zinc-800 rounded cursor-pointer text-sm text-zinc-400" onClick={() => toggleDomain(d.domain_name)}>
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedDomains.has(d.domain_name) ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                                        {selectedDomains.has(d.domain_name) && <CheckSquare size={10} className="text-white" />}
                                    </div>
                                    {d.domain_name}
                                </div>
                            ))}
                        </Dropdown>
                    </div>

                    <div className="lg:col-span-2 relative">
                        <Search className="absolute left-3 top-3.5 text-zinc-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search by email or name..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-3 pl-10 pr-24 text-sm focus:border-indigo-500 outline-none transition"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={fetchUsers} disabled={loadingUsers} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20">
                            {loadingUsers ? <RefreshCw className="animate-spin" size={18} /> : <Terminal size={18} />}
                            {loadingUsers ? "Fetching..." : "List Users"}
                        </button>
                        {selectedDomains.size === 1 && (
                            <CacheStatus
                                dataType="users"
                                contextKey={Array.from(selectedDomains)[0]}
                                onRefresh={fetchUsers}
                                compact
                            />
                        )}
                    </div>
                </div>

                {opStatus && (
                    <div className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-lg flex items-center gap-2 text-sm text-zinc-300">
                        <Terminal size={14} className="text-emerald-500" />
                        <span className="font-mono">{opStatus}</span>
                    </div>
                )}

                <div className="flex flex-wrap gap-2 items-center bg-zinc-900/30 p-2 rounded-lg border border-zinc-800/50">
                    <button onClick={() => runBulkOp('verify')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 font-medium transition"><Shield size={14} /> Verify Suspensions</button>
                    <button onClick={() => runBulkOp('unsuspend')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-emerald-900/30 hover:text-emerald-400 rounded text-xs text-zinc-300 font-medium transition"><UserCheck size={14} /> Unsuspend</button>
                    <button onClick={() => runBulkOp('add_to_group')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-indigo-900/30 hover:text-indigo-400 rounded text-xs text-zinc-300 font-medium transition"><UserCheck size={14} /> Add to Group</button>
                    <button onClick={() => runBulkOp('protect')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-blue-900/30 hover:text-blue-400 rounded text-xs text-zinc-300 font-medium transition"><Shield size={14} /> Protect Selected</button>

                    <div className="h-4 w-px bg-zinc-700 mx-1"></div>

                    {(() => {
                        const hasProtected = Array.from(selectedUsers).some(email => config.protected_users?.includes(email as string));
                        return (
                            <button
                                onClick={() => !hasProtected && runBulkOp('delete')}
                                disabled={hasProtected || selectedUsers.size === 0}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition ${hasProtected ? "bg-zinc-800 text-zinc-600 opacity-50" : "bg-red-900/20 hover:bg-red-900/40 text-red-400"}`}
                            >
                                <UserMinus size={14} /> {hasProtected ? "Protected" : "Delete"}
                            </button>
                        );
                    })()}
                </div>

                <DataTable
                    data={sortedFilteredUsers}
                    columns={columns.filter(c => c.key !== 'actions')}
                    selectedItems={selectedUsers}
                    onToggleItem={toggleItem}
                    onSelectAll={selectAll}
                    onInvertSelection={invertSelection}
                    handleSort={handleSort}
                    SortIcon={SortIcon}
                    columnFilters={columnFilters}
                    onToggleColumnFilter={toggleColumnFilter}
                    onClearColumnFilter={clearColumnFilter}
                    getUniqueValues={getUniqueValues}
                    rowIdKey="email"
                    isLoading={loadingUsers}
                    emptyMessage={loadingUsers ? "Loading users..." : "No users found. Select domains and click List Users."}
                />
            </div>
        </div>
    );
};

export default UserManagement;
