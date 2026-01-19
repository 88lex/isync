import { useState, useEffect } from 'react';
import { Key, Shield, Trash2, Search, CheckCircle, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import { listJSONKeys, inspectJSONKey, deleteJSONKey, extractKeyAttributes, KeyInfo, KeyInspection, KeyAttributes } from '../api';
import { Card } from '../components/Card';
import { Button, Input } from '../components/ui';

const KeyManager = () => {
    const [keys, setKeys] = useState<KeyInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [inspecting, setInspecting] = useState<string | null>(null);
    const [extracting, setExtracting] = useState<string | null>(null);
    const [inspectionResults, setInspectionResults] = useState<Record<string, KeyInspection>>({});
    const [attributeResults, setAttributeResults] = useState<Record<string, KeyAttributes>>({});

    useEffect(() => {
        loadKeys();
    }, []);

    const loadKeys = async () => {
        setLoading(true);
        try {
            const data = await listJSONKeys();
            setKeys(data);
        } catch (e) {
            console.error("Failed to list keys", e);
        } finally {
            setLoading(false);
        }
    };

    const handleInspect = async (filename: string) => {
        setInspecting(filename);
        try {
            // Find the key info to get admin_email if available
            const keyInfo = keys.find(k => k.filename === filename);
            const result = await inspectJSONKey(filename, keyInfo?.admin_email);
            setInspectionResults(prev => ({ ...prev, [filename]: result }));
        } catch (e) {
            alert("Inspection failed");
        } finally {
            setInspecting(null);
        }
    };

    const handleExtract = async (filename: string) => {
        setExtracting(filename);
        try {
            const result = await extractKeyAttributes(filename);
            setAttributeResults(prev => ({ ...prev, [filename]: result }));
        } catch (e) {
            alert("Extraction failed");
        } finally {
            setExtracting(null);
        }
    };

    const handleDelete = async (filename: string) => {
        if (!confirm(`Delete key ${filename}? This cannot be undone.`)) return;
        try {
            await deleteJSONKey(filename);
            await loadKeys();
        } catch (e) {
            alert("Delete failed");
        }
    };

    const filteredKeys = keys.filter(k =>
        k.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (k.client_email && k.client_email.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="page-container pb-16">
            <header className="page-header">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-600 to-orange-600 flex items-center justify-center">
                        <Key size={16} className="text-white" />
                    </div>
                    <div>
                        <h1 className="page-title">Manage JSON Keys</h1>
                        <p className="text-xs text-zinc-400">Service Account Credentials</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={loadKeys} icon={<RefreshCw size={12} />} />
                </div>
            </header>

            <div className="flex items-center gap-4 mb-6 bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                    <input
                        type="text"
                        placeholder="Search keys by filename or email..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded pl-9 pr-3 py-2 text-sm focus:border-amber-500 transition-colors"
                    />
                </div>
                <div className="text-xs text-zinc-500 font-mono">
                    {filteredKeys.length} keys found
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {filteredKeys.map(key => (
                    <Card key={key.filename} className="group hover:border-zinc-600 transition-colors">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-sm font-bold text-white font-mono">{key.filename}</h3>
                                    {key.valid_json ? (
                                        <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded border border-emerald-900/50">Valid JSON</span>
                                    ) : (
                                        <span className="text-[10px] bg-red-900/30 text-red-400 px-2 py-0.5 rounded border border-red-900/50">Invalid</span>
                                    )}
                                </div>

                                {key.client_email && (
                                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                                        <span className="text-zinc-500">Email:</span>
                                        <span className="text-zinc-300 font-mono select-all">{key.client_email}</span>
                                    </div>
                                )}
                                {key.project_id && (
                                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                                        <span className="text-zinc-500">Project:</span>
                                        <span className="text-zinc-300">{key.project_id}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-start gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleInspect(key.filename)}
                                    loading={inspecting === key.filename}
                                    icon={<Shield size={12} />}
                                >
                                    Inspect Roles
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleExtract(key.filename)}
                                    loading={extracting === key.filename}
                                    icon={<Eye size={12} />}
                                >
                                    Extract Attributes
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                                    onClick={() => handleDelete(key.filename)}
                                    icon={<Trash2 size={12} />}
                                />
                            </div>
                        </div>

                        {/* Inspection Results */}
                        {inspectionResults[key.filename] && (
                            <div className="mt-4 pt-4 border-t border-zinc-800 animate-in fade-in slide-in-from-top-2">
                                <div className="bg-zinc-950/50 rounded-lg p-3 border border-zinc-800">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                                <Shield size={12} />
                                                IAM Project Roles
                                            </h4>
                                            {inspectionResults[key.filename].status === 'success' ? (
                                                <div className="space-y-1">
                                                    {inspectionResults[key.filename].roles.length > 0 ? (
                                                        inspectionResults[key.filename].roles.map(role => (
                                                            <div key={role} className="text-xs font-mono text-zinc-300 flex items-center gap-2">
                                                                <CheckCircle size={10} className="text-emerald-500" />
                                                                {role}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="text-xs text-zinc-500 italic">No direct roles found on project.</div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-red-400 flex items-center gap-2">
                                                    <AlertCircle size={12} />
                                                    Inspection failed: {inspectionResults[key.filename].details}
                                                </div>
                                            )}
                                        </div>

                                        {inspectionResults[key.filename].status === 'success' && (
                                            <div>
                                                <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                                    <Shield size={12} />
                                                    Domain-Wide Delegation
                                                </h4>
                                                <div className="space-y-2">
                                                    {inspectionResults[key.filename].dwd_verified ? (
                                                        inspectionResults[key.filename].dwd_enabled ? (
                                                            <>
                                                                <div className="text-xs text-emerald-400 flex items-center gap-2 bg-emerald-900/20 px-2 py-1 rounded inline-flex">
                                                                    <CheckCircle size={12} />
                                                                    Active & Authorized
                                                                </div>
                                                                <div className="mt-2">
                                                                    <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Verified Scopes</div>
                                                                    {inspectionResults[key.filename].dwd_scopes?.map(scope => (
                                                                        <div key={scope} className="text-[10px] font-mono text-zinc-400 truncate" title={scope}>
                                                                            • {scope.replace('https://www.googleapis.com/auth/', '')}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="text-xs text-red-400 flex items-center gap-2 bg-red-900/20 px-2 py-1 rounded inline-flex">
                                                                <AlertCircle size={12} />
                                                                Authorization Failed
                                                            </div>
                                                        )
                                                    ) : (
                                                        <div className="text-xs text-zinc-500 italic">
                                                            Cannot verify DWD (no admin email linked in Config)
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Attribute Results */}
                        {attributeResults[key.filename] && (
                            <div className="mt-4 pt-4 border-t border-zinc-800 animate-in fade-in slide-in-from-top-2">
                                <div className="bg-zinc-950/50 rounded-lg p-3 border border-zinc-800">
                                    <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <Eye size={12} />
                                        Key Attributes
                                    </h4>
                                    {attributeResults[key.filename].status === 'success' ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                                            {Object.entries(attributeResults[key.filename].attributes).map(([k, v]) => (
                                                <div key={k} className="flex flex-col border-b border-zinc-800/50 pb-1 last:border-0">
                                                    <span className="text-[10px] text-zinc-500 uppercase font-bold">{k.replace(/_/g, ' ')}</span>
                                                    <span className="text-xs font-mono text-zinc-300 break-all">{String(v)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-red-400 flex items-center gap-2">
                                            <AlertCircle size={12} />
                                            Extraction failed: {attributeResults[key.filename].details}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </Card>
                ))}

                {filteredKeys.length === 0 && !loading && (
                    <div className="text-center py-12 text-zinc-500">
                        No keys found matching your criteria.
                    </div>
                )}
            </div>
        </div>
    );
};

export default KeyManager;
