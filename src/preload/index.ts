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

export interface ElectronAPI {
  getAppInfo: () => Promise<AppInfo>;
  getDbStatus: () => Promise<DbStatus>;
}

const api: ElectronAPI = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getDbStatus: () => ipcRenderer.invoke('db:status')
};

contextBridge.exposeInMainWorld('api', api);
