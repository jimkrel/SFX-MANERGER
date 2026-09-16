import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { findYtDlp, findFfmpeg } from './binaryManager';
import { importDroppedPaths, notifyUpdated } from '../indexer';

export interface MediaInfo {
  url: string;
  id: string;
  title: string;
  duration: number;
  uploader: string;
  thumbnail: string;
  platform: 'youtube' | 'tiktok' | 'soundcloud' | 'generic';
  description?: string;
}

export type DownloadFormat = 'wav' | 'mp3' | 'mp4_1080p' | 'mp4_best' | 'mp4_720p' | 'original';

export interface DownloadOptions {
  url: string;
  format: DownloadFormat;
  outputDir?: string;
  targetName?: string;
  /** Unique job identifier. If omitted, one will be auto-generated. */
  jobId?: string;
}

export interface DownloadProgress {
  status: 'starting' | 'downloading' | 'extracting' | 'completed' | 'error';
  percent: number;
  speed?: string;
  eta?: string;
  totalSize?: string;
  filePath?: string;
  error?: string;
  /** Echoed back so the renderer can match progress events to a specific job. */
  jobId?: string;
}

export function detectPlatform(url: string): 'youtube' | 'tiktok' | 'soundcloud' | 'generic' {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('soundcloud.com')) return 'soundcloud';
  return 'generic';
}

import os from 'os';

export function getDefaultDownloadsDir(): string {
  const downloads = app && typeof app.getPath === 'function'
    ? app.getPath('downloads')
    : path.join(os.homedir(), 'Downloads');
  const dir = path.join(downloads, 'SFX-Studio-Downloads');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
}

export function sanitizeMediaUrl(raw: string): string {
  let u = raw.trim();
  try {
    const parsed = new URL(u);
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      if (parsed.searchParams.has('v')) {
        parsed.searchParams.delete('list');
        parsed.searchParams.delete('index');
        parsed.searchParams.delete('start_radio');
        u = parsed.toString();
      }
    }
  } catch {}
  return u;
}

export function getYtDlpBaseArgs(): string[] {
  return [
    '--no-warnings',
    '--no-check-certificates'
  ];
}

export function cleanStderr(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => {
      const l = line.trim();
      if (!l) return false;
      if (l.includes('Deprecated Feature: Support for Python')) return false;
      if (l.startsWith('WARNING:')) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * Rapidly fetches title, thumbnail, duration, uploader without downloading the media.
 */
export async function fetchMediaInfo(url: string): Promise<MediaInfo> {
  const ytDlp = await findYtDlp();
  if (!ytDlp) {
    throw new Error('Không tìm thấy công cụ yt-dlp. Vui lòng cài đặt công cụ tải trước khi tiếp tục.');
  }

  const cleanUrl = sanitizeMediaUrl(url);
  if (!cleanUrl) {
    throw new Error('Đường dẫn link không được để trống.');
  }

  const args = [
    ...getYtDlpBaseArgs(),
    '--dump-single-json',
    '--no-playlist',
    '--skip-download',
    cleanUrl
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, { windowsHide: true });
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0 || !stdoutData.trim()) {
        const cleaned = cleanStderr(stderrData);
        const errDetail = cleaned || `Thất bại với mã thoát ${code}`;
        console.warn('[Downloader] fetchMediaInfo failed:', errDetail);
        reject(new Error(`Không thể phân tích link: ${errDetail}`));
        return;
      }

      try {
        const json = JSON.parse(stdoutData.trim());
        const duration = Number(json.duration) || 0;
        const platform = detectPlatform(cleanUrl);

        let thumbnail = json.thumbnail || '';
        if (!thumbnail && Array.isArray(json.thumbnails) && json.thumbnails.length > 0) {
          thumbnail = json.thumbnails[json.thumbnails.length - 1]?.url || '';
        }

        // For YouTube, ensure reliable JPG thumbnail format
        if (platform === 'youtube' && json.id) {
          if (!thumbnail || thumbnail.includes('.webp')) {
            thumbnail = `https://i.ytimg.com/vi/${json.id}/hqdefault.jpg`;
          }
        }

        const info: MediaInfo = {
          url: cleanUrl,
          id: json.id || String(Date.now()),
          title: json.title || 'Audio không tên',
          duration,
          uploader: json.uploader || json.channel || json.creator || 'Chưa rõ tác giả',
          thumbnail,
          platform,
          description: json.description ? json.description.slice(0, 300) : undefined
        };
        resolve(info);
      } catch (parseErr: any) {
        reject(new Error(`Lỗi giải mã thông tin media: ${parseErr?.message || String(parseErr)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Lỗi khởi chạy yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Resolves the exact output file path that yt-dlp will write to,
 * by running `--print filename` with the same format/template args — no network download.
 * Returns null if the subprocess fails or produces no usable output.
 */
async function resolveOutputPath(
  ytDlp: string,
  url: string,
  outputTemplate: string,
  formatArgs: string[]
): Promise<string | null> {
  return new Promise((resolve) => {
    const args = [
      ...getYtDlpBaseArgs(),
      '--no-playlist',
      '--print', 'filename',
      '-o', outputTemplate,
      ...formatArgs,
      url
    ];

    const proc = spawn(ytDlp, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const line = stdout.trim().split('\n').find((l) => l.trim() && !l.startsWith('['));
      if (code === 0 && line) {
        resolve(line.trim());
      } else {
        console.warn('[Downloader] resolveOutputPath failed (code=%d): %s', code, stderr.slice(0, 200));
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

/**
 * Downloads audio from URL, transcodes to Broadcast WAV 48kHz or MP3 320k,
 * reports progress real-time, and automatically imports file into SQLite database.
 */
export async function downloadAudio(
  options: DownloadOptions,
  onProgress: (data: DownloadProgress) => void,
  activeJobsMap?: Map<string, { abort: () => void }>
): Promise<{ filePath: string; duration: number; jobId: string }> {
  // --- Fix 1: generate a unique jobId so parallel downloads of the same URL
  //            each get an independent slot in activeJobsMap. ---
  const jobId = options.jobId ?? `${options.url}-${Date.now()}`;

  const ytDlp = await findYtDlp();
  if (!ytDlp) {
    throw new Error('Chưa cài đặt công cụ yt-dlp.');
  }
  const ffmpeg = await findFfmpeg();

  const isVideo = options.format.startsWith('mp4');
  const baseDir = options.outputDir || getDefaultDownloadsDir();
  const outDir = isVideo ? path.join(baseDir, 'Videos') : baseDir;
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`[Downloader] Request to download: jobId="${jobId}", url="${options.url}", format="${options.format}", outDir="${outDir}"`);
  onProgress({ status: 'starting', percent: 0, jobId });

  const outputTemplate = isVideo
    ? path.join(outDir, '%(title).160B [%(height)sp].%(ext)s')
    : path.join(outDir, '%(title).180B.%(ext)s');

  // Build the format-specific args (shared by both resolveOutputPath and the real download)
  const formatArgs: string[] = [];
  if (ffmpeg) {
    formatArgs.push('--ffmpeg-location', ffmpeg);
  }
  if (isVideo) {
    if (options.format === 'mp4_1080p') {
      // Full HD 1080p: prioritize H.264 (avc) + AAC (m4a) for 100% NLE/CapCut compatibility
      formatArgs.push(
        '-f',
        'bestvideo[height<=1080][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
        '--merge-output-format', 'mp4'
      );
    } else if (options.format === 'mp4_best') {
      // Highest resolution available (4K UHD / 2K 60fps) + highest quality audio
      formatArgs.push(
        '-f',
        'bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4'
      );
    } else if (options.format === 'mp4_720p') {
      // Lightweight 720p MP4
      formatArgs.push(
        '-f',
        'bestvideo[height<=720][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best',
        '--merge-output-format', 'mp4'
      );
    } else {
      formatArgs.push('--merge-output-format', 'mp4');
    }
  } else {
    // Audio mode
    if (ffmpeg) {
      if (options.format === 'wav') {
        // Broadcast WAV 48kHz 16-bit Stereo (Industry standard for NLE)
        formatArgs.push(
          '-x',
          '--audio-format', 'wav',
          '--audio-quality', '0',
          '--postprocessor-args', 'ffmpeg:-ar 48000 -ac 2'
        );
      } else if (options.format === 'mp3') {
        // MP3 320kbps
        formatArgs.push(
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '320k'
        );
      } else {
        formatArgs.push('-x');
      }
    } else {
      formatArgs.push('-x');
    }
  }

  const cleanDownloadUrl = sanitizeMediaUrl(options.url);

  // --- Fix 2: Pre-resolve the exact output path using --print filename.
  //            This is deterministic and safe to run in parallel — no network download. ---
  const predictedPath = await resolveOutputPath(ytDlp, cleanDownloadUrl, outputTemplate, formatArgs);
  console.log(`[Downloader] Predicted output path: ${predictedPath ?? '(unknown — will parse from stdout)'}`);

  const args: string[] = [
    ...getYtDlpBaseArgs(),
    '--no-playlist',
    '--force-overwrites',
    '--newline',
    '-o', outputTemplate,
    ...formatArgs,
    cleanDownloadUrl
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, { windowsHide: true });
    // Start with the pre-resolved path; stdout parsing can refine it further (e.g. Merger line)
    let downloadedFilePath = predictedPath ?? '';
    let lastPercent = 0;
    let isExtracting = false;

    // Fix 1: register job under its unique jobId, not under the bare URL
    if (activeJobsMap) {
      activeJobsMap.set(jobId, {
        abort: () => {
          try { proc.kill('SIGTERM'); } catch {}
        }
      });
    }

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 1. Refine/confirm the final destination path from stdout log lines
        if (
          trimmed.startsWith('[download] Destination:') ||
          trimmed.startsWith('[ExtractAudio] Destination:') ||
          trimmed.startsWith('[ffmpeg] Destination:') ||
          trimmed.startsWith('[Merger] Merging formats into') ||
          trimmed.includes('has already been downloaded')
        ) {
          if (trimmed.startsWith('[Merger] Merging formats into')) {
            const rawDest = trimmed
              .replace(/^\[Merger\]\s+Merging formats into\s+/, '')
              .replace(/^["']|["']$/g, '')
              .trim();
            if (rawDest) downloadedFilePath = rawDest;
          } else if (trimmed.includes('has already been downloaded')) {
            const match = trimmed.match(/\[download\]\s+(.*?)\s+has already been downloaded/);
            if (match?.[1]) {
              downloadedFilePath = match[1].replace(/^["']|["']$/g, '').trim();
            }
          } else {
            // "[download] Destination: /path/to/file"
            // Split only on first ': ' to handle colons in path (e.g. Windows drive letters)
            const idx = trimmed.indexOf(': ');
            if (idx !== -1) {
              downloadedFilePath = trimmed.slice(idx + 2).trim();
            }
          }
        }

        // 2. Detect when audio extraction / postprocessing begins
        if (
          trimmed.startsWith('[ExtractAudio]') ||
          trimmed.startsWith('[ffmpeg]') ||
          trimmed.startsWith('[Merger]')
        ) {
          isExtracting = true;
          onProgress({
            status: 'extracting',
            percent: 95,
            jobId,
            speed: isVideo ? 'Đang ghép luồng Video & Âm thanh Full HD bằng FFmpeg...' : 'Đang chuyển mã Broadcast Audio...'
          });
        }

        // 3. Parse download progress: [download]  45.2% of ~ 12.34MiB at  3.45MiB/s ETA 00:02
        if (trimmed.startsWith('[download]') && trimmed.includes('%')) {
          const percentMatch = trimmed.match(/(\d+(?:\.\d+)?)%/);
          const sizeMatch = trimmed.match(/of\s+(?:~\s*)?([0-9.]+[A-Za-z]+)/);
          const speedMatch = trimmed.match(/at\s+([0-9.]+[A-Za-z]+\/s)/);
          const etaMatch = trimmed.match(/ETA\s+([0-9:]+)/);

          if (percentMatch) {
            const rawPercent = parseFloat(percentMatch[1]);
            const percent = isExtracting
              ? 95
              : Math.min(94, Math.round(rawPercent * 0.94));

            lastPercent = Math.max(lastPercent, percent);
            onProgress({
              status: isExtracting ? 'extracting' : 'downloading',
              percent: lastPercent,
              jobId,
              totalSize: sizeMatch ? sizeMatch[1] : undefined,
              speed: speedMatch ? speedMatch[1] : undefined,
              eta: etaMatch ? etaMatch[1] : undefined
            });
          }
        }
      }
    });

    let stderrMsg = '';
    proc.stderr.on('data', (chunk) => {
      stderrMsg += chunk.toString();
    });

    proc.on('close', async (code) => {
      // Fix 1: clean up by jobId, not by URL
      if (activeJobsMap) {
        activeJobsMap.delete(jobId);
      }

      if (code !== 0) {
        const cleaned = cleanStderr(stderrMsg);
        const err = cleaned || `Quá trình tải thất bại (mã ${code})`;
        onProgress({ status: 'error', percent: lastPercent, error: err, jobId });
        reject(new Error(err));
        return;
      }

      // Fix 2: predictedPath was set before the download; stdout parsing may have
      // refined it further. If we still have nothing (shouldn't happen), warn and bail.
      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
        console.warn(`[Downloader] jobId="${jobId}": could not determine output file path. predictedPath=${predictedPath}`);
      }

      console.log(`[Downloader] jobId="${jobId}": completed → ${downloadedFilePath}`);
      onProgress({
        status: 'completed',
        percent: 100,
        filePath: downloadedFilePath,
        jobId
      });

      // Automatically import audio files into SQLite library & waveform cache
      if (!isVideo && downloadedFilePath && fs.existsSync(downloadedFilePath)) {
        try {
          await importDroppedPaths([downloadedFilePath]);
          notifyUpdated();
          console.log(`[Downloader] Indexed audio into library: ${downloadedFilePath}`);
        } catch (importErr) {
          console.warn('[Downloader] Auto-import warning:', importErr);
        }
      }

      resolve({ filePath: downloadedFilePath, duration: 0, jobId });
    });

    proc.on('error', (err) => {
      if (activeJobsMap) activeJobsMap.delete(jobId);
      onProgress({ status: 'error', percent: lastPercent, error: err.message, jobId });
      reject(err);
    });
  });
}
