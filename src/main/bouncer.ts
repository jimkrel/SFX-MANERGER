import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { app } from 'electron';

export interface BounceCheckResult {
  cached: boolean;
  bouncedPath: string;
  bouncePath: string;
}

/**
 * Get the dedicated temporary directory for On-The-Fly Broadcast WAV bouncing.
 */
export function getBounceDir(): string {
  let tempBase: string;
  try {
    tempBase = app ? app.getPath('temp') : os.tmpdir();
  } catch {
    tempBase = os.tmpdir();
  }

  const bounceDir = path.join(tempBase, 'sfx-manager-bounce');
  if (!fs.existsSync(bounceDir)) {
    fs.mkdirSync(bounceDir, { recursive: true });
  }
  return bounceDir;
}

/**
 * Generate a deterministic cached file name based on source path, file size and mtime.
 */
export function getBounceCacheFileName(sourcePath: string): string {
  const normPath = path.normalize(path.resolve(sourcePath));
  let fileStatsSig = '0_0';
  try {
    if (fs.existsSync(normPath)) {
      const st = fs.statSync(normPath);
      fileStatsSig = `${st.size}_${Math.floor(st.mtimeMs)}`;
    }
  } catch {
    // fallback if stat fails
  }

  const hash = crypto
    .createHash('md5')
    .update(`${normPath}_${fileStatsSig}`)
    .digest('hex')
    .slice(0, 10);

  const baseName = path.basename(normPath, path.extname(normPath));
  const sanitizedBase = baseName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  return `${sanitizedBase}_${hash}_48k16b.wav`;
}

/**
 * Check if a fresh Broadcast WAV version of the source audio file is already cached.
 */
export function isBouncedCached(sourcePath: string): BounceCheckResult {
  const bounceDir = getBounceDir();
  const cacheFileName = getBounceCacheFileName(sourcePath);
  const bouncedPath = path.join(bounceDir, cacheFileName);

  const cached = fs.existsSync(bouncedPath) && fs.statSync(bouncedPath).size > 44;
  return {
    cached,
    bouncedPath,
    bouncePath: bouncedPath
  };
}

/**
 * Save an encoded Broadcast WAV PCM buffer to the bounce cache.
 */
export function saveBouncedWav(sourcePath: string, wavBuffer: Buffer | Uint8Array): string {
  const bounceDir = getBounceDir();
  const cacheFileName = getBounceCacheFileName(sourcePath);
  const bouncedPath = path.join(bounceDir, cacheFileName);

  fs.writeFileSync(bouncedPath, Buffer.from(wavBuffer));
  return bouncedPath;
}

/**
 * Remove stale bounce cache files older than maxAgeHours (default 24 hours).
 */
export function cleanStaleBounceCache(maxAgeHours: number = 24): number {
  try {
    const bounceDir = getBounceDir();
    if (!fs.existsSync(bounceDir)) return 0;

    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    let removedCount = 0;

    const files = fs.readdirSync(bounceDir);
    for (const file of files) {
      if (!file.endsWith('.wav')) continue;
      const fullPath = path.join(bounceDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          removedCount++;
        }
      } catch {
        // Skip busy files
      }
    }
    return removedCount;
  } catch (err) {
    console.warn('[Bouncer] Failed to clean stale bounce cache:', err);
    return 0;
  }
}

/**
 * Completely wipe the bounce cache directory.
 */
export function clearBounceCache(): { cleared: number; clearedCount: number; freedBytes: number; totalBytes: number } {
  try {
    const bounceDir = getBounceDir();
    if (!fs.existsSync(bounceDir)) return { cleared: 0, clearedCount: 0, freedBytes: 0, totalBytes: 0 };

    let clearedCount = 0;
    let totalBytes = 0;

    const files = fs.readdirSync(bounceDir);
    for (const file of files) {
      const fullPath = path.join(bounceDir, file);
      try {
        const stat = fs.statSync(fullPath);
        totalBytes += stat.size;
        fs.unlinkSync(fullPath);
        clearedCount++;
      } catch {
        // Skip busy files
      }
    }
    return { cleared: clearedCount, clearedCount, freedBytes: totalBytes, totalBytes };
  } catch (err) {
    console.error('[Bouncer] Failed to clear bounce cache:', err);
    return { cleared: 0, clearedCount: 0, freedBytes: 0, totalBytes: 0 };
  }
}
