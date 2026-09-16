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
}

export interface DownloadProgress {
  status: 'starting' | 'downloading' | 'extracting' | 'completed' | 'error';
  percent: number;
  speed?: string;
  eta?: string;
  totalSize?: string;
  filePath?: string;
  error?: string;
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
 * Downloads audio from URL, transcodes to Broadcast WAV 48kHz or MP3 320k,
 * reports progress real-time, and automatically imports file into SQLite database.
 */
export async function downloadAudio(
  options: DownloadOptions,
  onProgress: (data: DownloadProgress) => void,
  activeJobsMap?: Map<string, { abort: () => void }>
): Promise<{ filePath: string; duration: number }> {
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

  console.log(`[Downloader] Request to download: url="${options.url}", format="${options.format}", outDir="${outDir}"`);
  onProgress({ status: 'starting', percent: 0 });

  const outputTemplate = isVideo
    ? path.join(outDir, '%(title).160B [%(height)sp].%(ext)s')
    : path.join(outDir, '%(title).180B.%(ext)s');

  const args: string[] = [
    ...getYtDlpBaseArgs(),
    '--no-playlist',
    '--force-overwrites',
    '--newline',
    '-o', outputTemplate
  ];

  if (ffmpeg) {
    args.push('--ffmpeg-location', ffmpeg);
  }

  if (isVideo) {
    if (options.format === 'mp4_1080p') {
      // Full HD 1080p: prioritize H.264 (avc) + AAC (m4a) for 100% NLE/CapCut compatibility, fallback to any 1080p
      args.push(
        '-f',
        'bestvideo[height<=1080][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
        '--merge-output-format', 'mp4'
      );
    } else if (options.format === 'mp4_best') {
      // Highest resolution available (4K UHD / 2K 60fps) + highest quality audio
      args.push(
        '-f',
        'bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4'
      );
    } else if (options.format === 'mp4_720p') {
      // Lightweight 720p MP4
      args.push(
        '-f',
        'bestvideo[height<=720][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best',
        '--merge-output-format', 'mp4'
      );
    } else {
      args.push('--merge-output-format', 'mp4');
    }
  } else {
    // Audio mode
    if (ffmpeg) {
      if (options.format === 'wav') {
        // Broadcast WAV 48kHz 16-bit Stereo (Industry standard for NLE)
        args.push(
          '-x',
          '--audio-format', 'wav',
          '--audio-quality', '0',
          '--postprocessor-args', 'ffmpeg:-ar 48000 -ac 2'
        );
      } else if (options.format === 'mp3') {
        // MP3 320kbps
        args.push(
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '320k'
        );
      } else {
        // Best original audio
        args.push('-x');
      }
    } else {
      // If ffmpeg is missing, extract audio stream directly
      args.push('-x');
    }
  }

  const cleanDownloadUrl = sanitizeMediaUrl(options.url);
  args.push(cleanDownloadUrl);

  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, { windowsHide: true });
    let downloadedFilePath = '';
    let lastPercent = 0;
    let isExtracting = false;

    if (activeJobsMap) {
      activeJobsMap.set(options.url, {
        abort: () => {
          try {
            proc.kill('SIGTERM');
          } catch {}
        }
      });
    }

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 1. Detect destination file path
        if (
          trimmed.startsWith('[download] Destination:') ||
          trimmed.startsWith('[ExtractAudio] Destination:') ||
          trimmed.startsWith('[ffmpeg] Destination:') ||
          trimmed.startsWith('[Merger] Merging formats into') ||
          trimmed.includes('has already been downloaded')
        ) {
          if (trimmed.startsWith('[Merger] Merging formats into')) {
            const rawDest = trimmed.replace(/^\[Merger\]\s+Merging formats into\s+/, '').replace(/^["']|["']$/g, '').trim();
            if (rawDest) downloadedFilePath = rawDest;
          } else if (trimmed.includes('has already been downloaded')) {
            const match = trimmed.match(/\[download\]\s+(.*?)\s+has already been downloaded/);
            if (match && match[1]) {
              downloadedFilePath = match[1].replace(/^["']|["']$/g, '').trim();
            }
          } else {
            const parts = trimmed.split(': ');
            if (parts[1]) {
              downloadedFilePath = parts[1].trim();
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
            speed: isVideo ? 'Đang ghép luồng Video & Âm thanh Full HD bằng FFmpeg...' : 'Đang chuyển mã Broadcast Audio...'
          });
        }

        // 3. Parse progress: [download]  45.2% of ~ 12.34MiB at  3.45MiB/s ETA 00:02
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
      if (activeJobsMap) {
        activeJobsMap.delete(options.url);
      }

      if (code !== 0) {
        const cleaned = cleanStderr(stderrMsg);
        const err = cleaned || `Quá trình tải thất bại (mã ${code})`;
        onProgress({ status: 'error', percent: lastPercent, error: err });
        reject(new Error(err));
        return;
      }

      // If downloadedFilePath wasn't caught directly from stdout, look in directory for newest file
      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
        try {
          const files = fs.readdirSync(outDir)
            .map((f) => path.join(outDir, f))
            .filter((p) => fs.statSync(p).isFile());
          files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          if (files[0]) {
            downloadedFilePath = files[0];
          }
        } catch {}
      }

      console.log(`[Downloader] Download completed successfully: ${downloadedFilePath}`);
      onProgress({
        status: 'completed',
        percent: 100,
        filePath: downloadedFilePath
      });

      // Automatically import audio files into SQLite library & waveform cache!
      if (!isVideo && downloadedFilePath && fs.existsSync(downloadedFilePath)) {
        try {
          await importDroppedPaths([downloadedFilePath]);
          notifyUpdated();
          console.log(`[Downloader] Successfully indexed downloaded audio file into library: ${downloadedFilePath}`);
        } catch (importErr) {
          console.warn('[Downloader] Auto-import to library warning:', importErr);
        }
      }

      resolve({
        filePath: downloadedFilePath,
        duration: 0
      });
    });

    proc.on('error', (err) => {
      if (activeJobsMap) activeJobsMap.delete(options.url);
      onProgress({ status: 'error', percent: lastPercent, error: err.message });
      reject(err);
    });
  });
}
