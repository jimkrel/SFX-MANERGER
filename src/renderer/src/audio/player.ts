import { Track } from '../../../preload';
import { getAudioContext } from './audioContext';
import { loadAudioBuffer, observeTrack, trackCacheKey } from './bufferLoader';

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

export type PlayerErrorListener = (error: { message: string; track: Track }) => void;

class AudioPlayer {
  private playRequest = 0;
  private isLoading = false;
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
  private bufferGainCache: Map<string, number> = new Map();
  private listeners: Set<StateListener> = new Set();
  private errorListeners: Set<PlayerErrorListener> = new Set();

  constructor() {}

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onError(listener: PlayerErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  private notifyError(message: string, track: Track): void {
    this.errorListeners.forEach((l) => l({ message, track }));
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
      const normGain = this.bufferGainCache.get(trackCacheKey(this.currentTrack)) || 1.0;
      this.gainNode.gain.value = this.volume * normGain;
    }
    this.notify();
  }

  public async getAudioBufferForTrack(track: Track, priority = 0): Promise<AudioBuffer | null> {
    const buffer = await loadAudioBuffer(track, priority);
    if (!buffer) return null;
    const key = trackCacheKey(track);
    const normGain = track.peak_gain ?? calculatePeakGain(buffer);
    if (!this.bufferGainCache.has(key)) {
      if (this.bufferGainCache.size >= 16) this.bufferGainCache.delete(this.bufferGainCache.keys().next().value!);
      this.bufferGainCache.set(key, normGain);
      if (track.peak_gain == null) void window.api?.setPeakGain(track.id, normGain, track.content_version).catch(console.warn);
    }
    return buffer;
  }

  // A refreshed library snapshot invalidates a source being played or loaded.
  public refreshTracks(tracks: Track[]): void {
    for (const track of tracks) {
      observeTrack(track);
      if (this.currentTrack?.id !== track.id) continue;
      if (trackCacheKey(track) !== trackCacheKey(this.currentTrack) || track.is_missing) {
        this.pause();
        this.activeBuffer = null;
        this.duration = 0;
        this.pausedAt = 0;
      }
      this.currentTrack = track;
      this.notify();
    }
  }

  public async play(track: Track, offset: number = 0): Promise<void> {
    const request = ++this.playRequest;
    this.stopSourceNode();
    this.currentTrack = track;
    this.pausedAt = offset;
    this.isPlaying = false;
    this.isLoading = true;
    this.activeBuffer = null;
    this.duration = 0;
    this.notify();
    const ctx = getAudioContext();
    let buffer: AudioBuffer | null = null;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      if (request !== this.playRequest) return;
      buffer = await this.getAudioBufferForTrack(track, 100);
    } catch (error) { console.warn('[AudioPlayer]', error); }
    if (request !== this.playRequest) return;
    this.isLoading = false;
    if (!buffer) {
      console.error('[AudioPlayer] Unable to get audio buffer for track:', track.name);
      const isExternal = track.path.startsWith('/Volumes/');
      const errorMsg = isExternal
        ? `Không thể phát "${track.name}". Ổ đĩa ngoài /Volumes bị macOS chặn quyền truy cập (EPERM). Hãy kiểm tra Cài đặt hệ thống > Quyền riêng tư & Bảo mật hoặc thêm lại thư mục.`
        : `Không thể nạp dữ liệu âm thanh cho "${track.name}". File có thể bị hỏng hoặc đã bị di chuyển.`;
      this.pausedAt = 0;
      this.notify();
      this.notifyError(errorMsg, track);
      return;
    }

    this.activeBuffer = buffer;
    this.duration = buffer.duration;

    // Normalization Gain
    const normGain = this.bufferGainCache.get(trackCacheKey(track)) || 1.0;
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

    try { source.start(0, safeOffset); }
    catch (error) {
      this.stopSourceNode(); this.isPlaying = false; this.activeBuffer = null;
      this.notifyError(String(error), track);
    }
    this.notify();
  }

  public pause(): void {
    ++this.playRequest;
    this.isLoading = false;
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

    if (this.isPlaying || this.isLoading) {
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
    const safeOffset = Math.max(0, Math.min(offsetSeconds, this.duration || this.currentTrack.duration));
    if (this.isPlaying || this.isLoading) {
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
