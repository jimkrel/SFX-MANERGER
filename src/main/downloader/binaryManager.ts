import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import https from 'https';
import zlib from 'zlib';

export interface BinaryStatus {
  isReady: boolean;
  hasYtDlp: boolean;
  hasFfmpeg: boolean;
  canDownloadVideo: boolean;
  ytDlpPath: string | null;
  ffmpegPath: string | null;
  version?: string;
}

const isWindows = process.platform === 'win32';
const ytDlpFilename = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ffmpegFilename = isWindows ? 'ffmpeg.exe' : 'ffmpeg';

let cachedYtDlpPath: string | null = null;
let cachedFfmpegPath: string | null = null;

import os from 'os';

export function getLocalBinDir(): string {
  let userData = '';
  try {
    if (app && typeof app.getPath === 'function') {
      userData = app.getPath('userData');
    }
  } catch {}
  if (!userData) {
    userData = process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'sfx-music-manager')
      : path.join(os.homedir(), '.sfx-music-manager');
  }
  const binDir = path.join(userData, 'bin');
  if (!fs.existsSync(binDir)) {
    try {
      fs.mkdirSync(binDir, { recursive: true });
    } catch {}
  }
  return binDir;
}

function checkExecutable(execPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(execPath, args, { timeout: 15000 }, (error, stdout) => {
      if (error) {
        try {
          if (fs.existsSync(execPath) && fs.statSync(execPath).size > 10 * 1024 * 1024) {
            return resolve('verified');
          }
        } catch {}
        resolve(null);
      } else {
        resolve(stdout.trim() || 'verified');
      }
    });
  });
}

function findInPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const lookupTool = isWindows ? 'where' : 'which';
    execFile(lookupTool, [command], { timeout: 3000 }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
      } else {
        const firstLine = stdout.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
          resolve(firstLine);
        } else {
          resolve(null);
        }
      }
    });
  });
}

export async function findYtDlp(): Promise<string | null> {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath;
  }

  // 1. Check local app bin dir
  const localBin = path.join(getLocalBinDir(), ytDlpFilename);
  if (fs.existsSync(localBin)) {
    const ver = await checkExecutable(localBin, ['--version']);
    if (ver) {
      cachedYtDlpPath = localBin;
      return localBin;
    }
  }

  // 2. Check system PATH
  const fromPath = await findInPath('yt-dlp');
  if (fromPath) {
    const ver = await checkExecutable(fromPath, ['--version']);
    if (ver) {
      cachedYtDlpPath = fromPath;
      return fromPath;
    }
  }

  // 3. Common fallback locations on Windows
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const userProfile = process.env.USERPROFILE || '';
    const candidates = [
      path.join(localAppData, 'Programs', 'Python', 'Python310', 'Scripts', 'yt-dlp.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
      path.join(userProfile, 'scoop', 'shims', 'yt-dlp.exe'),
      'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe'
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        const ver = await checkExecutable(cand, ['--version']);
        if (ver) {
          cachedYtDlpPath = cand;
          return cand;
        }
      }
    }
  }

  return null;
}

export async function findFfmpeg(): Promise<string | null> {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }

  // 1. Check local app bin dir
  const localBin = path.join(getLocalBinDir(), ffmpegFilename);
  if (fs.existsSync(localBin)) {
    const ver = await checkExecutable(localBin, ['-version']);
    if (ver) {
      cachedFfmpegPath = localBin;
      return localBin;
    }
  }

  // 2. Check system PATH
  const fromPath = await findInPath('ffmpeg');
  if (fromPath) {
    const ver = await checkExecutable(fromPath, ['-version']);
    if (ver) {
      cachedFfmpegPath = fromPath;
      return fromPath;
    }
  }

  // 3. Common fallback locations on Windows
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const userProfile = process.env.USERPROFILE || '';
    const candidates = [
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
      path.join(userProfile, 'scoop', 'shims', 'ffmpeg.exe'),
      'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
      'C:\\ffmpeg\\bin\\ffmpeg.exe'
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        const ver = await checkExecutable(cand, ['-version']);
        if (ver) {
          cachedFfmpegPath = cand;
          return cand;
        }
      }
    }
  }

  return null;
}

export async function getBinaryStatus(): Promise<BinaryStatus> {
  const ytDlpPath = await findYtDlp();
  const ffmpegPath = await findFfmpeg();

  let version: string | undefined;
  if (ytDlpPath) {
    const ver = await checkExecutable(ytDlpPath, ['--version']);
    if (ver) version = ver;
  }

  return {
    isReady: Boolean(ytDlpPath),
    hasYtDlp: Boolean(ytDlpPath),
    hasFfmpeg: Boolean(ffmpegPath),
    canDownloadVideo: Boolean(ytDlpPath && ffmpegPath),
    ytDlpPath,
    ffmpegPath,
    version
  };
}

/**
 * Downloads a file from a URL, following 301/302 redirects (such as GitHub releases).
 */
function downloadFileWithRedirects(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFileWithRedirects(res.headers.location, destPath, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Tải thất bại với mã lỗi HTTP ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          onProgress(percent);
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => {
          if (!isWindows) {
            try {
              fs.chmodSync(destPath, 0o755);
            } catch {}
          }
          resolve();
        });
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });

    request.on('error', reject);
  });
}

/**
 * Downloads official yt-dlp binary from GitHub release into userData/bin.
 */
export async function installYtDlpBinary(
  onProgress?: (percent: number, statusText: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    const binDir = getLocalBinDir();
    const destPath = path.join(binDir, ytDlpFilename);
    const tempPath = `${destPath}.tmp`;

    const downloadUrl = isWindows
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : process.platform === 'darwin'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    if (onProgress) onProgress(0, 'Đang kết nối tới máy chủ GitHub...');

    await downloadFileWithRedirects(downloadUrl, tempPath, (percent) => {
      if (onProgress) onProgress(percent, `Đang tải yt-dlp (${percent}%)...`);
    });

    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch {}
    }
    fs.renameSync(tempPath, destPath);

    cachedYtDlpPath = destPath;
    if (onProgress) onProgress(100, 'Cài đặt yt-dlp thành công!');

    return { success: true };
  } catch (err: any) {
    console.error('[Downloader] Failed to install yt-dlp:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Downloads a gzip-compressed file from a URL following 301/302 redirects,
 * decompresses on-the-fly with zlib.createGunzip(), and writes executable output.
 */
function downloadGzFileWithRedirects(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadGzFileWithRedirects(res.headers.location, destPath, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Tải thất bại với mã lỗi HTTP ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(destPath);
      const gunzip = zlib.createGunzip();

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          onProgress(percent);
        }
      });

      gunzip.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });

      fileStream.on('finish', () => {
        fileStream.close(() => {
          if (!isWindows) {
            try {
              fs.chmodSync(destPath, 0o755);
            } catch {}
          }
          resolve();
        });
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });

      res.pipe(gunzip).pipe(fileStream);
    });

    request.on('error', reject);
  });
}

/**
 * Downloads official static FFmpeg binary (gzip) from GitHub release into userData/bin.
 * Provides the required video/audio multiplexer for 1080p/4K YouTube & TikTok downloads.
 */
export async function installFfmpegBinary(
  onProgress?: (percent: number, statusText: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    const binDir = getLocalBinDir();
    const destPath = path.join(binDir, ffmpegFilename);
    const tempPath = `${destPath}.tmp`;

    let gzFilename = 'ffmpeg-win32-x64.gz';
    if (process.platform === 'darwin') {
      gzFilename = process.arch === 'arm64' ? 'ffmpeg-darwin-arm64.gz' : 'ffmpeg-darwin-x64.gz';
    } else if (process.platform === 'linux') {
      gzFilename = process.arch === 'arm64' ? 'ffmpeg-linux-arm64.gz' : 'ffmpeg-linux-x64.gz';
    }

    const downloadUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${gzFilename}`;

    if (onProgress) onProgress(0, 'Đang kết nối tới máy chủ GitHub tải FFmpeg...');

    await downloadGzFileWithRedirects(downloadUrl, tempPath, (percent) => {
      if (onProgress) onProgress(percent, `Đang tải FFmpeg (${percent}%)...`);
    });

    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch {}
    }
    fs.renameSync(tempPath, destPath);

    cachedFfmpegPath = destPath;
    if (onProgress) onProgress(100, 'Cài đặt FFmpeg thành công!');

    return { success: true };
  } catch (err: any) {
    console.error('[Downloader] Failed to install FFmpeg:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Installs both yt-dlp and FFmpeg if either is missing.
 */
export async function installAllBinaries(
  onProgress?: (percent: number, statusText: string) => void
): Promise<{ success: boolean; error?: string }> {
  const ytDlp = await findYtDlp();
  const ffmpeg = await findFfmpeg();

  if (!ytDlp) {
    const resYt = await installYtDlpBinary((p, t) => {
      if (onProgress) onProgress(Math.round(p * (ffmpeg ? 1 : 0.5)), t);
    });
    if (!resYt.success) return resYt;
  }

  if (!ffmpeg) {
    const resFf = await installFfmpegBinary((p, t) => {
      if (onProgress) onProgress(Math.round(ytDlp ? p : (50 + p * 0.5)), t);
    });
    if (!resFf.success) return resFf;
  }

  return { success: true };
}

