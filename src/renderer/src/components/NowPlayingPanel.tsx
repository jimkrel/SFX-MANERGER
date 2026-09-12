import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Track } from '../../../preload';
import { getOrComputePeaks } from '../audio/waveform';
import { audioPlayer, PlayerState } from '../audio/player';
import { TagEditor } from './TagEditor';

interface NowPlayingPanelProps {
  selectedTrack: Track | null;
  onLibraryRefresh?: () => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export const NowPlayingPanel: React.FC<NowPlayingPanelProps> = ({ selectedTrack, onLibraryRefresh }) => {
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());
  const [peaks, setPeaks] = useState<number[] | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeDisplayRef = useRef<HTMLSpanElement | null>(null);

  const activeTrack = playerState.currentTrack || selectedTrack;

  // 1. Subscribe to player state updates
  useEffect(() => {
    const unsubscribe = audioPlayer.subscribe((state) => {
      setPlayerState(state);
    });
    return () => unsubscribe();
  }, []);

  // 2. Load 800-peak resolution waveform for the active track
  useEffect(() => {
    if (!activeTrack || activeTrack.is_missing === 1) {
      setPeaks(null);
      return;
    }

    let isMounted = true;
    getOrComputePeaks(activeTrack, 800)
      .then((p) => {
        if (isMounted) {
          setPeaks(p);
        }
      })
      .catch((err) => console.error('Now Playing waveform error:', err));

    return () => {
      isMounted = false;
    };
  }, [activeTrack]);

  // 3. Draw static waveform ONCE onto the background canvas (Mục 3.4)
  const drawStaticWaveform = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas || !peaks || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = 90;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const barCount = peaks.length;
    const barSpacing = 0.5;
    const totalSpacing = (barCount - 1) * barSpacing;
    const barWidth = Math.max(1, (width - totalSpacing) / barCount);
    const centerY = height / 2;

    ctx.fillStyle = 'rgba(232, 227, 218, 0.45)';

    for (let i = 0; i < barCount; i++) {
      const peak = peaks[i] || 0;
      const barHeight = Math.max(2, peak * (height - 8));
      const x = i * (barWidth + barSpacing);
      const y = centerY - barHeight / 2;

      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }, [peaks]);

  useEffect(() => {
    drawStaticWaveform();
    window.addEventListener('resize', drawStaticWaveform);
    return () => window.removeEventListener('resize', drawStaticWaveform);
  }, [drawStaticWaveform]);

  // 4. Draw playhead overlay layer in requestAnimationFrame (Mục 3.4 & 3.5)
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth;
    const height = 90;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number | null = null;

    const renderPlayhead = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const duration = playerState.duration || activeTrack?.duration || 0;
      const currentTime = playerState.isPlaying
        ? audioPlayer.getCurrentTime()
        : playerState.currentTime;

      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(currentTime);
      }

      if (duration > 0) {
        const progress = Math.min(1, Math.max(0, currentTime / duration));
        const playheadX = progress * width * dpr;

        // Draw active tinted region
        ctx.fillStyle = 'rgba(201, 151, 78, 0.18)';
        ctx.fillRect(0, 0, playheadX, canvas.height);

        // Draw vertical playhead line
        ctx.fillStyle = '#C9974E';
        ctx.fillRect(playheadX - 1.5, 0, 3, canvas.height);
      }

      if (playerState.isPlaying) {
        animId = requestAnimationFrame(renderPlayhead);
      }
    };

    renderPlayhead();

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [playerState.isPlaying, playerState.duration, activeTrack]);

  // 5. Seek on click (Mục 3.5)
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeTrack || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.min(1, Math.max(0, clickX / rect.width));
    const duration = playerState.duration || activeTrack.duration;
    const seekTime = percent * duration;

    audioPlayer.seek(seekTime);
  };

  const togglePlay = () => {
    if (activeTrack) {
      audioPlayer.togglePlay(activeTrack);
    }
  };

  if (!activeTrack) {
    return (
      <div
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(232, 227, 218, 0.4)',
          fontSize: '13px',
          height: '100%'
        }}
      >
        Chọn một clip âm thanh để xem waveform chi tiết và nghe thử.
      </div>
    );
  }

  const duration = playerState.duration || activeTrack.duration;
  const currentTime = playerState.currentTime;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        height: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', marginBottom: '4px' }}>
            Now Playing
          </div>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
            {activeTrack.name}
          </h2>
          <div className="mono" style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.4)', marginTop: '2px', wordBreak: 'break-all' }}>
            {activeTrack.path}
          </div>
        </div>

        {/* Technical Data Tokens (Sample Rate, Channels, BPM, dB) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
          <div className="mono" style={{ fontSize: '12px', color: 'var(--accent)' }}>
            {activeTrack.sample_rate ? `${activeTrack.sample_rate.toLocaleString()} Hz` : '48,000 Hz'}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.6)' }}>
              {activeTrack.channels === 1 ? '1 Ch' : activeTrack.channels === 2 ? '2 Ch' : 'Stereo'}
            </span>
            <span style={{ color: 'rgba(232, 227, 218, 0.2)' }}>•</span>
            <span className="mono" style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.6)' }}>
              {activeTrack.duration >= 30 ? '120 BPM' : 'SFX'}
            </span>
            <span style={{ color: 'rgba(232, 227, 218, 0.2)' }}>•</span>
            <span className="mono" style={{ fontSize: '10px', color: 'var(--accent)' }}>
              -0.1 dB
            </span>
          </div>
        </div>
      </div>

      {/* Large Waveform Canvas (Full-size Now Playing) */}
      <div
        ref={containerRef}
        onClick={handleSeek}
        style={{
          position: 'relative',
          width: '100%',
          height: '90px',
          backgroundColor: '#161514',
          borderRadius: '6px',
          cursor: 'pointer',
          overflow: 'hidden',
          border: '1px solid rgba(232, 227, 218, 0.08)'
        }}
        title="Click bất kỳ vị trí nào để seek (Soundcloud style)"
      >
        {/* Layer 1: Static Waveform */}
        <canvas
          ref={bgCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
        {/* Layer 2: Realtime Playhead */}
        <canvas
          ref={playheadCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      </div>

      {/* Transport Controls & Time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={togglePlay}
            disabled={activeTrack.is_missing === 1}
            style={{
              backgroundColor: playerState.isPlaying ? 'var(--accent)' : 'rgba(232, 227, 218, 0.1)',
              border: playerState.isPlaying ? 'none' : '1px solid var(--border-color)',
              color: playerState.isPlaying ? '#1C1B19' : 'var(--text-main)',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: activeTrack.is_missing === 1 ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 700
            }}
            title="Space = Play/Pause"
          >
            {playerState.isPlaying ? '⏸' : '▶'}
          </button>

          <span style={{ fontSize: '11px', color: 'rgba(232, 227, 218, 0.4)' }}>
            Phím <strong style={{ color: 'var(--text-main)' }}>Space</strong> để Play / Pause
          </span>
        </div>

        {/* Technical Time Display */}
        <div className="mono" style={{ fontSize: '14px', letterSpacing: '0.05em' }}>
          <span ref={timeDisplayRef} style={{ color: 'var(--accent)' }}>{formatTime(currentTime)}</span>
          <span style={{ color: 'rgba(232, 227, 218, 0.3)', margin: '0 4px' }}>/</span>
          <span style={{ color: 'var(--text-main)' }}>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Phase 4: Tag Editor */}
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '4px' }}>
        <TagEditor
          trackId={activeTrack.id}
          tags={activeTrack.tagList || []}
          onTagsChanged={() => {
            if (onLibraryRefresh) {
              onLibraryRefresh();
            }
          }}
        />
      </div>
    </div>
  );
};
