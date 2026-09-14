import { audioPlayer } from './player';
import { resampleAudioBuffer } from './audioConverter';
import { encodeAudioBufferToWav } from './wavEncoder';
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

/**
 * In-memory mapping to remember already bounced paths during the current session.
 */
const memoryCache = new Map<string, string>();

/**
 * Get or prepare the Broadcast WAV (48kHz 16-bit) path for a single track.
 * Uses disk cache + memory cache for instantaneous (0ms) resolution.
 */
export async function getOrPrepareBouncedPath(track: Track): Promise<string> {
  if (!window.api || !isAutoBounceEnabled()) {
    return track.path;
  }

  // If already ideal 48kHz WAV, keep original path
  if (isTrackAlreadyBroadcastWav(track)) {
    return track.path;
  }

  // Check in-memory cache
  if (memoryCache.has(track.path)) {
    return memoryCache.get(track.path)!;
  }

  try {
    // 1. Check if cache exists in temporary folder
    const check = await window.api.isBouncedCached(track.path);
    if (check && check.cached) {
      memoryCache.set(track.path, check.bouncePath);
      return check.bouncePath;
    }

    // 2. Decode audio buffer using player
    const audioBuffer = await audioPlayer.getAudioBufferForTrack(track);
    if (!audioBuffer) {
      return track.path;
    }

    // 3. Resample to 48.000 Hz if needed
    const targetSampleRate = 48000;
    const resampled = audioBuffer.sampleRate === targetSampleRate
      ? audioBuffer
      : await resampleAudioBuffer(audioBuffer, targetSampleRate);

    // 4. Encode to PCM 16-bit RIFF WAV
    const wavData = encodeAudioBufferToWav(resampled, 16);

    // 5. Save to temporary bounce directory
    const bouncedPath = await window.api.saveBouncedWav(track.path, wavData);
    if (bouncedPath) {
      memoryCache.set(track.path, bouncedPath);
      return bouncedPath;
    }
  } catch (err) {
    console.warn(`[BouncerService] Failed to bounce ${track.path}, fallback to original:`, err);
  }

  return track.path;
}

/**
 * Get or prepare bounced paths for multiple tracks concurrently.
 */
export async function getOrPrepareBouncedPaths(tracks: Track[]): Promise<string[]> {
  if (!isAutoBounceEnabled()) {
    return tracks.map((t) => t.path);
  }
  return await Promise.all(tracks.map((t) => getOrPrepareBouncedPath(t)));
}

/**
 * Pre-warm/pre-bounce a track in the background so that by the time
 * the user drags it, the WAV is already in cache.
 */
export function prewarmBounce(track: Track): void {
  if (!isAutoBounceEnabled()) return;
  if (isTrackAlreadyBroadcastWav(track)) return;
  if (memoryCache.has(track.path)) return;

  // Non-blocking background task
  getOrPrepareBouncedPath(track).catch(() => {});
}
