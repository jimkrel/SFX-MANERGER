import { contextBridge, ipcRenderer, webUtils } from 'electron';

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

export interface Tag {
  id: number;
  name: string;
  count?: number;
}

export interface SearchFilterOptions {
  searchQuery?: string;
  folderPath?: string;
  tagIds?: number[];
  tagMode?: 'AND' | 'OR';
  onlyAvailable?: boolean;
}

export interface LibraryStats {
  totalSfx: number;
  totalMusic: number;
  newThisWeek: number;
  totalMissing: number;
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
  tagList?: Tag[];
}

export interface ElectronAPI {
  getAppInfo: () => Promise<AppInfo>;
  getDbStatus: () => Promise<DbStatus>;
  getTracks: (options?: SearchFilterOptions) => Promise<Track[]>;
  getWatchedFolders: () => Promise<string[]>;
  addWatchedFolder: (folderPath: string) => Promise<string[]>;
  removeWatchedFolder: (folderPath: string) => Promise<string[]>;
  rescanLibrary: () => Promise<{ checked: number; missing: number; recovered: number }>;
  openFolderDialog: () => Promise<string | null>;
  onLibraryUpdated: (callback: () => void) => () => void;
  readAudioBuffer: (filePath: string) => Promise<Uint8Array | null>;
  getWaveformPeaks: (trackId: number, resolution: number) => Promise<number[] | null>;
  saveWaveformPeaks: (trackId: number, resolution: number, peaks: number[]) => Promise<boolean>;
  getAllTags: () => Promise<Tag[]>;
  addTagToTrack: (trackId: number, tagName: string) => Promise<Tag>;
  removeTagFromTrack: (trackId: number, tagId: number) => Promise<boolean>;
  getLibraryStats: () => Promise<LibraryStats>;
  startDrag: (filePath: string, iconDataUrl?: string) => void;
  getPathForFile: (file: File) => string;
  importDroppedPaths: (paths: string[]) => Promise<{ imported: number; folders: number; errors: string[] }>;
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
  },
  readAudioBuffer: (filePath: string) => ipcRenderer.invoke('file:readBuffer', filePath),
  getWaveformPeaks: (trackId: number, resolution: number) =>
    ipcRenderer.invoke('waveform:getPeaks', trackId, resolution),
  saveWaveformPeaks: (trackId: number, resolution: number, peaks: number[]) =>
    ipcRenderer.invoke('waveform:savePeaks', trackId, resolution, peaks),
  getAllTags: () => ipcRenderer.invoke('tags:getAll'),
  addTagToTrack: (trackId: number, tagName: string) => ipcRenderer.invoke('tags:addToTrack', trackId, tagName),
  removeTagFromTrack: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:removeFromTrack', trackId, tagId),
  getLibraryStats: () => ipcRenderer.invoke('stats:get'),
  startDrag: (filePath: string, iconDataUrl?: string) => ipcRenderer.send('drag:start', filePath, iconDataUrl),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return (file as unknown as { path: string }).path || '';
    }
  },
  importDroppedPaths: (paths: string[]) => ipcRenderer.invoke('library:importPaths', paths)
};

contextBridge.exposeInMainWorld('api', api);
