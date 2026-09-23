import React, { useEffect, useState, useMemo, useRef } from 'react';
import { CapCutPreset } from '../../../preload';
import { Play, Pause, RotateCcw } from 'lucide-react';

export type AnimStyleType =
  | 'auto'
  | 'bounce-pop'
  | 'slide-up'
  | 'typewriter'
  | 'glow-gold'
  | 'shimmer-sweep'
  | 'blur-fade'
  | 'glitch'
  | 'stamp-slam'
  | 'flip-3d';

export interface CapCutAnimPreviewProps {
  preset: CapCutPreset;
  isPlaying?: boolean;
  overrideText?: string;
  overrideAnim?: AnimStyleType;
  speed?: number; // 0.5, 1, 1.5, 2
  compact?: boolean;
  showControls?: boolean;
  onTogglePlay?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colorToRgb(color: number[]): { r: number; g: number; b: number; css: string } {
  if (!color || color.length < 3) {
    return { r: 255, g: 255, b: 255, css: '#ffffff' };
  }
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  return { r, g, b, css: `rgb(${r}, ${g}, ${b})` };
}

// Detect the best matching animation style from effect names
export function detectAnimationStyle(preset: CapCutPreset): AnimStyleType {
  const effectNames = preset.effects.map((e) => e.name.toLowerCase()).join(' ');

  if (effectNames.includes('gold') || effectNames.includes('brillo') || effectNames.includes('phát sáng')) {
    return 'glow-gold';
  }
  if (effectNames.includes('tia sáng') || effectNames.includes('quét qua') || effectNames.includes('rollo')) {
    return 'shimmer-sweep';
  }
  if (effectNames.includes('văn bản') || effectNames.includes('cọ than')) {
    return 'typewriter';
  }
  if (effectNames.includes('borrosa') || effectNames.includes('làm mờ') || effectNames.includes('mờ chrome')) {
    return 'blur-fade';
  }
  if (effectNames.includes('lên trên') || effectNames.includes('arriba')) {
    return 'slide-up';
  }
  if (effectNames.includes('rebote') || effectNames.includes('burbujeante') || effectNames.includes('split') || effectNames.includes('tách')) {
    return 'bounce-pop';
  }
  if (effectNames.includes('trượt')) {
    return 'slide-up';
  }

  // Hash preset ID to pick diverse animations for presets without explicit effect hints
  const hash = preset.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const styles: AnimStyleType[] = ['bounce-pop', 'slide-up', 'glow-gold', 'shimmer-sweep', 'blur-fade', 'typewriter'];
  return styles[hash % styles.length];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CapCutAnimPreview({
  preset,
  isPlaying = true,
  overrideText,
  overrideAnim = 'auto',
  speed = 1,
  compact = false,
  showControls = false,
  onTogglePlay,
}: CapCutAnimPreviewProps) {
  const [localPlaying, setLocalPlaying] = useState<boolean>(isPlaying);
  const [replayKey, setReplayKey] = useState<number>(0);
  const [fontLoaded, setFontLoaded] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalPlaying(isPlaying);
  }, [isPlaying]);

  // Determine effective animation
  const effectiveAnim = useMemo(() => {
    if (overrideAnim && overrideAnim !== 'auto') return overrideAnim;
    return detectAnimationStyle(preset);
  }, [overrideAnim, preset]);

  // Dynamic FontFace loader
  useEffect(() => {
    let isCancelled = false;
    const fontText = preset.texts.find((t) => !t.isFontBroken && t.fontPath);
    if (!fontText || !window.api?.capcut?.getAssetDataUrl) return;

    const fontId = `cc_font_${preset.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    window.api.capcut.getAssetDataUrl(fontText.fontPath).then((dataUrl) => {
      if (isCancelled || !dataUrl) return;
      try {
        const fontFace = new FontFace(fontId, `url("${dataUrl}")`);
        fontFace.load().then((loaded) => {
          if (isCancelled) return;
          (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
          setFontLoaded(fontId);
        });
      } catch {
        // Fallback to system font silently
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [preset]);

  // Text layers to render
  const textItems = useMemo(() => {
    if (overrideText && overrideText.trim()) {
      return [
        {
          id: 'override',
          text: overrideText.trim(),
          color: [1, 1, 1],
          bold: true,
          fontSize: 28,
        },
      ];
    }
    if (preset.texts.length > 0) {
      return preset.texts
        .filter((t) => t.parsedText && t.parsedText.trim())
        .map((t) => ({
          id: t.id,
          text: t.parsedText.trim(),
          color: t.color,
          bold: t.bold,
          fontSize: t.fontSize || 20,
        }));
    }
    // Fallback if preset has no text
    return [
      {
        id: 'fallback',
        text: preset.name.replace(/Các kiểu cài sẵn của tôi\d*/i, 'VIRAL TEXT') || 'CAPCUT PRESET',
        color: [1, 0.85, 0.3],
        bold: true,
        fontSize: 24,
      },
    ];
  }, [overrideText, preset]);

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReplayKey((k) => k + 1);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onTogglePlay) {
      onTogglePlay();
    } else {
      setLocalPlaying((p) => !p);
    }
  };

  const durationSec = Math.max(1.2, 3 / speed);

  return (
    <div
      ref={containerRef}
      className={`cc-anim-stage ${compact ? 'compact' : ''} ${effectiveAnim}`}
      style={
        {
          '--anim-duration': `${durationSec}s`,
          '--anim-play-state': localPlaying ? 'running' : 'paused',
        } as React.CSSProperties
      }
      key={replayKey}
    >
      {/* Background cinematic aura */}
      <div className="cc-stage-backdrop">
        <div className="cc-stage-grid" />
        <div className="cc-stage-glow-spot" />
      </div>

      {/* Main text content container */}
      <div className="cc-stage-content">
        {textItems.map((item, index) => {
          const { css: colorCss, r, g, b } = colorToRgb(item.color);
          const delaySec = index * 0.18;

          return (
            <div
              key={item.id}
              className={`cc-anim-text-layer cc-anim-${effectiveAnim}`}
              style={
                {
                  color: colorCss,
                  fontWeight: item.bold ? 800 : 600,
                  fontFamily: fontLoaded ? `'${fontLoaded}', 'Montserrat', 'Inter', sans-serif` : "'Montserrat', 'Inter', -apple-system, sans-serif",
                  '--layer-color': colorCss,
                  '--layer-rgb': `${r}, ${g}, ${b}`,
                  '--anim-delay': `${delaySec}s`,
                } as React.CSSProperties
              }
            >
              {/* Typewriter mode: split into words or letters */}
              {effectiveAnim === 'typewriter' ? (
                <span className="cc-typewriter-words">
                  {item.text.split(' ').map((word, wIdx) => (
                    <span
                      key={wIdx}
                      className="cc-typewriter-word"
                      style={{ animationDelay: `${delaySec + wIdx * 0.12}s` }}
                    >
                      {word}&nbsp;
                    </span>
                  ))}
                </span>
              ) : (
                <span className="cc-text-inner" data-text={item.text}>
                  {item.text}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Looping progress bar */}
      <div className="cc-stage-timeline">
        <div
          className="cc-timeline-bar"
          style={{
            animationDuration: `${durationSec}s`,
            animationPlayState: localPlaying ? 'running' : 'paused',
          }}
        />
      </div>

      {/* Mini controls overlay */}
      {showControls && (
        <div className="cc-stage-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="cc-stage-btn"
            onClick={handleToggle}
            title={localPlaying ? 'Tạm dừng' : 'Phát tiếp'}
          >
            {localPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button className="cc-stage-btn" onClick={handleReplay} title="Phát lại từ đầu">
            <RotateCcw size={12} />
          </button>
          <span className="cc-stage-anim-tag">{effectiveAnim}</span>
        </div>
      )}
    </div>
  );
}
