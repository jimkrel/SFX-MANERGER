import React, { useState } from 'react';
import { Tag } from '../../../preload';

interface TagEditorProps {
  trackId: number;
  tags?: Tag[];
  currentTags?: Tag[];
  onTagsChanged?: () => void;
}

export const TagEditor: React.FC<TagEditorProps> = ({
  trackId,
  tags,
  currentTags,
  onTagsChanged
}) => {
  const [newTagInput, setNewTagInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const effectiveTags = tags || currentTags || [];

  const handleAddTag = async (tagName: string) => {
    const trimmed = tagName.trim();
    if (!trimmed || !window.api) return;

    try {
      await window.api.addTagToTrack(trackId, trimmed);
      setNewTagInput('');
      setIsAdding(false);
      if (onTagsChanged) onTagsChanged();
    } catch (err) {
      console.error('Error adding tag:', err);
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!window.api) return;
    try {
      await window.api.removeTagFromTrack(trackId, tagId);
      if (onTagsChanged) onTagsChanged();
    } catch (err) {
      console.error('Error removing tag:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag(newTagInput);
    } else if (e.key === 'Escape') {
      setIsAdding(false);
      setNewTagInput('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(232, 227, 218, 0.5)' }}>
        Tags
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {effectiveTags.map((tag) => (
          <span
            key={tag.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: 'rgba(201, 151, 78, 0.15)',
              border: '1px solid rgba(201, 151, 78, 0.3)',
              color: 'var(--text-main)',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px'
            }}
          >
            #{tag.name}
            <button
              onClick={() => handleRemoveTag(tag.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(232, 227, 218, 0.4)',
                cursor: 'pointer',
                padding: '0 2px',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Xoá tag"
            >
              ✕
            </button>
          </span>
        ))}

        {isAdding ? (
          <input
            autoFocus
            type="text"
            placeholder="Tên tag + Enter..."
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (newTagInput.trim()) {
                handleAddTag(newTagInput);
              } else {
                setIsAdding(false);
              }
            }}
            style={{
              backgroundColor: 'rgba(28, 27, 25, 0.9)',
              border: '1px solid var(--accent)',
              borderRadius: '12px',
              color: 'var(--text-main)',
              fontSize: '11px',
              padding: '2px 8px',
              outline: 'none',
              width: '110px'
            }}
          />
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            style={{
              background: 'none',
              border: '1px dashed rgba(232, 227, 218, 0.25)',
              color: 'rgba(232, 227, 218, 0.6)',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              cursor: 'pointer'
            }}
          >
            + Tag
          </button>
        )}
      </div>
    </div>
  );
};
