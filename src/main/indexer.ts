import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';
import {
  upsertTrack,
  markTrackMissing,
  checkMissingTracks,
  getWatchedFolders,
  addWatchedFolder,
  removeWatchedFolder
} from './db';

const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.aiff', '.aif', '.flac']);

let watchers: Map<string, FSWatcher> = new Map();
let onLibraryUpdatedCallback: (() => void) | null = null;

export function setOnLibraryUpdated(callback: () => void): void {
  onLibraryUpdatedCallback = callback;
}

function notifyUpdated(): void {
  if (onLibraryUpdatedCallback) {
    onLibraryUpdatedCallback();
  }
}

export function isAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export async function parseAudioMetadata(filePath: string): Promise<{
  name: string;
  duration: number;
  sampleRate?: number | null;
  channels?: number | null;
}> {
  const baseName = path.basename(filePath, path.extname(filePath));
  try {
    const mm = await import('music-metadata');
    let metadata = await mm.parseFile(filePath, { duration: true });

    // Fallback: nếu phần mở rộng không khớp cấu trúc thực (VD: file MP3 nhưng đặt đuôi .wav),
    // parseBuffer sẽ tự đọc magic header để nhận diện container & duration thật.
    if (!metadata.format.container || metadata.format.duration === undefined) {
      try {
        const fileBuffer = await fs.promises.readFile(filePath);
        metadata = await mm.parseBuffer(fileBuffer);
      } catch {
        // Giữ kết quả parseFile ban đầu nếu parseBuffer không thành công
      }
    }

    const title = metadata.common.title || baseName;
    const duration = metadata.format.duration || 0;
    const sampleRate = metadata.format.sampleRate || null;
    const channels = metadata.format.numberOfChannels || null;

    return {
      name: title,
      duration,
      sampleRate,
      channels
    };
  } catch (err) {
    console.warn(`[Indexer] Could not parse metadata for ${filePath}:`, err);
    return {
      name: baseName,
      duration: 0,
      sampleRate: null,
      channels: null
    };
  }
}

export async function indexFile(filePath: string): Promise<void> {
  if (!isAudioFile(filePath)) return;
  if (!fs.existsSync(filePath)) return;

  const metadata = await parseAudioMetadata(filePath);
  upsertTrack({
    path: filePath,
    name: metadata.name,
    duration: metadata.duration,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels
  });
  notifyUpdated();
}

export function startWatchingFolder(folderPath: string): void {
  if (watchers.has(folderPath)) return;
  if (!fs.existsSync(folderPath)) {
    console.warn(`[Indexer] Folder does not exist: ${folderPath}`);
    return;
  }

  console.log(`[Indexer] Starting watch on: ${folderPath}`);
  const watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false,
    depth: 10
  });

  watcher.on('add', async (filePath) => {
    if (isAudioFile(filePath)) {
      await indexFile(filePath);
    }
  });

  watcher.on('change', async (filePath) => {
    if (isAudioFile(filePath)) {
      await indexFile(filePath);
    }
  });

  watcher.on('unlink', (filePath) => {
    if (isAudioFile(filePath)) {
      console.log(`[Indexer] File removed/unlinked: ${filePath}. Marking as missing.`);
      markTrackMissing(filePath, true);
      notifyUpdated();
    }
  });

  watcher.on('error', (error) => {
    console.error(`[Indexer] Watcher error on ${folderPath}:`, error);
  });

  watchers.set(folderPath, watcher);
}

export async function stopWatchingFolder(folderPath: string): Promise<void> {
  const watcher = watchers.get(folderPath);
  if (watcher) {
    await watcher.close();
    watchers.delete(folderPath);
    console.log(`[Indexer] Stopped watching: ${folderPath}`);
  }
}

export async function initLibraryWatcher(): Promise<void> {
  // First check missing status for any disconnected files/drives
  checkMissingTracks();

  // Load all watched folders from DB
  const folders = getWatchedFolders();
  for (const folder of folders) {
    startWatchingFolder(folder);
  }
}

export async function watchNewFolder(folderPath: string): Promise<void> {
  addWatchedFolder(folderPath);
  startWatchingFolder(folderPath);
}

export async function unwatchFolder(folderPath: string): Promise<void> {
  removeWatchedFolder(folderPath);
  await stopWatchingFolder(folderPath);
}

export function rescanLibrary(): { checked: number; missing: number; recovered: number } {
  const result = checkMissingTracks();
  notifyUpdated();
  return result;
}
