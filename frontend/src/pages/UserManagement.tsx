import { useState, useEffect } from 'react';
import {
    RefreshCw, Terminal, CheckSquare,
    Filter, Globe, Search, Copy,
    Shield, ShieldAlert, UserCheck, UserMinus, Users
} from 'lucide-react';
import { listDomainUsers, fetchConfig, bulkUserOps, Config, BulkOpRequest } from '../api';
import { SESSION_KEYS } from '../constants/storageKeys';
import { PageHeader } from '../components/PageHeader';
import { Dropdown } from '../components/Dropdown';
import { useSortableData } from '../hooks/useSortableData';

const UserManagement = () => {

    // Sub-component for Column Filter
    const ColumnFilter = ({ column, title, options, selected, onToggle, onClear }: any) => {
        const [open, setOpen] = useState(false);
        const isActive = selected && selected.size > 0;

        return (
            <div className="relative inline-block ml-2">
                <button
                    onClick={() => setOpen(!open)}
                    className={`p-1 rounded hover:bg-zinc-800 transition ${isActive ? 'text-indigo-400' : 'text-zinc-600'}`}
                >
                    <Filter size={12} fill={isActive ? "currentColor" : "none"} />
                </button>

                {open && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}></div>
                        <div className="absolute top-full left-0 mt-1 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 p-2 text-left">
                            <div className="flex justify-between items-center mb-2 pb-2 border-b border-zinc-800">
                                <span className="text-xs font-bold text-zinc-400">{title}</span>
                                {isActive && <button onClick={() => onClear(column)} className="text-[10px] text-red-400 hover:text-red-300">Clear</button>}
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                                {options.map((opt: string) => (
                                    <label key={opt} className="flex items-center gap-2 p-1.5 hover:bg-zinc-800 rounded cursor-pointer text-xs text-zinc-300">
                                        <input
                                            type="checkbox"
                                            checked={isActive ? selected.has(opt) : false}
                                            onChange={() => onToggle(column, opt)}
                                            className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-0"
                                        />
                                        <span className="truncate">{opt}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        );
    };

    const [config, setConfig] = useState<Config>({});

    // User Mgmt State - Persistent
    const [selectedDomains, setSelectedDomains] = useState<Set<string>>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.SELECTED_DOMAINS);
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });
    const [users, setUsers] = useState<any[]>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.USERS);
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(() => {
        const saved = sessionStorage.getItem(SESSION_KEYS.SELECTED_USERS);
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });

    const [loadingUsers, setLoadingUsers] = useState(false);
    const [filter, setFilter] = useState("");
    const [opStatus, setOpStatus] = useState<string | null>(null);

    // Persistence Hooks
    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.SELECTED_DOMAINS, JSON.stringify(Array.from(selectedDomains)));
    }, [selectedDomains]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.USERS, JSON.stringify(users));
    }, [users]);

    useEffect(() => {
        sessionStorage.setItem(SESSION_KEYS.SELECTED_USERS, JSON.stringify(Array.from(selectedUsers)));
    }, [selectedUsers]);

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
                    console.error(`Failed ${domain}`, e);
                    if (e.message.includes("400")) {
                        errors.push(`Missing JSON for ${domain}`);
                    } else {
                        errors.push(`${domain}: ${e.message}`);
                    }
                }
            }

            setUsers(allUsers);
            setSelectedUsers(new Set());

            if (errors.length > 0) {
                alert(`Loaded with errors:\n${errors.join("\n")}`);
            } else if (allUsers.length === 0) {
                setOpStatus("No users found in selected domains.");
            } else {
                setOpStatus(`Loaded ${allUsers.length} users from ${selectedDomains.size} domains.`);
            }

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
        if (selectedDomains.size === config.domains.length) {
            setSelectedDomains(new Set());
        } else {
            setSelectedDomains(new Set(config.domains.map(d => d.domain_name)));
        }
    };

    const toggleUser = (email: string) => {
        const next = new Set(selectedUsers);
        if (next.has(email)) next.delete(email);
        else next.add(email);
        setSelectedUsers(next);
    };

    const selectAllUsers = (visibleUsers: any[]) => {
        if (selectedUsers.size === visibleUsers.length && visibleUsers.length > 0) {
            setSelectedUsers(new Set());
        } else {
            setSelectedUsers(new Set(visibleUsers.map(u => u.email)));
        }
    };

    const runBulkOp = async (action: BulkOpRequest['action']) => {
        if (selectedUsers.size === 0) return alert("No users selected.");

        let message = `Are you sure you want to ${action} ${selectedUsers.size} users?`;
        if (action === 'delete') {
            message = `⚠️ WARNING: You are about to PERMANENTLY DELETE ${selectedUsers.size} user(s).\n\nThis action cannot be undone.\n\nAre you sure you want to proceed?`;
        } else if (action === 'protect') {
            message = `Are you sure you want to add ${selectedUsers.size} user(s) to the Protected list?`;
        } else if (action === 'unsuspend') {
            message = `Are you sure you want to UNSUSPEND ${selectedUsers.size} user(s)?`;
        } else if (action === 'verify') {
            message = `Verify suspension status for ${selectedUsers.size} user(s)?`;
        } else if (action === 'add_to_group') {
            message = `Add ${selectedUsers.size} user(s) to their domain's configured permission group?`;
        }

        if (!confirm(message)) return;

        setOpStatus(`Running ${action}...`);

        const emailToDomain = new Map(users.map(u => [u.email, u._sourceDomain]));

        const usersByDomain: Record<string, string[]> = {};
        for (const email of Array.from(selectedUsers)) {
            const dom = emailToDomain.get(email);
            if (!dom) continue;
            if (!usersByDomain[dom]) usersByDomain[dom] = [];
            usersByDomain[dom].push(email);
        }

        try {
            let results: any = {};
            const domains = Object.entries(usersByDomain);
            let processed = 0;

            for (const [dom, userList] of domains) {
                setOpStatus(`Processing ${dom}... (${processed}/${domains.length} domains)`);
                const res = await bulkUserOps({
                    action,
                    domain: dom,
                    users: userList
                });
                results = { ...results, ...res };
                processed++;
            }

            // Count successes - check for success patterns
            const successCount = Object.values(results).filter((s: any) => {
                if (typeof s !== 'string') return false;
                const lower = s.toLowerCase();
                return lower.includes('deleted') ||
                    lower.includes('verified') ||
                    lower.includes('unsuspended') ||
                    lower.includes('added to') ||
                    lower.includes('active') ||
                    lower === 'ok';
            }).length;

            const errorCount = Object.values(results).filter((s: any) =>
                typeof s === 'string' && s.toLowerCase().includes('error')
            ).length;

            if (errorCount > 0) {
                setOpStatus(`⚠️ Done. ${successCount} successful, ${errorCount} errors. Check console for details.`);
            } else {
                setOpStatus(`✅ Done. ${successCount}/${Object.keys(results).length} operations successful.`);
            }
            console.log('Bulk operation results:', results);

        } catch (e: any) {
            setOpStatus(`❌ Error: ${e.message}`);
            console.error('Bulk operation error:', e);
            return; // Don't try to refresh on error
        }

        // Refresh user list after modifying operations (separate try/catch)
        if (action === 'delete' || action === 'protect' || action === 'unsuspend' || action === 'add_to_group') {
            try {
                await loadData();
                await fetchUsers();
            } catch (refreshError) {
                console.warn('Failed to refresh user list:', refreshError);
                // Don't overwrite success status with refresh error
            }
        }
    };

    // Column Filters State
    const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});

    const toggleColumnFilter = (column: string, value: string) => {
        const current = columnFilters[column] ? new Set<string>(columnFilters[column]) : new Set<string>();
        if (current.has(value)) current.delete(value);
        else current.add(value);

        setColumnFilters((prev: Record<string, Set<string>>) => ({ ...prev, [column]: current }));
    };

    const clearColumnFilter = (column: string) => {
        const next = { ...columnFilters };
        delete next[column];
        setColumnFilters(next);
    };

    const copyText = (text: string) => {
        if (!text || text === 'N/A') return;
        navigator.clipboard.writeText(text);
        setOpStatus(`📋 Copied: "${text}"`);
    };

    // Filter Logic
    const filteredUsers = users.filter(u => {
        const searchMatch = !filter ||
            u.email.toLowerCase().includes(filter.toLowerCase()) ||
            (u.name?.fullName || "").toLowerCase().includes(filter.toLowerCase());

        if (!searchMatch) return false;

        const statusVal = u.suspended ? "Suspended" : "Active";
        if (columnFilters['status'] && columnFilters['status'].size > 0 && !columnFilters['status'].has(statusVal)) return false;

        const domainVal = u._sourceDomain || 'N/A';
        if (columnFilters['domain'] && columnFilters['domain'].size > 0 && !columnFilters['domain'].has(domainVal)) return false;

        if (columnFilters['group'] && columnFilters['group'].size > 0) {
            const filters = columnFilters['group'];
            const emailMatch = filters.has(u._groupEmail || 'N/A');
            const statusMatch = (u.in_group && filters.has("Member")) || (!u.in_group && filters.has("Not Member"));

            if (!emailMatch && !statusMatch) return false;
        }

        const jsonVal = u._jsonKey || 'N/A';
        if (columnFilters['json'] && columnFilters['json'].size > 0 && !columnFilters['json'].has(jsonVal)) return false;

        return true;
    });

    // Use sortable data hook
    const { sortedData: sortedFilteredUsers, handleSort, SortIcon } = useSortableData({
        data: filteredUsers,
        initialSortColumn: null,
        initialSortDirection: 'asc'
    });

    const getUniqueValues = (key: string) => {
        const values = new Set<string>();
        users.forEach(u => {
            if (key === 'status') values.add(u.suspended ? "Suspended" : "Active");
            else if (key === 'domain') values.add(u._sourceDomain || 'N/A');
            else if (key === 'group') {
                values.add(u._groupEmail || 'N/A');
            }
            else if (key === 'json') values.add(u._jsonKey || 'N/A');
        });

        const arr = Array.from(values).sort();
        if (key === 'group') {
            return ["Member", "Not Member", ...arr];
        }
        return arr;
    };



    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">

            {/* Header */}
            <PageHeader
                icon={Users}
                title="User Manager"
                subtitle="Manage Google Workspace users across domains"
                gradient="from-indigo-600 to-purple-600"
            />

            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                {/* Controls */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    {/* Domain Selector (Multi) */}
                    <div className="lg:col-span-1">
                        <Dropdown
                            fullWidth
                            trigger={
                                <div className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:border-zinc-700 transition">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Globe className="text-indigo-400 shrink-0" size={18} />
                                        <span className="text-sm truncate">
                                            {selectedDomains.size === 0 ? "Select Domains..." :
                                                selectedDomains.size === config.domains?.length ? "All Domains Selected" :
                                                    `${selectedDomains.size} Selected`}
                                        </span>
                                    </div>
                                    <Filter size={14} className="text-zinc-500" />
                                </div>
                            }
                            menuClassName="p-2 max-h-60 overflow-y-auto"
                        >
                            <div
                                className="flex items-center gap-2 p-2 hover:bg-zinc-800 rounded cursor-pointer text-sm font-bold text-zinc-300 border-b border-zinc-800 mb-1"
                                onClick={toggleAllDomains}
                            >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedDomains.size === (config.domains?.length || 0) && config.domains?.length ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                                    {selectedDomains.size === (config.domains?.length || 0) && <CheckSquare size={10} className="text-white" />}
                                </div>
                                Select All
                            </div>
                            {config.domains?.map(d => (
                                <div
                                    key={d.domain_name}
                                    className="flex items-center gap-2 p-2 hover:bg-zinc-800 rounded cursor-pointer text-sm text-zinc-400"
                                    onClick={() => toggleDomain(d.domain_name)}
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedDomains.has(d.domain_name) ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                                        {selectedDomains.has(d.domain_name) && <CheckSquare size={10} className="text-white" />}
                                    </div>
                                    {d.domain_name}
                                </div>
                            ))}
                        </Dropdown>
                    </div>

                    {/* Search */}
                    <div className="lg:col-span-2 relative">
                        <Search className="absolute left-3 top-3.5 text-zinc-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search by email or name..."
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-3 pl-10 pr-24 text-sm focus:border-indigo-500 outline-none transition"
                        />
                        {users.length > 0 && (
                            <div className="absolute right-3 top-3.5 text-xs text-zinc-500 font-mono bg-zinc-800 px-2 py-0.5 rounded">
                                {sortedFilteredUsers.length}/{users.length}
                            </div>
                        )}
                    </div>

                    {/* Fetch Button */}
                    <button
                        onClick={fetchUsers}
                        disabled={loadingUsers}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20"
                    >
                        {loadingUsers ? <RefreshCw className="animate-spin" size={18} /> : <Terminal size={18} />}
                        {loadingUsers ? "Fetching..." : "List Users"}
                    </button>
                </div>

                {/* Status Bar */}
                {opStatus && (
                    <div className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-lg flex items-center gap-2 text-sm text-zinc-300">
                        <Terminal size={14} className="text-emerald-500" />
                        <span className="font-mono">{opStatus}</span>
                    </div>
                )}

                {/* Toolbar */}
                <div className="flex flex-wrap gap-2 items-center bg-zinc-900/30 p-2 rounded-lg border border-zinc-800/50">
                    {/* Count Indicators */}
                    <div className="flex items-center gap-3 px-3 py-1.5 bg-zinc-800 rounded text-sm font-mono">
                        <span className="text-blue-400 font-semibold">{users.length} <span className="text-zinc-400 font-normal">users</span></span>
                        <span className="text-zinc-600">|</span>
                        <span className={selectedUsers.size > 0 ? "text-blue-400 font-semibold" : "text-zinc-500"}>
                            {selectedUsers.size} <span className="text-zinc-400 font-normal">selected</span>
                        </span>
                    </div>
                    <div className="h-4 w-px bg-zinc-700 mx-1"></div>
                    <button onClick={() => runBulkOp('verify')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 font-medium transition"><Shield size={14} /> Verify Suspensions</button>
                    <button onClick={() => runBulkOp('unsuspend')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-emerald-900/30 hover:text-emerald-400 rounded text-xs text-zinc-300 font-medium transition"><UserCheck size={14} /> Unsuspend</button>
                    <button onClick={() => runBulkOp('add_to_group')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-indigo-900/30 hover:text-indigo-400 rounded text-xs text-zinc-300 font-medium transition"><UserCheck size={14} /> Add to Group</button>
                    <button onClick={() => runBulkOp('protect')} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-blue-900/30 hover:text-blue-400 rounded text-xs text-zinc-300 font-medium transition"><ShieldAlert size={14} /> Protect Selected</button>
                    <div className="h-4 w-px bg-zinc-700 mx-1"></div>
                    <button
                        onClick={() => toggleColumnFilter('group', 'Not Member')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition ${columnFilters['group']?.has('Not Member') ? 'bg-amber-600/30 text-amber-400 border border-amber-500/50' : 'bg-zinc-800 hover:bg-amber-900/30 hover:text-amber-400 text-zinc-300'}`}
                    >
                        <UserMinus size={14} /> No Group
                    </button>
                    <div className="h-4 w-px bg-zinc-700 mx-2"></div>

                    {/* Smart Delete Button */}
                    {(() => {
                        const hasProtected = Array.from(selectedUsers).some(email => config.protected_users?.includes(email));
                        return (
                            <button
                                onClick={() => !hasProtected && runBulkOp('delete')}
                                disabled={hasProtected || selectedUsers.size === 0}
                                title={hasProtected ? "Cannot delete protected users" : "Delete selected users"}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition ${hasProtected
                                    ? "bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50"
                                    : "bg-red-900/20 hover:bg-red-900/40 text-red-400"
                                    }`}
                            >
                                <UserMinus size={14} /> {hasProtected ? "Delete Disabled (Protected)" : "Delete User(s)"}
                            </button>
                        );
                    })()}
                </div>

                {/* Table */}
                <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900">
                    <div className="overflow-x-auto max-h-[600px]">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-zinc-950 text-zinc-500 font-medium sticky top-0 z-10">
                                <tr>
                                    <th className="p-4 w-10">
                                        <input
                                            type="checkbox"
                                            className="rounded border-zinc-700 bg-zinc-800"
                                            checked={filteredUsers.length > 0 && selectedUsers.size === filteredUsers.length}
                                            onChange={() => selectAllUsers(filteredUsers)}
                                        />
                                    </th>
                                    <th className="p-4 cursor-pointer hover:bg-zinc-900" onClick={() => handleSort('email')}>
                                        <div className="flex items-center">
                                            User
                                            <SortIcon column="email" />
                                        </div>
                                    </th>
                                    <th className="p-4 cursor-pointer hover:bg-zinc-900" onClick={() => handleSort('status')}>
                                        <div className="flex items-center">
                                            Status
                                            <SortIcon column="status" />
                                            <ColumnFilter
                                                column="status"
                                                title="Filter Status"
                                                options={getUniqueValues('status')}
                                                selected={columnFilters['status']}
                                                onToggle={toggleColumnFilter}
                                                onClear={clearColumnFilter}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-4 cursor-pointer hover:bg-zinc-900" onClick={() => handleSort('domain')}>
                                        <div className="flex items-center">
                                            Domain
                                            <SortIcon column="domain" />
                                            <ColumnFilter
                                                column="domain"
                                                title="Filter Domain"
                                                options={getUniqueValues('domain')}
                                                selected={columnFilters['domain']}
                                                onToggle={toggleColumnFilter}
                                                onClear={clearColumnFilter}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-4 cursor-pointer hover:bg-zinc-900" onClick={() => handleSort('group')}>
                                        <div className="flex items-center">
                                            Group
                                            <SortIcon column="group" />
                                            <ColumnFilter
                                                column="group"
                                                title="Filter Group"
                                                options={getUniqueValues('group')}
                                                selected={columnFilters['group']}
                                                onToggle={toggleColumnFilter}
                                                onClear={clearColumnFilter}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-4 cursor-pointer hover:bg-zinc-900" onClick={() => handleSort('json')}>
                                        <div className="flex items-center">
                                            JSON Key
                                            <SortIcon column="json" />
                                            <ColumnFilter
                                                column="json"
                                                title="Filter JSON Key"
                                                options={getUniqueValues('json')}
                                                selected={columnFilters['json']}
                                                onToggle={toggleColumnFilter}
                                                onClear={clearColumnFilter}
                                            />
                                        </div>
                                    </th>
                                    <th className="p-4">ID</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/50">
                                {sortedFilteredUsers.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="p-8 text-center text-zinc-600 italic">
                                            {loadingUsers ? "Loading users..." : "No users found. Select domains and click List Users."}
                                        </td>
                                    </tr>
                                ) : (
                                    sortedFilteredUsers.map((u, i) => {
                                        const isProtected = config.protected_users?.includes(u.email);
                                        return (
                                            <tr key={i} className={`group hover:bg-zinc-800/50 transition ${selectedUsers.has(u.email) ? 'bg-indigo-900/10' : ''}`}>
                                                <td className="p-4">
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-zinc-700 bg-zinc-800"
                                                        checked={selectedUsers.has(u.email)}
                                                        onChange={() => toggleUser(u.email)}
                                                    />
                                                </td>
                                                <td className="p-4">
                                                    <div
                                                        className="font-medium text-zinc-200 flex items-center gap-2 cursor-pointer hover:text-white transition"
                                                        onClick={() => copyText(u.name?.fullName || u.email.split('@')[0])}
                                                        title="Click to copy name"
                                                    >
                                                        {u.name?.fullName || u.email.split('@')[0]}
                                                        {isProtected && (
                                                            <span className="bg-purple-900/30 border border-purple-500/30 text-purple-400 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" title="Protected User">
                                                                <Shield size={10} /> Protected
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div
                                                        className="text-xs text-indigo-300 font-mono cursor-pointer hover:text-indigo-200 transition"
                                                        onClick={() => copyText(u.email)}
                                                        title="Click to copy email"
                                                    >
                                                        {u.email}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    {u.suspended ? (
                                                        <span onClick={() => copyText("Suspended")} className="px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-500 border border-red-500/20 cursor-pointer hover:bg-red-500/20" title="Click to copy status">Suspended</span>
                                                    ) : (
                                                        <span onClick={() => copyText("Active")} className="px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20" title="Click to copy status">Active</span>
                                                    )}
                                                </td>
                                                <td
                                                    className="p-4 text-xs text-indigo-300 cursor-pointer hover:text-indigo-200"
                                                    onClick={() => copyText(u._sourceDomain)}
                                                    title="Click to copy domain"
                                                >
                                                    {u._sourceDomain || 'N/A'}
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className="text-xs font-mono text-indigo-300 cursor-pointer hover:text-indigo-200"
                                                            onClick={() => copyText(u._groupEmail)}
                                                            title="Click to copy group email"
                                                        >
                                                            {u._groupEmail}
                                                        </span>
                                                        {u._groupEmail !== 'N/A' && (
                                                            u.in_group
                                                                ? <span title="Member"><CheckSquare size={14} className="text-emerald-500" /></span>
                                                                : <span className="text-red-500 font-bold text-xs" title="Not a Member">✕</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td
                                                    className="p-4 text-xs font-mono text-indigo-300 cursor-pointer hover:text-indigo-200"
                                                    onClick={() => copyText(u._jsonKey)}
                                                    title="Click to copy JSON key"
                                                >
                                                    {u._jsonKey}
                                                </td>
                                                <td
                                                    className="p-4 text-xs font-mono text-indigo-300 cursor-pointer hover:text-indigo-200"
                                                    onClick={() => copyText(u.id)}
                                                    title="Click to copy ID"
                                                >
                                                    {u.id}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <button onClick={() => {
                                                        copyText(u.email);
                                                    }} className="text-zinc-600 hover:text-white transition p-1"><Copy size={14} /></button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-2 border-t border-zinc-800 bg-zinc-950 text-xs text-zinc-500 flex justify-between">
                        <span>Showing {sortedFilteredUsers.length} of {users.length} users</span>
                        <span>{selectedUsers.size} selected</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserManagement;
