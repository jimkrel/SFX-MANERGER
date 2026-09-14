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
const bounceQueue = new DecodeQueue(2);
let generation = 0;

export async function clearPreparedBounceCache(): Promise<{ cleared: number; freedBytes: number }> {
  generation++;
  warmed.clear();
  return window.api.clearBounceCache();
}

export async function getOrPrepareBouncedPath(track: Track): Promise<string> {
  if (!window.api || !isAutoBounceEnabled() || isTrackAlreadyBroadcastWav(track)) return track.path;
  const epoch = generation;
  const key = trackCacheKey(track);
  return bounceQueue.run(key + ':' + epoch, async () => {
    if (epoch !== generation || !isAutoBounceEnabled()) return track.path;
    try {
      const check = await window.api.isBouncedCached(track.path);
      if (epoch !== generation) return track.path;
      if (check.cached) { markWarm(key); return check.bouncePath; }
      // Force a fresh read when disk cache is absent. Never encode an older player buffer.
      const buffer = await loadAudioBuffer(track, 5, check.sourceToken);
      if (!buffer || epoch !== generation) return track.path;
      const resampled = buffer.sampleRate === 48000 ? buffer : await resampleAudioBuffer(buffer, 48000);
      const wavData = await encodeAudioBufferToWavAsync(resampled, 16);
      if (epoch !== generation) return track.path;
      const bounced = await window.api.saveBouncedWav(track.path, wavData, check.sourceToken);
      if (bounced) { markWarm(key); return bounced; }
    } catch (error) { console.warn('[Bouncer] Falling back to source', error); }
    return track.path;
  });
}

function markWarm(key: string): void {
  if (warmed.size >= 512) warmed.delete(warmed.values().next().value!);
  warmed.add(key);
}

export async function getOrPrepareBouncedPaths(tracks: Track[]): Promise<string[]> {
  return Promise.all(tracks.map(track => getOrPrepareBouncedPath(track)));
}

export function prewarmBounce(track: Track): void {
  if (!isAutoBounceEnabled() || isTrackAlreadyBroadcastWav(track) || warmed.has(trackCacheKey(track))) return;
  void getOrPrepareBouncedPath(track).catch(console.warn);
}
