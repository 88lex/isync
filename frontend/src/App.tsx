import React, { useState } from 'react';
import { APP_VERSION } from './constants/config';
import { STORAGE_KEYS } from './constants/storageKeys';
import {
  LayoutDashboard, Settings, Activity, Database, History, Calendar,
  Users, FileCode, Server, HardDrive, Wrench, ChevronDown, ChevronRight
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import BatchGenerator from './pages/BatchGenerator';
import ConfigPage from './pages/Config';
import SyncBackup from './pages/SyncBackup';
import HistoryPage from './pages/History';
import SchedulesPage from './pages/Schedules';
import RemoteServers from './pages/RemoteServers';
import DriveManager from './pages/DriveManager';
import PrepCheck from './pages/PrepCheck';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfigStatusIndicator } from './components/ConfigStatusIndicator';

type ViewType = 'dashboard' | 'users' | 'batch' | 'config' | 'sync' | 'history' | 'schedules' | 'servers' | 'drives' | 'prep';

// Define navigation groups
interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: 'Main',
    defaultOpen: true,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'users', label: 'User Management', icon: Users },
      { id: 'batch', label: 'Batch Generator', icon: FileCode },
    ]
  },
  {
    label: 'Automation',
    defaultOpen: true,
    items: [
      { id: 'schedules', label: 'Schedules', icon: Calendar },
      { id: 'history', label: 'Job History', icon: History },
    ]
  },
  {
    label: 'Infrastructure',
    defaultOpen: true,
    items: [
      { id: 'servers', label: 'Remote Servers', icon: Server },
      { id: 'drives', label: 'Drive Manager', icon: HardDrive },
    ]
  },
  {
    label: 'Settings',
    defaultOpen: true,
    items: [
      { id: 'config', label: 'Configuration', icon: Settings },
      { id: 'sync', label: 'Backup & Sync', icon: Database },
      { id: 'prep', label: 'Prep Check', icon: Wrench },
    ]
  }
];

function App() {
  const [view, setView] = useState<ViewType>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.VIEW);
    if (saved === 'manual') return 'users';
    const validViews: ViewType[] = ['dashboard', 'users', 'batch', 'config', 'sync', 'history', 'schedules', 'servers', 'drives', 'prep'];
    return validViews.includes(saved as ViewType) ? (saved as ViewType) : 'dashboard';
  });

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLLAPSED_GROUPS);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.VIEW, view);
  }, [view]);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.COLLAPSED_GROUPS, JSON.stringify([...collapsedGroups]));
  }, [collapsedGroups]);

  const toggleGroup = (label: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    setCollapsedGroups(next);
  };

  const navClass = (isActive: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isActive
      ? 'bg-zinc-800 text-white'
      : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
    }`;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans antialiased selection:bg-indigo-500/30">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-800 bg-zinc-950 p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Activity className="text-white" size={18} />
            </div>
            <span className="text-lg font-bold tracking-tight">ISync</span>
          </div>

          <nav className="space-y-4 flex-1 overflow-y-auto">
            {navGroups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.label);
              return (
                <div key={group.label}>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-2 py-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-300 transition"
                  >
                    {group.label}
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {!isCollapsed && (
                    <div className="mt-1 space-y-0.5">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setView(item.id)}
                          className={navClass(view === item.id)}
                        >
                          <item.icon size={18} />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Config Status */}
          <div className="py-4 border-t border-zinc-800">
            <ConfigStatusIndicator compact />
          </div>

          <div className="pt-2 text-xs text-zinc-600">
            {APP_VERSION} Modular
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-black/20">
          <ErrorBoundary>
            {view === 'dashboard' && <Dashboard />}
            {view === 'users' && <UserManagement />}
            {view === 'batch' && <BatchGenerator />}
            {view === 'schedules' && <SchedulesPage />}
            {view === 'history' && <HistoryPage />}
            {view === 'config' && <ConfigPage />}
            {view === 'sync' && <SyncBackup />}
            {view === 'servers' && <RemoteServers />}
            {view === 'drives' && <DriveManager />}
            {view === 'prep' && <PrepCheck />}
          </ErrorBoundary>
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
