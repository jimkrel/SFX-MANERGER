import React, { useEffect, useRef, useState } from 'react';
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
  const [peaks, setPeaks] = useState<number[] | null>(null);

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

  // 2. Fetch/Compute peaks khi visible
  useEffect(() => {
    if (!isVisible || track.is_missing === 1) return;

    let isMounted = true;
    getOrComputePeaks(track, 80)
      .then((computedPeaks) => {
        if (isMounted) {
          setPeaks(computedPeaks);
        }
      })
      .catch((err) => console.warn('Thumbnail waveform load error:', err));

    return () => {
      isMounted = false;
    };
  }, [isVisible, track]);

  // 3. Vẽ tĩnh 1 lần lên canvas khi peaks hoặc trạng thái thay đổi
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const barCount = peaks.length;
    const barSpacing = 1;
    const totalSpacing = (barCount - 1) * barSpacing;
    const barWidth = Math.max(1, (width - totalSpacing) / barCount);

    const activeColor = '#C9974E';
    const inactiveColor = isSelected ? 'rgba(201, 151, 78, 0.7)' : 'rgba(232, 227, 218, 0.35)';
    ctx.fillStyle = isPlaying ? activeColor : inactiveColor;

    const centerY = height / 2;

    for (let i = 0; i < barCount; i++) {
      const peak = peaks[i] || 0;
      const barHeight = Math.max(2, peak * (height - 4));
      const x = i * (barWidth + barSpacing);
      const y = centerY - barHeight / 2;

      // Rounded vertical bars
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    }
  }, [peaks, isPlaying, isSelected, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
        borderRadius: '3px',
        backgroundColor: 'rgba(0, 0, 0, 0.15)'
      }}
    />
  );
};
