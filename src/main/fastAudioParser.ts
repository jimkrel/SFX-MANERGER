/**
 * symphonia-wasm integration layer
 *
 * Thứ tự ưu tiên:
 *  1. WASM symphonia (Spotify-grade, cross-platform, nhanh nhất)
 *  2. Fast WAV binary header parser (pure JS, fallback cho WASM fail)
 *  3. music-metadata (universal fallback)
 */

import path from 'path';
import fs from 'fs';

export interface AudioMetadataResult {
  name: string;
  duration: number;
  sampleRate: number | null;
  channels: number | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  bpm: number | null;
}

// ─── WASM loader (lazy singleton) ───────────────────────────────────────────

let wasmModule: {
  parse_audio_metadata: (data: Uint8Array, extension: string) => {
    duration?: number;
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    sample_rate?: number;
    channels?: number;
    bit_depth?: number;
    codec?: string;
    error?: string;
  } | null;
} | null = null;

let wasmLoadAttempted = false;

async function getWasmModule() {
  if (wasmModule) return wasmModule;
  if (wasmLoadAttempted) return null;
  wasmLoadAttempted = true;

  try {
    // WASM file được bundle vào src/main/wasm/ sau khi build
    const wasmGlue = path.join(__dirname, 'wasm', 'sfx_parser.js');
    if (!fs.existsSync(wasmGlue)) {
      console.log('[FastParser] WASM not built yet, using JS fallback');
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(wasmGlue);
    if (typeof mod.parse_audio_metadata === 'function') {
      wasmModule = mod;
      console.log('[FastParser] ✅ symphonia WASM loaded');
    }
    return wasmModule;
  } catch (e) {
    console.warn('[FastParser] WASM load failed, using JS fallback:', e);
    return null;
  }
}

// ─── music-metadata lazy loader ─────────────────────────────────────────────

let mmPromise: Promise<typeof import('music-metadata')> | null = null;
function getMusicMetadata(): Promise<typeof import('music-metadata')> {
  if (!mmPromise) {
    mmPromise = new Function('return import("music-metadata")')() as Promise<typeof import('music-metadata')>;
  }
  return mmPromise;
}

// ─── Fast WAV binary header parser (JS, zero-alloc) ─────────────────────────

export function parseWavHeaderFast(buf: Buffer, fileSize: number, baseName: string): AudioMetadataResult | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;

  let pos = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let dataLength: number | null = null;
  let title: string | null = null;
  let artist: string | null = null;
  let album: string | null = null;
  let genre: string | null = null;

  const limit = Math.min(buf.length, fileSize);
  while (pos + 8 <= limit) {
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    const chunkDataPos = pos + 8;

    if (chunkId === 'fmt ' && chunkDataPos + 16 <= limit) {
      channels = buf.readUInt16LE(chunkDataPos + 2);
      sampleRate = buf.readUInt32LE(chunkDataPos + 4);
      bitsPerSample = buf.readUInt16LE(chunkDataPos + 14);
    } else if (chunkId === 'data') {
      dataLength = chunkSize;
    } else if (chunkId === 'LIST' && chunkDataPos + 4 <= limit) {
      const listType = buf.toString('ascii', chunkDataPos, chunkDataPos + 4);
      if (listType === 'INFO') {
        let infoPos = chunkDataPos + 4;
        const infoEnd = Math.min(chunkDataPos + chunkSize, limit);
        while (infoPos + 8 <= infoEnd) {
          const subId = buf.toString('ascii', infoPos, infoPos + 4);
          const subSize = buf.readUInt32LE(infoPos + 4);
          const subDataPos = infoPos + 8;
          if (subDataPos + subSize <= limit) {
            const val = buf.toString('utf8', subDataPos, subDataPos + subSize).replace(/\0+$/, '').trim();
            if (subId === 'INAM' && val) title = val;
            else if (subId === 'IART' && val) artist = val;
            else if (subId === 'IPRD' && val) album = val;
            else if (subId === 'IGNR' && val) genre = val;
          }
          infoPos += 8 + subSize + (subSize & 1);
        }
      }
    }
    pos += 8 + chunkSize + (chunkSize & 1);
  }

  if (sampleRate && channels && bitsPerSample && dataLength !== null) {
    const bytesPerFrame = channels * (bitsPerSample / 8);
    const duration = bytesPerFrame > 0 ? dataLength / (sampleRate * bytesPerFrame) : 0;
    return {
      name: title || baseName,
      duration,
      sampleRate,
      channels,
      artist: artist || null,
      album: album || null,
      genre: genre || null,
      bpm: null
    };
  }

  return null;
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * High-performance audio metadata parser.
 *
 * Priority chain:
 *  WAV:       fast WAV header parser (JS) → WASM symphonia → music-metadata
 *  MP3/OGG/FLAC/M4A: WASM symphonia → music-metadata
 */
export async function parseAudioMetadata(filePath: string): Promise<AudioMetadataResult> {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);

  // ── Fast path: WAV header (pure JS, no alloc) ──
  if (ext === '.wav') {
    try {
      const fd = await fs.promises.open(filePath, 'r');
      try {
        const stat = await fd.stat();
        const headerSize = Math.min(stat.size, 16384);
        const headerBuf = Buffer.allocUnsafe(headerSize);
        const { bytesRead } = await fd.read(headerBuf, 0, headerSize, 0);
        const fastResult = parseWavHeaderFast(headerBuf.subarray(0, bytesRead), stat.size, baseName);
        if (fastResult) return fastResult;
      } finally {
        await fd.close();
      }
    } catch {
      // Fall through
    }
  }

  // ── WASM symphonia path (non-WAV, or WAV fallback) ──
  try {
    const wasm = await getWasmModule();
    if (wasm) {
      const fileData = await fs.promises.readFile(filePath);
      const result = wasm.parse_audio_metadata(new Uint8Array(fileData), ext.replace('.', ''));
      if (result && !result.error) {
        return {
          name: result.title || baseName,
          duration: result.duration ?? 0,
          sampleRate: result.sample_rate ?? null,
          channels: result.channels ?? null,
          artist: result.artist ?? null,
          album: result.album ?? null,
          genre: result.genre ?? null,
          bpm: null
        };
      }
    }
  } catch {
    // Fall through to music-metadata
  }

  // ── Universal fallback: music-metadata ──
  try {
    const mm = await getMusicMetadata();
    let metadata: Awaited<ReturnType<typeof mm.parseFile>>;
    try {
      metadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    } catch {
      const fd = await fs.promises.open(filePath, 'r');
      try {
        const headerBuf = Buffer.alloc(65536);
        const { bytesRead } = await fd.read(headerBuf, 0, 65536, 0);
        metadata = await mm.parseBuffer(headerBuf.subarray(0, bytesRead), undefined, { duration: true, skipCovers: true });
      } finally {
        await fd.close();
      }
    }

    return {
      name: metadata.common.title || baseName,
      duration: metadata.format.duration || 0,
      sampleRate: metadata.format.sampleRate || null,
      channels: metadata.format.numberOfChannels || null,
      artist: metadata.common.artist || (metadata.common.artists?.[0]) || null,
      album: metadata.common.album || null,
      genre: metadata.common.genre?.[0] || null,
      bpm: metadata.common.bpm || null
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
