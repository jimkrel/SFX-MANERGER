import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, Trash2, CheckCircle2, ShieldAlert, Sparkles, Command, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import { isAutoBounceEnabled, setAutoBounceEnabled, clearPreparedBounceCache } from '../audio/bouncerService';
import { isWindows, isMac, subscribePlatform } from '../utils/platform';

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
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribePlatform(() => forceUpdate((n) => n + 1));
    return unsubscribe;
  }, []);

  const [autoBounce, setAutoBounce] = useState<boolean>(isAutoBounceEnabled());
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);
  const [shortcut, setShortcut] = useState<string>('');
  const [isSavingShortcut, setIsSavingShortcut] = useState<boolean>(false);
  const [isAccessibilityGranted, setIsAccessibilityGranted] = useState<boolean>(true);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const recorderRef = useRef<HTMLDivElement | null>(null);

  // Focus recorder element when recording starts
  useEffect(() => {
    if (isRecording && recorderRef.current) {
      recorderRef.current.focus();
    }
  }, [isRecording]);

  // Sync settings when modal opens
  useEffect(() => {
    if (!isOpen || !window.api) {
      setIsRecording(false);
      return;
    }

    window.api.getQuickLauncherShortcut().then((sc) => {
      setShortcut(sc);
    });

    if (isMac) {
      window.api.checkAccessibilityPermission(false).then((granted) => {
        setIsAccessibilityGranted(granted);
      });
      const unsubscribePerm = window.api.onAccessibilityStatusChanged?.(({ granted }) => {
        setIsAccessibilityGranted(granted);
        if (granted && onToast) {
          onToast('success', 'Đã Cấp Quyền Trợ Năng', 'Hệ thống đã nhận diện quyền Trợ Năng (Accessibility) thành công! Phím tắt toàn cục đã kích hoạt.');
        }
      });
      return () => {
        if (unsubscribePerm) unsubscribePerm();
      };
    }
  }, [isOpen, isMac, onToast]);

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
            <Settings className="modal-title-icon" size={18} />
            <div>
              <h3>Cài Đặt Hệ Thống</h3>
              <p>Tùy chỉnh chuyển mã kéo thả & phím tắt Quick Launcher</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Đóng (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body settings-body">
          {/* Card 1: Kéo Thả NLE */}
          <div className="settings-group-card">
            <div className="settings-group-title">
              <Sparkles size={14} className="text-accent" />
              <span>Kéo Thả Sang CapCut / Premiere / Resolve</span>
            </div>

            <div className="settings-item-row">
              <div className="settings-item-text">
                <span className="settings-item-title">Tự động chuẩn hóa Broadcast WAV</span>
                <span className="settings-item-desc">
                  Chuyển mã ngầm tức thì sang WAV 48kHz / 16-bit để timeline edit nhận ngay không lệch nhịp
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

            <div className="settings-item-row">
              <div className="settings-item-text">
                <span className="settings-item-title">Bộ nhớ đệm tạm (%TEMP%)</span>
                <span className="settings-item-desc">
                  Cache WAV được tự động dọn sau 24h hoặc bấm dọn ngay để giải phóng dung lượng ổ đĩa
                </span>
              </div>
              <button
                className="btn-clear-cache"
                onClick={handleClearCache}
                disabled={isClearingCache}
              >
                <Trash2 size={13} />
                <span>{isClearingCache ? 'Đang dọn...' : 'Dọn cache'}</span>
              </button>
            </div>
          </div>

          {/* Card 2: Quick Launcher & Phím Tắt */}
          <div className="settings-group-card">
            <div className="settings-group-title">
              <Command size={14} className="text-accent" />
              <span>Cửa Sổ Nổi Quick Launcher</span>
            </div>

            <div className="settings-item-row">
              <div className="settings-item-text">
                <span className="settings-item-title">Phím tắt kích hoạt toàn cục</span>
                <span className="settings-item-desc">
                  Bấm mở ô tìm kiếm nhanh khi đang ở bất kỳ phần mềm dựng phim nào
                </span>
              </div>

              <div className="hotkey-control-wrap">
                {isRecording ? (
                  <div
                    ref={recorderRef}
                    tabIndex={0}
                    className="hotkey-recorder-box"
                    onKeyDown={handleRecordKeyDown}
                  >
                    <span className="recording-dot" />
                    <span className="recording-text">Nhấn tổ hợp phím mới...</span>
                    <button
                      className="btn-cancel-recording"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsRecording(false);
                      }}
                      title="Hủy (Esc)"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="hotkey-display-group">
                    <button
                      className="hotkey-trigger-btn"
                      onClick={() => setIsRecording(true)}
                      title="Nhấp để đổi tổ hợp phím tắt mới"
                    >
                      <kbd className="settings-kbd">{formatShortcutDisplay(shortcut || (isMac ? 'Command+Shift+.' : 'Control+Shift+.'))}</kbd>
                      <span className="hotkey-edit-hint">Đổi phím</span>
                    </button>
                    <button
                      className="btn-reset-icon"
                      onClick={handleResetDefaultShortcut}
                      disabled={isSavingShortcut}
                      title={`Khôi phục phím mặc định (${isMac ? 'Cmd+Shift+.' : 'Ctrl+Shift+.'})`}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* macOS Accessibility Status */}
            {isMac && (
              <div className={`accessibility-pill ${isAccessibilityGranted ? 'granted' : 'pending'}`}>
                <div className="pill-left">
                  {isAccessibilityGranted ? (
                    <CheckCircle2 size={15} className="text-success" />
                  ) : (
                    <ShieldAlert size={15} className="text-warning" />
                  )}
                  <span className="pill-text">
                    {isAccessibilityGranted
                      ? 'Quyền Trợ Năng (Accessibility): Đã kích hoạt · Sẵn sàng bắt phím khi ở app khác'
                      : 'Quyền Trợ Năng: Cần cấp quyền để lắng nghe phím khi ở app khác'}
                  </span>
                </div>
                {!isAccessibilityGranted && (
                  <div className="pill-actions">
                    <button className="btn-perm-primary" onClick={handleOpenAccessibility}>
                      <ExternalLink size={12} />
                      <span>Mở Cài Đặt</span>
                    </button>
                    <button className="btn-perm-icon" onClick={handleRecheckAccessibility} title="Kiểm tra lại quyền">
                      <RefreshCw size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Windows UIPI Status */}
            {isWindows && (
              <div className={`accessibility-pill ${appInfo?.isElevated ? 'granted' : 'pending'}`}>
                <div className="pill-left">
                  {appInfo?.isElevated ? (
                    <CheckCircle2 size={15} className="text-success" />
                  ) : (
                    <ShieldAlert size={15} className="text-warning" />
                  )}
                  <span className="pill-text">
                    {appInfo?.isElevated
                      ? 'Windows UIPI: Đang chạy quyền Quản trị (Toàn quyền kéo thả)'
                      : 'Windows UIPI: Quyền thường (Nếu CapCut Admin không nhận kéo, hãy chạy SFX Manager với Run as Administrator)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Specs Mini Bar */}
          <div className="settings-specs-compact">
            <div className="spec-tag">
              <span className="spec-tag-label">Render Output</span>
              <span className="spec-tag-val">Broadcast WAV 16-bit</span>
            </div>
            <div className="spec-tag">
              <span className="spec-tag-label">Timeline Rate</span>
              <span className="spec-tag-val">48.000 Hz</span>
            </div>
            <div className="spec-tag">
              <span className="spec-tag-label">Audio Core</span>
              <span className="spec-tag-val">Web Audio & FFmpeg</span>
            </div>
            <div className="spec-tag">
              <span className="spec-tag-label">Native Protocol</span>
              <span className="spec-tag-val">{isWindows ? 'OLE / CF_HDROP' : 'Cocoa NSPasteboard'}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-modal-close" onClick={onClose}>
            Xong
          </button>
        </div>
      </div>
    </div>
  );
};
