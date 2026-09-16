import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FolderDown,
  Loader2,
  Clock,
  User,
  Music,
  Volume2,
  Radio,
  Film,
  Video,
  Copy
} from 'lucide-react';
import { MediaInfo, BinaryStatus, DownloadProgress, DownloadFormat } from '../../../preload';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  isOpen,
  onClose,
  onToast
}) => {
  const [url, setUrl] = useState('');
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [downloadType, setDownloadType] = useState<'video' | 'audio'>('video');
  const [format, setFormat] = useState<DownloadFormat>('mp4_1080p');
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [completedPath, setCompletedPath] = useState<string | null>(null);
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<{ percent: number; statusText: string } | null>(null);
  // Tracks the unique jobId of the currently active download (for cancellation)
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // 1. Check binary readiness on mount / open
  useEffect(() => {
    if (!isOpen || !window.api) return;

    window.api.checkDownloaderStatus().then((status) => {
      setBinaryStatus(status);
    });

    // Auto-detect URL from clipboard if user copied a media link
    navigator.clipboard?.readText?.().then((clip) => {
      const text = (clip || '').trim();
      if (
        text.startsWith('http') &&
        (text.includes('youtube.com') ||
          text.includes('youtu.be') ||
          text.includes('tiktok.com') ||
          text.includes('soundcloud.com'))
      ) {
        setUrl(text);
      }
    }).catch(() => {});

    setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
  }, [isOpen]);

  // 2. Subscribe to progress events from main process
  useEffect(() => {
    if (!isOpen || !window.api) return;

    const cleanupProgress = window.api.onDownloadProgress((data) => {
      setProgress(data);
      // Capture jobId from each progress event so cancel always has the right key
      if (data.jobId) setActiveJobId(data.jobId);
      if (data.status === 'completed' && data.filePath) {
        setIsDownloading(false);
        setActiveJobId(null);
        setCompletedPath(data.filePath);
        if (onToast) {
          onToast('success', 'Tải Thành Công', `Đã lưu và thêm vào thư viện:\n${data.filePath}`);
        }
      } else if (data.status === 'error') {
        setIsDownloading(false);
        setActiveJobId(null);
        if (onToast) {
          onToast('error', 'Lỗi Tải', data.error || 'Quá trình tải thất bại.');
        }
      }
    });

    const cleanupInstall = window.api.onDownloaderInstallProgress((data) => {
      setInstallProgress(data);
      if (data.percent >= 100) {
        setIsInstalling(false);
        window.api.checkDownloaderStatus().then(setBinaryStatus);
      }
    });

    return () => {
      cleanupProgress();
      cleanupInstall();
    };
  }, [isOpen, onToast]);

  // 3. Handle Esc key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDownloading && !isInstalling) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDownloading, isInstalling, onClose]);

  if (!isOpen) return null;

  // Handler: Analyze URL
  const handleAnalyze = async (targetUrl?: string) => {
    const raw = (targetUrl || url).trim();
    if (!raw || !window.api || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalyzeError(null);
    setMediaInfo(null);
    setCompletedPath(null);
    setProgress(null);

    try {
      const info = await window.api.fetchMediaInfo(raw);
      setMediaInfo(info);
    } catch (err: any) {
      console.error('[DownloadModal] Analyze error:', err);
      setAnalyzeError(err?.message || 'Không thể lấy thông tin video từ đường dẫn này.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handler: Start download
  const handleStartDownload = async () => {
    const targetUrl = (mediaInfo?.url || url).trim();
    if (!targetUrl || !window.api || isDownloading) return;

    setIsDownloading(true);
    setProgress({ status: 'starting', percent: 0 });
    setCompletedPath(null);
    setActiveJobId(null);

    try {
      const result = await window.api.startAudioDownload({
        url: targetUrl,
        format
      });
      // result.jobId is available if the download resolved synchronously
      // (progress events during download already carry jobId in their payload)
      if (result?.jobId) setActiveJobId(result.jobId);
    } catch (err: any) {
      console.error('[DownloadModal] Download error:', err);
      setIsDownloading(false);
    }
  };

  // Handler: Cancel current download — use the unique jobId, not the URL
  const handleCancelDownload = async () => {
    if (!window.api) return;
    const jobId = activeJobId;
    if (jobId) {
      await window.api.cancelAudioDownload(jobId);
    }
    setIsDownloading(false);
    setActiveJobId(null);
    setProgress(null);
  };

  // Handler: Install yt-dlp binary
  const handleInstallBinary = async () => {
    if (!window.api || isInstalling) return;
    setIsInstalling(true);
    setInstallProgress({ percent: 0, statusText: 'Đang chuẩn bị tải...' });
    try {
      const res = await window.api.installDownloader();
      if (!res.success) {
        alert(`Cài đặt thất bại: ${res.error}`);
      } else {
        const updated = await window.api.checkDownloaderStatus();
        setBinaryStatus(updated);
      }
    } catch (e: any) {
      alert(`Lỗi cài đặt: ${e.message}`);
    } finally {
      setIsInstalling(false);
    }
  };

  // Handler: Install FFmpeg binary
  const handleInstallFfmpeg = async () => {
    if (!window.api || isInstalling) return;
    setIsInstalling(true);
    setInstallProgress({ percent: 0, statusText: 'Đang kết nối máy chủ tải FFmpeg...' });
    try {
      const res = await window.api.installFfmpeg();
      if (!res.success) {
        alert(`Cài đặt FFmpeg thất bại: ${res.error}`);
      } else {
        const updated = await window.api.checkDownloaderStatus();
        setBinaryStatus(updated);
        if (onToast) {
          onToast('success', 'FFmpeg Đã Sẵn Sàng', 'Đã cài đặt thành công FFmpeg để ghép video 1080p.');
        }
      }
    } catch (e: any) {
      alert(`Lỗi cài đặt FFmpeg: ${e.message}`);
    } finally {
      setIsInstalling(false);
    }
  };

  const getPlatformLabel = (platform?: string) => {
    switch (platform) {
      case 'youtube':
        return { label: 'YouTube / Shorts', color: '#ff0000', bg: 'rgba(255, 0, 0, 0.12)' };
      case 'tiktok':
        return { label: 'TikTok Audio', color: '#00f2fe', bg: 'rgba(0, 242, 254, 0.12)' };
      case 'soundcloud':
        return { label: 'SoundCloud', color: '#ff5500', bg: 'rgba(255, 85, 0, 0.12)' };
      default:
        return { label: 'Online Media', color: '#d9a55c', bg: 'rgba(217, 165, 92, 0.12)' };
    }
  };

  const platformMeta = getPlatformLabel(mediaInfo?.platform);

  return (
    <div className="modal-backdrop" onClick={isDownloading ? undefined : onClose}>
      <div className="download-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Download className="modal-title-icon" size={20} />
            <div>
              <h3>Tải Video & Âm Thanh Trực Tuyến</h3>
              <p>Tải video MP4 Full HD 1080p/4K & nhạc từ YouTube, TikTok, Shorts về máy</p>
            </div>
          </div>
          {!isDownloading && (
            <button className="modal-close-btn" onClick={onClose} title="Đóng (Esc)">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* Check Missing Binary Notice */}
          {binaryStatus && !binaryStatus.isReady && (
            <div className="dl-notice-box">
              <AlertCircle size={18} className="dl-notice-icon" />
              <div className="dl-notice-content">
                <strong>Chưa phát hiện công cụ yt-dlp trên hệ thống</strong>
                <p>Cần cài đặt bộ công cụ giải mã âm thanh (~15MB) để có thể tải nhạc từ YouTube và TikTok.</p>
                {isInstalling ? (
                  <div className="dl-install-progress">
                    <Loader2 size={14} className="spin" />
                    <span>{installProgress?.statusText || 'Đang cài đặt...'} ({installProgress?.percent || 0}%)</span>
                  </div>
                ) : (
                  <button className="dl-install-btn" onClick={handleInstallBinary}>
                    <Download size={13} /> Cài đặt tự động 1-Click
                  </button>
                )}
              </div>
            </div>
          )}

          {/* URL Input Bar */}
          <div className="dl-input-group">
            <div className="dl-input-wrap">
              <input
                ref={inputRef}
                type="text"
                className="dl-url-input"
                placeholder="Dán link YouTube, Shorts, TikTok, SoundCloud vào đây..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAnalyze();
                }}
                disabled={isDownloading}
              />
              {url && !isDownloading && (
                <button className="dl-clear-btn" onClick={() => { setUrl(''); setMediaInfo(null); }} title="Xóa">
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              className="dl-analyze-btn"
              onClick={() => handleAnalyze()}
              disabled={!url.trim() || isAnalyzing || isDownloading}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={14} className="spin" />
                  <span>Phân tích...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Phân tích</span>
                </>
              )}
            </button>
          </div>

          {/* Analyze Error */}
          {analyzeError && (
            <div className="dl-error-box">
              <AlertCircle size={15} />
              <span>{analyzeError}</span>
            </div>
          )}

          {/* Media Info Preview Card */}
          {mediaInfo && (
            <div className="dl-media-card">
              <div className="dl-thumb-wrap">
                {mediaInfo.thumbnail ? (
                  <img
                    src={mediaInfo.thumbnail}
                    alt={mediaInfo.title}
                    className="dl-thumb-img"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      // Fallback for YouTube if high-res thumb fails
                      if (mediaInfo.platform === 'youtube' && !e.currentTarget.src.includes('hqdefault')) {
                        e.currentTarget.src = `https://i.ytimg.com/vi/${mediaInfo.id}/hqdefault.jpg`;
                      } else {
                        // Fallback to placeholder icon
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                ) : (
                  <div className="dl-thumb-placeholder">
                    <Radio size={24} />
                  </div>
                )}
                <span className="dl-duration-tag">{formatDuration(mediaInfo.duration)}</span>
              </div>
              <div className="dl-media-details">
                <div className="dl-media-badge" style={{ color: platformMeta.color, backgroundColor: platformMeta.bg }}>
                  {platformMeta.label}
                </div>
                <h4 className="dl-media-title" title={mediaInfo.title}>
                  {mediaInfo.title}
                </h4>
                <div className="dl-media-meta">
                  <span className="dl-meta-item">
                    <User size={12} /> {mediaInfo.uploader}
                  </span>
                  {mediaInfo.duration > 0 && (
                    <span className="dl-meta-item">
                      <Clock size={12} /> {formatDuration(mediaInfo.duration)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Format Selection Grid */}
          <div className="dl-section">
            <div className="dl-section-header-wrap">
              <div className="dl-section-label">Loại tệp và định dạng xuất ra:</div>
            </div>

            {/* Segmented Mode Switch */}
            <div className="dl-type-toggle">
              <button
                type="button"
                className={`dl-type-btn ${downloadType === 'video' ? 'active' : ''}`}
                onClick={() => {
                  setDownloadType('video');
                  if (!format.startsWith('mp4')) setFormat('mp4_1080p');
                }}
                disabled={isDownloading}
              >
                <Film size={14} />
                <span>Tải Video (MP4)</span>
              </button>
              <button
                type="button"
                className={`dl-type-btn ${downloadType === 'audio' ? 'active' : ''}`}
                onClick={() => {
                  setDownloadType('audio');
                  if (format.startsWith('mp4')) setFormat('wav');
                }}
                disabled={isDownloading}
              >
                <Music size={14} />
                <span>Tải Âm Thanh (SFX/Nhạc)</span>
              </button>
            </div>

            {/* FFmpeg Missing Notice for Video */}
            {downloadType === 'video' && binaryStatus && !binaryStatus.hasFfmpeg && (
              <div className="dl-ffmpeg-warning">
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <div className="dl-ffmpeg-warning-content">
                  <strong>Chưa có FFmpeg:</strong> Video 1080p/4K cần FFmpeg để ghép hình và tiếng, tránh bị YouTube hạ xuống 480p.
                </div>
                {isInstalling ? (
                  <div className="dl-install-progress small">
                    <Loader2 size={13} className="spin" />
                    <span>{installProgress?.statusText || 'Đang cài...'}</span>
                  </div>
                ) : (
                  <button className="dl-install-btn small" onClick={handleInstallFfmpeg}>
                    <Download size={12} /> Cài FFmpeg (~19MB)
                  </button>
                )}
              </div>
            )}

            {downloadType === 'video' ? (
              <div className="dl-format-grid three-col">
                <button
                  type="button"
                  className={`dl-format-card ${format === 'mp4_1080p' ? 'active' : ''}`}
                  onClick={() => setFormat('mp4_1080p')}
                  disabled={isDownloading}
                >
                  <div className="dl-format-icon">
                    <Film size={18} />
                  </div>
                  <div className="dl-format-info">
                    <div className="dl-format-title">
                      MP4 Full HD
                      <span className="dl-tag-rec">1080p</span>
                    </div>
                    <div className="dl-format-sub">Nét chuẩn 1080p kèm tiếng gốc, chống hạ 480p</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`dl-format-card ${format === 'mp4_best' ? 'active' : ''}`}
                  onClick={() => setFormat('mp4_best')}
                  disabled={isDownloading}
                >
                  <div className="dl-format-icon">
                    <Sparkles size={18} />
                  </div>
                  <div className="dl-format-info">
                    <div className="dl-format-title">
                      MP4 Tối Đa
                      <span className="dl-tag-rec">4K / 2K</span>
                    </div>
                    <div className="dl-format-sub">Độ nét cao nhất nguồn cung cấp (2K, 4K 60fps)</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`dl-format-card ${format === 'mp4_720p' ? 'active' : ''}`}
                  onClick={() => setFormat('mp4_720p')}
                  disabled={isDownloading}
                >
                  <div className="dl-format-icon">
                    <Video size={18} />
                  </div>
                  <div className="dl-format-info">
                    <div className="dl-format-title">MP4 HD 720p</div>
                    <div className="dl-format-sub">Dung lượng nhẹ, tốc độ tải siêu tốc</div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="dl-format-grid">
                <button
                  type="button"
                  className={`dl-format-card ${format === 'wav' ? 'active' : ''}`}
                  onClick={() => setFormat('wav')}
                  disabled={isDownloading}
                >
                  <div className="dl-format-icon">
                    <Volume2 size={18} />
                  </div>
                  <div className="dl-format-info">
                    <div className="dl-format-title">
                      WAV Broadcast 48kHz
                      <span className="dl-tag-rec">Khuyên Dùng</span>
                    </div>
                    <div className="dl-format-sub">Chuẩn timeline CapCut & Premiere Pro, 0ms lag</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`dl-format-card ${format === 'mp3' ? 'active' : ''}`}
                  onClick={() => setFormat('mp3')}
                  disabled={isDownloading}
                >
                  <div className="dl-format-icon">
                    <Music size={18} />
                  </div>
                  <div className="dl-format-info">
                    <div className="dl-format-title">MP3 320 kbps</div>
                    <div className="dl-format-sub">Chất lượng cao, dung lượng nhẹ tiết kiệm ổ cứng</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Download Progress Box */}
          {isDownloading && progress && (
            <div className="dl-progress-box">
              <div className="dl-progress-header">
                <span className="dl-progress-status">
                  <RefreshCw size={13} className="spin" />
                  {progress.status === 'extracting'
                    ? (progress.speed || (format.startsWith('mp4') ? 'Đang ghép luồng Video & Âm thanh...' : 'Đang chuyển mã Broadcast Audio...'))
                    : `${format.startsWith('mp4') ? 'Đang tải video' : 'Đang tải âm thanh'}... ${progress.percent}%`}
                </span>
                {progress.speed && progress.status !== 'extracting' && (
                  <span className="dl-progress-speed">{progress.speed}</span>
                )}
              </div>
              <div className="dl-progress-bar-bg">
                <div
                  className="dl-progress-bar-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="dl-progress-footer">
                <span>{progress.totalSize ? `Dung lượng: ~${progress.totalSize}` : ''}</span>
                {progress.eta && <span>Còn lại: {progress.eta}</span>}
              </div>
            </div>
          )}

          {/* Download Success Card */}
          {completedPath && (
            <div className="dl-success-card">
              {format.startsWith('mp4') ? (
                <Film size={24} className="dl-success-icon" style={{ color: '#f59e0b' }} />
              ) : (
                <CheckCircle2 size={24} className="dl-success-icon" />
              )}
              <div className="dl-success-content">
                <strong>
                  {format.startsWith('mp4')
                    ? 'Tải Video MP4 thành công!'
                    : 'Tải và nhập vào thư viện âm thanh thành công!'}
                </strong>
                <p title={completedPath}>{completedPath}</p>
                <div className="dl-success-actions">
                  <button
                    className="dl-action-btn"
                    onClick={() => window.api?.showInFolder(completedPath)}
                    title="Mở thư mục chứa file"
                  >
                    <FolderDown size={13} /> Mở thư mục
                  </button>
                  <button
                    className="dl-action-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText?.(completedPath);
                      if (onToast) onToast('info', 'Đã Sao Chép', 'Đã sao chép đường dẫn file vào bộ nhớ tạm.');
                    }}
                    title="Sao chép đường dẫn file"
                  >
                    <Copy size={13} /> Sao chép link file
                  </button>
                  <button
                    className="dl-action-btn primary"
                    onClick={() => {
                      setUrl('');
                      setMediaInfo(null);
                      setCompletedPath(null);
                      setProgress(null);
                    }}
                  >
                    Tải link khác
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="download-modal-footer">
          <div className="dl-footer-hints">
            <span className="dl-hint-dot"></span>
            <span>
              {format.startsWith('mp4')
                ? 'Video MP4 tải về lưu tại thư mục Downloads/SFX-Studio-Downloads/Videos/'
                : 'Tự động tạo waveform & kéo thả vào timeline NLE'}
            </span>
          </div>
          <div className="dl-footer-actions">
            {isDownloading ? (
              <button className="dl-btn-cancel" onClick={handleCancelDownload}>
                Hủy tải
              </button>
            ) : (
              <>
                <button className="dl-btn-cancel" onClick={onClose}>
                  Đóng
                </button>
                <button
                  className="dl-btn-submit"
                  onClick={handleStartDownload}
                  disabled={!url.trim() || isAnalyzing || isDownloading || (binaryStatus !== null && !binaryStatus.isReady)}
                >
                  <Download size={14} />
                  <span>Bắt đầu tải</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
