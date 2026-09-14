import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Track } from '../../../preload';
import { getOrComputePeaks } from '../audio/waveform';

interface WaveformThumbnailProps {
  track: Track;
  isPlaying?: boolean;
  isSelected?: boolean;
  width?: number;
  height?: number;
}

export const WaveformThumbnail: React.FC<WaveformThumbnailProps> = ({
  track,
  isPlaying = false,
  isSelected = false,
  width = 120,
  height = 32
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [computedPeaks, setComputedPeaks] = useState<number[] | null>(null);

  // Synchronously use track.peaks_80 when available to eliminate any paint delay
  const activePeaks = track.peaks_80 ?? computedPeaks;

  // 1. IntersectionObserver để lazy-load/draw chỉ khi card lọt vào viewport
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // 2. Fetch/Compute peaks khi visible và chưa có peaks_80
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

  // Draw peaks before paint when available
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activePeaks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const barCount = activePeaks.length;
    const stride = width / barCount;
    const barWidth = Math.max(0.25, stride * 0.7);

    const activeColor = '#C9974E';
    const inactiveColor = isSelected ? 'rgba(201, 151, 78, 0.7)' : 'rgba(232, 227, 218, 0.35)';
    ctx.fillStyle = isPlaying ? activeColor : inactiveColor;

    const centerY = height / 2;

    for (let i = 0; i < barCount; i++) {
      const peak = activePeaks[i] || 0;
      const barHeight = Math.max(2, peak * (height - 4));
      const x = i * stride;
      const y = centerY - barHeight / 2;

      // Rounded vertical bars
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    }
  }, [activePeaks, isPlaying, isSelected, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        maxWidth: '100%',
        display: 'block',
        borderRadius: '3px',
        backgroundColor: 'rgba(0, 0, 0, 0.15)'
      }}
    />
  );
};
