import React, { useState } from 'react';
import { Settings, X, Trash2, CheckCircle2, ShieldAlert, Sparkles, Volume2 } from 'lucide-react';
import { isAutoBounceEnabled, setAutoBounceEnabled } from '../audio/bouncerService';
import { isWindows } from '../utils/platform';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appInfo?: { isElevated?: boolean; version?: string } | null;
  onToast?: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appInfo,
  onToast
}) => {
  const [autoBounce, setAutoBounce] = useState<boolean>(isAutoBounceEnabled());
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleToggleAutoBounce = () => {
    const nextVal = !autoBounce;
    setAutoBounce(nextVal);
    setAutoBounceEnabled(nextVal);
    if (onToast) {
      onToast(
        'info',
        nextVal ? 'Đã Bật On-The-Fly Bouncing' : 'Đã Tắt On-The-Fly Bouncing',
        nextVal
          ? 'File kéo thả sang CapCut/Premiere sẽ được tự động chuẩn hóa sang Broadcast WAV 48kHz PCM 16-bit.'
          : 'Sẽ kéo trực tiếp file gốc không qua chuyển mã.'
      );
    }
  };

  const handleClearCache = async () => {
    if (!window.api || isClearingCache) return;
    setIsClearingCache(true);
    try {
      const res = await window.api.clearBounceCache();
      const mb = (res.freedBytes / (1024 * 1024)).toFixed(1);
      if (onToast) {
        onToast(
          'success',
          'Đã Dọn Dẹp Bộ Nhớ Đệm',
          `Đã xóa ${res.cleared} file cache WAV tạm thời (${mb} MB) trong thư mục %TEMP%.`
        );
      }
    } catch (err) {
      if (onToast) {
        onToast('error', 'Lỗi Dọn Dẹp', String(err));
      }
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Settings className="modal-title-icon" size={20} />
            <div>
              <h3>Cài Đặt Hệ Thống</h3>
              <p>Tối ưu hóa khả năng tương thích và kéo thả sang CapCut, Premiere, DaVinci Resolve</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Đóng (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body settings-body">
          {/* Section 1: On-The-Fly Bouncing (Broadcast WAV) */}
          <div className="settings-section">
            <div className="settings-section-header">
              <Sparkles size={16} className="text-accent" />
              <h4>On-The-Fly Bouncing (Broadcast WAV 48kHz / 16-bit)</h4>
            </div>
            <p className="settings-section-desc">
              Khi kéo thả file âm thanh (MP3, FLAC, OGG, CAF...) vào phần mềm dựng phim, hệ thống sẽ ngầm chuyển mã siêu tốc sang chuẩn <strong>Broadcast WAV PCM 16-bit 48.000 Hz</strong> vào bộ nhớ đệm tạm thời. Giúp phần mềm edit nhận file 100% ngay lập tức, không bị từ chối định dạng hay lệch nhịp timeline.
            </p>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Tự động chuẩn hóa khi kéo thả</span>
                <span className="settings-row-hint">
                  {autoBounce ? 'Đang bật (Khuyên dùng cho Premiere, CapCut, Resolve, Final Cut)' : 'Đang tắt (Kéo trực tiếp file gốc)'}
                </span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoBounce}
                  onChange={handleToggleAutoBounce}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Bộ nhớ đệm kéo thả (%TEMP%)</span>
                <span className="settings-row-hint">
                  File WAV tạm thời được tự động xóa sau 24h hoặc khi bạn bấm dọn dẹp thủ công.
                </span>
              </div>
              <button
                className="btn-clear-cache"
                onClick={handleClearCache}
                disabled={isClearingCache}
              >
                <Trash2 size={13} />
                <span>{isClearingCache ? 'Đang dọn dẹp...' : 'Dọn dẹp cache'}</span>
              </button>
            </div>
          </div>

          {/* Section 2: Windows UIPI & Administrator Status */}
          {isWindows && (
            <div className="settings-section">
              <div className="settings-section-header">
                <ShieldAlert size={16} className={appInfo?.isElevated ? 'text-success' : 'text-warning'} />
                <h4>Quyền Quản Trị Hệ Điều Hành (Windows UIPI)</h4>
              </div>
              <p className="settings-section-desc">
                Cơ chế bảo mật của Windows (UIPI) sẽ chặn kéo thả chuột nếu phần mềm edit (CapCut, Premiere) đang chạy quyền <strong>Run as Administrator</strong> trong khi SFX Manager chạy quyền thường.
              </p>

              <div className="elevation-status-card">
                <div className="elevation-icon">
                  {appInfo?.isElevated ? (
                    <CheckCircle2 size={24} className="text-success" />
                  ) : (
                    <ShieldAlert size={24} className="text-warning" />
                  )}
                </div>
                <div className="elevation-info">
                  <div className="elevation-title">
                    Trạng thái hiện tại: <strong>{appInfo?.isElevated ? 'Quản trị viên (Administrator)' : 'Người dùng tiêu chuẩn (Standard User)'}</strong>
                  </div>
                  <div className="elevation-hint">
                    {appInfo?.isElevated
                      ? 'SFX Manager có toàn quyền kéo thả vào mọi ứng dụng (kể cả CapCut Admin).'
                      : 'Nếu kéo thả vào CapCut không phản hồi, hãy dùng nút "Sao chép để dán" (Ctrl+V) hoặc chuột phải chọn "Run as Administrator" khi mở SFX Manager.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 3: Audio Engine Info */}
          <div className="settings-section">
            <div className="settings-section-header">
              <Volume2 size={16} className="text-muted" />
              <h4>Thông Tin Động Cơ Âm Thanh</h4>
            </div>
            <div className="settings-spec-grid">
              <div className="spec-item">
                <span className="spec-label">Chuẩn Render:</span>
                <span className="spec-val">Broadcast WAV PCM 16-bit</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Sample Rate mục tiêu:</span>
                <span className="spec-val">48.000 Hz (Video Timeline Standard)</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Bộ giải mã:</span>
                <span className="spec-val">Chromium Web Audio & FFmpeg Core</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Giao thức kéo thả:</span>
                <span className="spec-val">{isWindows ? 'Windows OLE / CF_HDROP' : 'macOS Cocoa NSPasteboard'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
