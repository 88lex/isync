import React, { useEffect, useState, useRef } from 'react';
import { Play, Square, Server, Activity, Terminal, AlertTriangle, CheckCircle, XCircle, RotateCcw, ChevronDown } from 'lucide-react';
import { startJob, stopJob, fetchSyncList, SyncPair, fetchStepStatus, submitStepAction, fetchJobPreview, restartBackend, restartFrontend, restartAll } from '../api';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { Dropdown, DropdownItem, DropdownDivider } from '../components/Dropdown';

const Dashboard = () => {
  const [status, setStatus] = useState<any>({ is_running: false, mode: 'IDLE' });
  const [stepStatus, setStepStatus] = useState<any>({ status: 'IDLE', step: '', detail: '' });
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Poll for main status and step status
  useEffect(() => {
    fetchSyncList().then(data => {
      setPairs(data);
      // Load selection from persistence or default to all
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_INDICES);
        if (saved) {
             const indices = JSON.parse(saved);
             if (Array.isArray(indices)) {
                 // Validate indices are within bounds
                 const validIndices = new Set(indices.filter((i: any) => typeof i === 'number' && i >= 0 && i < data.length));
                 setSelectedIndices(validIndices);
                 return;
             }
        }
      } catch (e) { console.error("Failed to load persistence", e); }
      
      // Default fallback
      setSelectedIndices(new Set(data.map((_, i) => i)));
    }).catch(console.error);
    
    // WS for Job Status
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
                     setLogs(prev => {
                        const newLogs = [data.status_msg, ...prev].slice(0, 50);
                        return newLogs;
                     });
                }
            } catch (e) { console.error("WS Parse Error", e); }
        };
        ws.onclose = () => setTimeout(connectWs, 3000); 
    };
    connectWs();

    // Polling for Step Status (Interactive Mode)
    const interval = setInterval(async () => {
        try {
            const s = await fetchStepStatus();
            setStepStatus(s);
        } catch(e) { console.error(e); }
    }, 1000);

    return () => { 
        if(ws) ws.close(); 
        clearInterval(interval);
    };
  }, []);

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
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

  const toggleSelection = (idx: number) => {
    const newSet = new Set(selectedIndices);
    if (newSet.has(idx)) newSet.delete(idx);
    else newSet.add(idx);
    setSelectedIndices(newSet);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INDICES, JSON.stringify(Array.from(newSet)));
  };

  const toggleAll = () => {
    let newSet: Set<number>;
    if (selectedIndices.size === pairs.length) {
      newSet = new Set();
    } else {
      newSet = new Set(pairs.map((_, i) => i));
    }
    setSelectedIndices(newSet);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INDICES, JSON.stringify(Array.from(newSet)));
  };

  const handleStepAction = async (action: 'CONTINUE' | 'ABORT') => {
      try {
          await submitStepAction(action);
      } catch (e) { alert("Failed to submit action"); }
  };

  // Restart controls
  const [restarting, setRestarting] = useState<string | null>(null);

  const handleRestart = async (type: 'backend' | 'frontend' | 'all') => {
      setRestarting(type);
      try {
          if (type === 'backend') {
              await restartBackend();
              alert('Backend restart initiated. The page may become unresponsive briefly.');
          } else if (type === 'frontend') {
              await restartFrontend();
              alert('Frontend restart initiated. Please refresh the page in a few seconds.');
          } else {
              await restartAll();
              alert('Full restart initiated. Please wait and refresh the page.');
          }
      } catch (e: any) {
          alert('Restart failed: ' + (e.message || 'Unknown error'));
      } finally {
          setRestarting(null);
      }
  };

  const isPaused = stepStatus.status === 'WAITING_USER';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 text-zinc-100 font-sans pb-20">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">ISync Dashboard</h1>
          <p className="text-zinc-400 text-sm mt-1">Live Operation Console</p>
        </div>
        <div className="flex items-center gap-3">
             {/* Restart dropdown */}
             <Dropdown
                 trigger={
                     <button className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition border border-zinc-700">
                         <RotateCcw size={14} />
                         Restart
                         <ChevronDown size={14} />
                     </button>
                 }
                 align="right"
                 menuClassName="w-48"
             >
                 <DropdownItem onClick={() => handleRestart('backend')} disabled={!!restarting}>
                     <Server size={14} />
                     {restarting === 'backend' ? 'Restarting...' : 'Restart Backend'}
                 </DropdownItem>
                 <DropdownItem onClick={() => handleRestart('frontend')} disabled={!!restarting}>
                     <Activity size={14} />
                     {restarting === 'frontend' ? 'Restarting...' : 'Restart Frontend'}
                 </DropdownItem>
                 <DropdownDivider />
                 <DropdownItem onClick={() => handleRestart('all')} disabled={!!restarting} variant="warning">
                     <RotateCcw size={14} />
                     {restarting === 'all' ? 'Restarting...' : 'Restart Both'}
                 </DropdownItem>
             </Dropdown>
             {/* Status indicator */}
             <div className="flex items-center gap-4 bg-zinc-900 p-2 rounded-lg border border-zinc-800">
                  <div className={`w-3 h-3 rounded-full ${status.is_running ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="font-mono text-sm font-bold text-zinc-300">{status.is_running ? 'RUNNING' : 'STOPPED'}</span>
             </div>
        </div>
      </header>

      {/* Interactive Step Check Panel */}
      {isPaused && (
          <div className="bg-amber-500/10 border border-amber-500/50 rounded-xl p-6 mb-6 animate-pulse-slow">
              <div className="flex items-start gap-4">
                  <AlertTriangle className="text-amber-500 mt-1" size={24} />
                  <div className="flex-1">
                      <h3 className="text-xl font-bold text-amber-500 mb-1">Step Confirmation Required</h3>
                      <p className="text-zinc-300 mb-2">The engine is paused and waiting for your approval to proceed.</p>
                      
                      <div className="bg-black/40 rounded p-3 mb-4 font-mono text-sm border border-amber-500/20">
                          <div className="text-zinc-500 text-xs uppercase mb-1">Next Step</div>
                          <div className="text-white font-bold">{stepStatus.step}</div>
                          {stepStatus.detail && <div className="text-zinc-400 mt-2 whitespace-pre-wrap">{stepStatus.detail}</div>}
                      </div>

                      <div className="flex gap-4">
                          <button 
                            onClick={() => handleStepAction('CONTINUE')}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition"
                          >
                              <CheckCircle size={18} /> Continue
                          </button>
                          <button 
                            onClick={() => handleStepAction('ABORT')}
                            className="bg-red-600 hover:bg-red-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition"
                          >
                              <XCircle size={18} /> Abort
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-xl shadow-2xl max-w-lg w-full">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Execution</h3>
            <p className="text-zinc-400 mb-4">You are about to start the following sync jobs:</p>
            <div className="bg-black/30 rounded-lg p-3 max-h-[400px] overflow-auto mb-6 border border-zinc-800">
               {previews.map((item, i) => (
                 <div key={i} className="text-sm font-mono border-b border-zinc-800 last:border-0 py-4">
                   <div className="flex justify-between items-center mb-2">
                     <span className="text-blue-400 font-bold">SRC: {item.pair.source}</span>
                     <span className="text-zinc-600">to</span>
                     <span className="text-emerald-400 font-bold">DST: {item.pair.dest}</span>
                   </div>
                   <div className="text-xs text-zinc-500 mb-2">Domain: {item.pair.domain_reference || 'Default'}</div>
                   
                   <div className="mb-2">
                       <span className="text-[10px] uppercase text-zinc-500 font-bold bg-zinc-800 px-1 rounded mr-2">Context</span>
                       <span className="text-zinc-300 text-xs">{item.context}</span>
                   </div>

                   <div className="bg-black p-2 rounded border border-zinc-800 text-xs text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all">
                       <span className="text-zinc-600 select-none">$ </span>{item.command}
                   </div>
                 </div>
               ))}
            </div>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button 
                onClick={confirmStartJob}
                className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-900/20"
              >
                Start Jobs
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Control */}
        <div className="md:col-span-2 space-y-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 relative overflow-hidden group shadow-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-50" />
                
                <div className="relative z-10 flex justify-between items-start">
                    <div className="space-y-4 w-full">
                        <div className="flex justify-between items-start">
                            <div>
                                <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-1">Current Job</h2>
                                <div className="text-xl font-semibold text-white truncate max-w-md" title={status.job}>{status.job || 'No Job Active'}</div>
                            </div>
                             <div className="text-right">
                                <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-1">Mode</h2>
                                <div className="text-xl font-mono text-blue-400">{status.mode || 'N/A'}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 bg-black/20 p-4 rounded-lg border border-white/5">
                            <div>
                                <div className="text-xs text-zinc-500 uppercase font-bold">Current User</div>
                                <div className="font-mono text-emerald-400 text-sm truncate" title={status.current_user}>{status.current_user || '-'}</div>
                            </div>
                            <div>
                                <div className="text-xs text-zinc-500 uppercase font-bold">Speed</div>
                                <div className="font-mono text-white text-lg">{status.speed || '0 B/s'}</div>
                            </div>
                            <div>
                                <div className="text-xs text-zinc-500 uppercase font-bold">Total Transferred</div>
                                <div className="font-mono text-white text-lg">{status.total_transferred_gb || 0} GB</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="relative z-20 mt-8 flex items-end justify-between">
                    <div className="flex-1 mr-8">
                         <div className="flex justify-between text-xs text-zinc-500 mb-2">
                            <span>Job Progress</span>
                            <div className="flex items-center gap-4">
                              {/* Calculate ETA from progress and speed */}
                              {status.is_running && status.current_progress && status.speed && (
                                <span className="text-zinc-400">
                                  ETA: {(() => {
                                    try {
                                      const progress = parseFloat(status.current_progress.replace('%', '')) || 0;
                                      if (progress <= 0 || progress >= 100) return '--';
                                      
                                      // Parse speed (e.g., "10.5 MB/s" or "1.2 GB/s")
                                      const speedMatch = status.speed.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
                                      if (!speedMatch) return '--';
                                      
                                      const speedVal = parseFloat(speedMatch[1]);
                                      const speedUnit = speedMatch[2].toUpperCase();
                                      
                                      // Convert to bytes per second
                                      const unitMultipliers: Record<string, number> = {
                                        'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4
                                      };
                                      const bytesPerSecond = speedVal * (unitMultipliers[speedUnit] || 1);
                                      
                                      if (bytesPerSecond <= 0) return '--';
                                      
                                      // Estimate remaining based on total transferred
                                      const totalGB = parseFloat(status.total_transferred_gb) || 0;
                                      const totalBytes = totalGB * 1024**3;
                                      
                                      // Estimate total size from progress
                                      const estimatedTotal = totalBytes / (progress / 100);
                                      const remainingBytes = estimatedTotal - totalBytes;
                                      const remainingSeconds = remainingBytes / bytesPerSecond;
                                      
                                      if (remainingSeconds < 60) return `${Math.round(remainingSeconds)}s`;
                                      if (remainingSeconds < 3600) return `${Math.round(remainingSeconds / 60)}m`;
                                      return `${Math.round(remainingSeconds / 3600)}h ${Math.round((remainingSeconds % 3600) / 60)}m`;
                                    } catch {
                                      return '--';
                                    }
                                  })()}
                                </span>
                              )}
                              <span className="font-mono text-white">{status.current_progress || '0%'}</span>
                            </div>
                        </div>
                        <div className="bg-zinc-800 h-3 rounded-full overflow-hidden">
                            <div 
                                className="bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 h-full transition-all duration-500 relative" 
                                style={{ width: status.current_progress || '0%' }} 
                            >
                                <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                {/* Shimmer effect */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                            </div>
                        </div>
                        {/* Sub-stats */}
                        {status.is_running && (
                          <div className="flex justify-between mt-2 text-xs text-zinc-500">
                            <span>{status.current_bytes || '0 B'} transferred this cycle</span>
                            <span className="text-emerald-400">{status.speed || '0 B/s'}</span>
                          </div>
                        )}
                    </div>
                    
                    <button 
                        onClick={toggleJob}
                        className={`w-16 h-16 rounded-xl transition-all shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center shrink-0 ${status.is_running ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/30'}`}
                        title={status.is_running ? "Stop Job" : "Start Job"}
                    >
                        {status.is_running ? <Square size={24} fill="currentColor" strokeWidth={0} /> : <div className="flex items-center"><Play size={24} fill="currentColor" strokeWidth={0} /><span className="ml-1 font-bold">Start</span></div>}
                    </button>
                </div>
            </div>

            {/* Live Console */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-96 shadow-lg">
                <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex justify-between items-center">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        <Terminal size={14} /> Live Console
                    </div>
                    <div className="flex gap-2">
                        <div className="text-[10px] text-zinc-600">Tail: 50 lines</div>
                    </div>
                </div>
                <div className="p-4 overflow-auto font-mono text-xs text-zinc-400 scrollbar-thin flex-1" ref={logsEndRef}>
                    {logs.length === 0 && <div className="text-zinc-700 italic text-center mt-10">Waiting for live events...</div>}
                    {logs.map((log, i) => (
                        <div key={i} className="mb-1 border-b border-zinc-900/50 pb-1 last:border-0 hover:bg-zinc-900/40 transition-colors">
                            <span className="text-zinc-600 mr-3 select-none">[{new Date().toLocaleTimeString()}]</span>
                            <span className={log.includes('Error') ? 'text-red-400' : log.includes('Success') || log.includes('Complete') ? 'text-emerald-400' : 'text-zinc-300'}>
                                {log}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Sync List (Side Panel) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 h-fit sticky top-6">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-zinc-200">
                    <Server size={18} />
                    Sync Targets
                </h3>
                <button onClick={toggleAll} className="text-xs text-blue-400 hover:text-blue-300 font-bold uppercase tracking-wider">
                  {selectedIndices.size === pairs.length ? 'Deselect All' : 'Select All'}
                </button>
            </div>
            <div className="space-y-3 max-h-[600px] overflow-auto pr-2 scrollbar-thin">
                {pairs.map((pair, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => toggleSelection(idx)}
                      className={`p-3 rounded border transition group relative overflow-hidden cursor-pointer ${selectedIndices.has(idx) ? 'bg-zinc-900 border-blue-500/50 shadow-blue-900/10 shadow-lg' : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700 opacity-60 hover:opacity-100'}`}
                    >
                        <div className="flex justify-between items-center mb-2 relative z-10">
                             <div className="flex items-center gap-2">
                                <input 
                                  type="checkbox" 
                                  checked={selectedIndices.has(idx)} 
                                  onChange={() => {}} // Handle loop via parent div click
                                  className="rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500/50"
                                />
                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Job {idx+1}</div>
                             </div>
                             <span className="text-[10px] bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-800">{pair.domain_reference || 'Default'}</span>
                        </div>
                        <div className="space-y-1 relative z-10">
                            <div className="font-mono text-xs truncate text-blue-400" title={pair.source}>
                                <span className="text-zinc-600 mr-2 font-bold select-none">SRC</span>{pair.source}
                            </div>
                            <div className="font-mono text-xs truncate text-emerald-400" title={pair.dest}>
                                <span className="text-zinc-600 mr-2 font-bold select-none">DST</span>{pair.dest}
                            </div>
                        </div>
                    </div>
                ))}
                {pairs.length === 0 && <div className="text-zinc-500 text-center italic py-4">No jobs configured.</div>}
            </div>
            
            <div className="mt-6 pt-6 border-t border-zinc-800">
                <div className="text-xs text-zinc-500 text-center">
                    <Activity size={14} className="inline mr-1" />
                    Running in <span className="text-white font-bold">{status.mode || 'Normal'}</span> Mode
                </div>
                {/* Visual indicator for interactive mode if enabled? 
                    Actually, we can check stepStatus.status === 'RUNNING' or similar, 
                    but the config page toggles the setting. 
                    Let's just trust the live console logs.
                */}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
