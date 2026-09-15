import React, { useState, useEffect } from 'react';
import { X, Keyboard, Play, LayoutGrid, Search, Sparkles, ShieldAlert } from 'lucide-react';
import { isWindows, subscribePlatform } from '../utils/platform';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribePlatform(() => forceUpdate((n) => n + 1));
    return unsubscribe;
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Keyboard className="modal-title-icon" size={20} />
            <div>
              <h3>Bảng Phím Tắt DAW</h3>
              <p>Tối ưu hóa tốc độ tìm kiếm và thử âm thanh chuyên nghiệp</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Đóng (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Group 1: Phát & Thử âm thanh */}
          <div className="shortcut-group">
            <div className="group-title">
              <Play size={14} />
              <span>Phát & Nghe Thử</span>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Phát / Tạm dừng clip đang chọn</span>
              <kbd className="shortcut-key">Space</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Bật / Tắt phát lặp lại (Loop Audio)</span>
              <kbd className="shortcut-key">L</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Chọn và nghe clip trước / tiếp theo</span>
              <div className="shortcut-keys-combo">
                <kbd className="shortcut-key">↑</kbd>
                <kbd className="shortcut-key">↓</kbd>
              </div>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Kéo tua sóng âm trực tiếp (Scrubbing)</span>
              <span className="shortcut-mouse">Kéo chuột trên sóng</span>
            </div>
          </div>

          {/* Group 2: Chế độ hiển thị */}
          <div className="shortcut-group">
            <div className="group-title">
              <LayoutGrid size={14} />
              <span>Chế Độ Hiển Thị</span>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Chế độ Danh sách (List Table)</span>
              <kbd className="shortcut-key">1</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Chế độ Thẻ (Grid Cards)</span>
              <kbd className="shortcut-key">2</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Chế độ Cột (Columns Finder)</span>
              <kbd className="shortcut-key">3</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Chế độ Ảnh lớn (Gallery View)</span>
              <kbd className="shortcut-key">4</kbd>
            </div>
          </div>

          {/* Group 3: Điều hướng & Thao tác */}
          <div className="shortcut-group">
            <div className="group-title">
              <Search size={14} />
              <span>Tìm Kiếm & Thao Tác</span>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Kích hoạt nhanh ô tìm kiếm</span>
              <kbd className="shortcut-key">/</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Bỏ chọn nhiều file / Xóa tìm kiếm / Đóng</span>
              <kbd className="shortcut-key">Esc</kbd>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Chọn nhiều clip đồng thời</span>
              <span className="shortcut-mouse">Ctrl / Cmd + Click</span>
            </div>
            <div className="shortcut-item">
              <span className="shortcut-desc">Kéo clip sang Premiere / DaVinci / CapCut</span>
              <span className="shortcut-mouse">Kéo clip ra ngoài</span>
            </div>
          </div>

          {/* Group 4: Khắc phục sự cố kéo thả (Windows UIPI) */}
          {isWindows && (
            <div className="shortcut-group" style={{ borderColor: 'rgba(217, 165, 92, 0.25)', backgroundColor: 'rgba(217, 165, 92, 0.04)', borderRadius: '6px', padding: '10px 12px' }}>
              <div className="group-title" style={{ color: '#d9a55c', marginBottom: '6px' }}>
                <ShieldAlert size={14} />
                <span>Lưu Ý Kéo Thả Sang CapCut / Premiere (Windows UIPI)</span>
              </div>
              <div style={{ fontSize: '11.5px', color: 'rgba(232, 227, 218, 0.85)', lineHeight: 1.5 }}>
                Nếu phần mềm dựng phim (CapCut, Premiere Pro) đang chạy bằng quyền <strong>Administrator</strong>, cơ chế bảo mật Windows (UIPI) sẽ chặn kéo thả OLE từ ứng dụng thường.
              </div>
              <div style={{ fontSize: '11.5px', color: '#d9a55c', lineHeight: 1.5, marginTop: '6px' }}>
                💡 <strong>Cách xử lý:</strong> Dùng nút <strong>"Explorer"</strong> để mở thư mục chứa file rồi kéo trực tiếp vào timeline.
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="modal-tip">
            <Sparkles size={13} color="var(--accent)" />
            <span>Mẹo: Nhấn <kbd>?</kbd> bất kỳ lúc nào để mở bảng phím tắt này.</span>
          </div>
          <button className="btn-done" onClick={onClose}>
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
};
