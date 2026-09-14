import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  AudioLines,
  Heart,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Volume2,
  Tag as TagIcon,
  Plus,
  RefreshCw,
  Star,
  FolderOpen,
  Repeat,
  ArrowLeftRight
} from 'lucide-react';
import { Track } from '../../../preload';
import { getOrComputePeaks } from '../audio/waveform';
import { audioPlayer, PlayerState } from '../audio/player';
import { detectBpm } from '../audio/bpmDetector';
import { TagEditor } from './TagEditor';
import { getFileManagerName } from '../utils/platform';
import { AudioConvertModal } from './AudioConvertModal';

interface NowPlayingPanelProps {
  selectedTrack: Track | null;
  onLibraryRefresh?: () => void;
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
  onToast?: (type: 'success' | 'warning' | 'error' | 'info', title: string, message: string) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export const NowPlayingPanel: React.FC<NowPlayingPanelProps> = ({
  selectedTrack,
  onLibraryRefresh,
  onNextTrack,
  onPrevTrack,
  onToast
}) => {
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [currentBpm, setCurrentBpm] = useState<number | null>(null);
  const [isTogglingType, setIsTogglingType] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeDisplayRef = useRef<HTMLSpanElement | null>(null);

  // Bug fix: prefer selectedTrack (fresh from library) over playerState.currentTrack (stale)
  // when they refer to the same track — ensures toggle/tag changes show immediately
  const activeTrack = (() => {
    const pt = playerState.currentTrack;
    if (!pt) return selectedTrack;
    if (selectedTrack && selectedTrack.id === pt.id) return selectedTrack;
    return pt;
  })();

  // 1. Subscribe to player state
  useEffect(() => {
    const unsubscribe = audioPlayer.subscribe((state) => {
      setPlayerState(state);
    });
    return () => unsubscribe();
  }, []);

  // 1b. Sync & auto-detect BPM for active track
  useEffect(() => {
    if (!activeTrack) {
      setCurrentBpm(null);
      return;
    }

    if (activeTrack.bpm !== undefined && activeTrack.bpm !== null) {
      setCurrentBpm(activeTrack.bpm);
      return;
    }

    // Spec v2: Do not run BPM detection for SFX < 2s
    if (activeTrack.duration < 2.0 || activeTrack.is_missing === 1) {
      setCurrentBpm(null);
      return;
    }

    let isMounted = true;
    audioPlayer.getAudioBufferForTrack(activeTrack).then((buffer) => {
      if (!isMounted || !buffer) return;
      const detected = detectBpm(buffer);
      if (isMounted) {
        setCurrentBpm(detected);
        if (window.api) {
          window.api.setBpm(activeTrack.id, detected);
          activeTrack.bpm = detected;
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [activeTrack?.id, activeTrack?.bpm]);

  // 2. Load 800-peak resolution waveform
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
  }, [activeTrack?.id]);

  const containerWidthRef = useRef<number>(0);

  // 3. Draw static waveform onto background canvas with specified width
  const drawStaticWaveform = useCallback((targetWidth?: number) => {
    const canvas = bgCanvasRef.current;
    if (!canvas || !peaks) return;

    const width = targetWidth || containerWidthRef.current || containerRef.current?.clientWidth || 0;
    if (width <= 0) return;

    const height = 54;
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

    ctx.fillStyle = '#4d535c';

    for (let i = 0; i < barCount; i++) {
      const peak = peaks[i] || 0;
      const barHeight = Math.max(2, peak * (height - 6));
      const x = i * (barWidth + barSpacing);
      const y = centerY - barHeight / 2;

      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }, [peaks]);

  // Use ResizeObserver with 60ms debounce instead of synchronous window.resize listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const initialWidth = container.clientWidth;
    containerWidthRef.current = initialWidth;
    drawStaticWaveform(initialWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.round(entry.contentRect.width);
        if (newWidth > 0 && Math.abs(newWidth - containerWidthRef.current) > 2) {
          containerWidthRef.current = newWidth;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            drawStaticWaveform(newWidth);
            renderPlayheadRef.current?.();
          }, 60);
        }
      }
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [drawStaticWaveform]);

  const renderPlayheadRef = useRef<(() => void) | null>(null);

  // 4. Draw playhead overlay layer in requestAnimationFrame
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const height = 54;
    const dpr = window.devicePixelRatio || 1;

    let animId: number | null = null;

    const renderPlayhead = () => {
      const currentWidth = containerWidthRef.current || container.clientWidth;
      if (canvas.width !== currentWidth * dpr) {
        canvas.width = currentWidth * dpr;
        canvas.height = height * dpr;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const duration = playerState.duration || activeTrack?.duration || 0;
      const currentTime = playerState.isPlaying
        ? audioPlayer.getCurrentTime()
        : playerState.currentTime;

      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(currentTime);
      }

      if (duration > 0 && currentWidth > 0) {
        const progress = Math.min(1, Math.max(0, currentTime / duration));
        const playheadX = progress * currentWidth * dpr;

        // Draw active tinted region
        ctx.fillStyle = 'rgba(217, 165, 92, 0.22)';
        ctx.fillRect(0, 0, playheadX, canvas.height);

        // Draw vertical playhead line
        ctx.fillStyle = '#d9a55c';
        ctx.fillRect(playheadX - 1.5, 0, 3, canvas.height);
      }

      if (playerState.isPlaying) {
        animId = requestAnimationFrame(renderPlayhead);
      }
    };

    renderPlayheadRef.current = renderPlayhead;
    renderPlayhead();

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [playerState.isPlaying, playerState.duration, activeTrack?.id, playerState.isPlaying ? 0 : playerState.currentTime]);

  // Real-time Waveform Scrubbing (Click and Drag)
  const isScrubbingRef = useRef(false);

  const updateSeekFromClientX = useCallback(
    (clientX: number) => {
      if (!activeTrack || !containerRef.current || activeTrack.is_missing === 1) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const progress = Math.max(0, Math.min(1, clickX / rect.width));
      const duration = playerState.duration || activeTrack.duration || 0;
      audioPlayer.seek(progress * duration);
    },
    [activeTrack, playerState.duration]
  );

  const handleWaveMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTrack?.is_missing === 1) return;
    isScrubbingRef.current = true;
    updateSeekFromClientX(e.clientX);
  };

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isScrubbingRef.current) {
        updateSeekFromClientX(e.clientX);
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
  }, [updateSeekFromClientX]);

  // Toggle Favorite
  const handleToggleFavorite = async () => {
    if (!activeTrack || !window.api) return;
    try {
      await window.api.toggleFavorite(activeTrack.id);
      if (onLibraryRefresh) onLibraryRefresh();
    } catch (err) {
      console.error('Lỗi khi đổi trạng thái yêu thích:', err);
    }
  };

  // Set Rating
  const handleSetRating = async (ratingVal: number) => {
    if (!activeTrack || !window.api) return;
    try {
      await window.api.setRating(activeTrack.id, ratingVal);
      if (onLibraryRefresh) onLibraryRefresh();
    } catch (err) {
      console.error('Lỗi khi lưu rating:', err);
    }
  };

  // Toggle SFX <-> Music
  const handleToggleType = async () => {
    if (!activeTrack || !window.api || isTogglingType) return;
    setIsTogglingType(true);
    try {
      const newType = await window.api.toggleTrackType(activeTrack.id);
      // Optimistically update local activeTrack so UI updates in 0ms!
      if (activeTrack.tagList) {
        activeTrack.tagList = activeTrack.tagList.filter(
          (t) => t.name.toLowerCase() !== 'sfx' && t.name.toLowerCase() !== 'music'
        );
        activeTrack.tagList.push({ id: 0, name: newType });
      } else {
        activeTrack.tagList = [{ id: 0, name: newType }];
      }
      activeTrack.tags = newType;

      if (onToast) onToast('success', 'Đổi loại thành công', `Clip đã chuyển sang: ${newType}`);
      if (onLibraryRefresh) onLibraryRefresh();
    } catch (err) {
      console.error('Lỗi khi đổi loại track:', err);
    } finally {
      setIsTogglingType(false);
    }
  };

  if (!activeTrack) {
    return (
      <aside className="inspector empty-inspector">
        <div className="empty-state-content">
          <AudioLines size={40} className="muted-icon" />
          <p>Chọn một clip âm thanh để xem chi tiết và nghe thử</p>
        </div>
      </aside>
    );
  }

  const isPlayingCurrent = playerState.isPlaying && playerState.currentTrack?.id === activeTrack.id;
  const isFavorite = activeTrack.is_favorite === 1;
  const rating = activeTrack.rating || 0;

  // FIX: Tách biệt 2 loại dữ liệu:
  // - audioType: SFX hoặc Music — lấy từ tagList / tags
  // - genreName: thể loại nội dung (Cinematic, Foley, Ambience...) — lấy từ category field
  const isCurrentMusic =
    activeTrack.tagList?.some((t) => t.name.toLowerCase() === 'music') ??
    (activeTrack.tags && activeTrack.tags.toLowerCase().includes('music')) ??
    (activeTrack.duration >= 30 && !activeTrack.tagList?.some((t) => t.name.toLowerCase() === 'sfx'));
  const audioType = isCurrentMusic ? 'MUSIC' : 'SFX';
  const genreName = activeTrack.category && activeTrack.category !== 'Khác' && activeTrack.category.trim() !== '' ? activeTrack.category : null;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <p className="eyebrow">ĐANG CHỌN</p>
          <h2>Chi tiết âm thanh</h2>
        </div>
        {activeTrack.is_missing === 1 && (
          <span className="badge-missing">FILE BỊ THIẾU</span>
        )}
      </div>

      {/* Hero Artwork with Category Badge & Glow */}
      <div className={`hero-art ${isPlayingCurrent ? 'playing' : ''}`}>
        <div className="art-glow" />
        <AudioLines />
        <div className="hero-badges">
          {/* audioType badge: SFX hoặc MUSIC */}
          <span className={`hero-type-badge ${isCurrentMusic ? 'badge-type-music' : 'badge-type-sfx'}`}>
            {isCurrentMusic ? '🎵 MUSIC' : '🔊 SFX'}
          </span>
          {/* genre badge nếu có (Cinematic, Foley...) */}
          {genreName && <span className="badge-genre">{genreName}</span>}
          {currentBpm ? <span className="hero-bpm-badge">{currentBpm} BPM</span> : null}
          <button
            className="hero-type-toggle-btn"
            onClick={handleToggleType}
            disabled={isTogglingType}
            title={isCurrentMusic ? 'Chuyển clip này sang SFX' : 'Chuyển clip này sang Nhạc nền (Music)'}
          >
            <ArrowLeftRight size={10} />
            {isTogglingType ? '...' : (isCurrentMusic ? 'Đổi sang SFX' : 'Đổi sang Music')}
          </button>
        </div>
      </div>





      {/* Title & Favorite / Rating */}
      <div className="selected-title">
        <div className="title-text-wrap">
          <h2 title={activeTrack.name}>{activeTrack.name}</h2>
          <span>{activeTrack.path}</span>
        </div>
        <button
          className={`heart-button ${isFavorite ? 'liked' : ''}`}
          onClick={handleToggleFavorite}
          title={isFavorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}
        >
          <Heart fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Star Rating Interactivity */}
      <div className="rating-row">
        <span className="rating-label">Đánh giá:</span>
        <div className="stars-wrap" onMouseLeave={() => setHoverRating(null)}>
          {[1, 2, 3, 4, 5].map((starVal) => {
            const isFilled = (hoverRating !== null ? hoverRating : rating) >= starVal;
            return (
              <button
                key={starVal}
                className={`star-btn ${isFilled ? 'filled' : ''}`}
                onMouseEnter={() => setHoverRating(starVal)}
                onClick={() => handleSetRating(starVal === rating ? 0 : starVal)}
                title={`Đánh giá ${starVal} sao`}
              >
                <Star size={16} fill={isFilled ? '#d9a55c' : 'none'} color={isFilled ? '#d9a55c' : '#6b7280'} />
              </button>
            );
          })}
        </div>
        <span className="numeric-value rating-number">{rating > 0 ? `${rating}/5` : 'Chưa chấm'}</span>
      </div>

      {/* Big Waveform 800-peak */}
      <div
        className="big-wave"
        ref={containerRef}
        onMouseDown={handleWaveMouseDown}
        title="Nhấp hoặc kéo chuột để tua nhanh (Scrubbing)"
      >
        <canvas ref={bgCanvasRef} className="wave-bg-canvas" />
        <canvas ref={playheadCanvasRef} className="wave-playhead-canvas" />
      </div>

      {/* DAW Player Controls */}
      <div className="player-controls">
        <button
          className={`player-loop ${playerState.isLooping ? 'active' : ''}`}
          onClick={() => audioPlayer.toggleLoop()}
          title={playerState.isLooping ? 'Tắt phát lặp lại (L)' : 'Bật phát lặp lại (L)'}
        >
          <Repeat size={14} />
        </button>
        <button
          className="player-skip"
          onClick={() => audioPlayer.seekBy(-10)}
          title="Lùi 10 giây"
        >
          <RotateCcw />
          <span>10</span>
        </button>
        <button
          className="player-track"
          onClick={onPrevTrack}
          title="Clip trước đó"
        >
          <SkipBack />
        </button>
        <button
          className="main-play"
          onClick={() => {
            if (activeTrack.is_missing === 1) {
              if (onToast) onToast('warning', 'File bị thiếu', 'Không thể phát vì file không còn tồn tại trên ổ cứng.');
              return;
            }
            audioPlayer.togglePlay(activeTrack);
          }}
          disabled={activeTrack.is_missing === 1}
          title={activeTrack.is_missing === 1 ? 'File bị thiếu trên ổ cứng' : isPlayingCurrent ? 'Tạm dừng (Space)' : 'Phát (Space)'}
        >
          {isPlayingCurrent ? <Pause /> : <Play />}
        </button>
        <button
          className="player-track"
          onClick={onNextTrack}
          title="Clip tiếp theo"
        >
          <SkipForward />
        </button>
        <button
          className="player-skip"
          onClick={() => audioPlayer.seekBy(10)}
          title="Tua tới 10 giây"
        >
          <RotateCw />
          <span>10</span>
        </button>
        <div className="player-timing">
          <span ref={timeDisplayRef} className="numeric-value player-current">
            {formatTime(playerState.currentTime)}
          </span>
          <span className="timing-slash">/</span>
          <span className="numeric-value player-total">
            {formatTime(playerState.duration || activeTrack.duration || 0)}
          </span>
        </div>
      </div>

      {/* Volume Slider */}
      <div className="volume-row">
        <Volume2 size={16} />
        <input
          type="range"
          min="0"
          max="1"
          step="0.02"
          value={playerState.volume}
          onChange={(e) => audioPlayer.setVolume(parseFloat(e.target.value))}
          className="volume-slider"
          title={`Âm lượng: ${Math.round(playerState.volume * 100)}%`}
        />
        <span className="numeric-value volume-text">{Math.round(playerState.volume * 100)}%</span>
      </div>

      {/* File Info Block */}
      <div className="info-block">
        <div className="info-title">
          <h3>Thông tin file</h3>
        </div>
        <dl>
          <div>
            <dt>Phân loại</dt>
            <dd className="numeric-value">
              <span className={`badge-type-pill ${isCurrentMusic ? 'badge-type-music' : 'badge-type-sfx'}`}>
                {isCurrentMusic ? '🎵 Nhạc nền (Music)' : '🔊 Hiệu ứng (SFX)'}
              </span>
            </dd>
          </div>
          {activeTrack.artist && (
            <div>
              <dt>Nghệ sĩ</dt>
              <dd>{activeTrack.artist}</dd>
            </div>
          )}
          {activeTrack.album && (
            <div>
              <dt>Album</dt>
              <dd>{activeTrack.album}</dd>
            </div>
          )}
          {activeTrack.genre && (
            <div>
              <dt>Thể loại</dt>
              <dd>{activeTrack.genre}</dd>
            </div>
          )}
          <div>
            <dt>Định dạng</dt>
            <dd className="numeric-value">
              {activeTrack.path.split('.').pop()?.toUpperCase() || 'AUDIO'}
              {activeTrack.sample_rate ? ` · ${activeTrack.sample_rate / 1000} kHz` : ''}
              {activeTrack.channels ? ` · ${activeTrack.channels === 2 ? 'Stereo' : 'Mono'}` : ''}
            </dd>
          </div>
          <div>
            <dt>Nhịp điệu</dt>
            <dd className="numeric-value">
              {currentBpm ? (
                <span className="badge-bpm">{currentBpm} BPM</span>
              ) : activeTrack.duration >= 2 ? (
                <span className="badge-bpm-dim">Không có nhịp</span>
              ) : (
                <span className="badge-bpm-dim">— (&lt;2s)</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Thời lượng</dt>
            <dd className="numeric-value">{formatTime(activeTrack.duration)}</dd>
          </div>
          <div>
            <dt>Thư mục</dt>
            <dd className="path-text" title={activeTrack.path}>
              <FolderOpen size={11} style={{ display: 'inline', marginRight: 4 }} />
              {activeTrack.path.split(/[/\\]/).slice(-2, -1)[0] || 'Gốc'}
            </dd>
          </div>
        </dl>
      </div>


      {/* Tag Editor Block */}
      <div className="tag-block">
        <div className="info-title">
          <h3>Tags phân loại</h3>
          <button onClick={() => setIsTagEditorOpen(!isTagEditorOpen)}>
            <Plus size={12} /> {isTagEditorOpen ? 'Đóng' : 'Thêm tag'}
          </button>
        </div>
        <div className="tag-list">
          {activeTrack.tagList && activeTrack.tagList.length > 0 ? (
            activeTrack.tagList.map((tag) => (
              <span key={tag.id} className="tag-pill">
                <TagIcon size={11} /> {tag.name}
              </span>
            ))
          ) : (
            <span className="empty-tags-hint">Chưa có tag nào</span>
          )}
        </div>
        {isTagEditorOpen && (
          <div className="tag-editor-wrap">
            <TagEditor
              trackId={activeTrack.id}
              tags={activeTrack.tagList || []}
              onTagsChanged={onLibraryRefresh}
            />
          </div>
        )}
      </div>

      {/* Quick Explorer/Finder Action */}
      <div className="quick-actions-row" style={{ display: 'flex', gap: '8px', marginTop: '12px', marginBottom: '8px' }}>
        <button
          className="btn-quick-action"
          onClick={() => {
            if (!window.api || !activeTrack) return;
            window.api.showInFolder(activeTrack.path);
          }}
          title={`Mở vị trí file trong ${getFileManagerName()}`}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '7px 10px',
            backgroundColor: '#242220',
            border: '1px solid #32353a',
            borderRadius: '6px',
            color: '#c3c8cf',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.22s var(--ease-out-expo)'
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#2c2f35')}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#242220')}
        >
          <FolderOpen size={13} />
          <span>Mở trong {getFileManagerName()}</span>
        </button>
      </div>

      {/* Audio Format Converter Button */}
      <button
        className="btn-convert-format"
        onClick={() => setIsConvertModalOpen(true)}
        disabled={!activeTrack || activeTrack.is_missing === 1}
        title="Chuyển đổi file sang các định dạng khác (WAV 16/24-bit, MP3 320k/192k/128k, đổi tần số lấy mẫu 48kHz/44.1kHz...)"
      >
        <RefreshCw size={14} />
        <span>Chuyển đổi định dạng</span>
      </button>

      {/* Audio Convert Modal */}
      <AudioConvertModal
        isOpen={isConvertModalOpen}
        onClose={() => setIsConvertModalOpen(false)}
        track={activeTrack}
        onToast={onToast}
      />
    </aside>
  );
};
