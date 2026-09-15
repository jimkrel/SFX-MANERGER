import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  upsertTracks,
  TrackInput,
  markTrackMissing,
  checkMissingTracks,
  getWatchedFolders,
  addWatchedFolder,
  removeWatchedFolder,
  getTrackByPath
} from './db';
import { readWavPeaks } from './waveformService';
import { parseAudioMetadata } from './fastAudioParser';

export { parseAudioMetadata };

const SUPPORTED_EXTENSIONS = new Set([
  '.wav',
  '.mp3',
  '.aiff',
  '.aif',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.caf'
]);

let watchers: Map<string, FSWatcher> = new Map();
const finishWatching = new Map<string, () => void>();
let onLibraryUpdatedCallback: (() => void) | null = null;
let notifyTimeout: NodeJS.Timeout | null = null;

export function setOnLibraryUpdated(callback: () => void): void {
  onLibraryUpdatedCallback = callback;
}

export function notifyUpdated(): void {
  if (notifyTimeout) {
    clearTimeout(notifyTimeout);
  }
  notifyTimeout = setTimeout(() => {
    if (onLibraryUpdatedCallback) {
      onLibraryUpdatedCallback();
    }
    notifyTimeout = null;
  }, 150);
}

export function flushNotifyUpdated(): void {
  if (notifyTimeout) {
    clearTimeout(notifyTimeout);
    notifyTimeout = null;
  }
  if (onLibraryUpdatedCallback) {
    onLibraryUpdatedCallback();
  }
}

export function isAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Rapid parallel directory scanner for audio files.
 * Crawls directory trees concurrently up to 16 directories at once.
 */
export async function scanDirectoryForAudioFiles(dirPath: string): Promise<string[]> {
  const audioFiles: string[] = [];
  const dirsToScan: string[] = [path.normalize(path.resolve(dirPath))];

  while (dirsToScan.length > 0) {
    const currentDirs = dirsToScan.splice(0, 16);
    const results = await Promise.allSettled(
      currentDirs.map(async (dir) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const subDirs: string[] = [];
        const files: string[] = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            subDirs.push(fullPath);
          } else if (entry.isFile() && isAudioFile(fullPath)) {
            files.push(fullPath);
          }
        }
        return { subDirs, files };
      })
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        dirsToScan.push(...res.value.subDirs);
        audioFiles.push(...res.value.files);
      }
    }
  }

  return audioFiles;
}

// Bounded queue for processing files with high concurrency.
let shuttingDown = false;
let draining: Promise<void> | null = null;
type IndexJob = { filePath: string; resolve: () => void; reject: (error: unknown) => void };
const indexQueue: IndexJob[] = [];
const inFlight = new Map<string, Promise<void>>();

const BATCH_SIZE = Math.max(12, Math.min(32, (os.cpus()?.length || 4) * 2));

async function prepareFile(filePath: string): Promise<TrackInput | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await fs.promises.stat(filePath);
    if (!before.isFile()) return null;
    const existing = getTrackByPath(filePath);
    if (existing && !existing.is_missing && existing.file_size === before.size && existing.file_mtime === before.mtimeMs) return null;
    const metadata = await parseAudioMetadata(filePath);
    const peaks80 = await readWavPeaks(filePath, 80);
    const after = await fs.promises.stat(filePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
    return { path: filePath, ...metadata, fileSize: after.size, fileMtime: after.mtimeMs, peaks80 };
  }
  throw new Error('File is still changing: ' + filePath);
}

async function drain(): Promise<void> {
  while (indexQueue.length && !shuttingDown) {
    const jobs = indexQueue.splice(0, BATCH_SIZE);
    const results = await Promise.allSettled(jobs.map(job => prepareFile(job.filePath)));
    try {
      const rows = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
      if (!shuttingDown && rows.length) {
        upsertTracks(rows);
        notifyUpdated();
      }
      jobs.forEach((job, i) => {
        inFlight.delete(job.filePath);
        const result = results[i];
        if (result.status === 'rejected') job.reject(result.reason); else job.resolve();
      });
    } catch (error) {
      for (const job of jobs) {
        inFlight.delete(job.filePath);
        job.reject(error);
      }
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

export function indexFile(filePath: string): Promise<void> {
  const normalized = path.normalize(path.resolve(filePath));
  if (shuttingDown || !isAudioFile(normalized)) return Promise.resolve();
  const current = inFlight.get(normalized);
  if (current) return current;
  const job = new Promise<void>((resolve, reject) => indexQueue.push({ filePath: normalized, resolve, reject }));
  inFlight.set(normalized, job);
  if (!draining) {
    draining = new Promise<void>(resolve => setImmediate(resolve)).then(drain).finally(() => { draining = null; });
  }
  return job;
}

export async function startWatchingFolder(
  folderPath: string,
  onFileIndexed?: (filePath?: string) => void,
  options?: { scanExisting?: boolean }
): Promise<number> {
  const folder = path.normalize(path.resolve(folderPath));
  if (shuttingDown || watchers.has(folder) || !fs.existsSync(folder)) return 0;

  let count = 0;
  if (options?.scanExisting !== false) {
    try {
      const existingFiles = await scanDirectoryForAudioFiles(folder);
      if (existingFiles.length > 0) {
        await Promise.all(
          existingFiles.map(async (file) => {
            try {
              await indexFile(file);
              count++;
              onFileIndexed?.(file);
            } catch (err) {
              console.warn('[Indexer] Error indexing file:', err);
            }
          })
        );
      }
    } catch (err) {
      console.warn('[Indexer] Scan directory error:', err);
    }
  }

  if (shuttingDown) return count;

  // Watch for subsequent real-time changes with ignoreInitial: true (eliminates redundant 400ms re-crawling)
  const watcher = chokidar.watch(folder, {
    ignored: file => path.basename(file).startsWith('.'),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }
  });
  watchers.set(folder, watcher);

  const pending = new Set<Promise<void>>();
  const onFile = (file: string) => {
    if (shuttingDown || !isAudioFile(file)) return;
    const task = indexFile(file)
      .then(() => { count++; onFileIndexed?.(file); })
      .catch(error => console.warn('[Indexer]', error));
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  watcher.on('add', onFile);
  watcher.on('change', onFile);
  watcher.on('unlink', file => {
    if (!shuttingDown && isAudioFile(file)) {
      markTrackMissing(file, true);
      notifyUpdated();
    }
  });

  return new Promise(resolve => {
    let ready = false;
    const finish = async () => {
      if (ready) return;
      ready = true;
      while (pending.size) await Promise.all(pending);
      finishWatching.delete(folder);
      resolve(count);
    };
    finishWatching.set(folder, () => { void finish(); });
    watcher.once('ready', () => { void finish(); });
    watcher.on('error', error => { console.warn('[Indexer] Watch failed', error); void finish(); });
  });
}

export async function stopWatchingFolder(folderPath: string): Promise<void> {
  const folder = path.normalize(path.resolve(folderPath));
  const watcher = watchers.get(folder);
  watchers.delete(folder);
  finishWatching.get(folder)?.();
  await watcher?.close();
}

let driveHeartbeatInterval: NodeJS.Timeout | null = null;
let activeRescan: Promise<{ checked: number; missing: number; recovered: number }> | null = null;

export function rescanLibrary(): Promise<{ checked: number; missing: number; recovered: number }> {
  if (activeRescan) return activeRescan;
  activeRescan = (async () => {
    const result = await checkMissingTracks();
    if (!shuttingDown) {
      // Queue only paths whose signature changed, including files edited while the app was closed.
      await Promise.all(result.changedPaths.map(file => indexFile(file).catch(error => console.warn('[Indexer]', error))));
      for (const folder of getWatchedFolders()) {
        if (!watchers.has(path.normalize(path.resolve(folder)))) {
          await startWatchingFolder(folder, undefined, { scanExisting: false });
        }
      }
      if (result.changedPaths.length || result.missing) flushNotifyUpdated();
    }
    return { checked: result.checked, missing: result.missing, recovered: result.recovered };
  })().finally(() => { activeRescan = null; });
  return activeRescan;
}

export function startDriveHeartbeat(): void {
  if (driveHeartbeatInterval) return;
  // File events handle local changes immediately. Slow/offline drives never block IPC.
  driveHeartbeatInterval = setInterval(() => { void rescanLibrary().catch(console.warn); }, 30000);
}

export function stopDriveHeartbeat(): void {
  if (driveHeartbeatInterval) clearInterval(driveHeartbeatInterval);
  driveHeartbeatInterval = null;
}

export async function initLibraryWatcher(): Promise<void> {
  startDriveHeartbeat();
  await rescanLibrary();
}

export async function stopLibraryWatcher(): Promise<void> {
  shuttingDown = true;
  stopDriveHeartbeat();
  if (notifyTimeout) clearTimeout(notifyTimeout);
  notifyTimeout = null;
  for (const job of indexQueue.splice(0)) { inFlight.delete(job.filePath); job.resolve(); }
  for (const finish of finishWatching.values()) finish();
  await Promise.all([...watchers.values()].map(watcher => watcher.close()));
  watchers.clear();
  await draining;
  await activeRescan;
}

export async function watchNewFolder(folderPath: string, onFileIndexed?: (filePath?: string) => void): Promise<number> {
  const folder = path.normalize(path.resolve(folderPath));
  addWatchedFolder(folder);
  return startWatchingFolder(folder, onFileIndexed, { scanExisting: true });
}

export async function unwatchFolder(folderPath: string): Promise<void> {
  const folder = path.normalize(path.resolve(folderPath));
  removeWatchedFolder(folder);
  await stopWatchingFolder(folder);
}

export async function importDroppedPaths(paths: string[]): Promise<{ imported: number; folders: number; errors: string[] }> {
  let imported = 0, folders = 0;
  const errors: string[] = [];
  const filesToIndex: string[] = [];
  const newFolders: string[] = [];

  for (const input of paths) {
    const file = path.normalize(path.resolve(input));
    try {
      const stat = await fs.promises.stat(file);
      if (stat.isDirectory()) {
        folders++;
        newFolders.push(file);
        const folderAudioFiles = await scanDirectoryForAudioFiles(file);
        filesToIndex.push(...folderAudioFiles);
      } else if (stat.isFile() && isAudioFile(file)) {
        filesToIndex.push(file);
      } else {
        errors.push('Định dạng không được hỗ trợ: ' + file);
      }
    } catch (error) {
      errors.push(file + ': ' + String(error));
    }
  }

  if (filesToIndex.length > 0) {
    await Promise.all(
      filesToIndex.map(async (file) => {
        try {
          await indexFile(file);
          imported++;
        } catch (error) {
          errors.push(file + ': ' + String(error));
        }
      })
    );
  }

  for (const folder of newFolders) {
    addWatchedFolder(folder);
    await startWatchingFolder(folder, undefined, { scanExisting: false });
  }

  flushNotifyUpdated();
  return { imported, folders, errors };
}
