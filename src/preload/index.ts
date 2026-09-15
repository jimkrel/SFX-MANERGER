import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface AppInfo {
  version: string;
  electronVersion: string;
  nodeVersion: string;
  arch: string;
  platform: string;
  isElevated: boolean;
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
  favoriteOnly?: boolean;
  category?: string;
  rating?: number;
  sortBy?: 'newest' | 'favorite_desc' | 'duration_desc' | 'rating_desc' | 'name_asc';
  audioClassification?: 'SFX' | 'Music';
  limit?: number;
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
  rating?: number;
  is_favorite?: number;
  category?: string;
  bpm?: number | null;
  peak_gain?: number | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  tagList?: Tag[];
  file_size?: number | null;
  file_mtime?: number | null;
  content_version?: number;
  type_override?: string | null;
  peaks_80?: number[] | null;
}

export interface ElectronAPI {
  platform: string;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  getAppInfo: () => Promise<AppInfo>;
  getDbStatus: () => Promise<DbStatus>;
  getTracks: (options?: SearchFilterOptions) => Promise<Track[]>;
  getWatchedFolders: () => Promise<string[]>;
  addWatchedFolder: (folderPath: string) => Promise<string[]>;
  removeWatchedFolder: (folderPath: string) => Promise<string[]>;
  rescanLibrary: () => Promise<{ checked: number; missing: number; recovered: number }>;
  openFolderDialog: () => Promise<string | null>;
  openFilesDialog: () => Promise<string[]>;
  onLibraryUpdated: (callback: () => void) => () => void;
  readAudioBuffer: (filePath: string, trackId?: number, version?: number) => Promise<Uint8Array | null>;
  getWaveformPeaks: (trackId: number, resolution: number, version?: number) => Promise<number[] | null>;
  saveWaveformPeaks: (trackId: number, resolution: number, peaks: number[], version?: number) => Promise<boolean>;
  getAllTags: () => Promise<Tag[]>;
  addTagToTrack: (trackId: number, tagName: string) => Promise<Tag>;
  removeTagFromTrack: (trackId: number, tagId: number) => Promise<boolean>;
  getLibraryStats: () => Promise<LibraryStats>;
  startDrag: (filePathOrPaths: string | string[], iconDataUrl?: string) => void;
  getPathForFile: (file: File) => string;
  importDroppedPaths: (paths: string[]) => Promise<{ imported: number; folders: number; errors: string[] }>;
  // v2 API
  setRating: (trackId: number, rating: number) => Promise<boolean>;
  toggleFavorite: (trackId: number) => Promise<number>;
  setCategory: (trackId: number, category: string) => Promise<boolean>;
  setBpm: (trackId: number, bpm: number | null, version?: number) => Promise<boolean>;
  setPeakGain: (trackId: number, peakGain: number, version?: number) => Promise<boolean>;
  bulkTag: (trackIds: number[], tagName: string) => Promise<boolean>;
  bulkRemoveTag: (trackIds: number[], tagId: number) => Promise<boolean>;
  bulkDelete: (trackIds: number[]) => Promise<boolean>;
  getStorageStats: () => Promise<{ totalBytes: number; totalFiles: number }>;
  saveExportedFile: (payload: { defaultName: string; buffer: ArrayBuffer | Uint8Array; format: 'wav' | 'mp3' }) => Promise<string | null>;
  showInFolder: (filePath: string) => Promise<boolean>;
  copyPaths: (paths: string[]) => Promise<boolean>;
  onDragEnded: (callback: () => void) => () => void;
  checkIsElevated: () => Promise<boolean>;
  logDrag: (step: string, data?: unknown) => void;
  toggleTrackType: (trackId: number) => Promise<'SFX' | 'Music'>;
  reclassifyAll: () => Promise<{ totalScanned: number; updatedCount: number; sfxCount: number; musicCount: number }>;
  isBouncedCached: (sourcePath: string) => Promise<{ cached: boolean; bouncePath: string; sourceToken: string }>;
  saveBouncedWav: (sourcePath: string, wavBuffer: Uint8Array, sourceToken?: string) => Promise<string>;
  clearBounceCache: () => Promise<{ cleared: number; freedBytes: number }>;
  // Quick Launcher & Global Hotkey API
  showQuickLauncher: () => Promise<void>;
  hideQuickLauncher: () => Promise<void>;
  toggleQuickLauncher: () => Promise<void>;
  getQuickLauncherShortcut: () => Promise<string>;
  setQuickLauncherShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>;
  checkAccessibilityPermission: (prompt?: boolean) => Promise<boolean>;
  openAccessibilitySettings: () => Promise<void>;
  onQuickLauncherShown: (callback: () => void) => () => void;
  onQuickLauncherHidden: (callback: () => void) => () => void;
}

const api: ElectronAPI = {
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  checkIsElevated: () => ipcRenderer.invoke('app:isElevated'),
  getDbStatus: () => ipcRenderer.invoke('db:status'),
  getTracks: (options) => ipcRenderer.invoke('library:getTracks', options),
  getWatchedFolders: () => ipcRenderer.invoke('library:getWatchedFolders'),
  addWatchedFolder: (folderPath: string) => ipcRenderer.invoke('library:addFolder', folderPath),
  removeWatchedFolder: (folderPath: string) => ipcRenderer.invoke('library:removeFolder', folderPath),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openFilesDialog: () => ipcRenderer.invoke('dialog:openFiles'),
  onLibraryUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('library:updated', handler);
    return () => {
      ipcRenderer.removeListener('library:updated', handler);
    };
  },
  readAudioBuffer: (filePath: string, trackId?: number, version?: number) => ipcRenderer.invoke('file:readBuffer', filePath, trackId, version),
  getWaveformPeaks: (trackId: number, resolution: number, version?: number) =>
    ipcRenderer.invoke('waveform:getPeaks', trackId, resolution, version),
  saveWaveformPeaks: (trackId: number, resolution: number, peaks: number[], version?: number) =>
    ipcRenderer.invoke('waveform:savePeaks', trackId, resolution, peaks, version),
  getAllTags: () => ipcRenderer.invoke('tags:getAll'),
  addTagToTrack: (trackId: number, tagName: string) => ipcRenderer.invoke('tags:addToTrack', trackId, tagName),
  removeTagFromTrack: (trackId: number, tagId: number) => ipcRenderer.invoke('tags:removeFromTrack', trackId, tagId),
  getLibraryStats: () => ipcRenderer.invoke('stats:get'),
  startDrag: (filePathOrPaths: string | string[], iconDataUrl?: string) => {
    try {
      ipcRenderer.send('log:drag', '[PRELOAD STEP 3] startDrag called', { filePathOrPaths, hasIcon: Boolean(iconDataUrl) });
    } catch {}
    ipcRenderer.send('drag:start', filePathOrPaths, iconDataUrl);
  },
  logDrag: (step: string, data?: unknown) => {
    try {
      ipcRenderer.send('log:drag', step, data);
    } catch {}
  },
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return (file as unknown as { path: string }).path || '';
    }
  },
  importDroppedPaths: (paths: string[]) => ipcRenderer.invoke('library:importPaths', paths),
  // v2 methods
  setRating: (trackId: number, rating: number) => ipcRenderer.invoke('track:setRating', trackId, rating),
  toggleFavorite: (trackId: number) => ipcRenderer.invoke('track:toggleFavorite', trackId),
  setCategory: (trackId: number, category: string) => ipcRenderer.invoke('track:setCategory', trackId, category),
  setBpm: (trackId: number, bpm: number | null, version?: number) => ipcRenderer.invoke('track:setBpm', trackId, bpm, version),
  setPeakGain: (trackId: number, peakGain: number, version?: number) => ipcRenderer.invoke('track:setPeakGain', trackId, peakGain, version),
  bulkTag: (trackIds: number[], tagName: string) => ipcRenderer.invoke('track:bulkTag', trackIds, tagName),
  bulkRemoveTag: (trackIds: number[], tagId: number) => ipcRenderer.invoke('track:bulkRemoveTag', trackIds, tagId),
  bulkDelete: (trackIds: number[]) => ipcRenderer.invoke('track:bulkDelete', trackIds),
  getStorageStats: () => ipcRenderer.invoke('app:getStorageStats'),
  saveExportedFile: (payload) => ipcRenderer.invoke('audio:saveExportedFile', payload),
  // Windows UIPI fallback: Copy file paths to clipboard using native CF_HDROP format
  // On Windows: Ctrl+V will paste actual files (when using Explorer or file-aware apps)
  // On Mac: Falls back to newline-separated text paths
  // Usage: When drag-drop fails due to elevation mismatch, user can:
  //   1. Click "Copy to Clipboard" button
  //   2. Open target app (CapCut, Premiere, DaVinci Resolve)
  //   3. Ctrl+V to paste files directly
  copyPaths: (paths: string[]) => ipcRenderer.invoke('shell:copyPaths', paths),
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
  onDragEnded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('drag:ended', handler);
    return () => {
      ipcRenderer.removeListener('drag:ended', handler);
    };
  },
  toggleTrackType: (trackId: number) => ipcRenderer.invoke('track:toggleType', trackId),
  reclassifyAll: () => ipcRenderer.invoke('library:reclassifyAll'),
  isBouncedCached: (sourcePath: string) => ipcRenderer.invoke('bouncer:isCached', sourcePath),
  saveBouncedWav: (sourcePath: string, wavBuffer: Uint8Array, sourceToken?: string) =>
    ipcRenderer.invoke('bouncer:saveWav', sourcePath, wavBuffer, sourceToken),
  clearBounceCache: () => ipcRenderer.invoke('bouncer:clearCache'),
  // Quick Launcher & Global Hotkey implementations
  showQuickLauncher: () => ipcRenderer.invoke('quickLauncher:show'),
  hideQuickLauncher: () => ipcRenderer.invoke('quickLauncher:hide'),
  toggleQuickLauncher: () => ipcRenderer.invoke('quickLauncher:toggle'),
  getQuickLauncherShortcut: () => ipcRenderer.invoke('settings:getQuickLauncherShortcut'),
  setQuickLauncherShortcut: (shortcut: string) => ipcRenderer.invoke('settings:setQuickLauncherShortcut', shortcut),
  checkAccessibilityPermission: (prompt = false) => ipcRenderer.invoke('system:checkAccessibility', prompt),
  openAccessibilitySettings: () => ipcRenderer.invoke('system:openAccessibilitySettings'),
  onQuickLauncherShown: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('quickLauncher:shown', handler);
    return () => {
      ipcRenderer.removeListener('quickLauncher:shown', handler);
    };
  },
  onQuickLauncherHidden: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('quickLauncher:hidden', handler);
    return () => {
      ipcRenderer.removeListener('quickLauncher:hidden', handler);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);
