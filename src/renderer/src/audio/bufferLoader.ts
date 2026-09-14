import type { Track } from '../../../preload';
import { decodeAudioBuffer } from './audioContext';
import { decodeQueue } from './decodeQueue';

const buffers = new Map<string, AudioBuffer>();
const versions = new Map<number, number>();
const MAX_BYTES = 64 * 1024 * 1024;
let cacheBytes = 0;
const bytes = (buffer: AudioBuffer) => buffer.length * buffer.numberOfChannels * 4;
export const trackCacheKey = (track: Track): string => `${track.id}:${track.content_version ?? 0}:${track.path}`;

export function observeTrack(track: Track): boolean {
  const version = track.content_version ?? 0;
  const known = versions.get(track.id);
  if (known !== undefined && known > version) return false;
  versions.set(track.id, version);
  if (known !== version) {
    for (const [key, buffer] of buffers) {
      if (key.startsWith(`${track.id}:`) && key !== trackCacheKey(track)) {
        buffers.delete(key);
        cacheBytes -= bytes(buffer);
      }
    }
  }
  return true;
}

export async function loadAudioBuffer(track: Track, priority = 0, freshToken?: string): Promise<AudioBuffer | null> {
  if (!window.api || track.is_missing || !observeTrack(track)) return null;
  const key = trackCacheKey(track);
  const cached = buffers.get(key);
  if (cached && !freshToken) { buffers.delete(key); buffers.set(key, cached); return cached; }
  return decodeQueue.run(key + (freshToken ? ':fresh:' + freshToken : ''), async () => {
    if (!observeTrack(track)) return null;
    try {
      const raw = await window.api.readAudioBuffer(track.path, track.id, track.content_version);
      if (!raw || !observeTrack(track)) return null;
      const data = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
        ? raw.buffer as ArrayBuffer : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      const buffer = await decodeAudioBuffer(data);
      if (!observeTrack(track)) return null;
      const size = bytes(buffer);
      if (size <= MAX_BYTES) {
        while (buffers.size && (buffers.size >= 8 || cacheBytes + size > MAX_BYTES)) {
          const oldest = buffers.keys().next().value!;
          cacheBytes -= bytes(buffers.get(oldest)!);
          buffers.delete(oldest);
        }
        const previous = buffers.get(key);
        if (previous) cacheBytes -= bytes(previous);
        buffers.set(key, buffer);
        cacheBytes += size;
      }
      return buffer;
    } catch (error) { console.warn('[Audio] Read/decode failed', error); return null; }
  }, priority);
}
