import React, { useState } from 'react';
import { Tag, Trash2, X, Move, Check } from 'lucide-react';
import { Track } from '../../../preload';

interface FloatingActionBarProps {
  selectedTracks: Track[];
  onClearSelection: () => void;
  onBulkAddTag: (tagName: string) => void;
  onBulkDelete: () => void;
  onStartDrag?: (e: React.DragEvent, paths: string[]) => void;
}

export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  selectedTracks,
  onClearSelection,
  onBulkAddTag,
  onBulkDelete,
  onStartDrag
}) => {
  const [tagInput, setTagInput] = useState('');
  const [isTagging, setIsTagging] = useState(false);

  if (selectedTracks.length < 2) return null;

  const count = selectedTracks.length;
  const paths = selectedTracks.map((t) => t.path);

  const handleDragStart = (e: React.DragEvent) => {
    if (onStartDrag) {
      onStartDrag(e, paths);
    } else {
      e.preventDefault();
      if (window.api && paths.length > 0) {
        window.api.startDrag(paths);
      }
    }
  };

  const handleApplyTag = () => {
    if (tagInput.trim()) {
      onBulkAddTag(tagInput.trim());
      setTagInput('');
      setIsTagging(false);
    }
  };

  return (
    <div className="floating-action-bar">
      <div className="floating-info">
        <strong>{count}</strong>
        <span>clip được chọn</span>
      </div>

      <div className="floating-divider" />

      {/* Bulk Tagging */}
      {isTagging ? (
        <div className="floating-tag-input-wrap">
          <input
            type="text"
            placeholder="Nhập tên tag..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleApplyTag();
              if (e.key === 'Escape') setIsTagging(false);
            }}
            autoFocus
          />
          <button className="floating-btn success" onClick={handleApplyTag} title="Lưu tag">
            <Check size={14} />
          </button>
          <button className="floating-btn muted" onClick={() => setIsTagging(false)} title="Hủy">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button className="floating-btn" onClick={() => setIsTagging(true)} title="Gắn tag cho các clip đã chọn">
          <Tag size={14} />
          <span>Gắn tag</span>
        </button>
      )}

      {/* Multi-file Native Drag */}
      <div
        className="floating-btn draggable-clip"
        draggable
        onDragStart={handleDragStart}
        title="Kéo thả tất cả clip đã chọn sang Premiere Pro / DaVinci Resolve"
      >
        <Move size={14} />
        <span>Kéo {count} file vào NLE</span>
      </div>

      {/* Bulk Delete */}
      <button className="floating-btn danger" onClick={onBulkDelete} title="Xóa các clip đã chọn khỏi thư viện">
        <Trash2 size={14} />
        <span>Xóa ({count})</span>
      </button>

      <div className="floating-divider" />

      {/* Clear selection */}
      <button className="floating-btn close-btn" onClick={onClearSelection} title="Bỏ chọn (Esc)">
        <X size={15} />
      </button>
    </div>
  );
};
