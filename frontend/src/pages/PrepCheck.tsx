import { useState, useEffect } from 'react';
import {
    CheckCircle2, XCircle, AlertTriangle, RefreshCw, Download,
    Terminal, Cloud, Server, FileJson, Key, Settings, Folder,
    ChevronDown, ChevronRight, Loader2, Wrench, ExternalLink
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import axios from 'axios';

const API_BASE = '/api';

interface PrerequisiteCheck {
    name: string;
    status: 'ok' | 'warning' | 'error' | 'missing';
    message?: string;
    version?: string;
    suggestion?: string;
    auto_fix?: string;
    docs_url?: string;
    [key: string]: any;
}

interface PrepCheckResponse {
    status: 'ok' | 'warning' | 'error';
    ready_to_run: boolean;
    local: Record<string, PrerequisiteCheck>;
    remote: any[];
    issues: any[];
    summary: {
        total: number;
        ok: number;
        warnings: number;
        errors: number;
    };
}

const statusIcon = (status: string) => {
    switch (status) {
        case 'ok': return <CheckCircle2 size={18} className="text-emerald-400" />;
        case 'warning': return <AlertTriangle size={18} className="text-amber-400" />;
        case 'error': return <XCircle size={18} className="text-red-400" />;
        default: return <AlertTriangle size={18} className="text-zinc-500" />;
    }
};

const categoryIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('python')) return <Terminal size={16} />;
    if (lower.includes('pip') || lower.includes('package')) return <Download size={16} />;
    if (lower.includes('rclone') || lower.includes('fclone')) return <Cloud size={16} />;
    if (lower.includes('google')) return <Cloud size={16} />;
    if (lower.includes('ssh')) return <Server size={16} />;
    if (lower.includes('node')) return <FileJson size={16} />;
    if (lower.includes('config')) return <Settings size={16} />;
    if (lower.includes('key')) return <Key size={16} />;
    if (lower.includes('domain')) return <Folder size={16} />;
    if (lower.includes('remote')) return <Cloud size={16} />;
    return <Settings size={16} />;
};

const PrepCheck = () => {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<PrepCheckResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
    const [installing, setInstalling] = useState<string | null>(null);

    const runCheck = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_BASE}/prep/check`);
            setResult(res.data);
        } catch (e: any) {
            setError(e.message || 'Failed to run prep check');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        runCheck();
    }, []);

    const handleInstall = async (autoFix: string) => {
        setInstalling(autoFix);
        try {
            if (autoFix === 'install_pip_packages') {
                await axios.post(`${API_BASE}/prep/install/packages`);
            } else if (autoFix === 'install_google_api') {
                await axios.post(`${API_BASE}/prep/install/google-api`);
            }
            // Re-run check after install
            await runCheck();
        } catch (e: any) {
            setError(`Install failed: ${e.message}`);
        } finally {
            setInstalling(null);
        }
    };

    const toggleIssue = (id: string) => {
        const next = new Set(expandedIssues);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setExpandedIssues(next);
    };

    const checks = result ? Object.values(result.local) : [];

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            <PageHeader
                icon={Wrench}
                title="System Prep Check"
                subtitle="Validate prerequisites and system readiness"
                gradient="from-cyan-600 to-teal-600"
            />

            {/* Summary Banner */}
            {result && (
                <div className={`rounded-xl p-4 border ${result.ready_to_run
                        ? 'bg-emerald-900/20 border-emerald-700'
                        : result.status === 'warning'
                            ? 'bg-amber-900/20 border-amber-700'
                            : 'bg-red-900/20 border-red-700'
                    }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {result.ready_to_run
                                ? <CheckCircle2 size={24} className="text-emerald-400" />
                                : result.status === 'warning'
                                    ? <AlertTriangle size={24} className="text-amber-400" />
                                    : <XCircle size={24} className="text-red-400" />
                            }
                            <div>
                                <div className="font-bold text-lg">
                                    {result.ready_to_run
                                        ? 'System Ready'
                                        : result.status === 'warning'
                                            ? 'Ready with Warnings'
                                            : 'Setup Required'
                                    }
                                </div>
                                <div className="text-sm text-zinc-400">
                                    {result.summary.ok} OK • {result.summary.warnings} Warnings • {result.summary.errors} Errors
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={runCheck}
                            disabled={loading}
                            className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded-lg text-sm transition"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            {loading ? 'Checking...' : 'Re-check'}
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
                    {error}
                </div>
            )}

            {/* Prerequisites List */}
            <Card>
                <h3 className="text-lg font-bold text-zinc-200 mb-4">Local System Prerequisites</h3>

                {loading && !result ? (
                    <div className="flex items-center justify-center py-12 text-zinc-500">
                        <Loader2 size={24} className="animate-spin mr-2" />
                        Running checks...
                    </div>
                ) : (
                    <div className="space-y-2">
                        {checks.map((check) => (
                            <div
                                key={check.name}
                                className={`rounded-lg border transition ${check.status === 'ok'
                                        ? 'bg-zinc-800/30 border-zinc-700/50'
                                        : check.status === 'warning'
                                            ? 'bg-amber-900/10 border-amber-700/50'
                                            : 'bg-red-900/10 border-red-700/50'
                                    }`}
                            >
                                <div className="flex items-center justify-between p-3">
                                    <div className="flex items-center gap-3">
                                        {statusIcon(check.status)}
                                        <span className="text-zinc-400">
                                            {categoryIcon(check.name)}
                                        </span>
                                        <div>
                                            <div className="font-medium text-sm">{check.name}</div>
                                            <div className="text-xs text-zinc-500">{check.message}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {check.auto_fix && (
                                            <button
                                                onClick={() => handleInstall(check.auto_fix!)}
                                                disabled={installing === check.auto_fix}
                                                className="flex items-center gap-1 px-2 py-1 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 rounded text-xs transition"
                                            >
                                                {installing === check.auto_fix ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Download size={12} />
                                                )}
                                                Install
                                            </button>
                                        )}
                                        {check.docs_url && (
                                            <a
                                                href={check.docs_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-zinc-500 hover:text-zinc-300 transition"
                                            >
                                                <ExternalLink size={14} />
                                            </a>
                                        )}
                                        {check.suggestion && (
                                            <button
                                                onClick={() => toggleIssue(check.name)}
                                                className="text-zinc-500 hover:text-zinc-300"
                                            >
                                                {expandedIssues.has(check.name)
                                                    ? <ChevronDown size={16} />
                                                    : <ChevronRight size={16} />
                                                }
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {check.suggestion && expandedIssues.has(check.name) && (
                                    <div className="px-3 pb-3 pt-0">
                                        <div className="p-2 bg-zinc-900/50 rounded text-xs font-mono text-zinc-400">
                                            💡 {check.suggestion}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Issues Summary */}
            {result && result.issues.length > 0 && (
                <Card>
                    <h3 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
                        <AlertTriangle size={18} />
                        Action Required ({result.issues.length})
                    </h3>
                    <div className="space-y-2">
                        {result.issues.map((issue: any) => (
                            <div
                                key={issue.id}
                                className={`rounded-lg p-3 ${issue.severity === 'error'
                                        ? 'bg-red-900/20 border border-red-700/50'
                                        : 'bg-amber-900/20 border border-amber-700/50'
                                    }`}
                            >
                                <div className="flex items-start gap-3">
                                    {statusIcon(issue.severity)}
                                    <div className="flex-1">
                                        <div className="font-medium text-sm">{issue.name}</div>
                                        <div className="text-xs text-zinc-400">{issue.message}</div>
                                        {issue.suggestion && (
                                            <div className="mt-2 text-xs font-mono text-zinc-500">
                                                → {issue.suggestion}
                                            </div>
                                        )}
                                    </div>
                                    {issue.auto_fix && (
                                        <button
                                            onClick={() => handleInstall(issue.auto_fix)}
                                            disabled={installing === issue.auto_fix}
                                            className="flex items-center gap-1 px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs transition"
                                        >
                                            {installing === issue.auto_fix ? (
                                                <Loader2 size={12} className="animate-spin" />
                                            ) : (
                                                <Wrench size={12} />
                                            )}
                                            Fix
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Help Section */}
            <Card>
                <h3 className="text-lg font-bold text-zinc-200 mb-4">Quick Setup Commands</h3>
                <div className="space-y-3">
                    <div>
                        <div className="text-xs text-zinc-400 mb-1">Ubuntu/Debian - Install all prerequisites:</div>
                        <code className="block bg-zinc-900 rounded p-2 text-xs font-mono text-cyan-300">
                            sudo apt update && sudo apt install -y python3 python3-pip python3-venv nodejs npm rclone openssh-client
                        </code>
                    </div>
                    <div>
                        <div className="text-xs text-zinc-400 mb-1">Install Python packages:</div>
                        <code className="block bg-zinc-900 rounded p-2 text-xs font-mono text-cyan-300">
                            pip install -r requirements.txt
                        </code>
                    </div>
                    <div>
                        <div className="text-xs text-zinc-400 mb-1">Install Google API libraries:</div>
                        <code className="block bg-zinc-900 rounded p-2 text-xs font-mono text-cyan-300">
                            pip install google-api-python-client google-auth
                        </code>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default PrepCheck;
