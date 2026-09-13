import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Waves,
  Plus,
  LayoutGrid,
  Heart,
  History,
  AlertTriangle,
  FolderOpen,
  FolderPlus,
  FilePlus,
  Trash2,
  Search,
  X,
  ListFilter,
  Columns3,
  GalleryHorizontalEnd,
  Play,
  Pause,
  Star,
  AudioLines,
  UploadCloud,
  CheckSquare,
  Square
} from 'lucide-react';
import { Track, Tag, LibraryStats, SearchFilterOptions } from '../../preload';
import { WaveformThumbnail } from './components/WaveformThumbnail';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { FloatingActionBar } from './components/FloatingActionBar';
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

type ViewMode = 'list' | 'grid' | 'columns' | 'gallery';
type SpaceType = 'all' | 'favorites' | 'recent' | 'missing';
type SortOption = 'newest' | 'duration_desc' | 'rating_desc' | 'name_asc';

const CATEGORIES = ['Tất cả', 'Cinematic', 'Foley', 'Ambience', 'UI / Digital', 'Nature', 'Khác'];

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState<LibraryStats>({ totalSfx: 0, totalMusic: 0, newThisWeek: 0, totalMissing: 0 });
  const [storageBytes, setStorageBytes] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeSpace, setActiveSpace] = useState<SpaceType>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tất cả');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Selection state
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set());

  // Audio player state
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());

  // Drag & Drop Import Overlay state
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const dragCounter = useRef(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;
  const selectedTrackRef = useRef<Track | null>(null);
  selectedTrackRef.current = selectedTrack;

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

  // 2. Load Library Data
  const loadData = useCallback(async () => {
    if (!window.api) return;
    try {
      const filterOptions: SearchFilterOptions = {
        searchQuery: searchQuery.trim() || undefined,
        folderPath: selectedFolder || undefined,
        category: selectedCategory !== 'Tất cả' ? selectedCategory : undefined,
        favoriteOnly: activeSpace === 'favorites' ? true : undefined,
        onlyAvailable: activeSpace === 'missing' ? false : undefined,
        sortBy: sortBy
      };

      const [trackList, folderList, tagList, libStats, storageInfo] = await Promise.all([
        window.api.getTracks(filterOptions),
        window.api.getWatchedFolders(),
        window.api.getAllTags(),
        window.api.getLibraryStats(),
        window.api.getStorageStats ? window.api.getStorageStats() : Promise.resolve({ totalBytes: 0, totalFiles: 0 })
      ]);

      // Filter for 'missing' space or 'recent' space if active
      let filtered = trackList;
      if (activeSpace === 'missing') {
        filtered = trackList.filter((t) => t.is_missing === 1);
      } else if (activeSpace === 'recent') {
        filtered = trackList.slice(0, 30);
      }

      setTracks(filtered);
      setFolders(folderList);
      setTags(tagList);
      setStats(libStats);
      if (storageInfo) setStorageBytes(storageInfo.totalBytes);

      if (filtered.length > 0 && !selectedTrackRef.current) {
        setSelectedTrack(filtered[0]);
      } else if (selectedTrackRef.current) {
        const updated = filtered.find((t) => t.id === selectedTrackRef.current?.id);
        if (updated) setSelectedTrack(updated);
      }
    } catch (error) {
      console.error('[Library] Lỗi nạp dữ liệu:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedFolder, selectedCategory, activeSpace, sortBy]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // IPC listener for library updates
  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.onLibraryUpdated(() => {
      loadData();
    });
    return () => cleanup();
  }, [loadData]);

  // 3. Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus search on '/'
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Escape: clear search or clear multi-selection
      if (e.key === 'Escape') {
        if (selectedTrackIds.size > 0) {
          setSelectedTrackIds(new Set());
          return;
        }
        if (searchQuery) {
          setSearchQuery('');
          searchInputRef.current?.blur();
          return;
        }
      }

      // Ignore DAW hotkeys when typing in input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      // Space: Toggle Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (selectedTrackRef.current) {
          audioPlayer.togglePlay(selectedTrackRef.current);
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
  }, [playerState.isPlaying, selectedTrackIds.size, searchQuery]);

  // Navigate Next/Prev track for NowPlayingPanel
  const handleNextTrack = () => {
    if (tracks.length === 0) return;
    const currentIndex = tracks.findIndex((t) => t.id === selectedTrack?.id);
    const nextIndex = (currentIndex + 1) % tracks.length;
    const next = tracks[nextIndex];
    setSelectedTrack(next);
    if (playerState.isPlaying && next.is_missing !== 1) {
      audioPlayer.play(next, 0);
    }
  };

  const handlePrevTrack = () => {
    if (tracks.length === 0) return;
    const currentIndex = tracks.findIndex((t) => t.id === selectedTrack?.id);
    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    const prev = tracks[prevIndex];
    setSelectedTrack(prev);
    if (playerState.isPlaying && prev.is_missing !== 1) {
      audioPlayer.play(prev, 0);
    }
  };

  // Add Folder
  const handleAddFolder = async () => {
    if (!window.api) return;
    try {
      const selected = await window.api.openFolderDialog();
      if (selected) {
        addToast('info', 'Đang xử lý', `Đang quét thư mục: ${selected}`);
        await window.api.addWatchedFolder(selected);
        addToast('success', 'Thêm thư mục', `Đã thêm thư mục theo dõi: ${selected}`);
        loadData();
      }
    } catch (error) {
      console.error('[Library] Lỗi thêm thư mục:', error);
      addToast('error', 'Lỗi thêm thư mục', String(error));
    }
  };

  // Add Files
  const handleAddFiles = async () => {
    if (!window.api) return;
    try {
      const selected = await window.api.openFilesDialog();
      if (selected && selected.length > 0) {
        addToast('info', 'Đang xử lý', `Đang phân tích ${selected.length} file âm thanh...`);
        const result = await window.api.importDroppedPaths(selected);
        if (result.imported > 0) {
          addToast('success', 'Thêm file thành công', `Đã thêm ${result.imported} clip âm thanh vào thư viện`);
        }
        loadData();
      }
    } catch (error) {
      console.error('[Library] Lỗi thêm file:', error);
      addToast('error', 'Lỗi thêm file', String(error));
    }
  };

  // Remove Folder
  const handleRemoveFolder = async (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.api) return;
    try {
      await window.api.removeWatchedFolder(folderPath);
      if (selectedFolder === folderPath) {
        setSelectedFolder(null);
      }
      addToast('info', 'Ngừng theo dõi', `Đã gỡ thư mục: ${folderPath}`);
      loadData();
    } catch (error) {
      console.error('[Library] Lỗi gỡ thư mục:', error);
    }
  };

  // Selection Logic (Single, Multi-select, Shift-click)
  const handleTrackClick = (track: Track, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle in multi-selection
      setSelectedTrackIds((prev) => {
        const next = new Set(prev);
        if (next.has(track.id)) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
      setSelectedTrack(track);
    } else if (e.shiftKey && selectedTrack) {
      // Range selection
      const fromIdx = tracks.findIndex((t) => t.id === selectedTrack.id);
      const toIdx = tracks.findIndex((t) => t.id === track.id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const next = new Set(selectedTrackIds);
        for (let i = start; i <= end; i++) {
          next.add(tracks[i].id);
        }
        setSelectedTrackIds(next);
      }
      setSelectedTrack(track);
    } else {
      // Normal click
      setSelectedTrack(track);
      if (selectedTrackIds.size > 0) {
        setSelectedTrackIds(new Set());
      }
      if (track.is_missing !== 1) {
        audioPlayer.play(track, 0);
      }
    }
  };

  const toggleSelectBox = (trackId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  // Drag & Drop to NLE (Single or Multi-file)
  const handleDragStart = (e: React.DragEvent, track: Track) => {
    if (track.is_missing === 1 || !window.api) return;
    e.preventDefault();
    if (selectedTrackIds.has(track.id) && selectedTrackIds.size > 1) {
      // Multi-file drag
      const paths = tracks.filter((t) => selectedTrackIds.has(t.id)).map((t) => t.path);
      window.api.startDrag(paths);
    } else {
      window.api.startDrag(track.path);
    }
  };

  // Global Drop Import Handlers
  const handleWindowDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleWindowDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingOver(false);
    }
  };

  const handleWindowDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleWindowDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDraggingOver(false);

    if (!window.api) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const paths: string[] = files
      .map((f) => window.api.getPathForFile(f))
      .filter((p) => p && p.length > 0);

    if (paths.length > 0) {
      addToast('info', 'Đang quét file/thư mục thả vào', `Đang xử lý ${paths.length} mục...`);
      try {
        const res = await window.api.importDroppedPaths(paths);
        if (res.imported > 0) {
          addToast('success', 'Nhập thành công', `Đã thêm ${res.imported} clip âm thanh mới.`);
        }
        loadData();
      } catch (err) {
        addToast('error', 'Lỗi nhập dữ liệu', String(err));
      }
    }
  };

  // Bulk operations
  const selectedTracksList = useMemo(
    () => tracks.filter((t) => selectedTrackIds.has(t.id)),
    [tracks, selectedTrackIds]
  );

  const handleBulkAddTag = async (tagName: string) => {
    if (!window.api || selectedTrackIds.size === 0) return;
    const ids = Array.from(selectedTrackIds);
    await window.api.bulkTag(ids, tagName);
    addToast('success', 'Gắn tag hàng loạt', `Đã gắn tag "${tagName}" cho ${ids.length} clip.`);
    loadData();
  };

  const handleBulkDelete = async () => {
    if (!window.api || selectedTrackIds.size === 0) return;
    const ids = Array.from(selectedTrackIds);
    await window.api.bulkDelete(ids);
    addToast('info', 'Đã xóa', `Đã xóa ${ids.length} clip khỏi thư viện.`);
    setSelectedTrackIds(new Set());
    loadData();
  };

  // Toggle favorite on row
  const handleToggleFavoriteRow = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.api) return;
    await window.api.toggleFavorite(track.id);
    loadData();
  };

  // Set rating on row
  const handleRateRow = async (track: Track, rating: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.api) return;
    const nextRating = track.rating === rating ? 0 : rating;
    await window.api.setRating(track.id, nextRating);
    setTracks((prev) =>
      prev.map((t) => (t.id === track.id ? { ...t, rating: nextRating } : t))
    );
    if (selectedTrack?.id === track.id) {
      setSelectedTrack((prev) => (prev ? { ...prev, rating: nextRating } : null));
    }
  };

  // Count favorites
  const favoriteCount = useMemo(() => tracks.filter((t) => t.is_favorite === 1).length, [tracks]);

  return (
    <main
      className="app-shell"
      onDragEnter={handleWindowDragEnter}
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
    >
      {/* Amber Drag Overlay */}
      {isDraggingOver && (
        <div className="drop-overlay-active">
          <UploadCloud size={48} />
          <h2>Thả file hoặc thư mục âm thanh vào đây</h2>
          <p>Tự động nhận diện và trích xuất sóng âm vào thư viện</p>
        </div>
      )}

      {/* 1. LEFT SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Waves size={20} />
          </div>
          <div>
            <strong>SFX Studio</strong>
            <span>Thư viện âm thanh</span>
          </div>
        </div>

        <div className="sidebar-actions-wrap">
          <button className="add-library-btn" onClick={handleAddFiles} title="Chọn từng file âm thanh để thêm">
            <FilePlus size={14} /> + Thêm File
          </button>
          <button className="add-library-btn" onClick={handleAddFolder} title="Chọn thư mục chứa âm thanh để theo dõi">
            <FolderPlus size={14} /> + Thư Mục
          </button>
        </div>

        <nav className="nav-list" aria-label="Điều hướng thư viện">
          <p className="eyebrow">KHÔNG GIAN CỦA BẠN</p>
          <button
            className={`nav-item ${activeSpace === 'all' && !selectedFolder ? 'selected' : ''}`}
            onClick={() => {
              setActiveSpace('all');
              setSelectedFolder(null);
            }}
          >
            <LayoutGrid size={15} />
            <span>Tất cả âm thanh</span>
            <b>{stats.totalSfx + stats.totalMusic}</b>
          </button>

          <button
            className={`nav-item ${activeSpace === 'favorites' ? 'selected' : ''}`}
            onClick={() => {
              setActiveSpace('favorites');
              setSelectedFolder(null);
            }}
          >
            <Heart size={15} />
            <span>Yêu thích</span>
            <b>{favoriteCount}</b>
          </button>

          <button
            className={`nav-item ${activeSpace === 'recent' ? 'selected' : ''}`}
            onClick={() => {
              setActiveSpace('recent');
              setSelectedFolder(null);
            }}
          >
            <History size={15} />
            <span>Gần đây</span>
            <b>{stats.newThisWeek}</b>
          </button>

          {stats.totalMissing > 0 && (
            <button
              className={`nav-item missing-item ${activeSpace === 'missing' ? 'selected' : ''}`}
              onClick={() => {
                setActiveSpace('missing');
                setSelectedFolder(null);
              }}
            >
              <AlertTriangle size={15} />
              <span>File bị thiếu</span>
              <b>{stats.totalMissing}</b>
            </button>
          )}

          <p className="eyebrow folder-label">THƯ MỤC THEO DÕI</p>
          {folders.map((folderPath) => {
            const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;
            const isSelected = selectedFolder === folderPath;
            return (
              <div key={folderPath} className="nav-folder-item">
                <button
                  className={`nav-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedFolder(folderPath);
                    setActiveSpace('all');
                  }}
                  title={folderPath}
                >
                  <FolderOpen size={15} />
                  <span>{folderName}</span>
                  <button
                    className="nav-folder-remove"
                    onClick={(e) => handleRemoveFolder(folderPath, e)}
                    title="Ngừng theo dõi thư mục này"
                  >
                    <Trash2 size={12} />
                  </button>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Storage usage */}
        <div className="sidebar-bottom">
          <div className="storage">
            <div>
              <span>Dung lượng thư viện</span>
              <strong>{formatBytes(storageBytes)}</strong>
            </div>
            <div className="storage-track">
              <i className="storage-bar" style={{ width: `${Math.min(100, (storageBytes / (50 * 1024 * 1024 * 1024)) * 100)}%` }} />
            </div>
          </div>
        </div>
      </aside>

      {/* 2. CENTER WORKSPACE */}
      <section className="workspace">
        <div className="workspace-header">
          {/* Topbar */}
          <header className="topbar">
            <div className="finder-nav">
              <div className="path-control">
                <FolderOpen size={14} />
                <span>
                  {selectedFolder
                    ? selectedFolder.split(/[/\\]/).filter(Boolean).pop()
                    : activeSpace === 'favorites'
                    ? 'Yêu thích'
                    : activeSpace === 'missing'
                    ? 'File bị thiếu'
                    : 'Sound Library'}
                </span>
              </div>
            </div>
            <div className="top-actions">
              <span className="badge-total-items">{tracks.length} mục</span>
            </div>
          </header>

          {/* Search Row */}
          <div className="search-row">
            <div className="search-box">
              <Search size={16} />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm tên file, tag, thể loại (nhấn / để tìm)..."
              />
              <kbd>/</kbd>
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} title="Xóa tìm kiếm">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Content Tabs (Categories) & Sort */}
          <div className="content-tabs">
            <div className="tabs">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`tab-btn ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="newest">Mới nhất</option>
              <option value="duration_desc">Thời lượng dài</option>
              <option value="rating_desc">Đánh giá cao</option>
              <option value="name_asc">Tên (A-Z)</option>
            </select>
          </div>

          {/* Results Heading & View Switcher */}
          <div className="results-heading">
            <div>
              <h2>{searchQuery ? `Kết quả cho “${searchQuery}”` : selectedCategory === 'Tất cả' ? 'Tất cả âm thanh' : selectedCategory}</h2>
              <span>{tracks.length} âm thanh trong thư viện</span>
            </div>
            <div className="view-switcher" aria-label="Chế độ hiển thị">
              <button
                className={viewMode === 'list' ? 'active' : ''}
                onClick={() => setViewMode('list')}
                title="Chế độ danh sách (List Table)"
              >
                <ListFilter size={15} />
              </button>
              <button
                className={viewMode === 'grid' ? 'active' : ''}
                onClick={() => setViewMode('grid')}
                title="Chế độ thẻ (Grid Cards)"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                className={viewMode === 'columns' ? 'active' : ''}
                onClick={() => setViewMode('columns')}
                title="Chế độ cột (Columns Finder)"
              >
                <Columns3 size={15} />
              </button>
              <button
                className={viewMode === 'gallery' ? 'active' : ''}
                onClick={() => setViewMode('gallery')}
                title="Chế độ ảnh lớn (Gallery)"
              >
                <GalleryHorizontalEnd size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Workspace Body / View Render */}
        <div className="workspace-body">
          {/* EMPTY STATE */}
          {tracks.length === 0 && !loading && (
            <div className="empty-state">
              <Waves size={48} style={{ color: 'var(--muted-foreground)', marginBottom: 16 }} />
              <p className="empty-state-title">
                {searchQuery
                  ? `[HỆ THỐNG] Không tìm thấy kết quả cho "${searchQuery}"`
                  : '[HỆ THỐNG] Thư viện âm thanh đang trống'}
              </p>
              <p className="empty-state-body">
                {searchQuery
                  ? 'Thao tác tiếp theo: Xóa bộ lọc hoặc thử từ khóa khác.'
                  : 'Thao tác tiếp theo: Nhấn "Thêm thư mục" ở sidebar để bắt đầu index âm thanh của bạn.'}
              </p>
            </div>
          )}
          {/* VIEW 1: LIST TABLE */}
          {viewMode === 'list' && tracks.length > 0 && (

            <div className="view-list-container">
              <div className="file-table-head">
                <span>CHỌN</span>
                <span>TÊN FILE</span>
                <span>THỂ LOẠI</span>
                <span>SÓNG ÂM</span>
                <span>THỜI LƯỢNG</span>
                <span>ĐÁNH GIÁ</span>
              </div>
              <div className="view-list">
                {tracks.map((track) => {
                  const isSelected = selectedTrack?.id === track.id || selectedTrackIds.has(track.id);
                  const isChecked = selectedTrackIds.has(track.id);
                  const isPlayingThis = playerState.isPlaying && playerState.currentTrack?.id === track.id;
                  const isFav = track.is_favorite === 1;

                  return (
                    <div
                      key={track.id}
                      className={`list-row draggable-clip ${isSelected ? 'selected' : ''} ${track.is_missing === 1 ? 'missing' : ''}`}
                      onClick={(e) => handleTrackClick(track, e)}
                      draggable={track.is_missing !== 1}
                      onDragStart={(e) => handleDragStart(e, track)}
                    >
                      {/* Checkbox */}
                      <div onClick={(e) => toggleSelectBox(track.id, e)} style={{ cursor: 'pointer' }}>
                        {isChecked ? <CheckSquare size={16} color="#d9a55c" /> : <Square size={16} color="#555b66" />}
                      </div>

                      {/* Name & Play button with Favorite Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <button
                          className={`row-play-btn ${isPlayingThis ? 'playing' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTrack(track);
                            audioPlayer.togglePlay(track);
                          }}
                        >
                          {isPlayingThis ? <Pause size={12} /> : <Play size={12} />}
                        </button>
                        <div className="row-title-col">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span className="row-name" title={track.name}>{track.name}</span>
                            <button
                              className={`row-fav-badge ${isFav ? 'liked' : ''}`}
                              onClick={(e) => handleToggleFavoriteRow(track, e)}
                              title={isFav ? 'Bỏ yêu thích' : 'Yêu thích'}
                            >
                              <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                          <span className="row-sub">{track.path.split(/[/\\]/).slice(-2, -1)[0] || 'File lẻ'}</span>
                        </div>
                      </div>

                      {/* Category */}
                      <span className="row-category">{track.category || 'SFX'}</span>

                      {/* Waveform Thumbnail */}
                      <WaveformThumbnail track={track} isPlaying={isPlayingThis} />

                      {/* Duration */}
                      <span className="numeric-value" style={{ fontSize: 11, color: '#c9ced5' }}>
                        {formatDuration(track.duration)}
                      </span>

                      {/* Rating stars: 1 dim star if unrated, filled stars if rated, full 5 stars on hover */}
                      <div className="row-stars" onClick={(e) => e.stopPropagation()}>
                        <div className="stars-display">
                          {track.rating && track.rating > 0 ? (
                            Array.from({ length: track.rating }).map((_, i) => (
                              <Star key={i} size={11} fill="#d9a55c" color="#d9a55c" />
                            ))
                          ) : (
                            <Star size={11} color="#454a52" />
                          )}
                        </div>
                        <div className="stars-interactive">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              className="star-click-btn"
                              onClick={(e) => handleRateRow(track, s, e)}
                              title={`Đánh giá ${s} sao`}
                            >
                              <Star
                                size={11}
                                fill={(track.rating || 0) >= s ? '#d9a55c' : 'none'}
                                color={(track.rating || 0) >= s ? '#d9a55c' : '#454a52'}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW 2: GRID CARDS */}
          {viewMode === 'grid' && tracks.length > 0 && (
            <div className="view-grid">
              {tracks.map((track) => {
                const isSelected = selectedTrack?.id === track.id || selectedTrackIds.has(track.id);
                const isPlayingThis = playerState.isPlaying && playerState.currentTrack?.id === track.id;
                const colors = ['amber', 'blue', 'violet', 'cyan', 'slate'];
                const color = colors[track.id % colors.length];

                return (
                  <article
                    key={track.id}
                    className={`sound-card draggable-clip ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleTrackClick(track, e)}
                    draggable={track.is_missing !== 1}
                    onDragStart={(e) => handleDragStart(e, track)}
                  >
                    <div className={`sound-thumb ${color}`}>
                      <AudioLines size={28} />
                      <button
                        className="card-play"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrack(track);
                          audioPlayer.togglePlay(track);
                        }}
                      >
                        {isPlayingThis ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <span className="duration numeric-value">{formatDuration(track.duration)}</span>
                    </div>
                    <div className="card-copy">
                      <div className="card-title">
                        <h3 title={track.name}>{track.name}</h3>
                      </div>
                      <span className="card-category">{track.category || 'SFX'}</span>
                      <div className="card-wave-wrap">
                        <WaveformThumbnail track={track} isPlaying={isPlayingThis} />
                      </div>
                      <div className="card-meta">
                        <span className="numeric-value">
                          {track.sample_rate ? `${track.sample_rate / 1000}kHz` : 'Audio'}
                        </span>
                        <div className="card-tags">
                          {track.tagList && track.tagList.slice(0, 2).map((t) => <em key={t.id}>{t.name}</em>)}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* VIEW 3: COLUMNS FINDER VIEW */}
          {viewMode === 'columns' && tracks.length > 0 && (
            <div className="view-columns">
              <div className="column-pane">
                <span className="column-kicker">THỂ LOẠI</span>
                <strong>Categories</strong>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className={`column-item-btn ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    <span>{cat}</span>
                  </button>
                ))}
              </div>

              <div className="column-pane">
                <span className="column-kicker">THƯ MỤC</span>
                <strong>Folders</strong>
                <button
                  className={`column-item-btn ${!selectedFolder ? 'active' : ''}`}
                  onClick={() => setSelectedFolder(null)}
                >
                  <span>Tất cả</span>
                </button>
                {folders.map((f) => (
                  <button
                    key={f}
                    className={`column-item-btn ${selectedFolder === f ? 'active' : ''}`}
                    onClick={() => setSelectedFolder(f)}
                    title={f}
                  >
                    <span>{f.split(/[/\\]/).filter(Boolean).pop()}</span>
                  </button>
                ))}
              </div>

              <div className="column-pane">
                <span className="column-kicker">CLIP ÂM THANH</span>
                <strong>{tracks.length} files</strong>
                {tracks.map((track) => (
                  <button
                    key={track.id}
                    className={`column-item-btn ${selectedTrack?.id === track.id ? 'active' : ''}`}
                    onClick={(e) => handleTrackClick(track, e)}
                  >
                    <span>{track.name}</span>
                    <span className="numeric-value">{formatDuration(track.duration)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* VIEW 4: GALLERY VIEW */}
          {viewMode === 'gallery' && tracks.length > 0 && (
            <div className="view-gallery">
              {tracks.map((track) => {
                const isSelected = selectedTrack?.id === track.id || selectedTrackIds.has(track.id);
                const isPlayingThis = playerState.isPlaying && playerState.currentTrack?.id === track.id;

                return (
                  <article
                    key={track.id}
                    className={`gallery-card draggable-clip ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleTrackClick(track, e)}
                    draggable={track.is_missing !== 1}
                    onDragStart={(e) => handleDragStart(e, track)}
                  >
                    <div className="gallery-thumb">
                      <AudioLines size={42} />
                      <button
                        className="card-play"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrack(track);
                          audioPlayer.togglePlay(track);
                        }}
                      >
                        {isPlayingThis ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                    </div>
                    <div className="gallery-info">
                      <h3 className="gallery-title" title={track.name}>{track.name}</h3>
                      <WaveformThumbnail track={track} isPlaying={isPlayingThis} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#777f89' }}>
                        <span>{track.category || 'SFX'}</span>
                        <span className="numeric-value">{formatDuration(track.duration)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Floating Action Bar for Bulk Selection */}
        <FloatingActionBar
          selectedTracks={selectedTracksList}
          onClearSelection={() => setSelectedTrackIds(new Set())}
          onBulkAddTag={handleBulkAddTag}
          onBulkDelete={handleBulkDelete}
        />
      </section>

      {/* 3. RIGHT INSPECTOR / NOW PLAYING PANEL */}
      <NowPlayingPanel
        selectedTrack={selectedTrack}
        onLibraryRefresh={loadData}
        onNextTrack={handleNextTrack}
        onPrevTrack={handlePrevTrack}
        onToast={addToast}
      />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </main>
  );
}
