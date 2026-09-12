import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { initDatabase, closeDatabase } from './db';
import chokidar from 'chokidar';

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
}

app.whenReady().then(() => {
  console.log('[Main] App is ready. Initializing database and IPC...');
  initDatabase();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
