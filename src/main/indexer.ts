import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import fs from 'fs';
import {
  upsertTrack,
  markTrackMissing,
  checkMissingTracks,
  getWatchedFolders,
  addWatchedFolder,
  removeWatchedFolder,
  getTrackByPath
} from './db';

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
  const normPath = filePath.normalize('NFC');
  if (!isAudioFile(normPath)) return;
  if (!fs.existsSync(normPath)) return;

  const metadata = await parseAudioMetadata(normPath);
  upsertTrack({
    path: normPath,
    name: metadata.name,
    duration: metadata.duration,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels
  });
  notifyUpdated();
}

export function startWatchingFolder(
  folderPath: string,
  onFileIndexed?: () => void
): Promise<void> {
  const normFolder = path.normalize(folderPath).normalize('NFC');
  if (watchers.has(normFolder)) return Promise.resolve();
  if (!fs.existsSync(normFolder)) {
    console.warn(`[Indexer] Folder does not exist: ${normFolder}`);
    return Promise.resolve();
  }

  console.log(`[Indexer] Starting watch on: ${normFolder}`);
  const watcher = chokidar.watch(normFolder, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false,
    depth: 10
  });

  const pendingIndexings: Promise<void>[] = [];

  watcher.on('add', (filePath) => {
    const normFile = path.normalize(filePath).normalize('NFC');
    if (isAudioFile(normFile)) {
      const existing = getTrackByPath(normFile);
      if (!existing || existing.is_missing === 1) {
        const p = indexFile(normFile)
          .then(() => {
            if (onFileIndexed) {
              onFileIndexed();
            }
          })
          .catch((err) => console.error('[Indexer] Error indexing file:', err));
        pendingIndexings.push(p);
      }
    }
  });

  watcher.on('change', async (filePath) => {
    const normFile = path.normalize(filePath).normalize('NFC');
    if (isAudioFile(normFile)) {
      await indexFile(normFile);
    }
  });

  watcher.on('unlink', (filePath) => {
    const normFile = path.normalize(filePath).normalize('NFC');
    if (isAudioFile(normFile)) {
      console.log(`[Indexer] File removed/unlinked: ${normFile}. Marking as missing.`);
      markTrackMissing(normFile, true);
      notifyUpdated();
    }
  });

  watcher.on('error', (error) => {
    console.error(`[Indexer] Watcher error on ${normFolder}:`, error);
  });

  watchers.set(normFolder, watcher);

  return new Promise((resolve) => {
    watcher.on('ready', async () => {
      await Promise.all(pendingIndexings);
      resolve();
    });
  });
}

export async function stopWatchingFolder(folderPath: string): Promise<void> {
  const normFolder = path.normalize(folderPath).normalize('NFC');
  const watcher = watchers.get(normFolder);
  if (watcher) {
    await watcher.close();
    watchers.delete(normFolder);
    console.log(`[Indexer] Stopped watching: ${normFolder}`);
  }
}

let driveHeartbeatInterval: NodeJS.Timeout | null = null;

export function startDriveHeartbeat(): void {
  if (driveHeartbeatInterval) return;
  driveHeartbeatInterval = setInterval(() => {
    const result = checkMissingTracks();
    if (result.missing > 0 || result.recovered > 0) {
      notifyUpdated();
    }
  }, 5000);
}

export function stopDriveHeartbeat(): void {
  if (driveHeartbeatInterval) {
    clearInterval(driveHeartbeatInterval);
    driveHeartbeatInterval = null;
  }
}

export function initLibraryWatcher(): void {
  checkMissingTracks();
  const folders = getWatchedFolders();
  for (const folder of folders) {
    startWatchingFolder(path.normalize(folder).normalize('NFC'));
  }
  startDriveHeartbeat();
}

export async function watchNewFolder(
  folderPath: string,
  onFileIndexed?: () => void
): Promise<void> {
  const normFolder = path.normalize(folderPath).normalize('NFC');
  addWatchedFolder(normFolder);
  await startWatchingFolder(normFolder, onFileIndexed);
}

export async function unwatchFolder(folderPath: string): Promise<void> {
  const normFolder = path.normalize(folderPath).normalize('NFC');
  removeWatchedFolder(normFolder);
  await stopWatchingFolder(normFolder);
}

export function rescanLibrary(): { checked: number; missing: number; recovered: number } {
  const result = checkMissingTracks();
  flushNotifyUpdated();
  return result;
}

export async function importDroppedPaths(paths: string[]): Promise<{
  imported: number;
  folders: number;
  errors: string[];
}> {
  let importedCount = 0;
  let foldersCount = 0;
  const errors: string[] = [];

  for (const p of paths) {
    const rawPath = path.normalize(path.resolve(p)).normalize('NFC');
    if (!fs.existsSync(rawPath)) {
      errors.push(`Đường dẫn không tồn tại: ${rawPath}`);
      continue;
    }

    const stat = fs.statSync(rawPath);
    if (stat.isDirectory()) {
      foldersCount++;
      // Recursive scan: collect all audio files inside the folder
      const scanDir = (dir: string): string[] => {
        const found: string[] = [];
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              found.push(...scanDir(full));
            } else if (entry.isFile() && isAudioFile(full)) {
              found.push(full);
            }
          }
        } catch { /* skip unreadable dirs */ }
        return found;
      };

      const audioFiles = scanDir(rawPath);
      for (const audioFile of audioFiles) {
        const normFile = audioFile.normalize('NFC');
        const existing = getTrackByPath(normFile);
        if (!existing || existing.is_missing === 1) {
          await indexFile(normFile);
          importedCount++;
        } else {
          // Already in library — still count it as present for reporting
          importedCount++;
        }
      }

      // Register the folder as watched (if not already)
      if (!watchers.has(rawPath.normalize('NFC'))) {
        await watchNewFolder(rawPath);
      }

    } else if (stat.isFile()) {
      if (isAudioFile(rawPath)) {
        const existing = getTrackByPath(rawPath);
        if (!existing || existing.is_missing === 1) {
          await indexFile(rawPath);
          importedCount++;
        }
      } else {
        const ext = path.extname(rawPath) || 'không có định dạng';
        errors.push(`[LỖI ĐỊNH DẠNG] File "${path.basename(rawPath)}" (${ext}) không được hỗ trợ. Hỗ trợ: .wav, .mp3, .aiff, .flac, .m4a, .aac, .ogg, .caf.`);
      }
    }
  }

  flushNotifyUpdated();
  return {
    imported: importedCount,
    folders: foldersCount,
    errors
  };
}

