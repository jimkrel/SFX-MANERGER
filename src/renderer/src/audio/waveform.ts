import { Track } from '../../../preload';
import { loadAudioBuffer, observeTrack, trackCacheKey } from './bufferLoader';

import { DecodeQueue } from './decodeQueue';

const waveformQueue = new DecodeQueue(2);
const memoryPeakCache = new Map<string, number[]>();
const pendingPeakPromises = new Map<string, Promise<number[]>>();
const versions = new Map<number, number>();

function remember(key: string, peaks: number[]): number[] {
  if (memoryPeakCache.size >= 512) memoryPeakCache.delete(memoryPeakCache.keys().next().value!);
  memoryPeakCache.set(key, peaks);
  return peaks;
}

export function getAnyCachedPeaks(trackId: number, version?: number): number[] | undefined {
  const prefix = `${trackId}:${version ?? versions.get(trackId) ?? 0}:`;
  for (const [key, peaks] of memoryPeakCache) if (key.startsWith(prefix)) return peaks;
  return undefined;
}

export function expandPeaks(source: number[], targetResolution: number): number[] {
  if (source.length === targetResolution) return source;
  const result: number[] = new Array(targetResolution);
  const ratio = (source.length - 1) / Math.max(1, targetResolution - 1);
  for (let i = 0; i < targetResolution; i++) {
    const srcIdx = i * ratio;
    const lower = Math.floor(srcIdx);
    const upper = Math.min(source.length - 1, Math.ceil(srcIdx));
    const weight = srcIdx - lower;
    const val = source[lower] * (1 - weight) + source[upper] * weight;
    result[i] = Number(val.toFixed(4));
  }
  return result;
}

export function extractPeaksFromChannelData(data: Float32Array, resolution: number): number[] {
  const peaks = new Array<number>(resolution).fill(0);
  for (let i = 0; i < data.length; i++) {
    const bin = Math.min(resolution - 1, Math.floor(i * resolution / data.length));
    const value = Math.abs(data[i]);
    if (Number.isFinite(value)) peaks[bin] = Math.max(peaks[bin], Math.min(1, value));
  }
  return peaks.map(p => Number(p.toFixed(4)));
}

export async function getOrComputePeaks(track: Track, resolution: number, preloadedBuffer?: AudioBuffer): Promise<number[]> {
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > 10000) throw new Error('Invalid waveform resolution');
  if (!observeTrack(track)) return new Array(resolution).fill(0);
  versions.set(track.id, track.content_version ?? 0);
  const key = trackCacheKey(track) + ':' + resolution;
  if (resolution === 80 && track.peaks_80?.length === 80) return remember(key, track.peaks_80);
  if (memoryPeakCache.has(key)) return memoryPeakCache.get(key)!;
  if (pendingPeakPromises.has(key)) return pendingPeakPromises.get(key)!;
  const job = waveformQueue.run(key, async () => {
    // peaks_80=null means getTracks already checked the disk cache.
    // WAV cache misses are handled in a Node worker instead of decoding in the renderer.
    const isWav = /\.wav$/i.test(track.path);
    if (window.api && (resolution !== 80 || track.peaks_80 === undefined || isWav)) {
      const cached = await window.api.getWaveformPeaks(track.id, resolution, track.content_version);
      if (cached?.length === resolution && observeTrack(track)) return remember(key, cached);
    }
    const buffer = preloadedBuffer || await loadAudioBuffer(track, resolution > 80 ? 10 : 0);
    if (!buffer || !observeTrack(track)) return new Array(resolution).fill(0);
    const peaks = new Array<number>(resolution).fill(0);
    // Yield between chunks so JavaScript peak extraction cannot monopolize the UI.
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const samples = buffer.getChannelData(c);
      for (let start = 0; start < samples.length; start += 65536) {
        if (!observeTrack(track)) return new Array(resolution).fill(0);
        for (let i = start, end = Math.min(start + 65536, samples.length); i < end; i++) {
          const bin = Math.min(resolution - 1, Math.floor(i * resolution / samples.length));
          const value = Math.abs(samples[i]);
          if (Number.isFinite(value)) peaks[bin] = Math.max(peaks[bin], Math.min(1, value));
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    const rounded = peaks.map(p => Number(p.toFixed(4)));
    if (observeTrack(track)) {
      remember(key, rounded);
      void window.api?.saveWaveformPeaks(track.id, resolution, rounded, track.content_version).catch(console.warn);
    }
    return rounded;
  }, resolution > 80 ? 10 : 0).finally(() => pendingPeakPromises.delete(key));
  pendingPeakPromises.set(key, job);
  return job;
}
