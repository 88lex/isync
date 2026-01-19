import React, { useEffect, useState, useMemo } from 'react';
import { ShieldAlert, Trash2, Plus, RefreshCw, Save, Search, X, ArrowUpDown } from 'lucide-react';
import * as api from '../api';
import { DataTable } from '../components/ui/DataTable';
import { useSortableData } from '../hooks/useSortableData';
import { Card } from '../components/Card';

interface ExcludedItem {
    id: string;
    name: string;
}

export default function ManageExcluded() {
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [drives, setDrives] = useState<string[]>([]);
    const [remotes, setRemotes] = useState<string[]>([]);

    // Convert to objects for DataTable
    const driveItems = useMemo(() => drives.map(d => ({ id: d, name: d })), [drives]);
    const remoteItems = useMemo(() => remotes.map(r => ({ id: r, name: r })), [remotes]);

    const [selectedDrives, setSelectedDrives] = useState<Set<string>>(new Set());
    const [selectedRemotes, setSelectedRemotes] = useState<Set<string>>(new Set());

    const [newDrive, setNewDrive] = useState('');
    const [newRemote, setNewRemote] = useState('');
    const [driveFilter, setDriveFilter] = useState('');
    const [remoteFilter, setRemoteFilter] = useState('');

    // Sorting
    const { sortedData: sortedDrives, handleSort: sortDrives, SortIcon: DriveSortIcon } = useSortableData({ data: driveItems });
    const { sortedData: sortedRemotes, handleSort: sortRemotes, SortIcon: RemoteSortIcon } = useSortableData({ data: remoteItems });

    const loadConfig = async () => {
        setLoading(true);
        try {
            const res = await api.fetchConfig();
            setConfig(res);
            setDrives(res.excluded_drives || []);
            setRemotes(res.excluded_remotes || []);
            setSelectedDrives(new Set());
            setSelectedRemotes(new Set());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadConfig();
    }, []);

    const saveExclusions = async (updatedDrives: string[], updatedRemotes: string[]) => {
        try {
            await api.updateConfig({
                excluded_drives: updatedDrives,
                excluded_remotes: updatedRemotes
            });
            setConfig((prev: any) => ({
                ...prev,
                excluded_drives: updatedDrives,
                excluded_remotes: updatedRemotes
            }));
            setDrives(updatedDrives);
            setRemotes(updatedRemotes);
        } catch (err) {
            console.error("Failed to save exclusions", err);
            alert("Failed to save exclusions");
        }
    };

    const addDrive = () => {
        if (!newDrive.trim()) return;
        const next = [...drives, newDrive.trim()];
        saveExclusions(next, remotes);
        setNewDrive('');
    };

    const removeDrive = (name: string) => {
        const next = drives.filter(d => d !== name);
        saveExclusions(next, remotes);
        const nextSel = new Set(selectedDrives);
        nextSel.delete(name);
        setSelectedDrives(nextSel);
    };

    const addRemote = () => {
        if (!newRemote.trim()) return;
        const next = [...remotes, newRemote.trim()];
        saveExclusions(drives, next);
        setNewRemote('');
    };

    const removeRemote = (name: string) => {
        const next = remotes.filter(r => r !== name);
        saveExclusions(drives, next);
        const nextSel = new Set(selectedRemotes);
        nextSel.delete(name);
        setSelectedRemotes(nextSel);
    };

    const handleBulkRemoveDrives = () => {
        const next = drives.filter(d => !selectedDrives.has(d));
        saveExclusions(next, remotes);
        setSelectedDrives(new Set());
    };

    const handleBulkRemoveRemotes = () => {
        const next = remotes.filter(r => !selectedRemotes.has(r));
        saveExclusions(drives, next);
        setSelectedRemotes(new Set());
    };

    if (loading && !config) return <div className="p-8 text-zinc-400">Loading configuration...</div>;

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-red-500/10 rounded-lg">
                    <ShieldAlert className="text-red-400" size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-zinc-100">Manage Exclusions</h1>
                    <p className="text-zinc-400 text-sm">
                        Items listed here are globally ignored by iSync.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Drives Column */}
                <Card className="flex flex-col h-[600px]">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                            Excluded Shared Drives
                            <span className="text-xs font-normal text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                                {drives.length}
                            </span>
                        </h2>
                        {selectedDrives.size > 0 && (
                            <button onClick={handleBulkRemoveDrives} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                                <Trash2 size={12} /> Remove {selectedDrives.size}
                            </button>
                        )}
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            value={newDrive}
                            onChange={e => setNewDrive(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addDrive()}
                            placeholder="Enter Drive ID/Name"
                            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                        />
                        <button onClick={addDrive} disabled={!newDrive.trim()} className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm">
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="mb-2 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                            value={driveFilter}
                            onChange={e => setDriveFilter(e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-zinc-900 border border-zinc-800 rounded pl-9 pr-2 py-1.5 text-xs text-zinc-300"
                        />
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col">
                        <DataTable
                            data={sortedDrives.filter(d => d.name.toLowerCase().includes(driveFilter.toLowerCase()))}
                            columns={[
                                {
                                    key: 'name',
                                    header: 'Drive Name/ID',
                                    sortable: true,
                                    render: (val) => <span className="font-mono text-xs">{val}</span>
                                },
                                {
                                    key: 'actions',
                                    header: '',
                                    render: (_, item) => (
                                        <div className="flex justify-end">
                                            <button onClick={(e) => { e.stopPropagation(); removeDrive(item.name); }} className="text-zinc-500 hover:text-red-400 p-1">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )
                                }
                            ]}
                            selectedItems={selectedDrives}
                            onToggleItem={(id) => {
                                const next = new Set(selectedDrives);
                                if (next.has(id as string)) next.delete(id as string);
                                else next.add(id as string);
                                setSelectedDrives(next);
                            }}
                            onSelectAll={() => {
                                const filtered = sortedDrives.filter(d => d.name.toLowerCase().includes(driveFilter.toLowerCase()));
                                if (selectedDrives.size === filtered.length) setSelectedDrives(new Set());
                                else setSelectedDrives(new Set(filtered.map(d => d.id)));
                            }}
                            handleSort={sortDrives}
                            SortIcon={DriveSortIcon}
                            columnFilters={{}}
                            onToggleColumnFilter={() => { }}
                            onClearColumnFilter={() => { }}
                            getUniqueValues={() => []}
                            rowIdKey="id"
                            isLoading={false}
                        />
                    </div>
                </Card>

                {/* Remotes Column */}
                <Card className="flex flex-col h-[600px]">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                            Excluded Rclone Remotes
                            <span className="text-xs font-normal text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                                {remotes.length}
                            </span>
                        </h2>
                        {selectedRemotes.size > 0 && (
                            <button onClick={handleBulkRemoveRemotes} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                                <Trash2 size={12} /> Remove {selectedRemotes.size}
                            </button>
                        )}
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            value={newRemote}
                            onChange={e => setNewRemote(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addRemote()}
                            placeholder="Enter Remote Name"
                            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                        />
                        <button onClick={addRemote} disabled={!newRemote.trim()} className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm">
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="mb-2 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                            value={remoteFilter}
                            onChange={e => setRemoteFilter(e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-zinc-900 border border-zinc-800 rounded pl-9 pr-2 py-1.5 text-xs text-zinc-300"
                        />
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col">
                        <DataTable
                            data={sortedRemotes.filter(r => r.name.toLowerCase().includes(remoteFilter.toLowerCase()))}
                            columns={[
                                {
                                    key: 'name',
                                    header: 'Remote Name',
                                    sortable: true,
                                    render: (val) => <span className="font-mono text-xs">{val}</span>
                                },
                                {
                                    key: 'actions',
                                    header: '',
                                    render: (_, item) => (
                                        <div className="flex justify-end">
                                            <button onClick={(e) => { e.stopPropagation(); removeRemote(item.name); }} className="text-zinc-500 hover:text-red-400 p-1">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )
                                }
                            ]}
                            selectedItems={selectedRemotes}
                            onToggleItem={(id) => {
                                const next = new Set(selectedRemotes);
                                if (next.has(id as string)) next.delete(id as string);
                                else next.add(id as string);
                                setSelectedRemotes(next);
                            }}
                            onSelectAll={() => {
                                const filtered = sortedRemotes.filter(r => r.name.toLowerCase().includes(remoteFilter.toLowerCase()));
                                if (selectedRemotes.size === filtered.length) setSelectedRemotes(new Set());
                                else setSelectedRemotes(new Set(filtered.map(r => r.id)));
                            }}
                            handleSort={sortRemotes}
                            SortIcon={RemoteSortIcon}
                            columnFilters={{}}
                            onToggleColumnFilter={() => { }}
                            onClearColumnFilter={() => { }}
                            getUniqueValues={() => []}
                            rowIdKey="id"
                            isLoading={false}
                        />
                    </div>
                </Card>
            </div>
        </div>
    );
}
