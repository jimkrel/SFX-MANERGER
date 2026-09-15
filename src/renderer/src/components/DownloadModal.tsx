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
  Radio
} from 'lucide-react';
import { MediaInfo, BinaryStatus, DownloadProgress } from '../../../preload';

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
  const [format, setFormat] = useState<'wav' | 'mp3' | 'original'>('wav');
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [completedPath, setCompletedPath] = useState<string | null>(null);
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<{ percent: number; statusText: string } | null>(null);

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
      if (data.status === 'completed' && data.filePath) {
        setIsDownloading(false);
        setCompletedPath(data.filePath);
        if (onToast) {
          onToast('success', 'Tải Thành Công', `Đã lưu và thêm vào thư viện:\n${data.filePath}`);
        }
      } else if (data.status === 'error') {
        setIsDownloading(false);
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

    try {
      await window.api.startAudioDownload({
        url: targetUrl,
        format
      });
    } catch (err: any) {
      console.error('[DownloadModal] Download error:', err);
      setIsDownloading(false);
    }
  };

  // Handler: Cancel current download
  const handleCancelDownload = async () => {
    if (!url || !window.api) return;
    await window.api.cancelAudioDownload(url);
    setIsDownloading(false);
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
      }
    } catch (e: any) {
      alert(`Lỗi cài đặt: ${e.message}`);
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
              <h3>Tải Âm Thanh Trực Tuyến</h3>
              <p>Tải nhạc và hiệu ứng âm thanh từ YouTube, TikTok, Shorts về thư viện</p>
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
                  <img src={mediaInfo.thumbnail} alt={mediaInfo.title} className="dl-thumb-img" />
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
            <div className="dl-section-label">Định dạng âm thanh xuất ra:</div>
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
          </div>

          {/* Download Progress Box */}
          {isDownloading && progress && (
            <div className="dl-progress-box">
              <div className="dl-progress-header">
                <span className="dl-progress-status">
                  <RefreshCw size={13} className="spin" />
                  {progress.status === 'extracting'
                    ? 'Đang bóc tách & chuyển mã audio...'
                    : `Đang tải âm thanh... ${progress.percent}%`}
                </span>
                {progress.speed && <span className="dl-progress-speed">{progress.speed}</span>}
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
              <CheckCircle2 size={24} className="dl-success-icon" />
              <div className="dl-success-content">
                <strong>Tải và nhập vào thư viện thành công!</strong>
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
            <span>Tự động tạo waveform & kéo thả vào NLE</span>
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
