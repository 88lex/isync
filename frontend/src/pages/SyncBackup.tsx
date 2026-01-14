import { useState, useEffect } from 'react';
import { Download, Upload, Server, FileDiff, RefreshCw } from 'lucide-react';
import { createBackup, syncPush, syncPull, syncDiff, fetchConfig } from '../api';

const SyncBackup = () => {
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);
    const [sshEnabled, setSshEnabled] = useState(false);
    const [diffs, setDiffs] = useState<Record<string, string> | null>(null);

    useEffect(() => {
        fetchConfig().then(c => setSshEnabled(!!c.ssh_enabled));
    }, []);

    const handleBackup = async () => {
        setLoading(true);
        setStatus("Creating backup...");
        try {
            const res = await createBackup();
            setStatus(`✅ Backup created: ${res.file}`);
        } catch (e: any) {
            setStatus(`❌ Backup Failed: ${e.response?.data?.detail || e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handlePush = async () => {
        if (!confirm("Overwrite REMOTE config with LOCAL?")) return;
        setLoading(true);
        setStatus("Pushing to remote...");
        try {
            const config = await fetchConfig();
            const res = await syncPush({
                host: config.ssh_host || '',
                user: config.ssh_user,
                key_path: config.ssh_key_path,
                remote_path: config.ssh_remote_path,
                timeout: config.ssh_connect_timeout || 10
            });
            setStatus(`Push Result: ${JSON.stringify(res.details || res)}`);
        } catch (e: any) {
            setStatus(`❌ Push Failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handlePull = async () => {
        if (!confirm("Overwrite LOCAL config with REMOTE?")) return;
        setLoading(true);
        setStatus("Pulling from remote...");
        try {
             const config = await fetchConfig();
            const res = await syncPull({
                host: config.ssh_host || '',
                user: config.ssh_user,
                key_path: config.ssh_key_path,
                remote_path: config.ssh_remote_path,
                timeout: config.ssh_connect_timeout || 10
            });
            setStatus(`✅ Pull Complete: ${res.message}`);
        } catch (e: any) {
            setStatus(`❌ Pull Failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDiff = async () => {
        setLoading(true);
        setStatus("Comparing files...");
        try {
             const config = await fetchConfig();
            const res = await syncDiff({
                host: config.ssh_host || '',
                user: config.ssh_user,
                key_path: config.ssh_key_path,
                remote_path: config.ssh_remote_path,
                timeout: config.ssh_connect_timeout || 10
            });
            setDiffs(res.diffs);
            setStatus("✅ Comparison Complete");
        } catch (e: any) {
            setStatus(`❌ Diff Failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 text-zinc-100">
             <header>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Backup & Remote Sync</h1>
                <p className="text-zinc-400 text-sm mt-1">Manage backups and synchronize configuration with remote servers.</p>
            </header>

            {status && (
                <div className="bg-zinc-900 border border-zinc-700 p-4 rounded-lg font-mono text-sm whitespace-pre-wrap text-zinc-300">
                    {status}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Local Backup */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Download className="text-blue-500" /> Local Backup
                    </h2>
                    <p className="text-zinc-400 text-sm">Creates a zip archive of current config, sync list, and keys.</p>
                    <button 
                        onClick={handleBackup} disabled={loading}
                        className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold transition flex items-center justify-center gap-2"
                    >
                        {loading ? <RefreshCw className="animate-spin"/> : <Download size={18} />} Create Backup
                    </button>
                </div>

                {/* Remote Sync */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Server className={sshEnabled ? "text-green-500" : "text-red-500"} /> Remote Sync
                    </h2>
                    {!sshEnabled ? (
                        <div className="text-red-400 bg-red-900/20 p-3 rounded border border-red-900/50 text-sm">
                            ⚠️ SSH is disabled in Configuration. Enable it to use these features.
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                onClick={handlePush} disabled={loading}
                                className="py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold transition flex items-center justify-center gap-2"
                            >
                                <Upload size={18} /> Push to Remote
                            </button>
                            <button 
                                onClick={handlePull} disabled={loading}
                                className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold transition flex items-center justify-center gap-2"
                            >
                                <Download size={18} /> Pull from Remote
                            </button>
                            <button 
                                onClick={handleDiff} disabled={loading}
                                className="col-span-2 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold transition flex items-center justify-center gap-2"
                            >
                                <FileDiff size={18} /> Compare Configs
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Diff Viewer */}
            {diffs && (
                <div className="space-y-4">
                    <h3 className="text-xl font-bold">Configuration Differences</h3>
                    {Object.entries(diffs).map(([fname, diffContent]) => (
                        <div key={fname} className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                             <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 font-bold text-sm text-zinc-400">
                                {fname}
                            </div>
                            <div className="p-4 overflow-x-auto">
                                <pre className={`font-mono text-xs ${diffContent === "Identical" ? "text-green-500" : "text-yellow-500"}`}>
                                    {diffContent}
                                </pre>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SyncBackup;
