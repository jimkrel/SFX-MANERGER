import React, { useState, useEffect } from 'react';
import { Tag, Trash2, X, Move, Check, FolderOpen } from 'lucide-react';
import { Track } from '../../../preload';
import { getFileManagerName, subscribePlatform } from '../utils/platform';

interface FloatingActionBarProps {
  selectedTracks: Track[];
  onClearSelection: () => void;
  onBulkAddTag: (tagName: string) => void;
  onBulkDelete: () => void;
  onStartDrag?: (e: React.DragEvent, paths: string[]) => void;
  onRevealInExplorer?: (filePath: string) => void;
}

export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  selectedTracks,
  onClearSelection,
  onBulkAddTag,
  onBulkDelete,
  onStartDrag,
  onRevealInExplorer
}) => {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribePlatform(() => forceUpdate((n) => n + 1));
    return unsubscribe;
  }, []);

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
        title="Kéo thả tất cả clip đã chọn sang Premiere Pro / DaVinci Resolve / CapCut"
      >
        <Move size={14} />
        <span>Kéo {count} file vào NLE</span>
      </div>

      {/* Reveal in Explorer / Finder */}
      <button
        className="floating-btn muted"
        onClick={() => {
          if (paths.length > 0 && window.api) {
            if (onRevealInExplorer) onRevealInExplorer(paths[0]);
            else window.api.showInFolder(paths[0]);
          }
        }}
        title={`Mở thư mục chứa file trong ${getFileManagerName()}`}
      >
        <FolderOpen size={14} />
        <span>{getFileManagerName()}</span>
      </button>

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
