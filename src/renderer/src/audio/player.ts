import { Track } from '../../../preload';
import { getAudioContext, decodeAudioBuffer } from './audioContext';

export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

type StateListener = (state: PlayerState) => void;

function calculatePeakGain(buffer: AudioBuffer): number {
  let maxPeak = 0;
  const channels = buffer.numberOfChannels;
  const step = Math.max(1, Math.floor(buffer.length / 5000));
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += step) {
      const val = Math.abs(data[i]);
      if (val > maxPeak) maxPeak = val;
    }
  }
  if (maxPeak < 0.05) return 1.0;
  const target = 0.82;
  const gain = target / maxPeak;
  return Math.max(0.65, Math.min(1.35, gain));
}

class AudioPlayer {
  private static readonly MAX_BUFFER_CACHE = 8;
  private currentTrack: Track | null = null;
  private isPlaying: boolean = false;
  private isLooping: boolean = false;
  private startedAt: number = 0;
  private pausedAt: number = 0;
  private duration: number = 0;
  private volume: number = 0.8;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private activeBuffer: AudioBuffer | null = null;
  private bufferCache: Map<number, AudioBuffer> = new Map();
  private bufferGainCache: Map<number, number> = new Map();
  private listeners: Set<StateListener> = new Set();

  constructor() {}

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  public getState(): PlayerState {
    return {
      currentTrack: this.currentTrack,
      isPlaying: this.isPlaying,
      isLooping: this.isLooping,
      currentTime: this.getCurrentTime(),
      duration: this.duration || (this.currentTrack ? this.currentTrack.duration : 0),
      volume: this.volume
    };
  }

  public getCurrentTime(): number {
    if (!this.isPlaying) {
      return this.pausedAt;
    }
    const ctx = getAudioContext();
    const elapsed = ctx.currentTime - this.startedAt;
    if (this.isLooping && this.duration > 0) {
      return elapsed % this.duration;
    }
    const current = Math.min(this.duration, Math.max(0, elapsed));
    return current;
  }

  public getActiveBuffer(): AudioBuffer | null {
    return this.activeBuffer;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.currentTrack) {
      const normGain = this.bufferGainCache.get(this.currentTrack.id) || 1.0;
      this.gainNode.gain.value = this.volume * normGain;
    }
    this.notify();
  }

  public async getAudioBufferForTrack(track: Track): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(track.id)) {
      // LRU refresh: re-insert at the end
      const cached = this.bufferCache.get(track.id)!;
      this.bufferCache.delete(track.id);
      this.bufferCache.set(track.id, cached);
      return cached;
    }

    if (!window.api) return null;
    const rawBytes = await window.api.readAudioBuffer(track.path);
    if (!rawBytes) return null;

    try {
      const arrayBuffer = rawBytes.buffer.slice(
        rawBytes.byteOffset,
        rawBytes.byteOffset + rawBytes.byteLength
      ) as ArrayBuffer;
      const buffer = await decodeAudioBuffer(arrayBuffer);

      // LRU Eviction: remove oldest buffer when exceeding limit
      if (this.bufferCache.size >= AudioPlayer.MAX_BUFFER_CACHE) {
        const oldestKey = this.bufferCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.bufferCache.delete(oldestKey);
          this.bufferGainCache.delete(oldestKey);
        }
      }

      this.bufferCache.set(track.id, buffer);

      // Use cached peak_gain from SQLite if available, otherwise compute once and save to SQLite
      let normGain = track.peak_gain;
      if (normGain === undefined || normGain === null) {
        normGain = calculatePeakGain(buffer);
        track.peak_gain = normGain;
        if (window.api) {
          window.api.setPeakGain(track.id, normGain);
        }
      }
      this.bufferGainCache.set(track.id, normGain);
      return buffer;
    } catch (err) {
      console.error('[AudioPlayer] Decode audio error:', err);
      return null;
    }
  }

  public async play(track: Track, offset: number = 0): Promise<void> {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Stop current playing node if any
    this.stopSourceNode();

    // Check if switching tracks
    if (!this.currentTrack || this.currentTrack.id !== track.id) {
      this.currentTrack = track;
      this.pausedAt = offset;
    }

    const buffer = await this.getAudioBufferForTrack(track);
    if (!buffer) {
      console.error('[AudioPlayer] Unable to get audio buffer for track:', track.name);
      return;
    }

    this.activeBuffer = buffer;
    this.duration = buffer.duration;

    // Normalization Gain
    const normGain = this.bufferGainCache.get(track.id) || 1.0;
    const gainNode = ctx.createGain();
    gainNode.gain.value = this.volume * normGain;
    this.gainNode = gainNode;

    // Create new AudioBufferSourceNode
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = this.isLooping;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const safeOffset = Math.max(0, Math.min(offset, buffer.duration));
    this.startedAt = ctx.currentTime - safeOffset;
    this.pausedAt = safeOffset;
    this.isPlaying = true;
    this.sourceNode = source;

    source.onended = () => {
      if (this.sourceNode === source && !this.isLooping) {
        // Track finished naturally
        this.isPlaying = false;
        this.pausedAt = 0;
        this.notify();
      }
    };

    source.start(0, safeOffset);
    this.notify();
  }

  public pause(): void {
    if (!this.isPlaying) return;

    this.pausedAt = this.getCurrentTime();
    this.stopSourceNode();
    this.isPlaying = false;
    this.notify();
  }

  public async resume(): Promise<void> {
    if (this.isPlaying) return;
    if (this.currentTrack) {
      await this.play(this.currentTrack, this.pausedAt);
    }
  }

  public async togglePlay(track?: Track): Promise<void> {
    if (track && (!this.currentTrack || this.currentTrack.id !== track.id)) {
      await this.play(track, 0);
      return;
    }

    if (this.isPlaying) {
      this.pause();
    } else {
      if (this.currentTrack) {
        await this.resume();
      } else if (track) {
        await this.play(track, 0);
      }
    }
  }

  public async seek(offsetSeconds: number): Promise<void> {
    if (!this.currentTrack) return;
    const safeOffset = Math.max(0, Math.min(offsetSeconds, this.duration));
    if (this.isPlaying) {
      await this.play(this.currentTrack, safeOffset);
    } else {
      this.pausedAt = safeOffset;
      this.notify();
    }
  }

  public async seekBy(deltaSeconds: number): Promise<void> {
    const current = this.getCurrentTime();
    await this.seek(current + deltaSeconds);
  }

  public setLooping(loop: boolean): void {
    this.isLooping = loop;
    if (this.sourceNode) {
      this.sourceNode.loop = loop;
    }
    this.notify();
  }

  public toggleLoop(): boolean {
    this.setLooping(!this.isLooping);
    return this.isLooping;
  }

  private stopSourceNode(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // Source node may already be stopped
      }
      this.sourceNode = null;
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // Gain node may already be disconnected
      }
      this.gainNode = null;
    }
  }
}

export const audioPlayer = new AudioPlayer();
