import { Track } from '../../../preload';
import { decodeAudioBuffer } from './audioContext';

// In-memory cache to avoid redundant IPC calls while app is running
const memoryPeakCache = new Map<string, number[]>();
const pendingPeakPromises = new Map<string, Promise<number[]>>();

export function extractPeaksFromChannelData(channelData: Float32Array, resolution: number): number[] {
  const peaks: number[] = new Array(resolution);
  const totalSamples = channelData.length;

  if (totalSamples === 0) {
    return new Array(resolution).fill(0);
  }

  const blockSize = Math.floor(totalSamples / resolution);
  const step = Math.max(1, blockSize);

  for (let i = 0; i < resolution; i++) {
    const start = i * step;
    const end = Math.min(start + step, totalSamples);
    let max = 0;

    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) {
        max = val;
      }
    }
    // Clamp to [0, 1] and round to 4 decimals for compact JSON storage
    peaks[i] = Number(Math.min(1, Math.max(0, max)).toFixed(4));
  }

  return peaks;
}

export async function getOrComputePeaks(
  track: Track,
  resolution: number,
  preloadedBuffer?: AudioBuffer
): Promise<number[]> {
  const cacheKey = `${track.id}_${resolution}`;
  if (memoryPeakCache.has(cacheKey)) {
    return memoryPeakCache.get(cacheKey)!;
  }

  if (pendingPeakPromises.has(cacheKey)) {
    return pendingPeakPromises.get(cacheKey)!;
  }

  const computePromise = (async () => {
    try {
      // 1. Kiểm tra cache trong SQLite trước
      if (window.api) {
        try {
          const cached = await window.api.getWaveformPeaks(track.id, resolution);
          if (cached && Array.isArray(cached) && cached.length === resolution) {
            memoryPeakCache.set(cacheKey, cached);
            return cached;
          }
        } catch (e) {
          console.warn(`[Waveform] Error fetching peak cache for track ${track.id}:`, e);
        }
      }

      // 2. Chưa có cache: Decode file âm thanh
      let audioBuffer = preloadedBuffer;
      if (!audioBuffer) {
        if (!window.api) return new Array(resolution).fill(0);
        const rawBytes = await window.api.readAudioBuffer(track.path);
        if (!rawBytes) {
          console.warn(`[Waveform] Could not read audio buffer for ${track.path}`);
          return new Array(resolution).fill(0);
        }

        try {
          // Uint8Array.buffer might have byteOffset
          const arrayBuffer = rawBytes.buffer.slice(
            rawBytes.byteOffset,
            rawBytes.byteOffset + rawBytes.byteLength
          );
          audioBuffer = await decodeAudioBuffer(arrayBuffer);
        } catch (decodeErr) {
          console.error(`[Waveform] Decode error on ${track.path}:`, decodeErr);
          return new Array(resolution).fill(0);
        }
      }

      // 3. Trích xuất peaks theo mục 3.2
      const channelData = audioBuffer.getChannelData(0);
      const peaks = extractPeaksFromChannelData(channelData, resolution);

      // 4. Lưu peaks vào SQLite cache theo mục 3.3
      memoryPeakCache.set(cacheKey, peaks);
      if (window.api) {
        window.api.saveWaveformPeaks(track.id, resolution, peaks).catch((err) => {
          console.warn(`[Waveform] Failed to save peaks cache for track ${track.id}:`, err);
        });
      }

      return peaks;
    } finally {
      pendingPeakPromises.delete(cacheKey);
    }
  })();

  pendingPeakPromises.set(cacheKey, computePromise);
  return computePromise;
}
