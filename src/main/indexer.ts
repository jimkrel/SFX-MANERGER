import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';
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

let mmPromise: Promise<typeof import('music-metadata')> | null = null;
function getMusicMetadata(): Promise<typeof import('music-metadata')> {
  if (!mmPromise) {
    mmPromise = new Function('return import("music-metadata")')() as Promise<typeof import('music-metadata')>;
  }
  return mmPromise;
}

export async function parseAudioMetadata(filePath: string): Promise<{
  name: string;
  duration: number;
  sampleRate?: number | null;
  channels?: number | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  bpm?: number | null;
}> {
  const baseName = path.basename(filePath, path.extname(filePath));
  try {
    const mm = await getMusicMetadata();
    let metadata: Awaited<ReturnType<typeof mm.parseFile>>;
    try {
      metadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    } catch {
      // Sniff header bytes if extension is mismatched
      const fd = await fs.promises.open(filePath, 'r');
      try {
        const headerBuf = Buffer.alloc(65536);
        const { bytesRead } = await fd.read(headerBuf, 0, 65536, 0);
        metadata = await mm.parseBuffer(headerBuf.subarray(0, bytesRead), undefined, { duration: true, skipCovers: true });
      } finally {
        await fd.close();
      }
    }

    // Fallback: nếu phần mở rộng không khớp cấu trúc thực hoặc duration chưa xác định
    if (!metadata.format.container || metadata.format.duration === undefined || metadata.format.duration === 0) {
      try {
        // Only read up to first 256KB to inspect headers, avoiding reading entire huge files into RAM
        const fd = await fs.promises.open(filePath, 'r');
        try {
          const headerBuf = Buffer.alloc(262144);
          const { bytesRead } = await fd.read(headerBuf, 0, 262144, 0);
          const sniffed = await mm.parseBuffer(headerBuf.subarray(0, bytesRead), undefined, { duration: true, skipCovers: true });
          if (sniffed.format.duration) {
            metadata = sniffed;
          }
        } finally {
          await fd.close();
        }
      } catch {
        // Giữ kết quả parseFile ban đầu nếu parseBuffer không thành công
      }
    }

    const title = metadata.common.title || baseName;
    const duration = metadata.format.duration || 0;
    const sampleRate = metadata.format.sampleRate || null;
    const channels = metadata.format.numberOfChannels || null;
    const artist = metadata.common.artist || (metadata.common.artists && metadata.common.artists[0]) || null;
    const album = metadata.common.album || null;
    const genre = (metadata.common.genre && metadata.common.genre[0]) || null;
    const bpm = metadata.common.bpm || null;

    return {
      name: title,
      duration,
      sampleRate,
      channels,
      artist,
      album,
      genre,
      bpm
    };
  } catch (err) {
    console.warn(`[Indexer] Could not parse metadata for ${filePath}:`, err);
    return {
      name: baseName,
      duration: 0,
      sampleRate: null,
      channels: null,
      artist: null,
      album: null,
      genre: null,
      bpm: null
    };
  }
}

// One bounded queue for dropped files, initial scans and live watcher events.
// Parse outside SQLite; commit each completed group in one short transaction.
let shuttingDown = false;
let draining: Promise<void> | null = null;
type IndexJob = { filePath: string; resolve: () => void; reject: (error: unknown) => void };
const indexQueue: IndexJob[] = [];
const inFlight = new Map<string, Promise<void>>();

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
    const jobs = indexQueue.splice(0, 6);
    const results = await Promise.allSettled(jobs.map(job => prepareFile(job.filePath)));
    try {
      const rows = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
      if (!shuttingDown && rows.length) { upsertTracks(rows); notifyUpdated(); }
      jobs.forEach((job, i) => {
        inFlight.delete(job.filePath);
        const result = results[i];
        if (result.status === 'rejected') job.reject(result.reason); else job.resolve();
      });
    } catch (error) {
      for (const job of jobs) { inFlight.delete(job.filePath); job.reject(error); }
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

export function startWatchingFolder(folderPath: string, onFileIndexed?: (filePath?: string) => void): Promise<number> {
  const folder = path.normalize(path.resolve(folderPath));
  if (shuttingDown || watchers.has(folder) || !fs.existsSync(folder)) return Promise.resolve(0);
  const watcher = chokidar.watch(folder, {
    ignored: file => path.basename(file).startsWith('.'),
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }
  });
  watchers.set(folder, watcher);
  let count = 0;
  const pending = new Set<Promise<void>>();
  const onFile = (file: string) => {
    if (shuttingDown || !isAudioFile(file)) return;
    const task = indexFile(file).then(() => { count++; onFileIndexed?.(file); })
      .catch(error => console.warn('[Indexer]', error));
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  watcher.on('unlink', file => {
    if (!shuttingDown && isAudioFile(file)) { markTrackMissing(file, true); notifyUpdated(); }
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
        if (!watchers.has(path.normalize(path.resolve(folder)))) await startWatchingFolder(folder);
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
  return startWatchingFolder(folder, onFileIndexed);
}

export async function unwatchFolder(folderPath: string): Promise<void> {
  const folder = path.normalize(path.resolve(folderPath));
  removeWatchedFolder(folder);
  await stopWatchingFolder(folder);
}

export async function importDroppedPaths(paths: string[]): Promise<{ imported: number; folders: number; errors: string[] }> {
  let imported = 0, folders = 0;
  const errors: string[] = [];
  const batch: string[] = [];
  const flush = async () => {
    const files = batch.splice(0);
    await Promise.all(files.map(async file => {
      try { await indexFile(file); imported++; }
      catch (error) { errors.push(file + ': ' + String(error)); }
    }));
  };
  const enqueue = async (file: string) => { batch.push(file); if (batch.length >= 24) await flush(); };
  const scan = async (dir: string): Promise<void> => {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(full);
        else if (entry.isFile() && isAudioFile(full)) await enqueue(full);
      }
    } catch (error) { errors.push(dir + ': ' + String(error)); }
  };
  const newFolders: string[] = [];
  for (const input of paths) {
    const file = path.normalize(path.resolve(input));
    try {
      const stat = await fs.promises.stat(file);
      if (stat.isDirectory()) { folders++; await scan(file); newFolders.push(file); }
      else if (stat.isFile() && isAudioFile(file)) await enqueue(file);
      else errors.push('Định dạng không được hỗ trợ: ' + file);
    } catch (error) { errors.push(file + ': ' + String(error)); }
  }
  await flush();
  for (const folder of newFolders) await watchNewFolder(folder);
  flushNotifyUpdated();
  return { imported, folders, errors };
}
