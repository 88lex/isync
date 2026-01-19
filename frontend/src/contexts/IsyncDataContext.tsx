import React, { createContext, useContext, useState, ReactNode } from 'react';
import { DriveInfo, RcloneRemote } from '../api';

interface DriveManagerState {
    drives: DriveInfo[];
    localRemotes: RcloneRemote[];
    lastUpdated: number;
}

interface RcloneManagerState {
    remotes: any[];
    servers: any[];
    source: 'local' | 'remote';
    selectedServer: string;
    searchFilter: string;
    statusFilter: 'all' | 'normal' | 'ignored' | 'protected';
    lastUpdated: number;
}

interface IsyncDataContextType {
    driveManager: DriveManagerState;
    setDriveManager: React.Dispatch<React.SetStateAction<DriveManagerState>>;
    rcloneManager: RcloneManagerState;
    setRcloneManager: React.Dispatch<React.SetStateAction<RcloneManagerState>>;
}

const defaultDriveState: DriveManagerState = {
    drives: [],
    localRemotes: [],
    lastUpdated: 0
};

const defaultRcloneState: RcloneManagerState = {
    remotes: [],
    servers: [],
    source: 'local',
    selectedServer: '',
    searchFilter: '',
    statusFilter: 'all',
    lastUpdated: 0
};

const IsyncDataContext = createContext<IsyncDataContextType | undefined>(undefined);

export const IsyncDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [driveManager, setDriveManager] = useState<DriveManagerState>(defaultDriveState);
    const [rcloneManager, setRcloneManager] = useState<RcloneManagerState>(defaultRcloneState);

    return (
        <IsyncDataContext.Provider value={{
            driveManager,
            setDriveManager,
            rcloneManager,
            setRcloneManager
        }}>
            {children}
        </IsyncDataContext.Provider>
    );
};

export const useIsyncData = () => {
    const context = useContext(IsyncDataContext);
    if (!context) {
        throw new Error('useIsyncData must be used within an IsyncDataProvider');
    }
    return context;
};
