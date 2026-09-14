import { Track } from '../../../preload';
import { getAnyCachedPeaks } from '../audio/waveform';

/**
 * Generate a personalized 48x48 PNG Data URL drag icon for macOS / Windows.
 * - For single file: Renders music note icon + mini waveform using cached peaks.
 * - For multiple files: Renders music note icon + count indicator (e.g. "🎵 x3").
 */
export function generateDragIconDataUrl(track?: Track, count = 1): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // 1. Draw rounded background card
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(1, 1, 46, 46, 10);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 48);
    bgGrad.addColorStop(0, '#282622');
    bgGrad.addColorStop(1, '#161513');
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // 2. Amber border
    ctx.strokeStyle = '#d9a55c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    if (count > 1) {
      // MULTI-FILE: Display "🎵" and "x{count}"
      ctx.save();
      ctx.font = '15px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎵', 24, 17);

      ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = '#d9a55c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${count}`, 24, 33);
      ctx.restore();
    } else {
      // SINGLE FILE: Display note icon + mini waveform from cached peaks
      ctx.save();
      // Mini note at top
      ctx.font = '14px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎵', 24, 15);

      // Mini waveform bars at bottom
      const peaks = track ? getAnyCachedPeaks(track.id) : undefined;
      const barCount = 11;
      const defaultWave = [0.25, 0.5, 0.8, 1.0, 0.7, 0.9, 0.65, 0.45, 0.7, 0.4, 0.2];

      ctx.fillStyle = '#d9a55c';
      for (let i = 0; i < barCount; i++) {
        let val = 0.4;
        if (peaks && peaks.length > 0) {
          const pIdx = Math.floor((i / barCount) * peaks.length);
          val = peaks[pIdx] ?? 0.4;
        } else {
          val = defaultWave[i % defaultWave.length];
        }

        const barHeight = Math.max(3, Math.min(14, val * 14));
        const barX = 8 + i * 3;
        const barY = 38 - barHeight;

        ctx.beginPath();
        ctx.roundRect(barX, barY, 2, barHeight, 1);
        ctx.fill();
      }
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[DragIcon] Failed to generate custom drag icon:', err);
    return '';
  }
}
