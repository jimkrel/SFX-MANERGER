import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
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
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1C1B19',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch(() => {
      mainWindow?.loadURL(devServerUrl);
    });
  }

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
      platform: process.platform
    };
  });

  ipcMain.handle('db:status', () => {
    try {
      const db = initDatabase();
      const result = db.prepare('SELECT sqlite_version() as version').get() as { version: string };
      return {
        connected: true,
        sqliteVersion: result.version,
        path: path.join(app.getPath('userData'), 'library.db')
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // Library Handlers
  ipcMain.handle('library:getTracks', (_event, options?: SearchFilterOptions) => {
    return getTracks(options);
  });

  ipcMain.handle('library:getWatchedFolders', () => {
    return getWatchedFolders();
  });

  ipcMain.handle('library:addFolder', async (_event, folderPath: string) => {
    await watchNewFolder(folderPath);
    return getWatchedFolders();
  });

  ipcMain.handle('library:removeFolder', async (_event, folderPath: string) => {
    await unwatchFolder(folderPath);
    return getWatchedFolders();
  });

  ipcMain.handle('library:rescan', () => {
    return rescanLibrary();
  });

  // Phase 4: Tag & Stats Handlers
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

  // Native Drag & Drop to external apps (Premiere Pro, DaVinci Resolve, Finder)
  ipcMain.on('drag:start', (event, filePath: string, iconDataUrl?: string) => {
    if (fs.existsSync(filePath)) {
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
        // Fallback transparent 16x16 PNG base64 to ensure Cocoa startDrag never crashes
        const fallback16 =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEUlEQVR42mNk+M+ABzAMNQAA+n0P8fOcf9AAAAAElFTkSuQmCC';
        dragIcon = nativeImage.createFromDataURL(fallback16);
      }

      event.sender.startDrag({
        file: filePath,
        icon: dragIcon
      });
    }
  });

  // Import Dropped Files & Folders
  ipcMain.handle('library:importPaths', async (_event, paths: string[]) => {
    return await importDroppedPaths(paths);
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
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
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
