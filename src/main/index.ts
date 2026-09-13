import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import child_process from 'child_process';

let isElevatedCache: boolean | null = null;

export function checkIsElevated(): boolean {
  if (isElevatedCache !== null) return isElevatedCache;
  if (process.platform !== 'win32') {
    isElevatedCache = process.getuid ? process.getuid() === 0 : false;
    return isElevatedCache;
  }
  try {
    // fltmc is a built-in Windows utility since XP; exits 0 if elevated, 1 otherwise
    child_process.execFileSync('fltmc', { stdio: 'ignore' });
    isElevatedCache = true;
  } catch {
    isElevatedCache = false;
  }
  return isElevatedCache;
}

import {
  initDatabase,
  closeDatabase,
  getTracks,
  getWatchedFolders,
  getWaveformPeaks,
  saveWaveformPeaks,
  getAllTags,
  addTagToTrack,
  removeTagFromTrack,
  getLibraryStats,
  updateTrackRating,
  toggleTrackFavorite,
  updateTrackCategory,
  updateTrackBpm,
  updateTrackPeakGain,
  bulkAddTag,
  bulkRemoveTag,
  bulkDeleteTracks,
  getStorageStats,
  SearchFilterOptions
} from './db';
import {
  initLibraryWatcher,
  watchNewFolder,
  unwatchFolder,
  rescanLibrary,
  setOnLibraryUpdated,
  importDroppedPaths,
  stopDriveHeartbeat
} from './indexer';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: true,
    backgroundColor: '#141516',
    title: 'SFX Music Manager',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.show();
  mainWindow.focus();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch(() => {
      mainWindow?.loadURL(devServerUrl);
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Setup IPC Handlers
function registerIpcHandlers(): void {
  ipcMain.handle('app:info', () => {
    return {
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      arch: process.arch,
      platform: process.platform,
      isElevated: checkIsElevated()
    };
  });

  ipcMain.handle('app:isElevated', () => {
    return checkIsElevated();
  });

  ipcMain.handle('tracks:get', (_event, options?: SearchFilterOptions) => {
    return getTracks(options);
  });
  ipcMain.handle('library:getTracks', (_event, options?: SearchFilterOptions) => {
    return getTracks(options);
  });

  ipcMain.handle('folders:getWatched', () => {
    return getWatchedFolders();
  });
  ipcMain.handle('library:getWatchedFolders', () => {
    return getWatchedFolders();
  });

  ipcMain.handle('folders:add', async (_event, folderPath: string) => {
    await watchNewFolder(folderPath);
    return true;
  });
  ipcMain.handle('library:addFolder', async (_event, folderPath: string) => {
    await watchNewFolder(folderPath);
    return true;
  });

  ipcMain.handle('folders:remove', async (_event, folderPath: string) => {
    await unwatchFolder(folderPath);
    return true;
  });
  ipcMain.handle('library:removeFolder', async (_event, folderPath: string) => {
    await unwatchFolder(folderPath);
    return true;
  });

  ipcMain.handle('library:rescan', () => {
    return rescanLibrary();
  });

  ipcMain.handle('tags:getAll', () => {
    return getAllTags();
  });

  ipcMain.handle('tags:addToTrack', (_event, trackId: number, tagName: string) => {
    return addTagToTrack(trackId, tagName);
  });

  ipcMain.handle('tags:removeFromTrack', (_event, trackId: number, tagId: number) => {
    removeTagFromTrack(trackId, tagId);
    return true;
  });

  ipcMain.handle('stats:get', () => {
    return getLibraryStats();
  });

  // v2 IPC Handlers: Rating, Favorite, Category, Bulk actions, Storage
  ipcMain.handle('track:setRating', (_event, trackId: number, rating: number) => {
    updateTrackRating(trackId, rating);
    return true;
  });

  ipcMain.handle('track:toggleFavorite', (_event, trackId: number) => {
    return toggleTrackFavorite(trackId);
  });

  ipcMain.handle('track:setCategory', (_event, trackId: number, category: string) => {
    updateTrackCategory(trackId, category);
    return true;
  });

  ipcMain.handle('track:setBpm', (_event, trackId: number, bpm: number | null) => {
    updateTrackBpm(trackId, bpm);
    return true;
  });

  ipcMain.handle('track:setPeakGain', (_event, trackId: number, peakGain: number) => {
    updateTrackPeakGain(trackId, peakGain);
    return true;
  });

  ipcMain.handle('track:bulkTag', (_event, trackIds: number[], tagName: string) => {
    bulkAddTag(trackIds, tagName);
    return true;
  });

  ipcMain.handle('track:bulkRemoveTag', (_event, trackIds: number[], tagId: number) => {
    bulkRemoveTag(trackIds, tagId);
    return true;
  });

  ipcMain.handle('track:bulkDelete', (_event, trackIds: number[]) => {
    bulkDeleteTracks(trackIds);
    return true;
  });

  ipcMain.handle('app:getStorageStats', () => {
    return getStorageStats();
  });

  // Native Drag & Drop to external apps (single or multi-file) with OS path normalization
  ipcMain.on('drag:start', (event, filePathOrPaths: string | string[], iconDataUrl?: string) => {
    const rawPaths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    // Crucial for Windows & cross-platform: ensure absolute normalized path with native backslashes (\)
    const validPaths = rawPaths
      .map((p) => path.normalize(path.resolve(p)))
      .filter((p) => fs.existsSync(p));

    if (validPaths.length > 0) {
      let dragIcon: Electron.NativeImage | null = null;
      if (iconDataUrl && iconDataUrl.startsWith('data:image')) {
        try {
          dragIcon = nativeImage.createFromDataURL(iconDataUrl);
        } catch {
          dragIcon = null;
        }
      }

      if (!dragIcon || dragIcon.isEmpty()) {
        const fallbackPath = path.join(__dirname, '../../build/drag-icon.png');
        if (fs.existsSync(fallbackPath)) {
          dragIcon = nativeImage.createFromPath(fallbackPath);
        }
      }

      if (!dragIcon || dragIcon.isEmpty()) {
        const fallback16 =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEUlEQVR42mNk+M+ABzAMNQAA+n0P8fOcf9AAAAAElFTkSuQmCC';
        dragIcon = nativeImage.createFromDataURL(fallback16);
      }

      try {
        event.sender.startDrag({
          file: validPaths[0],
          files: validPaths,
          icon: dragIcon
        });
      } finally {
        // On Windows, DoDragDrop is a blocking call. When it completes or cancels, notify renderer.
        event.sender.send('drag:ended');
      }
    } else {
      event.sender.send('drag:ended');
    }
  });

  // Import Dropped Files & Folders
  ipcMain.handle('library:importPaths', async (_event, paths: string[]) => {
    return await importDroppedPaths(paths);
  });

  // Reveal file in Windows Explorer / macOS Finder
  // Workaround for UIPI: apps running as Administrator (e.g. CapCut) block OLE drag
  // from non-elevated processes. User can drag from Explorer instead.
  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    const normalized = path.normalize(path.resolve(filePath));
    if (fs.existsSync(normalized)) {
      shell.showItemInFolder(normalized);
      return true;
    }
    return false;
  });

  // Copy one or more file paths to system clipboard (plain text, newline-separated)
  ipcMain.handle('shell:copyPaths', (_event, paths: string[]) => {
    const normalized = paths
      .map((p) => path.normalize(path.resolve(p)))
      .filter((p) => fs.existsSync(p));
    if (normalized.length > 0) {
      clipboard.writeText(normalized.join('\n'));
      return true;
    }
    return false;
  });

  // File & Waveform Handlers
  ipcMain.handle('file:readBuffer', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      const buffer = await fs.promises.readFile(filePath);
      return buffer;
    } catch (err) {
      console.error('[Main] Failed to read audio file:', err);
      return null;
    }
  });

  ipcMain.handle('waveform:getPeaks', (_event, trackId: number, resolution: number) => {
    return getWaveformPeaks(trackId, resolution);
  });

  ipcMain.handle('waveform:savePeaks', (_event, trackId: number, resolution: number, peaks: number[]) => {
    saveWaveformPeaks(trackId, resolution, peaks);
    return true;
  });

  ipcMain.handle('dialog:openFolder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn Thư Mục Chứa Âm Thanh',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openFiles', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn File Âm Thanh',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio Files',
          extensions: ['wav', 'mp3', 'aiff', 'aif', 'flac', 'm4a', 'aac', 'ogg', 'caf']
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return result.filePaths;
  });

  // Export File Dialog and Save
  ipcMain.handle(
    'audio:saveExportedFile',
    async (
      _event,
      payload: { defaultName: string; buffer: ArrayBuffer | Uint8Array; format: 'wav' | 'mp3' }
    ) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: `Xuất Âm Thanh (${payload.format.toUpperCase()})`,
        defaultPath: payload.defaultName,
        filters: [{ name: payload.format.toUpperCase() + ' Audio', extensions: [payload.format] }]
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      const data = Buffer.isBuffer(payload.buffer)
        ? payload.buffer
        : payload.buffer instanceof Uint8Array
        ? Buffer.from(payload.buffer.buffer, payload.buffer.byteOffset, payload.buffer.byteLength)
        : Buffer.from(payload.buffer as ArrayBuffer);
      await fs.promises.writeFile(result.filePath, data);
      return result.filePath;
    }
  );
}

app.whenReady().then(async () => {
  console.log('[Main] App is ready. Initializing database and IPC...');
  initDatabase();
  registerIpcHandlers();
  createWindow();

  setOnLibraryUpdated(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('library:updated');
    }
  });

  await initLibraryWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopDriveHeartbeat();
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopDriveHeartbeat();
  closeDatabase();
});
