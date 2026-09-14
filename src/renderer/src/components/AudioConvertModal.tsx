import React, { useState } from 'react';
import { X, RefreshCw, Check, Sparkles, AudioLines, FileAudio, Disc } from 'lucide-react';
import { Track } from '../../../preload';
import { audioPlayer } from '../audio/player';
import { convertAudio, ConvertOptions } from '../audio/audioConverter';

interface AudioConvertModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  onToast?: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const AudioConvertModal: React.FC<AudioConvertModalProps> = ({
  isOpen,
  onClose,
  track,
  onToast
}) => {
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [wavBitDepth, setWavBitDepth] = useState<16 | 24>(16);
  const [mp3Bitrate, setMp3Bitrate] = useState<128 | 192 | 256 | 320>(320);
  const [sampleRate, setSampleRate] = useState<'original' | 44100 | 48000>(48000);
  const [channels, setChannels] = useState<'original' | 'stereo' | 'mono'>('original');
  const [isConverting, setIsConverting] = useState(false);
  const [statusText, setStatusText] = useState('');

  if (!isOpen || !track) return null;

  const originalExt = track.path.split('.').pop()?.toUpperCase() || 'AUDIO';
  const formatTime = (secs?: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleConvert = async () => {
    if (!track || !window.api || isConverting) return;

    if (track.is_missing === 1) {
      if (onToast) onToast('warning', 'File bị thiếu', 'Không thể chuyển đổi vì file nguồn không còn tồn tại trên ổ đĩa.');
      return;
    }

    setIsConverting(true);
    setStatusText('Đang nạp file audio...');

    try {
      const audioBuffer = await audioPlayer.getAudioBufferForTrack(track);
      if (!audioBuffer) {
        throw new Error('Không thể giải mã dữ liệu âm thanh của file nguồn');
      }

      setStatusText('Đang xử lý & mã hóa định dạng...');
      const options: ConvertOptions = {
        format,
        wavBitDepth,
        mp3Bitrate,
        sampleRate,
        channels
      };

      const { data, extension, label } = await convertAudio(audioBuffer, options);

      setStatusText('Đang chọn vị trí lưu...');
      const cleanName = track.name.replace(/[\\/:*?"<>|]/g, '_');
      const defaultName = `${cleanName}_${extension === 'wav' ? `${wavBitDepth}bit` : `${mp3Bitrate}k`}.${extension}`;

      const savedPath = await window.api.saveExportedFile({
        defaultName,
        buffer: data,
        format: extension as 'wav' | 'mp3'
      });

      if (savedPath) {
        if (onToast) {
          onToast('success', 'Chuyển Đổi Thành Công', `Đã xuất ${label} tới:\n${savedPath}`);
        }
        onClose();
      }
    } catch (err: unknown) {
      console.error('Lỗi chuyển đổi âm thanh:', err);
      if (onToast) {
        onToast('error', 'Lỗi chuyển đổi', String(err));
      }
    } finally {
      setIsConverting(false);
      setStatusText('');
    }
  };

  return (
    <div className="modal-backdrop" onClick={isConverting ? undefined : onClose}>
      <div className="convert-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <RefreshCw className={`modal-title-icon ${isConverting ? 'spin' : ''}`} size={20} />
            <div>
              <h3>Chuyển Đổi Định Dạng File</h3>
              <p>Chuyển đổi âm thanh sang định dạng tối ưu cho CapCut, Premiere, DaVinci</p>
            </div>
          </div>
          {!isConverting && (
            <button className="modal-close-btn" onClick={onClose} title="Đóng (Esc)">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* File Info Banner */}
          <div className="convert-file-info">
            <div className="convert-file-icon">
              <AudioLines size={20} />
            </div>
            <div className="convert-file-details">
              <div className="convert-file-name" title={track.name}>
                {track.name}
              </div>
              <div className="convert-file-meta">
                <span className="convert-badge badge-orig">{originalExt} Gốc</span>
                <span className="convert-meta-item">Thời lượng: <strong>{formatTime(track.duration)}</strong></span>
                {track.sample_rate && (
                  <span className="convert-meta-item">Tần số: <strong>{(track.sample_rate / 1000).toFixed(1)} kHz</strong></span>
                )}
              </div>
            </div>
          </div>

          {/* Section 1: Choose Target Format */}
          <div className="convert-section">
            <div className="convert-section-title">1. Chọn định dạng xuất ra</div>
            <div className="convert-format-grid">
              <button
                type="button"
                className={`format-card ${format === 'wav' ? 'active' : ''}`}
                onClick={() => setFormat('wav')}
                disabled={isConverting}
              >
                <div className="format-card-header">
                  <div className="format-card-icon">
                    <FileAudio size={18} />
                  </div>
                  <span className="format-card-name">WAV (Lossless)</span>
                  {format === 'wav' && <Check size={16} className="format-card-check" />}
                </div>
                <div className="format-card-desc">
                  Chất lượng chuẩn PCM không nén. Khuyên dùng khi kéo vào Premiere Pro, CapCut, DaVinci Resolve.
                </div>
              </button>

              <button
                type="button"
                className={`format-card ${format === 'mp3' ? 'active' : ''}`}
                onClick={() => setFormat('mp3')}
                disabled={isConverting}
              >
                <div className="format-card-header">
                  <div className="format-card-icon">
                    <Disc size={18} />
                  </div>
                  <span className="format-card-name">MP3 (Compressed)</span>
                  {format === 'mp3' && <Check size={16} className="format-card-check" />}
                </div>
                <div className="format-card-desc">
                  Dung lượng nhẹ, tương thích 100% mọi thiết bị. Thích hợp chia sẻ qua mạng, gửi khách hàng.
                </div>
              </button>
            </div>
          </div>

          {/* Section 2: Detailed Options */}
          <div className="convert-section">
            <div className="convert-section-title">2. Cấu hình chi tiết</div>
            <div className="convert-options-grid">
              {/* If WAV */}
              {format === 'wav' && (
                <div className="convert-option-group">
                  <label>Độ sâu bit (Bit Depth)</label>
                  <div className="convert-chips">
                    <button
                      type="button"
                      className={`convert-chip ${wavBitDepth === 16 ? 'active' : ''}`}
                      onClick={() => setWavBitDepth(16)}
                      disabled={isConverting}
                    >
                      16-bit PCM (Tiêu chuẩn)
                    </button>
                    <button
                      type="button"
                      className={`convert-chip ${wavBitDepth === 24 ? 'active' : ''}`}
                      onClick={() => setWavBitDepth(24)}
                      disabled={isConverting}
                    >
                      24-bit PCM (Studio Master)
                    </button>
                  </div>
                </div>
              )}

              {/* If MP3 */}
              {format === 'mp3' && (
                <div className="convert-option-group">
                  <label>Tốc độ bit (Bitrate)</label>
                  <div className="convert-chips">
                    <button
                      type="button"
                      className={`convert-chip ${mp3Bitrate === 320 ? 'active' : ''}`}
                      onClick={() => setMp3Bitrate(320)}
                      disabled={isConverting}
                    >
                      320 kbps (Cao nhất)
                    </button>
                    <button
                      type="button"
                      className={`convert-chip ${mp3Bitrate === 192 ? 'active' : ''}`}
                      onClick={() => setMp3Bitrate(192)}
                      disabled={isConverting}
                    >
                      192 kbps (Chuẩn)
                    </button>
                    <button
                      type="button"
                      className={`convert-chip ${mp3Bitrate === 128 ? 'active' : ''}`}
                      onClick={() => setMp3Bitrate(128)}
                      disabled={isConverting}
                    >
                      128 kbps (Siêu nhẹ)
                    </button>
                  </div>
                </div>
              )}

              {/* Sample Rate */}
              <div className="convert-option-group">
                <label>Tần số lấy mẫu (Sample Rate)</label>
                <div className="convert-chips">
                  <button
                    type="button"
                    className={`convert-chip ${sampleRate === 48000 ? 'active' : ''}`}
                    onClick={() => setSampleRate(48000)}
                    disabled={isConverting}
                  >
                    48 kHz (Chuẩn Video/Phim)
                  </button>
                  <button
                    type="button"
                    className={`convert-chip ${sampleRate === 44100 ? 'active' : ''}`}
                    onClick={() => setSampleRate(44100)}
                    disabled={isConverting}
                  >
                    44.1 kHz (Chuẩn Nhạc CD)
                  </button>
                  <button
                    type="button"
                    className={`convert-chip ${sampleRate === 'original' ? 'active' : ''}`}
                    onClick={() => setSampleRate('original')}
                    disabled={isConverting}
                  >
                    Gốc ({track.sample_rate ? `${(track.sample_rate / 1000).toFixed(1)}kHz` : 'Auto'})
                  </button>
                </div>
              </div>

              {/* Channels */}
              <div className="convert-option-group">
                <label>Kênh âm thanh (Channels)</label>
                <div className="convert-chips">
                  <button
                    type="button"
                    className={`convert-chip ${channels === 'original' ? 'active' : ''}`}
                    onClick={() => setChannels('original')}
                    disabled={isConverting}
                  >
                    Giữ nguyên gốc
                  </button>
                  <button
                    type="button"
                    className={`convert-chip ${channels === 'stereo' ? 'active' : ''}`}
                    onClick={() => setChannels('stereo')}
                    disabled={isConverting}
                  >
                    Stereo (2 kênh)
                  </button>
                  <button
                    type="button"
                    className={`convert-chip ${channels === 'mono' ? 'active' : ''}`}
                    onClick={() => setChannels('mono')}
                    disabled={isConverting}
                  >
                    Mono (1 kênh)
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Hint banner */}
          <div className="convert-hint">
            <Sparkles size={13} color="var(--accent)" />
            <span>
              <strong>Mẹo tiện lợi:</strong> Nếu bạn chỉ muốn dùng file âm thanh gốc trong CapCut hoặc Premiere, bạn có thể <strong>kéo trực tiếp clip từ danh sách vào timeline</strong> mà không cần chuyển đổi.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="modal-status-text">
            {isConverting && (
              <>
                <RefreshCw size={13} className="spin" />
                <span>{statusText}</span>
              </>
            )}
          </div>
          <div className="modal-btn-group">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={isConverting}
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn-primary-convert"
              onClick={handleConvert}
              disabled={isConverting}
            >
              {isConverting ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  <span>Chuyển Đổi & Lưu File</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
