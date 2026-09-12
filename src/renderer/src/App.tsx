import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track, Tag, LibraryStats, SearchFilterOptions } from '../../preload';
import { WaveformThumbnail } from './components/WaveformThumbnail';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { StatBar } from './components/StatBar';
import { ToastContainer, ToastMessage } from './components/Toast';
import { audioPlayer, PlayerState } from './audio/player';

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  if (mins === 0) {
    return `${secs}.${ms}s`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState<LibraryStats>({ totalSfx: 0, totalMusic: 0, newThisWeek: 0, totalMissing: 0 });
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Drag & Drop Import State
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Filters state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagMode, setTagMode] = useState<'AND' | 'OR'>('OR');

  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());
  const [rescanInfo, setRescanInfo] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTrackRef = useRef<Track | null>(null);
  selectedTrackRef.current = selectedTrack;
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;
  const dragCounter = useRef(0);

  const addToast = useCallback((type: 'success' | 'warning' | 'error' | 'info', title: string, message: string) => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, type, title, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 1. Subscribe to player state
  useEffect(() => {
    const unsubscribe = audioPlayer.subscribe((state) => {
      setPlayerState(state);
      if (state.currentTrack) {
        setSelectedTrack(state.currentTrack);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Load library data with active filters
  const loadData = useCallback(async () => {
    if (!window.api) return;
    try {
      const filterOptions: SearchFilterOptions = {
        searchQuery: searchQuery.trim() || undefined,
        folderPath: selectedFolder || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        tagMode: tagMode
      };

      const [trackList, folderList, tagList, libStats] = await Promise.all([
        window.api.getTracks(filterOptions),
        window.api.getWatchedFolders(),
        window.api.getAllTags(),
        window.api.getLibraryStats()
      ]);

      setTracks(trackList);
      setFolders(folderList);
      setTags(tagList);
      setStats(libStats);

      if (trackList.length > 0 && !selectedTrackRef.current) {
        setSelectedTrack(trackList[0]);
      } else if (selectedTrackRef.current) {
        const updated = trackList.find((t) => t.id === selectedTrackRef.current?.id);
        if (updated) setSelectedTrack(updated);
      }
    } catch (error) {
      console.error('[Library] Lỗi khi nạp dữ liệu:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedFolder, selectedTagIds, tagMode]);

  useEffect(() => {
    loadData();

    if (window.api) {
      const unsubscribe = window.api.onLibraryUpdated(() => {
        loadData();
      });
      return () => unsubscribe();
    }
  }, [loadData]);

  // 3. Global Keyboard Shortcuts (Space = preview, Up/Down = browse, "/" = search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputActive = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isInputActive) return;

      if (e.code === 'Space') {
        e.preventDefault();
        const current = selectedTrackRef.current;
        if (current && current.is_missing !== 1) {
          audioPlayer.togglePlay(current);
        }
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        const currentList = tracksRef.current;
        if (currentList.length === 0) return;
        const currentIndex = currentList.findIndex((t) => t.id === selectedTrackRef.current?.id);
        const nextIndex = currentIndex < currentList.length - 1 ? currentIndex + 1 : 0;
        const nextTrack = currentList[nextIndex];
        setSelectedTrack(nextTrack);
        if (playerState.isPlaying && nextTrack.is_missing !== 1) {
          audioPlayer.play(nextTrack, 0);
        }
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        const currentList = tracksRef.current;
        if (currentList.length === 0) return;
        const currentIndex = currentList.findIndex((t) => t.id === selectedTrackRef.current?.id);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : currentList.length - 1;
        const prevTrack = currentList[prevIndex];
        setSelectedTrack(prevTrack);
        if (playerState.isPlaying && prevTrack.is_missing !== 1) {
          audioPlayer.play(prevTrack, 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playerState.isPlaying]);

  const handleAddFolder = async () => {
    if (!window.api) return;
    try {
      const selected = await window.api.openFolderDialog();
      if (selected) {
        await window.api.addWatchedFolder(selected);
        addToast('success', 'Thêm thư mục', `Đang quét thư mục: ${selected}`);
        loadData();
      }
    } catch (error) {
      console.error('[Library] Lỗi thêm thư mục:', error);
    }
  };

  const handleRemoveFolder = async (folderPath: string) => {
    if (!window.api) return;
    try {
      await window.api.removeWatchedFolder(folderPath);
      if (selectedFolder === folderPath) {
        setSelectedFolder(null);
      }
      addToast('info', 'Ngừng theo dõi', `Đã gỡ thư mục: ${folderPath}`);
      loadData();
    } catch (error) {
      console.error('[Library] Lỗi gỡ bỏ thư mục:', error);
    }
  };

  const handleRescan = async () => {
    if (!window.api) return;
    try {
      const res = await window.api.rescanLibrary();
      setRescanInfo(`Đã quét ${res.checked} file (${res.missing} missing, ${res.recovered} phục hồi)`);
      addToast('info', 'Quét lại hoàn tất', `Kiểm tra ${res.checked} file: ${res.missing} missing, ${res.recovered} phục hồi`);
      setTimeout(() => setRescanInfo(null), 4000);
      loadData();
    } catch (error) {
      console.error('[Library] Lỗi quét lại:', error);
    }
  };

  const handleTrackClick = (track: Track) => {
    setSelectedTrack(track);
    if (track.is_missing !== 1) {
      audioPlayer.play(track, 0);
    }
  };

  // 4. EXPORT Drag & Drop to Premiere / Resolve / Finder
  const handleDragStart = (e: React.DragEvent, track: Track) => {
    if (track.is_missing === 1 || !window.api) return;
    e.preventDefault();

    // Get waveform thumbnail canvas to use as drag icon
    const targetElement = e.currentTarget as HTMLElement;
    const canvas = targetElement.querySelector('canvas');
    let iconDataUrl: string | undefined;
    if (canvas) {
      try {
        iconDataUrl = canvas.toDataURL('image/png');
      } catch (err) {
        console.warn('Could not extract canvas dataURL for drag icon:', err);
      }
    }

    window.api.startDrag(track.path, iconDataUrl);
  };

  // 5. IMPORT Drag & Drop from Finder
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDraggingOver(false);

    if (!window.api) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const paths: string[] = [];
    for (const file of files) {
      const filePath = window.api.getPathForFile(file);
      if (filePath) {
        paths.push(filePath);
      }
    }

    if (paths.length === 0) return;

    try {
      addToast('info', 'Đang xử lý', `Đang phân tích ${paths.length} mục kéo thả từ Finder...`);
      const result = await window.api.importDroppedPaths(paths);

      if (result.imported > 0 || result.folders > 0) {
        let msg = `Đã nhập ${result.imported} clip âm thanh`;
        if (result.folders > 0) {
          msg += ` từ ${result.folders} thư mục mới`;
        }
        addToast('success', 'Nhập thành công', msg);
      }

      if (result.errors && result.errors.length > 0) {
        result.errors.forEach((err) => {
          addToast('warning', 'Cảnh báo định dạng', err);
        });
      }

      loadData();
    } catch (err) {
      console.error('Lỗi khi import file kéo thả:', err);
      addToast('error', 'Lỗi Import', String(err));
    }
  };

  const toggleTagFilter = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedFolder(null);
    setSelectedTagIds([]);
  };

  const hasActiveFilters = searchQuery !== '' || selectedFolder !== null || selectedTagIds.length > 0;
  const totalTracks = tracks.length;
  const missingTracks = tracks.filter((t) => t.is_missing === 1).length;
  const availableTracks = totalTracks - missingTracks;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--bg-main)',
        color: 'var(--text-main)',
        padding: '12px 18px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)',
        position: 'relative'
      }}
    >
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '10px',
          marginBottom: '10px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent)',
              boxShadow: '0 0 8px rgba(201, 151, 78, 0.4)'
            }}
          />
          <h1 style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            SFX / Music Manager
          </h1>
          <span
            className="mono"
            style={{
              fontSize: '10px',
              color: 'var(--accent)',
              backgroundColor: 'rgba(201, 151, 78, 0.12)',
              border: '1px solid rgba(201, 151, 78, 0.25)',
              padding: '2px 8px',
              borderRadius: '4px'
            }}
          >
            Local Studio Edition
          </span>
        </div>

        {/* Shortcuts Bar Hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'rgba(232, 227, 218, 0.5)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <kbd className="mono" style={{ backgroundColor: 'rgba(232, 227, 218, 0.1)', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-main)' }}>Space</kbd> Preview
          </span>
          <span>•</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <kbd className="mono" style={{ backgroundColor: 'rgba(232, 227, 218, 0.1)', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-main)' }}>↑/↓</kbd> Duyệt
          </span>
          <span>•</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <kbd className="mono" style={{ backgroundColor: 'rgba(232, 227, 218, 0.1)', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-main)' }}>/</kbd> Tìm kiếm
          </span>
          <span>•</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: 'var(--accent)' }}>⇄</span> Kéo & Thả 2 chiều
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {rescanInfo && (
            <span style={{ fontSize: '11px', color: 'var(--accent)' }} className="mono">
              {rescanInfo}
            </span>
          )}
          <button
            onClick={handleRescan}
            style={{
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              padding: '5px 12px',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500
            }}
          >
            🔄 Quét lại
          </button>
          <button
            onClick={handleAddFolder}
            style={{
              backgroundColor: 'var(--accent)',
              border: 'none',
              color: '#1C1B19',
              fontWeight: 600,
              padding: '5px 14px',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            + Thêm Thư Mục
          </button>
        </div>
      </header>

      {/* 3-Column DAW Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr 340px',
          gap: '12px',
          flex: 1,
          minHeight: 0
        }}
      >
        {/* Column 1: Sidebar Folders & Tags */}
        <aside
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflowY: 'auto'
          }}
        >
          {/* Folders Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', fontWeight: 600 }}>
                Thư mục
              </span>
              {selectedFolder && (
                <button
                  onClick={() => setSelectedFolder(null)}
                  style={{ background: 'none', border: 'none', color: 'rgba(232, 227, 218, 0.5)', fontSize: '10px', cursor: 'pointer' }}
                >
                  Tất cả
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div
                onClick={() => setSelectedFolder(null)}
                style={{
                  padding: '5px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  backgroundColor: selectedFolder === null ? 'rgba(201, 151, 78, 0.15)' : 'transparent',
                  color: selectedFolder === null ? 'var(--accent)' : 'inherit',
                  fontWeight: selectedFolder === null ? 600 : 400
                }}
              >
                📁 Tất cả thư mục
              </div>

              {folders.map((folder) => {
                const folderName = folder.split('/').pop();
                const isSelected = selectedFolder === folder;
                return (
                  <div
                    key={folder}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      backgroundColor: isSelected ? 'rgba(201, 151, 78, 0.15)' : 'transparent',
                      color: isSelected ? 'var(--accent)' : 'inherit',
                      fontWeight: isSelected ? 600 : 400
                    }}
                  >
                    <span
                      onClick={() => setSelectedFolder(folder)}
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                      title={folder}
                    >
                      📁 {folderName}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFolder(folder);
                      }}
                      title="Ngừng theo dõi"
                      style={{ background: 'none', border: 'none', color: 'rgba(232, 227, 218, 0.3)', cursor: 'pointer', fontSize: '11px', padding: '0 2px' }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }} />

          {/* Tags Filter & AND/OR Toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', fontWeight: 600 }}>
                Lọc theo Tags
              </span>

              <div
                style={{
                  display: 'flex',
                  backgroundColor: 'rgba(28, 27, 25, 0.8)',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  padding: '1px'
                }}
              >
                <button
                  onClick={() => setTagMode('OR')}
                  style={{
                    border: 'none',
                    background: tagMode === 'OR' ? 'var(--accent)' : 'transparent',
                    color: tagMode === 'OR' ? '#1C1B19' : 'rgba(232, 227, 218, 0.5)',
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '2px 5px',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  OR
                </button>
                <button
                  onClick={() => setTagMode('AND')}
                  style={{
                    border: 'none',
                    background: tagMode === 'AND' ? 'var(--accent)' : 'transparent',
                    color: tagMode === 'AND' ? '#1C1B19' : 'rgba(232, 227, 218, 0.5)',
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '2px 5px',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  AND
                </button>
              </div>
            </div>

            {tags.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'rgba(232, 227, 218, 0.4)' }}>Chưa có tags nào.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {tags.map((tag) => {
                  const isChecked = selectedTagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        backgroundColor: isChecked ? 'rgba(201, 151, 78, 0.12)' : 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleTagFilter(tag.id)}
                          style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                        />
                        <span style={{ color: isChecked ? 'var(--accent)' : 'inherit', fontWeight: isChecked ? 600 : 400 }}>
                          #{tag.name}
                        </span>
                      </div>
                      <span className="mono" style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.4)' }}>
                        {tag.count || 0}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Column 2: Grid Clip & Two-Way Drag and Drop */}
        <section
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            backgroundColor: isDraggingOver ? 'rgba(201, 151, 78, 0.08)' : 'var(--bg-panel)',
            border: isDraggingOver ? '2px dashed var(--accent)' : '1px solid var(--border-color)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
            transition: 'border-color 0.15s ease, background-color 0.15s ease'
          }}
        >
          {/* Visual Drop Overlay Indicator */}
          {isDraggingOver && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(28, 27, 25, 0.88)',
                zIndex: 50,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                pointerEvents: 'none'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(201, 151, 78, 0.2)',
                  border: '2px solid var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px',
                  color: 'var(--accent)'
                }}
              >
                📥
              </div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--accent)' }}>
                Thả file hoặc thư mục vào đây để Import
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(232, 227, 218, 0.7)' }}>
                Hỗ trợ định dạng: .wav, .mp3, .aiff, .flac (hoặc thư mục đệ quy)
              </div>
            </div>
          )}

          {/* Top Search Bar (FTS5 + Spotlight shortcut /) */}
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo tên file, tags (nhấn / để focus)..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: '#161514',
                  border: '1px solid rgba(232, 227, 218, 0.15)',
                  borderRadius: '5px',
                  color: 'var(--text-main)',
                  padding: '6px 30px 6px 10px',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              <span
                className="mono"
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '10px',
                  color: 'rgba(232, 227, 218, 0.4)',
                  backgroundColor: 'rgba(232, 227, 218, 0.1)',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  pointerEvents: 'none'
                }}
              >
                /
              </span>
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  color: 'var(--accent)',
                  borderRadius: '5px',
                  padding: '5px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Xóa bộ lọc
              </button>
            )}
          </div>

          {/* Table Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '36px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.5)', fontSize: '13px' }}>
                Đang nạp dữ liệu thư viện...
              </div>
            ) : folders.length === 0 ? (
              /* Giọng hệ thống khi rỗng chưa add folder */
              <div style={{ padding: '40px 24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.6)', fontSize: '13px', lineHeight: 1.6 }}>
                <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: '6px' }}>
                  [HỆ THỐNG] Thư viện hiện chưa có thư mục nào được liên kết.
                </div>
                <div>
                  Thao tác tiếp theo: Kéo thả file/thư mục từ Finder vào đây, hoặc nhấn nút <strong>"+ Thêm Thư Mục"</strong> ở trên.
                </div>
              </div>
            ) : tracks.length === 0 ? (
              /* Giọng hệ thống khi search/filter không ra kết quả */
              <div style={{ padding: '40px 24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.6)', fontSize: '13px', lineHeight: 1.6 }}>
                <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: '6px' }}>
                  [HỆ THỐNG] Không tìm thấy clip âm thanh nào phù hợp với bộ lọc hiện tại.
                </div>
                <div>
                  Thao tác tiếp theo: Thay đổi từ khóa tìm kiếm, kiểm tra các tag đã chọn, hoặc nhấn <strong>"Xóa bộ lọc"</strong> để xem toàn bộ danh sách.
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'rgba(232, 227, 218, 0.45)', fontSize: '10px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '8px 10px', width: '24px' }}></th>
                    <th style={{ padding: '8px 10px' }}>Tên Clip</th>
                    <th style={{ padding: '8px 10px', width: '110px' }}>Waveform</th>
                    <th style={{ padding: '8px 10px', width: '60px' }}>Độ Dài</th>
                    <th style={{ padding: '8px 10px', width: '130px' }}>Tags</th>
                    <th style={{ padding: '8px 10px', width: '60px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => {
                    const isSelected = selectedTrack?.id === track.id;
                    const isCurrentPlaying = playerState.isPlaying && playerState.currentTrack?.id === track.id;
                    const isMissing = track.is_missing === 1;

                    return (
                      <tr
                        key={track.id}
                        onClick={() => handleTrackClick(track)}
                        draggable={!isMissing}
                        onDragStart={(e) => handleDragStart(e, track)}
                        className={!isMissing ? 'draggable-clip' : ''}
                        title={isMissing ? 'File bị thiếu trên ổ đĩa' : 'Kéo thả clip ra Premiere Pro / DaVinci Resolve / Finder'}
                        style={{
                          borderBottom: '1px solid rgba(232, 227, 218, 0.04)',
                          backgroundColor: isSelected ? 'rgba(201, 151, 78, 0.12)' : 'transparent',
                          cursor: isMissing ? 'not-allowed' : 'pointer',
                          opacity: isMissing ? 0.4 : 1
                        }}
                      >
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {isCurrentPlaying ? (
                            <span style={{ color: 'var(--accent)', fontSize: '12px' }}>▶</span>
                          ) : (
                            <span style={{ color: 'rgba(232, 227, 218, 0.3)', fontSize: '11px', cursor: 'grab' }} title="Kéo clip ra Premiere/Resolve">
                              ⋮⋮
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: isSelected ? 600 : 500, color: isSelected ? 'var(--accent)' : 'inherit' }}>
                              {track.name}
                            </span>
                            <span className="mono" style={{ fontSize: '9px', color: 'rgba(232, 227, 218, 0.3)' }}>
                              {track.path.split('/').pop()}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <WaveformThumbnail
                            track={track}
                            isPlaying={isCurrentPlaying}
                            isSelected={isSelected}
                            width={100}
                            height={22}
                          />
                        </td>
                        <td className="mono" style={{ padding: '8px 10px', color: 'var(--text-main)' }}>
                          {formatDuration(track.duration)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {track.tagList && track.tagList.length > 0 ? (
                              track.tagList.slice(0, 3).map((t) => (
                                <span
                                  key={t.id}
                                  style={{
                                    fontSize: '9px',
                                    color: 'var(--accent)',
                                    backgroundColor: 'rgba(201, 151, 78, 0.12)',
                                    padding: '1px 5px',
                                    borderRadius: '6px'
                                  }}
                                >
                                  #{t.name}
                                </span>
                              ))
                            ) : (
                              <span style={{ color: 'rgba(232, 227, 218, 0.2)', fontSize: '10px' }}>—</span>
                            )}
                            {track.tagList && track.tagList.length > 3 && (
                              <span style={{ fontSize: '9px', color: 'rgba(232, 227, 218, 0.4)' }}>
                                +{track.tagList.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {isMissing ? (
                            <span
                              className="mono"
                              style={{
                                fontSize: '9px',
                                color: '#F87171',
                                backgroundColor: 'rgba(248, 113, 113, 0.15)',
                                padding: '2px 5px',
                                borderRadius: '3px'
                              }}
                            >
                              MISSING
                            </span>
                          ) : (
                            <span
                              className="mono"
                              style={{
                                fontSize: '9px',
                                color: '#4ADE80',
                                backgroundColor: 'rgba(74, 222, 128, 0.12)',
                                padding: '2px 5px',
                                borderRadius: '3px'
                              }}
                            >
                              ONLINE
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Column 3: Now Playing Panel */}
        <aside style={{ height: '100%', minHeight: 0 }}>
          <NowPlayingPanel selectedTrack={selectedTrack} onLibraryRefresh={loadData} />
        </aside>
      </div>

      {/* DAW Stat Bar */}
      <StatBar stats={stats} />
    </div>
  );
}
