import { contextBridge, ipcRenderer } from 'electron';

export interface AppInfo {
  version: string;
  electronVersion: string;
  nodeVersion: string;
  arch: string;
  platform: string;
}

export interface DbStatus {
  connected: boolean;
  sqliteVersion?: string;
  path?: string;
  error?: string;
}

export interface Track {
  id: number;
  path: string;
  name: string;
  duration: number;
  sample_rate: number | null;
  channels: number | null;
  tags: string;
  is_missing: number;
  added_at: string;
}

export interface ElectronAPI {
  getAppInfo: () => Promise<AppInfo>;
  getDbStatus: () => Promise<DbStatus>;
  getTracks: (options?: { onlyAvailable?: boolean }) => Promise<Track[]>;
  getWatchedFolders: () => Promise<string[]>;
  addWatchedFolder: (folderPath: string) => Promise<string[]>;
  removeWatchedFolder: (folderPath: string) => Promise<string[]>;
  rescanLibrary: () => Promise<{ checked: number; missing: number; recovered: number }>;
  openFolderDialog: () => Promise<string | null>;
  onLibraryUpdated: (callback: () => void) => () => void;
}

const api: ElectronAPI = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getDbStatus: () => ipcRenderer.invoke('db:status'),
  getTracks: (options) => ipcRenderer.invoke('library:getTracks', options),
  getWatchedFolders: () => ipcRenderer.invoke('library:getWatchedFolders'),
  addWatchedFolder: (folderPath: string) => ipcRenderer.invoke('library:addFolder', folderPath),
  removeWatchedFolder: (folderPath: string) => ipcRenderer.invoke('library:removeFolder', folderPath),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  onLibraryUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('library:updated', handler);
    return () => {
      ipcRenderer.removeListener('library:updated', handler);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);
