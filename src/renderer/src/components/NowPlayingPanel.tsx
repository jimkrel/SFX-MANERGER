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
  Download,
  ChevronDown,
  Star,
  FolderOpen
} from 'lucide-react';
import { Track } from '../../../preload';
import { getOrComputePeaks } from '../audio/waveform';
import { audioPlayer, PlayerState } from '../audio/player';
import { encodeAudioBufferToMp3 } from '../audio/mp3Encoder';
import { encodeAudioBufferToWav } from '../audio/wavEncoder';
import { detectBpm } from '../audio/bpmDetector';
import { TagEditor } from './TagEditor';

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
  const [isExporting, setIsExporting] = useState(false);
  const [currentBpm, setCurrentBpm] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeDisplayRef = useRef<HTMLSpanElement | null>(null);

  const activeTrack = playerState.currentTrack || selectedTrack;

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

  // 3. Draw static waveform ONCE onto the background canvas
  const drawStaticWaveform = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas || !peaks || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
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

  useEffect(() => {
    drawStaticWaveform();
    window.addEventListener('resize', drawStaticWaveform);
    return () => window.removeEventListener('resize', drawStaticWaveform);
  }, [drawStaticWaveform]);

  // 4. Draw playhead overlay layer in requestAnimationFrame
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth;
    const height = 54;
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

    renderPlayhead();

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [playerState.isPlaying, playerState.duration, activeTrack?.id]);

  // Seek on click
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeTrack || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, clickX / rect.width));
    const duration = playerState.duration || activeTrack.duration || 0;
    audioPlayer.seek(progress * duration);
  };

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

  // Export File (WAV or MP3)
  const handleExport = async (format: 'wav' | 'mp3') => {
    if (!activeTrack || !window.api || isExporting) return;
    setIsExporting(true);
    try {
      const defaultName = `${activeTrack.name.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
      const isOriginalWav = activeTrack.path.toLowerCase().endsWith('.wav');
      if (format === 'wav') {
        let wavBytes: Uint8Array | ArrayBuffer;
        if (isOriginalWav) {
          // File gốc đã là .wav: copy raw trực tiếp, không re-encode
          const rawBuffer = await window.api.readAudioBuffer(activeTrack.path);
          if (!rawBuffer) throw new Error('Không thể đọc file audio gốc');
          wavBytes = rawBuffer;
        } else {
          // File nguồn không phải .wav (MP3, FLAC, M4A, OGG...): decode sang AudioBuffer rồi encode PCM RIFF 16-bit chuẩn
          const buffer = await audioPlayer.getAudioBufferForTrack(activeTrack);
          if (!buffer) throw new Error('Không thể giải mã audio để tạo file WAV');
          wavBytes = encodeAudioBufferToWav(buffer);
        }

        const savedPath = await window.api.saveExportedFile({
          defaultName,
          buffer: wavBytes,
          format: 'wav'
        });
        if (savedPath && onToast) {
          onToast('success', 'Xuất File Thành Công', `Đã xuất WAV (${isOriginalWav ? 'Bản gốc' : 'PCM RIFF 16-bit'}): ${savedPath}`);
        }
      } else {
        // MP3 Transcode
        const buffer = await audioPlayer.getAudioBufferForTrack(activeTrack);
        if (!buffer) throw new Error('Không thể nạp AudioBuffer để mã hóa MP3');
        const mp3Bytes = encodeAudioBufferToMp3(buffer, 320);
        const savedPath = await window.api.saveExportedFile({
          defaultName,
          buffer: mp3Bytes,
          format: 'mp3'
        });
        if (savedPath && onToast) {
          onToast('success', 'Xuất File Thành Công', `Đã xuất MP3 (320kbps): ${savedPath}`);
        }
      }
    } catch (err: unknown) {
      console.error('Lỗi khi xuất file:', err);
      if (onToast) {
        onToast('error', 'Xuất File Thất Bại', String(err));
      }
    } finally {
      setIsExporting(false);
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
  const categoryName = activeTrack.category || 'SFX';

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
      <div className="hero-art">
        <div className="art-glow" />
        <AudioLines />
        <div className="hero-badges">
          <span>{categoryName.toUpperCase()}</span>
          {currentBpm ? <span className="hero-bpm-badge">{currentBpm} BPM</span> : null}
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
      <div className="big-wave" ref={containerRef} onClick={handleSeek}>
        <canvas ref={bgCanvasRef} className="wave-bg-canvas" />
        <canvas ref={playheadCanvasRef} className="wave-playhead-canvas" />
      </div>

      {/* DAW Player Controls */}
      <div className="player-controls">
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
          onClick={() => audioPlayer.togglePlay(activeTrack)}
          title={isPlayingCurrent ? 'Tạm dừng (Space)' : 'Phát (Space)'}
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
              currentTags={activeTrack.tagList || []}
              onTagsChanged={onLibraryRefresh}
            />
          </div>
        )}
      </div>

      {/* Real Export Dropdown */}
      <details className="export-menu-wrap">
        <summary className="export-button" aria-busy={isExporting}>
          <Download />
          <span>{isExporting ? 'Đang xử lý xuất file...' : 'Xuất âm thanh'}</span>
          <ChevronDown />
        </summary>
        <div className="export-menu" role="menu">
          <button role="menuitem" onClick={() => handleExport('wav')} disabled={isExporting}>
            <Download />
            <span>
              <strong>WAV chất lượng cao</strong>
              <small>Giữ nguyên sample rate & bit depth gốc</small>
            </span>
          </button>
          <button role="menuitem" onClick={() => handleExport('mp3')} disabled={isExporting}>
            <Download />
            <span>
              <strong>MP3 nhẹ (320 kbps)</strong>
              <small>Mã hóa lamejs trực tiếp · Dễ chia sẻ</small>
            </span>
          </button>
        </div>
      </details>
    </aside>
  );
};
