import React, { useState, useEffect } from 'react';
import { Settings, X, Trash2, CheckCircle2, ShieldAlert, Sparkles, Volume2, Command, ExternalLink, RefreshCw, Check } from 'lucide-react';
import { isAutoBounceEnabled, setAutoBounceEnabled, clearPreparedBounceCache } from '../audio/bouncerService';
import { isWindows, isMac } from '../utils/platform';

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
  const [shortcut, setShortcut] = useState<string>('');
  const [isEditingShortcut, setIsEditingShortcut] = useState<boolean>(false);
  const [shortcutDraft, setShortcutDraft] = useState<string>('');
  const [isSavingShortcut, setIsSavingShortcut] = useState<boolean>(false);
  const [isAccessibilityGranted, setIsAccessibilityGranted] = useState<boolean>(true);

  // Sync settings when modal opens
  useEffect(() => {
    if (!isOpen || !window.api) return;

    window.api.getQuickLauncherShortcut().then((sc) => {
      setShortcut(sc);
      setShortcutDraft(sc);
    });

    if (isMac) {
      window.api.checkAccessibilityPermission(false).then((granted) => {
        setIsAccessibilityGranted(granted);
      });
    }
  }, [isOpen]);

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
      const res = await clearPreparedBounceCache();
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

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const recorderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isRecording && recorderRef.current) {
      recorderRef.current.focus();
    }
  }, [isRecording]);

  const formatShortcutDisplay = (sc: string): string => {
    if (!sc) return isMac ? '⌘ ⇧ .' : 'Ctrl + Shift + .';
    if (isMac) {
      return sc
        .replace(/CommandOrControl/g, '⌘')
        .replace(/Command/g, '⌘')
        .replace(/Cmd/g, '⌘')
        .replace(/Control/g, '⌃')
        .replace(/Ctrl/g, '⌃')
        .replace(/Alt/g, '⌥')
        .replace(/Option/g, '⌥')
        .replace(/Shift/g, '⇧')
        .replace(/\+/g, ' ');
    } else {
      return sc
        .replace(/CommandOrControl/g, 'Ctrl')
        .replace(/Control/g, 'Ctrl')
        .replace(/Command/g, 'Win')
        .replace(/Option/g, 'Alt')
        .replace(/\+/g, ' + ');
    }
  };

  const handleApplyShortcut = async (newCombo: string) => {
    if (!newCombo.trim() || !window.api || isSavingShortcut) return;
    setIsSavingShortcut(true);
    try {
      const res = await window.api.setQuickLauncherShortcut(newCombo.trim());
      if (res.success) {
        setShortcut(newCombo.trim());
        setIsRecording(false);
        if (onToast) {
          onToast(
            'success',
            'Đã Cập Nhật Phím Tắt Toàn Cục',
            `Phím tắt mới: ${formatShortcutDisplay(newCombo.trim())} (${newCombo.trim()}) — Áp dụng ngay tức thì, không cần khởi động lại app!`
          );
        }
      } else {
        setIsRecording(false);
        if (onToast) {
          onToast(
            'error',
            'Không Thể Đăng Ký Phím Tắt',
            res.error || `Tổ hợp phím "${newCombo.trim()}" đã bị chiếm giữ bởi hệ điều hành hoặc phần mềm khác.`
          );
        }
      }
    } catch (err) {
      setIsRecording(false);
      if (onToast) onToast('error', 'Lỗi Đăng Ký Phím Tắt', String(err));
    } finally {
      setIsSavingShortcut(false);
    }
  };

  const handleRecordKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels recording
    if (e.key === 'Escape') {
      setIsRecording(false);
      if (onToast) onToast('info', 'Đã Hủy Gán Phím Tắt', 'Giữ nguyên phím tắt hiện tại.');
      return;
    }

    // Ignore solitary modifier key presses
    if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Tab'].includes(e.key)) {
      return;
    }

    const hasCmd = isMac ? e.metaKey : false;
    const hasCtrl = isMac ? e.ctrlKey : e.ctrlKey;
    const hasAlt = e.altKey;
    const hasShift = e.shiftKey;
    const isFunctionKey = /^F\d{1,2}$/i.test(e.key);

    // Validate: must contain at least 1 modifier key (unless functional key like F1-F12)
    if (!hasCmd && !hasCtrl && !hasAlt && !hasShift && !isFunctionKey) {
      if (onToast) {
        onToast(
          'warning',
          'Tổ Hợp Phím Chưa Hợp Lệ',
          'Phím tắt toàn cục cần bao gồm ít nhất 1 phím bổ trợ (Cmd, Ctrl, Alt hoặc Shift). Ví dụ: Cmd+Shift+K'
        );
      }
      return;
    }

    // Resolve key name
    let keyName = '';
    if (isFunctionKey) {
      keyName = e.key.toUpperCase();
    } else if (e.code.startsWith('Key')) {
      keyName = e.code.replace('Key', '').toUpperCase();
    } else if (e.code.startsWith('Digit')) {
      keyName = e.code.replace('Digit', '');
    } else if (e.code === 'Space') {
      keyName = 'Space';
    } else if (e.code === 'Period') {
      keyName = '.';
    } else if (e.code === 'Comma') {
      keyName = ',';
    } else if (e.code === 'Slash') {
      keyName = '/';
    } else if (e.code === 'Backslash') {
      keyName = '\\';
    } else if (e.code === 'Minus') {
      keyName = '-';
    } else if (e.code === 'Equal') {
      keyName = '=';
    } else if (e.code === 'Semicolon') {
      keyName = ';';
    } else if (e.code === 'Quote') {
      keyName = "'";
    } else if (e.code === 'BracketLeft') {
      keyName = '[';
    } else if (e.code === 'BracketRight') {
      keyName = ']';
    } else if (e.code === 'Backquote') {
      keyName = '`';
    } else {
      keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    }

    // Assemble modifiers
    const modifiers: string[] = [];
    if (isMac) {
      if (hasCmd) modifiers.push('Command');
      if (hasCtrl) modifiers.push('Control');
      if (hasAlt) modifiers.push('Alt');
      if (hasShift) modifiers.push('Shift');
    } else {
      if (hasCtrl) modifiers.push('Control');
      if (hasAlt) modifiers.push('Alt');
      if (hasShift) modifiers.push('Shift');
      if (e.metaKey) modifiers.push('Command');
    }

    const combo = [...modifiers, keyName].join('+');
    handleApplyShortcut(combo);
  };

  const handleResetDefaultShortcut = async () => {
    if (!window.api || isSavingShortcut) return;
    const defaultSc = isMac ? 'Command+Shift+.' : 'Control+Shift+.';
    await handleApplyShortcut(defaultSc);
  };

  const handleOpenAccessibility = () => {
    if (window.api) {
      window.api.openAccessibilitySettings();
      if (onToast) {
        onToast(
          'info',
          'Mở Cài Đặt Hệ Thống macOS',
          'Vui lòng gạt bật SFX Music Manager trong mục Trợ Năng (Accessibility) rồi quay lại ứng dụng.'
        );
      }
    }
  };

  const handleRecheckAccessibility = async () => {
    if (!window.api) return;
    const granted = await window.api.checkAccessibilityPermission(false);
    setIsAccessibilityGranted(granted);
    if (onToast) {
      if (granted) {
        onToast('success', 'Đã Cấp Quyền', 'Hệ thống đã nhận diện quyền Trợ Năng (Accessibility) thành công!');
      } else {
        onToast('warning', 'Chưa Cấp Quyền', 'Chưa phát hiện quyền Trợ Năng. Hãy đảm bảo bạn đã tích chọn app trong System Settings.');
      }
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

          {/* Section 2: Quick Launcher & Global Hotkey */}
          <div className="settings-section">
            <div className="settings-section-header">
              <Command size={16} className="text-accent" />
              <h4>Phím Tắt Toàn Cục Quick Launcher (FX Console / Spotlight)</h4>
            </div>
            <p className="settings-section-desc">
              Kích hoạt cửa sổ tìm kiếm và nghe thử nhanh dạng nổi mini ngay cả khi ứng dụng dựng phim (CapCut, Premiere Pro, DaVinci Resolve) đang active, không cần mở giao diện chính.
            </p>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Phím tắt toàn cục hiện tại</span>
                <span className="settings-row-hint">
                  {isMac ? 'Mặc định macOS: Command+Shift+.' : 'Mặc định Windows: Control+Shift+.'}
                </span>
              </div>
              <div className="settings-shortcut-control">
                {isRecording ? (
                  <div
                    ref={recorderRef}
                    tabIndex={0}
                    className="hotkey-recorder-box active"
                    onKeyDown={handleRecordKeyDown}
                    title="Bấm tổ hợp phím bất kỳ trên bàn phím để gán phím tắt mới"
                  >
                    <div className="recording-indicator">
                      <span className="recording-dot" />
                      <span className="recording-text">Đang lắng nghe... Bấm tổ hợp phím trên bàn phím</span>
                    </div>
                    <button
                      className="btn-cancel-recording"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsRecording(false);
                      }}
                      title="Hủy gán phím (Esc)"
                    >
                      <X size={12} />
                      <span>Hủy (Esc)</span>
                    </button>
                  </div>
                ) : (
                  <div className="shortcut-display-wrap">
                    <div
                      className="hotkey-record-trigger"
                      onClick={() => setIsRecording(true)}
                      title="Nhấp vào đây để bấm tổ hợp phím mới"
                    >
                      <kbd className="settings-kbd">{formatShortcutDisplay(shortcut || (isMac ? 'Command+Shift+.' : 'Control+Shift+.'))}</kbd>
                      <span className="hotkey-raw-text">({shortcut || (isMac ? 'Command+Shift+.' : 'Control+Shift+.')})</span>
                    </div>
                    <button
                      className="btn-edit-shortcut"
                      onClick={() => setIsRecording(true)}
                      disabled={isSavingShortcut}
                      title="Bấm vào đây rồi nhấn tổ hợp phím mới trên bàn phím"
                    >
                      Bấm để đổi phím
                    </button>
                    <button
                      className="btn-reset-shortcut"
                      onClick={handleResetDefaultShortcut}
                      disabled={isSavingShortcut}
                      title="Đặt lại phím mặc định của hệ điều hành"
                    >
                      Mặc định
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* macOS Accessibility Permission Card */}
            {isMac && (
              <div className="elevation-status-card" style={{ marginTop: 12 }}>
                <div className="elevation-icon">
                  {isAccessibilityGranted ? (
                    <CheckCircle2 size={24} className="text-success" />
                  ) : (
                    <ShieldAlert size={24} className="text-warning" />
                  )}
                </div>
                <div className="elevation-info">
                  <div className="elevation-title">
                    Quyền Trợ Năng (Accessibility):{' '}
                    <strong>{isAccessibilityGranted ? 'Đã Cấp Quyền (Sẵn sàng hoạt động)' : 'Chưa Cấp Quyền'}</strong>
                  </div>
                  <div className="elevation-hint">
                    {isAccessibilityGranted
                      ? 'SFX Music Manager đã sẵn sàng bắt phím tắt ngay cả khi CapCut hay Premiere đang full-screen.'
                      : 'macOS yêu cầu cấp quyền Trợ Năng (Accessibility) để ứng dụng lắng nghe phím tắt khi app khác đang active.'}
                  </div>
                  {!isAccessibilityGranted && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn-open-perm" onClick={handleOpenAccessibility}>
                        <ExternalLink size={12} />
                        <span>Mở Cài Đặt Hệ Thống (System Settings)</span>
                      </button>
                      <button className="btn-recheck-perm" onClick={handleRecheckAccessibility} title="Kiểm tra lại quyền">
                        <RefreshCw size={12} />
                        <span>Kiểm tra lại</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Windows UIPI & Administrator Status */}
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
