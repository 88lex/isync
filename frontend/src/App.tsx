import React, { useState } from 'react';
import { APP_VERSION } from './constants/config';
import { STORAGE_KEYS } from './constants/storageKeys';
import {
  LayoutDashboard, Settings, Activity, Database, History, Calendar,
  Users, FileCode, Server, HardDrive, Wrench, ChevronDown, ChevronRight, ShieldAlert, Key, ArrowLeftRight
} from 'lucide-react';
import UserManagement from './pages/UserManagement';
import BatchGenerator from './pages/BatchGenerator';
import ConfigPage from './pages/Config';
import SyncBackup from './pages/SyncBackup';
import HistoryPage from './pages/History';
import SchedulesPage from './pages/Schedules';
import RemoteServers from './pages/RemoteServers';
import DriveManager from './pages/DriveManager';
import PrepCheck from './pages/PrepCheck';
import RemoteSync from './pages/RemoteSync';
import RcloneManagement from './pages/RcloneManagement';
import ManageExcluded from './pages/ManageExcluded';
import KeyManager from './pages/KeyManager';
import WorkspaceManager from './pages/WorkspaceManager';
import { IsyncDataProvider } from './contexts/IsyncDataContext';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfigStatusIndicator } from './components/ConfigStatusIndicator';

type ViewType = 'users' | 'batch' | 'config' | 'sync' | 'history' | 'schedules' | 'servers' | 'drives' | 'prep' | 'remotesync' | 'rclone' | 'excluded' | 'keys' | 'workspace';

// Define navigation groups
interface SubItem {
  id: string;
  label: string;
}

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ElementType;
  subItems?: SubItem[];
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
      { id: 'users', label: 'User Manager', icon: Users },
      {
        id: 'batch',
        label: 'Batch Generator',
        icon: FileCode,
        subItems: [
          { id: 'generator', label: 'Generator' },
          { id: 'saved-batches', label: 'Saved Batches' },
          { id: 'batch-groups', label: 'Batch Groups' }
        ]
      },
    ]
  },
  {
    label: 'Infrastructure',
    defaultOpen: true,
    items: [
      { id: 'servers', label: 'Remote Servers', icon: Server },
      { id: 'drives', label: 'Drive Manager', icon: HardDrive },
      { id: 'rclone', label: 'Rclone Manager', icon: HardDrive },
      { id: 'remotesync', label: 'Remote Sync', icon: ArrowLeftRight },
      { id: 'workspace', label: 'Workspace Manager', icon: Activity },
      { id: 'keys', label: 'Manage JSONs', icon: Key },
      { id: 'excluded', label: 'Manage Excluded', icon: ShieldAlert },
    ]
  },
  {
    label: 'Operations',
    defaultOpen: true,
    items: [
      {
        id: 'schedules',
        label: 'Schedules',
        icon: Calendar,
        subItems: [
          { id: 'local-schedules', label: 'Local Schedules' },
          { id: 'remote-schedules', label: 'Remote / Crontab' }
        ]
      },
      { id: 'history', label: 'Job History', icon: History },
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
    if (saved === 'manual' || saved === 'dashboard' || saved === 'monitor') return 'users';
    const validViews: ViewType[] = ['users', 'batch', 'config', 'sync', 'history', 'schedules', 'servers', 'drives', 'prep', 'remotesync', 'rclone', 'excluded', 'keys', 'workspace'];
    return validViews.includes(saved as ViewType) ? (saved as ViewType) : 'users';
  });

  const [activeSubSection, setActiveSubSection] = useState<string | null>(null);

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

  const subNavClass = (isActive: boolean) =>
    `w-full flex items-center gap-2 px-2 py-1.5 pl-9 text-xs rounded-lg transition-colors ${isActive
      ? 'text-cyan-400 font-medium'
      : 'text-zinc-500 hover:text-zinc-300'
    }`;

  return (
    <ErrorBoundary>
      <IsyncDataProvider>
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
                          <div key={item.id}>
                            <button
                              onClick={() => {
                                setView(item.id);
                                if (!item.subItems) setActiveSubSection(null);
                              }}
                              className={navClass(view === item.id)}
                            >
                              <item.icon size={18} />
                              {item.label}
                            </button>

                            {/* Sub-items */}
                            {item.subItems && view === item.id && (
                              <div className="mt-1 space-y-0.5 relative">
                                <div className="absolute left-6 top-1 bottom-1 w-px bg-zinc-800" />
                                {item.subItems.map(sub => (
                                  <button
                                    key={sub.id}
                                    onClick={() => setActiveSubSection(sub.id)}
                                    className={subNavClass(activeSubSection === sub.id)}
                                  >
                                    {sub.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
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
              {view === 'users' && <UserManagement />}
              {view === 'batch' && <BatchGenerator activeSection={activeSubSection} />}
              {view === 'schedules' && <SchedulesPage activeSection={activeSubSection} />}
              {view === 'history' && <HistoryPage />}
              {view === 'config' && <ConfigPage />}
              {view === 'sync' && <SyncBackup />}
              {view === 'servers' && <RemoteServers />}
              {view === 'drives' && <DriveManager />}
              {view === 'prep' && <PrepCheck />}
              {view === 'remotesync' && <RemoteSync />}
              {view === 'rclone' && <RcloneManagement />}
              {view === 'keys' && <KeyManager />}
              {view === 'workspace' && <WorkspaceManager />}
              {view === 'excluded' && <ManageExcluded />}
            </ErrorBoundary>
          </main>
        </div>
      </IsyncDataProvider>
    </ErrorBoundary>
  );
}

export default App;
