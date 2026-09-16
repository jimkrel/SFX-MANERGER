import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Track } from '../../../preload';
import { getOrComputePeaks } from '../audio/waveform';
import { audioPlayer } from '../audio/player';

export interface WaveformThumbnailProps {
  track: Track;
  isPlaying?: boolean;
  isSelected?: boolean;
  width?: number;
  height?: number;
  interactive?: boolean;
  onSelectTrack?: (track: Track) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const WaveformThumbnail: React.FC<WaveformThumbnailProps> = ({
  track,
  isPlaying = false,
  isSelected = false,
  width = 105,
  height = 24,
  interactive = true,
  onSelectTrack
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [computedPeaks, setComputedPeaks] = useState<number[] | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; time: number; isBelow?: boolean } | null>(null);
  const isScrubbingRef = useRef(false);

  // Synchronously use track.peaks_80 when available
  const activePeaks = track.peaks_80 ?? computedPeaks;

  // 1. IntersectionObserver to lazy load/compute peaks only when in viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '100px' }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 2. Fetch/Compute peaks when visible and not yet cached
  useEffect(() => {
    if (track.peaks_80) {
      setComputedPeaks(null);
      return;
    }
    if (!isVisible || track.is_missing === 1) return;

    let isMounted = true;
    getOrComputePeaks(track, 80)
      .then((peaks) => {
        if (isMounted) {
          setComputedPeaks(peaks);
        }
      })
      .catch((err) => console.warn('Thumbnail waveform load error:', err));

    return () => {
      isMounted = false;
    };
  }, [isVisible, track.id, track.content_version, track.is_missing, track.peaks_80]);

  // 3. Core Drawing Logic
  const drawWaveform = useCallback(
    (currentPlayTime?: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !activePeaks) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, width, height);

      const barCount = activePeaks.length;
      const stride = width / barCount;
      const barWidth = Math.max(0.75, stride * 0.7);

      const duration = track.duration || 1;
      const progress = currentPlayTime !== undefined && duration > 0
        ? Math.max(0, Math.min(1, currentPlayTime / duration))
        : 0;
      const playheadX = progress * width;

      const centerY = height / 2;

      // Draw bars with dual-color (played vs unplayed) if active/playing
      for (let i = 0; i < barCount; i++) {
        const peak = activePeaks[i] || 0;
        const barHeight = Math.max(2, peak * (height - 4));
        const x = i * stride;
        const y = centerY - barHeight / 2;

        if (currentPlayTime !== undefined && currentPlayTime > 0) {
          if (x <= playheadX) {
            // Played part: vibrant golden amber
            ctx.fillStyle = '#d9a55c';
          } else {
            // Unplayed part: subtle muted tone
            ctx.fillStyle = isSelected ? 'rgba(201, 151, 78, 0.45)' : 'rgba(232, 227, 218, 0.25)';
          }
        } else {
          // Inactive track: standard styling
          ctx.fillStyle = isSelected ? 'rgba(201, 151, 78, 0.7)' : 'rgba(232, 227, 218, 0.35)';
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }

      // Draw Playhead line if active/playing
      if (currentPlayTime !== undefined && currentPlayTime > 0 && progress > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#d9a55c';
        ctx.shadowBlur = 3;
        ctx.fillRect(Math.max(0, playheadX - 0.75), 0, 1.5, height);
        ctx.shadowBlur = 0;
      }

      // Draw Hover Indicator Line only when far enough from playhead to prevent visual clutter
      if (hoverPos !== null) {
        const isNearPlayhead = currentPlayTime !== undefined && currentPlayTime > 0 && Math.abs(hoverPos.x - playheadX) < 4;
        if (!isNearPlayhead) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fillRect(Math.round(hoverPos.x) - 0.5, 0, 1, height);
        }
      }
    },
    [activePeaks, width, height, isSelected, track.duration, hoverPos]
  );

  // 4. Paint static or paused position before repaint
  useLayoutEffect(() => {
    if (isPlaying) return; // Handled by RAF loop below

    const state = audioPlayer.getState();
    const isCurrent = state.currentTrack?.id === track.id;
    const pausedTime = isCurrent ? audioPlayer.getCurrentTime() : undefined;
    drawWaveform(pausedTime);
  }, [drawWaveform, isPlaying, track.id]);

  // 5. 60fps Real-time Playhead Animation Loop (only active on the currently playing track)
  useEffect(() => {
    if (!isPlaying) return;

    let animId: number;
    const renderLoop = () => {
      const curTime = audioPlayer.getCurrentTime();
      drawWaveform(curTime);
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [isPlaying, drawWaveform]);

  // 6. Fast Auditioning & Seeking Handler
  const handleSeekFromClientX = useCallback(
    (clientX: number) => {
      if (!containerRef.current || track.is_missing === 1 || !interactive) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTime = ratio * (track.duration || 0);

      onSelectTrack?.(track);

      const state = audioPlayer.getState();
      if (state.currentTrack?.id === track.id && state.isPlaying) {
        audioPlayer.seek(targetTime);
      } else {
        // Instant play from the clicked timestamp for rapid auditioning!
        audioPlayer.play(track, targetTime);
      }
    },
    [track, interactive, onSelectTrack]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || track.is_missing === 1) return;
    // Stop propagation so row drag/checkbox selection is not triggered
    e.stopPropagation();
    e.preventDefault();

    isScrubbingRef.current = true;
    handleSeekFromClientX(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !interactive || track.is_missing === 1) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, e.clientX - rect.left));
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * (track.duration || 0);

    // If near top of viewport / sticky table header (< 135px), flip tooltip below waveform
    const isBelow = rect.top < 135;
    setHoverPos({ x, time, isBelow });

    if (isScrubbingRef.current) {
      handleSeekFromClientX(e.clientX);
    }
  };

  const handleMouseLeave = () => {
    setHoverPos(null);
  };

  // Window-level scrubbing listeners
  useEffect(() => {
    if (!interactive) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isScrubbingRef.current) {
        handleSeekFromClientX(e.clientX);
      }
    };

    const handleWindowMouseUp = () => {
      isScrubbingRef.current = false;
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [interactive, handleSeekFromClientX]);

  return (
    <div
      ref={containerRef}
      className={`wf-thumb-wrap ${interactive ? 'interactive' : ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          maxWidth: '100%',
          display: 'block',
          borderRadius: '3px',
          backgroundColor: 'rgba(0, 0, 0, 0.18)'
        }}
      />
      {hoverPos !== null && (
        <div
          className={`wf-seek-tooltip ${hoverPos.isBelow ? 'tooltip-bottom' : ''}`}
          style={{ left: `${Math.max(22, Math.min(width - 22, hoverPos.x))}px` }}
        >
          <span>▶ {formatTime(hoverPos.time)}</span>
        </div>
      )}
    </div>
  );
};
