import { loadAudioBuffer, trackCacheKey } from './bufferLoader';
import { DecodeQueue } from './decodeQueue';
import { resampleAudioBuffer } from './audioConverter';
import { encodeAudioBufferToWavAsync } from './wavEncoder';
import type { Track } from '../../../preload/index';

export const BOUNCER_SETTINGS_KEY = 'sfx_auto_bounce_wav_enabled';

/**
 * Returns whether On-The-Fly Broadcast WAV (48kHz/16-bit) bouncing is enabled.
 * Defaults to true.
 */
export function isAutoBounceEnabled(): boolean {
  try {
    const saved = localStorage.getItem(BOUNCER_SETTINGS_KEY);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

/**
 * Update the Auto-Bouncing setting.
 */
export function setAutoBounceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BOUNCER_SETTINGS_KEY, String(enabled));
  } catch (err) {
    console.warn('[BouncerService] Failed to save setting:', err);
  }
}

/**
 * Checks if a track already has the ideal format (WAV 48kHz).
 */
export function isTrackAlreadyBroadcastWav(track: { path: string; sample_rate?: number | null }): boolean {
  const ext = track.path.split('.').pop()?.toLowerCase();
  return ext === 'wav' && track.sample_rate === 48000;
}

// Warm markers suppress repeated hover work only. Drag always validates the disk.
const warmed = new Set<string>();
// Fast synchronous in-memory resolution cache: trackCacheKey -> bouncedFilePath
const resolvedBouncedPaths = new Map<string, string>();
// Concurrency 4: handles simultaneous hover on multiple tracks without queuing
const bounceQueue = new DecodeQueue(4);
let generation = 0;

// Priority levels — higher = runs first
const PRIORITY_PREWARM_IDLE = 0;      // pre-warm khi load app (background)
const PRIORITY_PREWARM_HOVER = 5;     // pre-warm khi hover / select
const PRIORITY_DRAG = 10;             // drag thật — nhảy lên đầu queue

export async function clearPreparedBounceCache(): Promise<{ cleared: number; freedBytes: number }> {
  generation++;
  warmed.clear();
  resolvedBouncedPaths.clear();
  return window.api.clearBounceCache();
}

export async function getOrPrepareBouncedPath(track: Track, priority = PRIORITY_PREWARM_HOVER): Promise<string> {
  if (!window.api || !isAutoBounceEnabled() || isTrackAlreadyBroadcastWav(track)) return track.path;
  const epoch = generation;
  const key = trackCacheKey(track);
  return bounceQueue.run(key + ':' + epoch, async () => {
    if (epoch !== generation || !isAutoBounceEnabled()) return track.path;
    try {
      const check = await window.api.isBouncedCached(track.path);
      if (epoch !== generation) return track.path;
      if (check.cached) {
        markWarm(key);
        resolvedBouncedPaths.set(key, check.bouncePath);
        return check.bouncePath;
      }
      // Force a fresh read when disk cache is absent. Never encode an older player buffer.
      const buffer = await loadAudioBuffer(track, 5, check.sourceToken);
      if (!buffer || epoch !== generation) return track.path;
      const resampled = buffer.sampleRate === 48000 ? buffer : await resampleAudioBuffer(buffer, 48000);
      const wavData = await encodeAudioBufferToWavAsync(resampled, 16);
      if (epoch !== generation) return track.path;
      const bounced = await window.api.saveBouncedWav(track.path, wavData, check.sourceToken);
      if (bounced) {
        markWarm(key);
        resolvedBouncedPaths.set(key, bounced);
        return bounced;
      }
    } catch (error) { console.warn('[Bouncer] Falling back to source', error); }
    return track.path;
  }, priority);
}

function markWarm(key: string): void {
  if (warmed.size >= 512) warmed.delete(warmed.values().next().value!);
  warmed.add(key);
}

export async function getOrPrepareBouncedPaths(tracks: Track[]): Promise<string[]> {
  // Drag thật: promote mỗi track lên PRIORITY_DRAG để nhảy qua các prewarm đang chờ
  return Promise.all(tracks.map(track => {
    const key = trackCacheKey(track) + ':' + generation;
    bounceQueue.promote(key, PRIORITY_DRAG);
    return getOrPrepareBouncedPath(track, PRIORITY_DRAG);
  }));
}

/**
 * Pre-warm một track khi hover/select — priority trung bình.
 */
export function prewarmBounce(track: Track): void {
  if (window.api?.prewarmDrag) {
    void window.api.prewarmDrag(track.path).catch(() => {});
  }
  if (!isAutoBounceEnabled() || isTrackAlreadyBroadcastWav(track) || warmed.has(trackCacheKey(track))) return;
  void getOrPrepareBouncedPath(track, PRIORITY_PREWARM_HOVER).catch(console.warn);
}

/**
 * Pre-warm nhiều tracks cùng lúc (top visible khi load) — priority thấp background.
 * Stagger 200ms giữa các batch để hover/drag luôn có thể nhảy queue.
 */
export async function prewarmBounceMany(tracks: Track[], batchSize = 3): Promise<void> {
  if (window.api?.prewarmDrag) {
    for (const t of tracks.slice(0, 15)) {
      void window.api.prewarmDrag(t.path).catch(() => {});
    }
  }
  if (!isAutoBounceEnabled()) return;
  const candidates = tracks.filter(
    t => t.is_missing !== 1 && !isTrackAlreadyBroadcastWav(t) && !warmed.has(trackCacheKey(t))
  );
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(t => getOrPrepareBouncedPath(t, PRIORITY_PREWARM_IDLE)));
    if (i + batchSize < candidates.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

/**
 * Instant synchronous lookup for 0ms zero-latency drag start.
 * If 48kHz Broadcast WAV is already ready in memory, returns it immediately.
 * Otherwise returns the original track path so the OS drag gesture starts on frame 0 without waiting.
 */
export function getInstantBouncedPath(track: Track): string {
  if (!isAutoBounceEnabled() || isTrackAlreadyBroadcastWav(track)) return track.path;
  const key = trackCacheKey(track);
  return resolvedBouncedPaths.get(key) || track.path;
}

export function getInstantBouncedPaths(tracks: Track[]): string[] {
  return tracks.map(t => getInstantBouncedPath(t));
}
