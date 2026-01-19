import React, { useEffect, useState, useRef } from 'react';
import { Play, Square, Server, Activity, Terminal, AlertTriangle, CheckCircle, XCircle, RotateCcw, ChevronDown } from 'lucide-react';
import { startJob, stopJob, fetchSyncList, SyncPair, fetchStepStatus, submitStepAction, fetchJobPreview, restartBackend, restartFrontend, restartAll } from '../api';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { Dropdown, DropdownItem, DropdownDivider } from '../components/Dropdown';
import { Button, SelectionControls } from '../components/ui';

const Dashboard = () => {
  const [status, setStatus] = useState<any>({ is_running: false, mode: 'IDLE' });
  const [stepStatus, setStepStatus] = useState<any>({ status: 'IDLE', step: '', detail: '' });
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSyncList().then(data => {
      setPairs(data);
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_INDICES);
        if (saved) {
          const indices = JSON.parse(saved);
          if (Array.isArray(indices)) {
            const validIndices = new Set(indices.filter((i: any) => typeof i === 'number' && i >= 0 && i < data.length));
            setSelectedIndices(validIndices);
            return;
          }
        }
      } catch (e) { console.error("Failed to load persistence", e); }
      setSelectedIndices(new Set(data.map((_, i) => i)));
    }).catch(console.error);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/status`;
    let ws: WebSocket;

    const connectWs = () => {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => console.log("WS Connected");
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setStatus(data);
          if (data.status_msg) {
            setLogs(prev => [data.status_msg, ...prev].slice(0, 50));
          }
        } catch (e) { console.error("WS Parse Error", e); }
      };
      ws.onclose = () => setTimeout(connectWs, 3000);
    };
    connectWs();

    const interval = setInterval(async () => {
      try {
        const s = await fetchStepStatus();
        setStepStatus(s);
      } catch (e) { console.error(e); }
    }, 1000);

    return () => {
      if (ws) ws.close();
      clearInterval(interval);
    };
  }, []);

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [previews, setPreviews] = useState<any[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const toggleJob = async () => {
    if (status.is_running) {
      await stopJob();
    } else {
      if (selectedIndices.size === 0) {
        alert("Please select at least one sync target.");
        return;
      }
      setLoadingPreview(true);
      const selectedPairs = pairs.filter((_, i) => selectedIndices.has(i));
      try {
        const previewData = await fetchJobPreview(selectedPairs);
        setPreviews(previewData);
        setShowConfirm(true);
      } catch (e) {
        alert("Failed to fetch job preview.");
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  const confirmStartJob = async () => {
    setShowConfirm(false);
    const selectedPairs = pairs.filter((_, i) => selectedIndices.has(i));
    await startJob({ pairs: selectedPairs, dry_run: false });
  };

  const toggleSelection = (idx: number, shiftKey: boolean = false) => {
    const newSet = new Set(selectedIndices);
    if (shiftKey && lastClickedIdx !== null) {
      const start = Math.min(lastClickedIdx, idx);
      const end = Math.max(lastClickedIdx, idx);
      for (let i = start; i <= end; i++) {
        newSet.add(i);
      }
    } else {
      if (newSet.has(idx)) newSet.delete(idx);
      else newSet.add(idx);
      setLastClickedIdx(idx);
    }
    setSelectedIndices(newSet);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INDICES, JSON.stringify(Array.from(newSet)));
  };

  const handleStepAction = async (action: 'CONTINUE' | 'ABORT') => {
    try {
      await submitStepAction(action);
    } catch (e) { alert("Failed to submit action"); }
  };

  const [restarting, setRestarting] = useState<string | null>(null);

  const handleRestart = async (type: 'backend' | 'frontend' | 'all') => {
    setRestarting(type);
    try {
      if (type === 'backend') {
        await restartBackend();
        alert('Backend restart initiated.');
      } else if (type === 'frontend') {
        await restartFrontend();
        alert('Frontend restart initiated. Refresh page shortly.');
      } else {
        await restartAll();
        alert('Full restart initiated. Please refresh.');
      }
    } catch (e: any) {
      alert('Restart failed: ' + (e.message || 'Unknown error'));
    } finally {
      setRestarting(null);
    }
  };

  const isPaused = stepStatus.status === 'WAITING_USER';

  return (
    <div className="page-container pb-10">
      {/* Header - Compact */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-xs text-zinc-400">Live operation console</p>
        </div>
        <div className="flex items-center gap-2">
          <Dropdown
            trigger={
              <button className="btn btn-ghost btn-sm">
                <RotateCcw size={14} />
                Restart
                <ChevronDown size={12} />
              </button>
            }
            align="right"
            menuClassName="w-40"
          >
            <DropdownItem onClick={() => handleRestart('backend')} disabled={!!restarting}>
              <Server size={12} /> Backend
            </DropdownItem>
            <DropdownItem onClick={() => handleRestart('frontend')} disabled={!!restarting}>
              <Activity size={12} /> Frontend
            </DropdownItem>
            <DropdownDivider />
            <DropdownItem onClick={() => handleRestart('all')} disabled={!!restarting} variant="warning">
              <RotateCcw size={12} /> Both
            </DropdownItem>
          </Dropdown>
          <div className="flex items-center gap-2 bg-zinc-900 px-2 py-1.5 rounded-md border border-zinc-800">
            <div className={`w-2 h-2 rounded-full ${status.is_running ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="font-mono text-xs font-bold text-zinc-300">{status.is_running ? 'RUNNING' : 'STOPPED'}</span>
          </div>
        </div>
      </header>

      {/* Step Check Panel */}
      {isPaused && (
        <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-500 mt-0.5" size={18} />
            <div className="flex-1">
              <h3 className="text-sm font-bold text-amber-500 mb-1">Step Confirmation Required</h3>
              <div className="bg-black/40 rounded p-2 mb-3 font-mono text-xs border border-amber-500/20">
                <div className="text-zinc-500 text-xs uppercase mb-0.5">Next Step</div>
                <div className="text-white font-bold">{stepStatus.step}</div>
                {stepStatus.detail && <div className="text-zinc-400 mt-1">{stepStatus.detail}</div>}
              </div>
              <div className="flex gap-2">
                <Button variant="success" size="sm" onClick={() => handleStepAction('CONTINUE')} icon={<CheckCircle size={14} />}>
                  Continue
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleStepAction('ABORT')} icon={<XCircle size={14} />}>
                  Abort
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 p-4 rounded-lg shadow-2xl max-w-lg w-full">
            <h3 className="text-base font-bold text-white mb-3">Confirm Execution</h3>
            <div className="bg-black/30 rounded-lg p-2 max-h-[350px] overflow-auto mb-4 border border-zinc-800 text-xs">
              {previews.map((item, i) => (
                <div key={i} className="font-mono border-b border-zinc-800 last:border-0 py-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-blue-400 font-bold">{item.pair.source}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-emerald-400 font-bold">{item.pair.dest}</span>
                  </div>
                  <div className="bg-black p-1.5 rounded border border-zinc-800 text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all">
                    <span className="text-zinc-600 select-none">$ </span>{item.command}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button variant="success" size="sm" onClick={confirmStartJob}>Start Jobs</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Control */}
        <div className="lg:col-span-2 space-y-4">
          {/* Job Status Card */}
          <div className="card relative overflow-hidden">
            <div className="relative z-10 flex justify-between items-start mb-3">
              <div>
                <div className="text-xs font-bold text-zinc-500 uppercase">Current Job</div>
                <div className="text-sm font-semibold text-white truncate max-w-md">{status.job || 'No Job Active'}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-zinc-500 uppercase">Mode</div>
                <div className="text-sm font-mono text-blue-400">{status.mode || 'N/A'}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 bg-black/20 p-2.5 rounded-md border border-zinc-800 mb-3">
              <div>
                <div className="text-xs text-zinc-500 uppercase font-bold">User</div>
                <div className="font-mono text-emerald-400 text-xs truncate">{status.current_user || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 uppercase font-bold">Speed</div>
                <div className="font-mono text-white text-sm">{status.speed || '0 B/s'}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 uppercase font-bold">Transferred</div>
                <div className="font-mono text-white text-sm">{status.total_transferred_gb || 0} GB</div>
              </div>
            </div>

            <div className="flex items-end gap-4">
              <div className="flex-1">
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Progress</span>
                  <span className="font-mono text-white">{status.current_progress || '0%'}</span>
                </div>
                <div className="bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-500"
                    style={{ width: status.current_progress || '0%' }}
                  />
                </div>
              </div>
              <button
                onClick={toggleJob}
                className={`w-12 h-12 rounded-lg transition-all shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center shrink-0 ${status.is_running ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
              >
                {status.is_running ? <Square size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} />}
              </button>
            </div>
          </div>

          {/* Live Console */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-72">
            <div className="bg-zinc-900 px-3 py-1.5 border-b border-zinc-800 flex justify-between items-center">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 uppercase">
                <Terminal size={12} /> Console
              </div>
              <div className="text-xs text-zinc-600">Tail: 50</div>
            </div>
            <div className="p-2 overflow-auto font-mono text-xs text-zinc-400 scrollbar-thin flex-1" ref={logsEndRef}>
              {logs.length === 0 && <div className="text-zinc-700 italic text-center mt-8">Waiting for events...</div>}
              {logs.map((log, i) => (
                <div key={i} className="mb-0.5 py-0.5 hover:bg-zinc-900/40">
                  <span className="text-zinc-600 mr-2 select-none">[{new Date().toLocaleTimeString()}]</span>
                  <span className={log.includes('Error') ? 'text-red-400' : log.includes('Success') ? 'text-emerald-400' : 'text-zinc-300'}>
                    {log}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sync Targets - Side Panel */}
        <div className="card h-fit">
          <div className="card-header">
            <h3 className="card-title flex items-center gap-1.5">
              <Server size={14} /> Sync Targets
            </h3>
            <SelectionControls
              selectedCount={selectedIndices.size}
              totalCount={pairs.length}
              onSelectAll={() => {
                const all = new Set(pairs.map((_, i) => i));
                setSelectedIndices(all);
                localStorage.setItem(STORAGE_KEYS.SELECTED_INDICES, JSON.stringify(Array.from(all)));
              }}
              onDeselectAll={() => {
                setSelectedIndices(new Set());
                localStorage.setItem(STORAGE_KEYS.SELECTED_INDICES, JSON.stringify([]));
              }}
              onInvertSelection={() => {
                const allIndices = pairs.map((_, i) => i);
                const inverted = new Set(allIndices.filter(i => !selectedIndices.has(i)));
                setSelectedIndices(inverted);
                localStorage.setItem(STORAGE_KEYS.SELECTED_INDICES, JSON.stringify(Array.from(inverted)));
              }}
            />
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-auto scrollbar-thin">
            {pairs.map((pair, idx) => (
              <div
                key={idx}
                onClick={(e) => toggleSelection(idx, e.shiftKey)}
                className={`p-2 rounded border transition cursor-pointer ${selectedIndices.has(idx) ? 'bg-zinc-800 border-blue-500/50' : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700 opacity-70 hover:opacity-100'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={selectedIndices.has(idx)}
                    onChange={() => { }}
                    className="checkbox"
                  />
                  <span className="text-xs text-zinc-500 uppercase font-bold">Job {idx + 1}</span>
                  <span className="text-xs bg-zinc-900 text-zinc-400 px-1.5 py-0.5 rounded ml-auto">{pair.domain_reference || 'Default'}</span>
                </div>
                <div className="font-mono text-xs truncate text-blue-400">{pair.source}</div>
                <div className="font-mono text-xs truncate text-emerald-400">{pair.dest}</div>
              </div>
            ))}
            {pairs.length === 0 && <div className="text-zinc-500 text-center italic py-4 text-xs">No jobs configured.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
