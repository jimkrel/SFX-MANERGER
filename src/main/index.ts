import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
  getDatabase,
  getTrackByPath,
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
  toggleTrackType,
  reclassifyAllTracks,
  SearchFilterOptions
} from './db';
import { isBouncedCached, saveBouncedWav, cleanStaleBounceCache, clearBounceCache } from './bouncer';
import {
  initLibraryWatcher,
  watchNewFolder,
  unwatchFolder,
  rescanLibrary,
  setOnLibraryUpdated,
  importDroppedPaths,
  stopLibraryWatcher
} from './indexer';

import { getOrCreateWaveform, stopWaveformWorkers } from './waveformService';
import {
  createQuickLauncherWindow,
  showQuickLauncher,
  hideQuickLauncher,
  toggleQuickLauncher,
  registerQuickLauncherShortcut,
  updateQuickLauncherShortcut,
  getCurrentShortcut,
  setQuickLauncherHeight,
  checkAccessibilityPermission,
  openAccessibilitySettings,
  setOnAccessibilityGranted,
  unregisterAllQuickLauncherShortcuts,
  closeQuickLauncherWindow
} from './quickLauncher';

import { getBinaryStatus, installYtDlpBinary, installFfmpegBinary, installAllBinaries } from './downloader/binaryManager';
import { fetchMediaInfo, downloadAudio, DownloadOptions } from './downloader/engine';

const activeDownloadJobs = new Map<string, { abort: () => void }>();

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

  mainWindow.on('close', (e) => {
    if (!quitting) {
      if (process.platform === 'darwin') {
        e.preventDefault();
        mainWindow?.hide();
      } else {
        closeQuickLauncherWindow();
        quitting = true;
        app.quit();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create proper CF_HDROP buffer for Windows file clipboard format
// Reference: https://docs.microsoft.com/en-us/windows/win32/api/shlobj_core/ns-shlobj_core-dropfiles
// CF_HDROP structure: 20-byte header + UTF-16LE paths + double-null terminator
function createCFHDROPBuffer(filePaths: string[]): Buffer {
  // DROPFILES header (20 bytes)
  const headerBuf = Buffer.alloc(20);
  headerBuf.writeUInt32LE(20, 0);   // pFiles: offset to first path (always 20)
  headerBuf.writeUInt32LE(0, 4);    // pt.x: drop point x (0)
  headerBuf.writeUInt32LE(0, 8);    // pt.y: drop point y (0)
  headerBuf.writeUInt32LE(0, 12);   // fNC: client area flag (0)
  headerBuf.writeUInt32LE(1, 16);   // fWide: 1 = Unicode (UTF-16LE), 0 = ANSI

  // Encode each path as UTF-16LE with null-terminator
  const pathBufs = filePaths.map((filePath) => {
    return Buffer.from(filePath + '\0', 'utf16le');
  });

  // Concatenate all paths
  const pathsBuf = Buffer.concat(pathBufs);

  // Double null-terminator (signals end of list)
  const doubleNull = Buffer.from('\0\0', 'utf16le');

  // Return combined buffer
  return Buffer.concat([headerBuf, pathsBuf, doubleNull]);
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

  ipcMain.handle('db:status', () => {
    const database = getDatabase();
    return { connected: database.open, path: database.name, sqliteVersion: (database.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version };
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

  ipcMain.handle('track:setBpm', (_event, trackId: number, bpm: number | null, version?: number) => {
    updateTrackBpm(trackId, bpm, version);
    return true;
  });

  ipcMain.handle('track:setPeakGain', (_event, trackId: number, peakGain: number, version?: number) => {
    updateTrackPeakGain(trackId, peakGain, version);
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

  ipcMain.handle('track:toggleType', (_event, trackId: number) => {
    return toggleTrackType(trackId);
  });

  ipcMain.handle('library:reclassifyAll', () => {
    return reclassifyAllTracks();
  });

  // On-The-Fly Broadcast WAV Bouncing IPC Handlers
  ipcMain.handle('bouncer:isCached', (_event, sourcePath: string) => {
    return isBouncedCached(sourcePath);
  });

  ipcMain.handle('bouncer:saveWav', (_event, sourcePath: string, wavBuffer: Uint8Array, sourceToken?: string) => {
    return saveBouncedWav(sourcePath, wavBuffer, sourceToken);
  });

  ipcMain.handle('bouncer:clearCache', () => {
    return clearBounceCache();
  });

  // Diagnostic logger for drag & drop flow
  const logDragDebug = (step: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${step} ${data !== undefined ? JSON.stringify(data, null, 2) : ''}\n`;
    try {
      fs.appendFileSync('/tmp/sfx_drag_debug.log', line);
    } catch {
      // ignore
    }
    console.log(line);
  };

  ipcMain.on('log:drag', (_event, step: string, data?: unknown) => {
    logDragDebug(step, data);
  });

  /**
   * Prepare an audio file for zero-latency CapCut / NLE timeline import.
   * Preserves the EXACT original format and file extension (MP3 stays MP3, WAV stays WAV).
   * If on an external volume (/Volumes/...), fast-copies the original file to ~/Downloads/.sfx-fast-drop
   * so sandboxed NLEs (CapCut) have instant native local APFS SSD speed identical to dragging from ~/Downloads!
   */
  const prepareNleTrack = (sourcePath: string): string => {
    try {
      const norm = path.normalize(path.resolve(sourcePath));
      if (!fs.existsSync(norm)) return norm;

      // If already on local internal disk (not on /Volumes/ external drive), use original path directly!
      if (!norm.startsWith('/Volumes/')) {
        return norm;
      }

      // If on external drive (/Volumes/...), fast-copy original file to ~/Downloads/.sfx-fast-drop
      // preserving the exact original extension and format (MP3 stays MP3, WAV stays WAV).
      const dropBase = process.platform === 'darwin'
        ? path.join(os.homedir(), 'Downloads', '.sfx-fast-drop')
        : path.join(os.tmpdir(), 'sfx-fast-drop');

      if (!fs.existsSync(dropBase)) {
        try { fs.mkdirSync(dropBase, { recursive: true }); } catch {}
      }

      const fileName = path.basename(norm);
      const targetOrig = path.join(dropBase, fileName);
      const srcStat = fs.statSync(norm);

      if (!fs.existsSync(targetOrig) || fs.statSync(targetOrig).size !== srcStat.size) {
        fs.copyFileSync(norm, targetOrig);
      }
      return targetOrig;
    } catch {
      return sourcePath;
    }
  };

  ipcMain.handle('drag:prewarm', (_event, filePath: string) => {
    return prepareNleTrack(filePath);
  });

  // Native Drag & Drop to external apps (single or multi-file) with OS path normalization
  // Ensures compatibility across Windows, macOS, and Linux:
  // - 'file': validPaths[0] provides backwards-compatible single file pointer for standard shell handlers
  // - 'files': validPaths provides multi-file list for OLE CF_HDROP drop targets (Explorer, CapCut, Premiere, etc.)
  ipcMain.on('drag:start', (event, filePathOrPaths: string | string[], iconDataUrl?: string) => {
    logDragDebug('[MAIN STEP 4] Received drag:start IPC', {
      filePathOrPaths,
      hasIconDataUrl: Boolean(iconDataUrl),
      platform: process.platform
    });

    const rawPaths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    // Check path existence with detailed error capture
    const pathChecks = rawPaths.map((p) => {
      const normalized = path.normalize(path.resolve(p));
      let exists = false;
      let statInfo: unknown = null;
      let statError: string | null = null;
      try {
        exists = fs.existsSync(normalized);
        if (exists) {
          const st = fs.statSync(normalized);
          statInfo = { size: st.size, isFile: st.isFile(), mode: st.mode };
        }
      } catch (err: any) {
        statError = String(err);
      }
      return { original: p, normalized, exists, statInfo, statError };
    });

    logDragDebug('[MAIN STEP 4.1] Checked paths existence', pathChecks);

    const validPaths = pathChecks.filter((c) => c.exists).map((c) => c.normalized);

    // Prepare files in ~/Downloads/.sfx-fast-drop using Apple CoreAudio afconvert to Broadcast WAV 48kHz.
    // This matches Mac Downloads folder speed and permissions: 0ms CapCut decode, 0ms sandbox latency!
    const nleOptimizedPaths = validPaths.map((originalPath) => prepareNleTrack(originalPath));

    if (nleOptimizedPaths.length > 0) {
      let dragIcon: Electron.NativeImage | null = null;
      if (iconDataUrl && iconDataUrl.startsWith('data:image')) {
        try {
          dragIcon = nativeImage.createFromDataURL(iconDataUrl);
        } catch {
          dragIcon = null;
        }
      }

      // Valid 32x32 amber drag icon Data URL (guaranteed non-empty NativeImage on macOS & Windows)
      const VALID_DRAG_ICON_DATA_URL =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVRIiWOMWXqTgZaAiaamj1owasGoBaMWjFowasGoBaMWjFowasGoBVQEAACXAhpVoD0PAAAAAElFTkSuQmCC';

      if (!dragIcon || dragIcon.isEmpty()) {
        try {
          dragIcon = nativeImage.createFromDataURL(VALID_DRAG_ICON_DATA_URL);
        } catch {
          dragIcon = null;
        }
      }

      // If still somehow empty, create direct raw RGBA bitmap (guaranteed non-empty NativeImage)
      if (!dragIcon || dragIcon.isEmpty()) {
        const rawBuf = Buffer.alloc(32 * 32 * 4);
        for (let i = 0; i < 32 * 32; i++) {
          rawBuf[i * 4 + 0] = 0xd9; // R (#d9a55c)
          rawBuf[i * 4 + 1] = 0xa5; // G
          rawBuf[i * 4 + 2] = 0x5c; // B
          rawBuf[i * 4 + 3] = 0xff; // A
        }
        dragIcon = nativeImage.createFromBitmap(rawBuf, { width: 32, height: 32 });
      }

      logDragDebug('[MAIN STEP 5] Preparing event.sender.startDrag', {
        file: nleOptimizedPaths[0],
        files: nleOptimizedPaths,
        original: validPaths[0],
        iconIsEmpty: dragIcon?.isEmpty(),
        iconSize: dragIcon?.getSize()
      });

      try {
        event.sender.startDrag({
          file: nleOptimizedPaths[0],
          files: nleOptimizedPaths,
          icon: dragIcon
        });
        logDragDebug('[MAIN STEP 5.1] event.sender.startDrag CALLED SUCCESSFULLY');
      } catch (err: any) {
        logDragDebug('[MAIN STEP 5 ERROR] startDrag threw exception', {
          message: err?.message,
          stack: err?.stack,
          rawError: String(err)
        });
        console.error('[Main] startDrag failed with detail:', err);
      } finally {
        // On Windows: DoDragDrop is a blocking call. When it completes or cancels, notify renderer.
        // On macOS: startDrag is non-blocking in Cocoa. Sending drag:ended immediately in finally
        // causes renderer to reset isInternalDragging while cursor is still in motion, causing
        // drop overlay to intercept the cursor.
        if (process.platform === 'win32') {
          logDragDebug('[MAIN STEP 6] Sending drag:ended to renderer (Windows DoDragDrop completed)');
          event.sender.send('drag:ended');
        } else {
          logDragDebug('[MAIN STEP 6] macOS: startDrag initiated asynchronously, skipping immediate drag:ended');
        }
      }
    } else {
      logDragDebug('[MAIN STEP 5 WARNING] No valid paths found (all failed fs.existsSync)!', {
        rawPaths,
        pathChecks
      });
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

  // Copy file paths to clipboard using CF_HDROP format on Windows
  // On Windows: Creates proper OLE clipboard format so Ctrl+V pastes actual files
  // On Mac: Falls back to newline-separated text (standard behavior)
  // 
  // UIPI Fallback (Windows only):
  // When app running as non-elevated tries to drag to elevated app (e.g. CapCut admin),
  // this allows user to use Ctrl+V workaround: Copy here → Open Explorer → Paste
  ipcMain.handle('shell:copyPaths', (_event, paths: string[]) => {
    const normalized = paths
      .map((p) => path.normalize(path.resolve(p)))
      .filter((p) => fs.existsSync(p));

    if (normalized.length === 0) return false;

    if (process.platform === 'win32') {
      // Windows: Try CF_HDROP (proper file clipboard format)
      try {
        const cfHdropBuffer = createCFHDROPBuffer(normalized);
        clipboard.writeBuffer('CF_HDROP', cfHdropBuffer);
        console.log(`[Main] CF_HDROP clipboard: ${normalized.length} file(s) copied`);
        return true;
      } catch (err) {
        console.error('[Main] CF_HDROP write failed, fallback to text:', err);
        // Fallback to plain text if CF_HDROP fails
        clipboard.writeText(normalized.join('\n'));
        return false;
      }
    } else {
      // Mac/Linux: Plain text fallback (newline-separated paths)
      clipboard.writeText(normalized.join('\n'));
      return true;
    }
  });

  // File & Waveform Handlers
  ipcMain.handle('file:readBuffer', async (_event, filePath: string, trackId?: number, version?: number) => {
    try {
      const track = trackId === undefined ? undefined : getTrackByPath(filePath);
      if (trackId !== undefined && (!track || track.id !== trackId || track.is_missing || (version !== undefined && track.content_version !== version))) return null;
      const before = await fs.promises.stat(filePath);
      if (track && track.file_size != null && (before.size !== track.file_size || before.mtimeMs !== track.file_mtime)) return null;
      const buffer = await fs.promises.readFile(filePath);
      const after = await fs.promises.stat(filePath);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return null;
      return buffer;
    } catch (err) {
      console.error('[Main] Failed to read audio file:', err);
      return null;
    }
  });

  ipcMain.handle('waveform:getPeaks', (_event, trackId: number, resolution: number, version?: number) => {
    return getOrCreateWaveform(trackId, resolution, version);
  });

  ipcMain.handle('waveform:savePeaks', (_event, trackId: number, resolution: number, peaks: number[], version?: number) => {
    saveWaveformPeaks(trackId, resolution, peaks, version);
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

  // Quick Launcher IPC handlers
  ipcMain.handle('quickLauncher:show', () => {
    showQuickLauncher();
  });

  ipcMain.handle('quickLauncher:hide', () => {
    hideQuickLauncher();
  });

  ipcMain.handle('quickLauncher:toggle', () => {
    toggleQuickLauncher();
  });

  ipcMain.handle('quickLauncher:setHeight', (_event, height: number) => {
    setQuickLauncherHeight(height);
  });

  ipcMain.handle('settings:getQuickLauncherShortcut', () => {
    return getCurrentShortcut();
  });

  ipcMain.handle('settings:setQuickLauncherShortcut', (_event, newShortcut: string) => {
    return updateQuickLauncherShortcut(newShortcut);
  });

  ipcMain.handle('system:checkAccessibility', (_event, prompt = false) => {
    return checkAccessibilityPermission(prompt);
  });

  ipcMain.handle('system:openAccessibilitySettings', () => {
    openAccessibilitySettings();
  });

  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });

  // Downloader IPC handlers
  ipcMain.handle('downloader:checkStatus', async () => {
    return await getBinaryStatus();
  });

  ipcMain.handle('downloader:install', async (event) => {
    return await installAllBinaries((percent, statusText) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('downloader:installProgress', { percent, statusText });
      }
    });
  });

  ipcMain.handle('downloader:installFfmpeg', async (event) => {
    return await installFfmpegBinary((percent, statusText) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('downloader:installProgress', { percent, statusText });
      }
    });
  });

  ipcMain.handle('downloader:getInfo', async (_event, url: string) => {
    return await fetchMediaInfo(url);
  });

  ipcMain.handle('downloader:start', async (event, options: DownloadOptions) => {
    return await downloadAudio(
      options,
      (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('downloader:progress', { url: options.url, ...progress });
        }
      },
      activeDownloadJobs
    );
  });

  ipcMain.handle('downloader:cancel', (_event, url: string) => {
    const job = activeDownloadJobs.get(url);
    if (job) {
      job.abort();
      activeDownloadJobs.delete(url);
      return true;
    }
    return false;
  });
}

app.whenReady().then(async () => {
  console.log('[Main] App is ready. Initializing database and IPC...');
  initDatabase();
  cleanStaleBounceCache(24);
  registerIpcHandlers();
  createWindow();

  // Initialize Quick Launcher window and register global hotkey
  createQuickLauncherWindow();
  registerQuickLauncherShortcut();

  setOnAccessibilityGranted(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:accessibilityStatusChanged', { granted: true });
    }
  });

  setOnLibraryUpdated(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('library:updated');
    }
  });

  void initLibraryWatcher().catch(error => console.error('[Indexer] Startup failed', error));

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitting = false;
let isCleanedUp = false;
let isCleaningUp = false;

async function performShutdownCleanup(): Promise<void> {
  closeQuickLauncherWindow();
  unregisterAllQuickLauncherShortcuts();
  try {
    await stopWaveformWorkers();
  } catch (err) {
    console.error('[App] Error stopping waveform workers:', err);
  }
  try {
    await stopLibraryWatcher();
  } catch (err) {
    console.error('[App] Error stopping library watcher:', err);
  }
  try {
    closeDatabase();
  } catch (err) {
    console.error('[App] Error closing database:', err);
  }
}

app.on('before-quit', (event) => {
  if (isCleanedUp) return;
  event.preventDefault();
  if (isCleaningUp) return;
  isCleaningUp = true;
  quitting = true;
  void performShutdownCleanup().finally(() => {
    isCleanedUp = true;
    app.quit();
  });
});
