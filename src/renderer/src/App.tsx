import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Waves,
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
  AudioLines,
  UploadCloud,
  CheckSquare,
  Square,
  Keyboard,
  Settings,
  ShieldAlert,
  GripVertical,
  Download
} from 'lucide-react';
import { Track, Tag, LibraryStats, SearchFilterOptions, AppInfo } from '../../preload';
import { WaveformThumbnail } from './components/WaveformThumbnail';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { FloatingActionBar } from './components/FloatingActionBar';
import { ToastContainer, ToastMessage, ToastAction } from './components/Toast';
import { ShortcutsModal } from './components/ShortcutsModal';
import { SettingsModal } from './components/SettingsModal';
import { DownloadModal } from './components/DownloadModal';
import { audioPlayer, PlayerState } from './audio/player';
import { isMac, isWindows, setPlatform, subscribePlatform } from './utils/platform';
import { generateDragIconDataUrl } from './utils/dragIconGenerator';
import { getInstantBouncedPaths, prewarmBounce, prewarmBounceMany } from './audio/bouncerService';

function setupCustomDragImage(e: React.DragEvent, title: string, count = 1): void {
  // Log step 2
  window.api?.logDrag?.('[RENDERER STEP 2] setupCustomDragImage called', {
    isMac,
    title,
    count,
    hasDataTransfer: Boolean(e.dataTransfer)
  });
  console.log('[RENDERER STEP 2] setupCustomDragImage', { isMac, title, count });

  // Trên macOS: Không can thiệp setDragImage với toạ độ âm hoặc DOM badge ẩn
  // Trên WebKit/Chromium macOS, setDragImage toạ độ ngoài màn hình sẽ làm hỏng Cocoa NSDraggingSession
  // Electron IPC startDrag trên macOS đã tự truyền nativeImage render icon chuẩn xác và mượt mà.
  if (isMac) {
    window.api?.logDrag?.('[RENDERER STEP 2.1] setupCustomDragImage: returned early for macOS', { isMac });
    return;
  }
  if (!e.dataTransfer) return;
  const badge = document.createElement('div');
  badge.style.position = 'absolute';
  badge.style.top = '-9999px';
  badge.style.left = '-9999px';
  badge.style.padding = '6px 12px';
  badge.style.backgroundColor = '#242220';
  badge.style.border = '1px solid #d9a55c';
  badge.style.borderRadius = '6px';
  badge.style.color = '#E8E3DA';
  badge.style.fontFamily = 'Inter, sans-serif';
  badge.style.fontSize = '12px';
  badge.style.fontWeight = '600';
  badge.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
  badge.style.pointerEvents = 'none';
  badge.style.zIndex = '99999';
  badge.style.whiteSpace = 'nowrap';
  const cleanTitle = title.length > 28 ? title.slice(0, 25) + '...' : title;
  badge.textContent = count > 1 ? `🎵 Kéo ${count} file âm thanh` : `🎵 ${cleanTitle}`;

  document.body.appendChild(badge);
  e.dataTransfer.setDragImage(badge, 15, 15);
  requestAnimationFrame(() => {
    if (badge.parentNode) {
      badge.parentNode.removeChild(badge);
    }
  });
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

import { getTrackDisplayCategory, isTrackMusic } from './utils/audioClassifierUtils';
export { getTrackDisplayCategory, isTrackMusic };

type ViewMode = 'list' | 'grid' | 'columns' | 'gallery';
type SpaceType = 'all' | 'favorites' | 'recent' | 'missing';
type SortOption = 'newest' | 'favorite_desc' | 'duration_desc' | 'rating_desc' | 'name_asc';

const CATEGORIES = ['Tất cả', 'Cinematic', 'Foley', 'Ambience', 'UI / Digital', 'Nature', 'Khác'];

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [, setTags] = useState<Tag[]>([]);
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
  const [audioClassification, setAudioClassification] = useState<'SFX' | 'Music' | null>(null);

  // Selection state
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set());

  // Audio player state
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());

  // Shortcuts, Settings & Downloader Modals state
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState<boolean>(false);

  // Drag & Drop Import Overlay state
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [draggingTrackIds, setDraggingTrackIds] = useState<Set<number>>(new Set());
  const dragCounter = useRef(0);
  const isInternalDragging = useRef(false);

  // Resizable panels
  const [sidebarWidth, setSidebarWidth] = useState<number>(240);
  const [inspectorWidth, setInspectorWidth] = useState<number>(340);
  const resizingRef = useRef<null | 'sidebar' | 'inspector'>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  const handleResizeMouseDown = useCallback((panel: 'sidebar' | 'inspector', e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = panel;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = panel === 'sidebar' ? sidebarWidth : inspectorWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth, inspectorWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      if (resizingRef.current === 'sidebar') {
        const next = Math.max(160, Math.min(400, resizeStartWidthRef.current + delta));
        setSidebarWidth(next);
      } else {
        const next = Math.max(260, Math.min(500, resizeStartWidthRef.current - delta));
        setInspectorWidth(next);
      }
    };
    const onMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTrackRef = useRef<Track | null>(selectedTrack);
  selectedTrackRef.current = selectedTrack;
  const tracksRef = useRef<Track[]>(tracks);
  tracksRef.current = tracks;

  // App info & Admin status (Windows UIPI)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const lastDraggedPathsRef = useRef<string[]>([]);

  // Pre-warm bounce cache when tracks are selected or active
  useEffect(() => {
    if (selectedTrack && selectedTrack.is_missing !== 1) {
      prewarmBounce(selectedTrack);
    }
  }, [selectedTrack]);

  useEffect(() => {
    if (selectedTrackIds.size > 0) {
      const selected = tracks.filter((t) => selectedTrackIds.has(t.id) && t.is_missing !== 1);
      selected.forEach((t) => prewarmBounce(t));
    }
  }, [selectedTrackIds, tracks]);

  // Pre-warm top 20 visible tracks in the background when the list loads/changes.
  // Uses PRIORITY_PREWARM_IDLE so hover and drag always jump the queue.
  useEffect(() => {
    if (tracks.length === 0) return;
    const top20 = tracks.slice(0, 20);
    void prewarmBounceMany(top20, 3);
  }, [tracks]);

  // Master Select All logic
  const isAllSelected = useMemo(() => {
    return tracks.length > 0 && tracks.every((t) => selectedTrackIds.has(t.id));
  }, [tracks, selectedTrackIds]);

  const isSomeSelected = useMemo(() => {
    return selectedTrackIds.size > 0 && !isAllSelected;
  }, [selectedTrackIds.size, isAllSelected]);

  const handleToggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedTrackIds(new Set());
    } else {
      setSelectedTrackIds(new Set(tracks.map((t) => t.id)));
    }
  }, [isAllSelected, tracks]);

  // Toast Helpers with Action Button(s) & Custom Duration
  const addToast = useCallback(
    (
      type: 'success' | 'warning' | 'error' | 'info',
      title: string,
      message: string,
      actionOrActions?: ToastAction | ToastAction[],
      durationMs?: number
    ) => {
      const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
      const actions = Array.isArray(actionOrActions)
        ? actionOrActions
        : actionOrActions
        ? [actionOrActions]
        : undefined;
      setToasts((prev) => [...prev, { id, type, title, message, actions, durationMs }]);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // macOS Accessibility state & dynamic listener
  const [isAccessibilityGranted, setIsAccessibilityGranted] = useState<boolean>(true);

  useEffect(() => {
    if (isMac && window.api) {
      window.api.checkAccessibilityPermission(false).then((granted) => {
        setIsAccessibilityGranted(granted);
      });
      const unsub = window.api.onAccessibilityStatusChanged?.(({ granted }) => {
        setIsAccessibilityGranted(granted);
        if (granted) {
          addToast(
            'success',
            'Đã Cấp Quyền Trợ Năng',
            'Hệ thống đã nhận diện quyền Trợ Năng (Accessibility) thành công! Phím tắt toàn cục đã sẵn sàng.'
          );
        }
      });
      return () => {
        if (unsub) unsub();
      };
    }
  }, [isMac, addToast]);

  // 1. Subscribe to Player State
  useEffect(() => {
    const unsubscribe = audioPlayer.subscribe((state) => {
      setPlayerState(state);
    });
    const unsubError = audioPlayer.onError((err) => {
      addToast('error', 'Không thể phát file', err.message);
    });
    return () => {
      unsubscribe();
      unsubError();
    };
  }, [addToast]);

  // 2. Load Library Data
  const loadRequest = useRef(0);
  const loadData = useCallback(async () => {
    const request = ++loadRequest.current;
    if (!window.api) return;
    try {
      const filterOptions: SearchFilterOptions = {
        searchQuery: searchQuery.trim() || undefined,
        folderPath: selectedFolder || undefined,
        category: selectedCategory !== 'Tất cả' ? selectedCategory : undefined,
        favoriteOnly: activeSpace === 'favorites' ? true : undefined,
        onlyAvailable: activeSpace === 'missing' ? false : undefined,
        sortBy: sortBy,
        // Skip audioClassification when viewing missing/favorites spaces to avoid empty results
        audioClassification: (activeSpace === 'all' && audioClassification) ? audioClassification : undefined
      };

      const [trackList, folderList, tagList, libStats, storageInfo] = await Promise.all([
        window.api.getTracks(filterOptions),
        window.api.getWatchedFolders(),
        window.api.getAllTags(),
        window.api.getLibraryStats(),
        window.api.getStorageStats ? window.api.getStorageStats() : Promise.resolve({ totalBytes: 0, totalFiles: 0 })
      ]);

      if (request !== loadRequest.current) return;
      audioPlayer.refreshTracks(trackList);

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
      if (request === loadRequest.current) setLoading(false);
    }
  }, [searchQuery, selectedFolder, selectedCategory, activeSpace, sortBy, audioClassification]);


  useEffect(() => {
    loadData();
  }, [loadData]);

  // IPC listener for background changes
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
      // Toggle Shortcuts Modal on '?' or F1
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
        return;
      }

      // Escape: close modals, clear search or clear multi-selection
      if (e.key === 'Escape') {
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
          return;
        }
        if (showSettingsModal) {
          setShowSettingsModal(false);
          return;
        }
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

      // Ctrl/Cmd + A: Select All tracks in current view
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedTrackIds(new Set(tracksRef.current.map((t) => t.id)));
        return;
      }

      // Ctrl/Cmd + D: Open Online Downloader Modal
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setIsDownloadModalOpen(true);
        return;
      }

      // 1, 2, 3, 4: Quick switch view modes
      if (e.key === '1') {
        e.preventDefault();
        setViewMode('list');
        return;
      } else if (e.key === '2') {
        e.preventDefault();
        setViewMode('grid');
        return;
      } else if (e.key === '3') {
        e.preventDefault();
        setViewMode('columns');
        return;
      } else if (e.key === '4') {
        e.preventDefault();
        setViewMode('gallery');
        return;
      }

      // L: Toggle Loop
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        audioPlayer.toggleLoop();
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
        setTimeout(() => {
          const el = document.querySelector('.list-row.selected, .sound-card.selected, .gallery-card.selected, .column-item-btn.active');
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 40);
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
        setTimeout(() => {
          const el = document.querySelector('.list-row.selected, .sound-card.selected, .gallery-card.selected, .column-item-btn.active');
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 40);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playerState.isPlaying, selectedTrackIds.size, searchQuery, showShortcutsModal, showSettingsModal, isDownloadModalOpen]);

  // Global listener to ensure drag state resets and show Explorer fallback toast (Windows only)
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      window.api?.logDrag?.('[RENDERER STEP 7] handleGlobalDragEnd fired', {
        isWindows,
        lastDraggedPaths: lastDraggedPathsRef.current
      });
      isInternalDragging.current = false;
      dragCounter.current = 0;
      setIsDraggingOver(false);
      setDraggingTrackIds(new Set());
      lastDraggedPathsRef.current = [];
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    const unsubscribeDragEnded = window.api?.onDragEnded
      ? window.api.onDragEnded(handleGlobalDragEnd)
      : undefined;

    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      if (unsubscribeDragEnded) unsubscribeDragEnded();
    };
  }, [addToast]);

  const [, forceUpdatePlatform] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribePlatform(() => forceUpdatePlatform((n) => n + 1));
    return unsubscribe;
  }, []);

  // Check Admin Elevation on Startup (Windows UIPI notice)
  useEffect(() => {
    if (!window.api) return;
    window.api.getAppInfo().then((info) => {
      setAppInfo(info);
      setPlatform(info.platform);
    });
  }, []);


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
    setTimeout(() => {
      const el = document.querySelector('.list-row.selected, .sound-card.selected, .gallery-card.selected, .column-item-btn.active');
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 40);
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
    setTimeout(() => {
      const el = document.querySelector('.list-row.selected, .sound-card.selected, .gallery-card.selected, .column-item-btn.active');
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 40);
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
        if (next.size === 0 && selectedTrack && selectedTrack.id !== track.id) {
          next.add(selectedTrack.id);
        }
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
      const isSameTrack = selectedTrack?.id === track.id;
      setSelectedTrack(track);
      if (selectedTrackIds.size > 0) {
        setSelectedTrackIds(new Set());
      }
      if (track.is_missing !== 1 && (!isSameTrack || !playerState.isPlaying)) {
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
    window.api?.logDrag?.('[RENDERER STEP 1] handleDragStart entered', {
      trackId: track.id,
      trackName: track.name,
      trackPath: track.path,
      isMissing: track.is_missing,
      hasApi: Boolean(window.api)
    });
    console.log('[RENDERER STEP 1] handleDragStart entered', track.name, track.path);

    if (track.is_missing === 1 || !window.api) {
      window.api?.logDrag?.('[RENDERER STEP 1.1] ABORTED: track is missing or window.api missing', {
        isMissing: track.is_missing,
        hasApi: Boolean(window.api)
      });
      return;
    }
    isInternalDragging.current = true;
    setIsDraggingOver(false);
    dragCounter.current = 0;

    const isMulti = selectedTrackIds.has(track.id) && selectedTrackIds.size > 1;
    const paths = isMulti
      ? tracks.filter((t) => selectedTrackIds.has(t.id) && t.is_missing !== 1).map((t) => t.path)
      : [track.path];

    if (isMulti) {
      setDraggingTrackIds(new Set(selectedTrackIds));
    } else {
      setDraggingTrackIds(new Set([track.id]));
    }

    lastDraggedPathsRef.current = paths;

    window.api?.logDrag?.('[RENDERER STEP 1.2] Computed paths for drag', {
      pathsCount: paths.length,
      paths,
      isMulti
    });

    // Requirement 3: Ensure HTML5 drag fallback uses a compact audio badge instead of capturing entire row DOM
    setupCustomDragImage(e, track.name, paths.length);

    // Personalized drag icon with music note + mini waveform / multi-file count
    const iconDataUrl = generateDragIconDataUrl(track, paths.length);

    // Calling e.preventDefault() is REQUIRED by Electron:
    // It prevents Chromium from starting an HTML DOM text drag, allowing Electron's
    // native startDrag IPC to launch real OS file dragging (CF_HDROP) into CapCut, Premiere, Resolve.
    e.preventDefault();

    const targetTracks = isMulti
      ? tracks.filter((t) => selectedTrackIds.has(t.id) && t.is_missing !== 1)
      : [track];

    // INSTANT DRAG: Zero async latency. Calls OS startDrag on the exact same frame of mouse movement!
    const dragPaths = getInstantBouncedPaths(targetTracks);
    window.api?.logDrag?.('[RENDERER STEP 1.3] Calling window.api.startDrag INSTANTLY', {
      payload: dragPaths.length === 1 ? dragPaths[0] : dragPaths,
      hasIconDataUrl: Boolean(iconDataUrl)
    });
    window.api.startDrag(dragPaths.length === 1 ? dragPaths[0] : dragPaths, iconDataUrl);
  };

  const handleDragEnd = () => {
    isInternalDragging.current = false;
    dragCounter.current = 0;
    setIsDraggingOver(false);
    setDraggingTrackIds(new Set());
  };

  // Global Drop Import Handlers (from File Explorer / Finder)
  const handleWindowDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInternalDragging.current) return;
    dragCounter.current += 1;
    const hasFiles = e.dataTransfer.types && (e.dataTransfer.types.includes('Files') || e.dataTransfer.items?.length > 0);
    if (hasFiles) {
      setIsDraggingOver(true);
    }
  };

  const handleWindowDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInternalDragging.current) return;
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingOver(false);
    }
  };

  const handleWindowDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInternalDragging.current) return;
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleWindowDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isInternalDragging.current = false;
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
        } else if (res.errors && res.errors.length > 0) {
          addToast('error', 'Không thể nhập file', res.errors[0]);
        } else {
          addToast('info', 'Thông báo', 'Các file thả vào đã có sẵn trong thư viện.');
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

  // Count favorites
  const favoriteCount = useMemo(() => tracks.filter((t) => t.is_favorite === 1).length, [tracks]);

  return (
    <main
      className={`app-shell ${isMac ? 'is-mac' : 'is-windows'}`}
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px minmax(0,1fr) 4px ${inspectorWidth}px` }}
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
            <Waves size={17} />
          </div>
          <div>
            <strong>SFX Studio</strong>
            <span>Thư viện âm thanh</span>
          </div>
        </div>

        <div className="sidebar-actions-wrap">
          <div className="sidebar-actions-row">
            <button className="add-library-btn" onClick={handleAddFiles} title="Chọn từng file âm thanh để thêm">
              <FilePlus size={13} />
              <span>Thêm file</span>
            </button>
            <button className="add-library-btn" onClick={handleAddFolder} title="Chọn thư mục chứa âm thanh để theo dõi">
              <FolderPlus size={13} />
              <span>Thư mục</span>
            </button>
          </div>
          <button
            className="download-online-btn"
            onClick={() => setIsDownloadModalOpen(true)}
            title={`Tải âm thanh từ YouTube, TikTok, Shorts, SoundCloud (${isMac ? 'Cmd+D' : 'Ctrl+D'})`}
          >
            <div className="download-online-left">
              <Download size={13} />
              <span>Tải từ link online</span>
            </div>
            <kbd className="sidebar-kbd">{isMac ? '⌘D' : 'Ctrl+D'}</kbd>
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

          <p className="eyebrow folder-label">PHÂN LOẠI ÂM THANH</p>
          <button
            className={`nav-item ${audioClassification === 'SFX' ? 'selected' : ''}`}
            onClick={() => {
              setAudioClassification(audioClassification === 'SFX' ? null : 'SFX');
              setSelectedFolder(null);
              setActiveSpace('all');
            }}
          >
            <AudioLines size={15} />
            <span>SFX</span>
            <b>{stats.totalSfx}</b>
          </button>
          <button
            className={`nav-item ${audioClassification === 'Music' ? 'selected' : ''}`}
            onClick={() => {
              setAudioClassification(audioClassification === 'Music' ? null : 'Music');
              setSelectedFolder(null);
              setActiveSpace('all');
            }}
          >
            <Waves size={15} />
            <span>Nhạc nền</span>
            <b>{stats.totalMusic}</b>
          </button>

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
                    setAudioClassification(null);
                  }}
                  title={folderPath}
                >
                  <FolderOpen size={15} />
                  <span>{folderName}</span>
                </button>
                <button
                  className="nav-folder-remove"
                  onClick={(e) => handleRemoveFolder(folderPath, e)}
                  title="Ngừng theo dõi thư mục này"
                >
                  <Trash2 size={12} />
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

      {/* Resize handle: Sidebar ↔ Workspace */}
      <div
        className="resize-handle resize-handle-sidebar"
        onMouseDown={(e) => handleResizeMouseDown('sidebar', e)}
        title="Kéo để điều chỉnh độ rộng sidebar"
      />

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
              {isWindows && (
                <span
                  className={`badge-elevation-status ${appInfo?.isElevated ? 'elevated' : 'standard'}`}
                  title={
                    appInfo?.isElevated
                      ? 'SFX Manager đang chạy quyền Administrator (Toàn quyền kéo thả mọi app)'
                      : 'SFX Manager đang chạy quyền User thường. Nếu CapCut/Premiere chạy Admin, bạn có thể chạy SFX Manager bằng Run as Administrator để khớp cấp quyền.'
                  }
                  onClick={() => setShowShortcutsModal(true)}
                  style={{ cursor: 'pointer' }}
                >
                  {appInfo?.isElevated ? '⚡ Admin' : '🛡️ Quyền Thường'}
                </span>
              )}
              {isMac && !isAccessibilityGranted && (
                <span
                  className="badge-elevation-status standard"
                  title="SFX Manager chưa được cấp quyền Trợ Năng (Accessibility). Phím tắt toàn cục không thể kích hoạt khi bạn ở CapCut/Premiere. Bấm vào đây để mở Cài Đặt và cấp quyền."
                  onClick={() => {
                    if (window.api) window.api.openAccessibilitySettings();
                  }}
                  style={{
                    cursor: 'pointer',
                    background: 'rgba(201, 151, 78, 0.15)',
                    border: '1px solid rgba(201, 151, 78, 0.4)',
                    color: '#f3c78a'
                  }}
                >
                  <ShieldAlert size={12} />
                  <span>Cấp Quyền Trợ Năng</span>
                </span>
              )}
              <button
                className="btn-shortcuts"
                onClick={() => setShowShortcutsModal(true)}
                title="Bảng phím tắt thao tác DAW (?)"
              >
                <Keyboard size={13} />
                <span>Phím tắt (?)</span>
              </button>
              <button
                className="btn-settings"
                onClick={() => setShowSettingsModal(true)}
                title="Cài đặt định dạng âm thanh & kéo thả Broadcast WAV"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                  borderRadius: '6px',
                  color: 'var(--text-secondary, #94a3b8)',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Settings size={13} />
                <span>Cài đặt</span>
              </button>
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
              <option value="favorite_desc">Yêu thích trước</option>
              <option value="duration_desc">Thời lượng dài</option>
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
                <div
                  className="header-select-all"
                  onClick={handleToggleSelectAll}
                  title={isAllSelected ? 'Bỏ chọn tất cả (Esc)' : 'Chọn tất cả (Ctrl+A)'}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  {isAllSelected ? (
                    <CheckSquare size={16} color="#d9a55c" />
                  ) : isSomeSelected ? (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <Square size={16} color="#d9a55c" />
                      <div
                        style={{
                          position: 'absolute',
                          left: 4,
                          top: 7,
                          width: 8,
                          height: 2,
                          backgroundColor: '#d9a55c',
                          borderRadius: 1
                        }}
                      />
                    </div>
                  ) : (
                    <Square size={16} color="#555b66" />
                  )}
                </div>
                <span style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }} title="Yêu thích">
                  <Heart size={13} color="#8a929e" />
                </span>
                <span>TÊN FILE</span>
                <span>THỂ LOẠI</span>
                <span>SÓNG ÂM</span>
                <span style={{ textAlign: 'right' }}>THỜI LƯỢNG</span>
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
                      className={`list-row sound-row draggable-clip ${isSelected ? 'selected' : ''} ${draggingTrackIds.has(track.id) ? 'row-dragging' : ''} ${track.is_missing === 1 ? 'missing' : ''}`}
                      onClick={(e) => handleTrackClick(track, e)}
                      onMouseEnter={() => prewarmBounce(track)}
                      draggable={track.is_missing !== 1}
                      onDragStart={(e) => handleDragStart(e, track)}
                      onDragEnd={handleDragEnd}
                    >
                      {/* Checkbox */}
                      <div
                        className="row-checkbox-wrap"
                        onClick={(e) => toggleSelectBox(track.id, e)}
                        style={{ cursor: 'pointer' }}
                      >
                        {isChecked ? <CheckSquare size={16} color="#d9a55c" /> : <Square size={16} color="#555b66" />}
                        {draggingTrackIds.has(track.id) && (
                          <GripVertical size={13} className="drag-handle-icon" />
                        )}
                      </div>

                      {/* Dedicated Favorite Column (Replaces Rating) */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <button
                          className={`row-fav-btn ${isFav ? 'liked' : ''}`}
                          onClick={(e) => handleToggleFavoriteRow(track, e)}
                          title={isFav ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}
                        >
                          <Heart size={14} fill={isFav ? '#e58c83' : 'none'} color={isFav ? '#e58c83' : '#6b7280'} />
                        </button>
                      </div>

                      {/* Name & Play button */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, width: '100%', overflow: 'hidden' }}>
                        <button
                          className={`row-play-btn ${isPlayingThis ? 'playing' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTrack(track);
                            audioPlayer.togglePlay(track);
                          }}
                        >
                          {isPlayingThis ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                        <div className="row-title-col">
                          <span className="row-name" title={track.name}>{track.name}</span>
                          <span className="row-sub">{track.path.split(/[/\\]/).slice(-2, -1)[0] || 'File lẻ'}</span>
                        </div>
                      </div>

                      {/* Category */}
                      {(() => {
                        const catInfo = getTrackDisplayCategory(track);
                        return (
                          <span className={`row-category col-category ${catInfo.isMusic ? 'is-music-badge' : ''}`}>
                            {catInfo.label}
                          </span>
                        );
                      })()}

                      {/* Waveform Thumbnail */}
                      <div className="col-wave">
                        <WaveformThumbnail
                          key={`${track.id}:${track.content_version ?? 0}`}
                          track={track}
                          isPlaying={isPlayingThis}
                          width={105}
                          height={24}
                          onSelectTrack={setSelectedTrack}
                        />
                      </div>

                      {/* Duration */}
                      <span className="numeric-value col-duration">
                        {formatDuration(track.duration)}
                      </span>
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
                    className={`sound-card draggable-clip ${isSelected ? 'selected' : ''} ${draggingTrackIds.has(track.id) ? 'row-dragging' : ''}`}
                    onClick={(e) => handleTrackClick(track, e)}
                    onMouseEnter={() => prewarmBounce(track)}
                    draggable={track.is_missing !== 1}
                    onDragStart={(e) => handleDragStart(e, track)}
                    onDragEnd={handleDragEnd}
                  >
                    {draggingTrackIds.has(track.id) && (
                      <GripVertical size={14} className="drag-handle-icon card-drag-icon" />
                    )}
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
                        <button
                          className={`card-fav-btn ${track.is_favorite === 1 ? 'liked' : ''}`}
                          onClick={(e) => handleToggleFavoriteRow(track, e)}
                          title={track.is_favorite === 1 ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}
                        >
                          <Heart size={13} fill={track.is_favorite === 1 ? '#e58c83' : 'none'} color={track.is_favorite === 1 ? '#e58c83' : '#6b7280'} />
                        </button>
                      </div>
                      {(() => {
                        const catInfo = getTrackDisplayCategory(track);
                        return (
                          <span className={`card-category ${catInfo.isMusic ? 'is-music-badge' : ''}`}>
                            {catInfo.label}
                          </span>
                        );
                      })()}
                      <div className="card-wave-wrap">
                        <WaveformThumbnail
                          key={`${track.id}:${track.content_version ?? 0}`}
                          track={track}
                          isPlaying={isPlayingThis}
                          width={150}
                          height={28}
                          onSelectTrack={setSelectedTrack}
                        />
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
                    className={`column-item-btn sound-row draggable-clip ${selectedTrack?.id === track.id ? 'active' : ''} ${draggingTrackIds.has(track.id) ? 'row-dragging' : ''} ${track.is_missing === 1 ? 'missing' : ''}`}
                    onClick={(e) => handleTrackClick(track, e)}
                    onMouseEnter={() => prewarmBounce(track)}
                    draggable={track.is_missing !== 1}
                    onDragStart={(e) => handleDragStart(e, track)}
                    onDragEnd={handleDragEnd}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {draggingTrackIds.has(track.id) && (
                        <GripVertical size={12} className="drag-handle-icon" />
                      )}
                      <span>{track.name}</span>
                    </span>
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
                    className={`gallery-card sound-card draggable-clip ${isSelected ? 'selected' : ''} ${draggingTrackIds.has(track.id) ? 'row-dragging' : ''} ${track.is_missing === 1 ? 'missing' : ''}`}
                    onClick={(e) => handleTrackClick(track, e)}
                    onMouseEnter={() => prewarmBounce(track)}
                    draggable={track.is_missing !== 1}
                    onDragStart={(e) => handleDragStart(e, track)}
                    onDragEnd={handleDragEnd}
                  >
                    {draggingTrackIds.has(track.id) && (
                      <GripVertical size={14} className="drag-handle-icon card-drag-icon" />
                    )}
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
                      <div className="gallery-header-row">
                        <h3 className="gallery-title" title={track.name}>{track.name}</h3>
                        <button
                          className={`card-fav-btn ${track.is_favorite === 1 ? 'liked' : ''}`}
                          onClick={(e) => handleToggleFavoriteRow(track, e)}
                          title={track.is_favorite === 1 ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}
                        >
                          <Heart size={13} fill={track.is_favorite === 1 ? '#e58c83' : 'none'} color={track.is_favorite === 1 ? '#e58c83' : '#6b7280'} />
                        </button>
                      </div>
                      <WaveformThumbnail
                        key={`${track.id}:${track.content_version ?? 0}`}
                        track={track}
                        isPlaying={isPlayingThis}
                        width={200}
                        height={32}
                        onSelectTrack={setSelectedTrack}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#777f89' }}>
                        {(() => {
                          const catInfo = getTrackDisplayCategory(track);
                          return (
                            <span className={catInfo.isMusic ? 'is-music-badge' : ''}>
                              {catInfo.label}
                            </span>
                          );
                        })()}
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
          onRevealInExplorer={(filePath) => {
            if (window.api) window.api.showInFolder(filePath);
          }}
          onStartDrag={(e, paths) => {
            isInternalDragging.current = true;
            setIsDraggingOver(false);
            dragCounter.current = 0;
            lastDraggedPathsRef.current = paths;
            setDraggingTrackIds(new Set(selectedTrackIds));
            setupCustomDragImage(e, `${paths.length} file âm thanh`, paths.length);
            e.preventDefault();
            if (window.api && paths.length > 0) {
              const iconDataUrl = generateDragIconDataUrl(undefined, paths.length);
              const targetTracks = tracks.filter((t) => selectedTrackIds.has(t.id) && t.is_missing !== 1);
              const dragPaths = getInstantBouncedPaths(targetTracks);
              window.api.startDrag(dragPaths, iconDataUrl);
            }
          }}
        />
      </section>

      {/* Resize handle: Workspace ↔ Inspector */}
      <div
        className="resize-handle resize-handle-inspector"
        onMouseDown={(e) => handleResizeMouseDown('inspector', e)}
        title="Kéo để điều chỉnh độ rộng inspector"
      />

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

      {/* DAW Shortcuts Modal */}
      <ShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />

      {/* Audio & Drag Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        appInfo={appInfo}
        onToast={addToast}
      />

      {/* Online Audio Downloader Modal */}
      <DownloadModal
        isOpen={isDownloadModalOpen}
        onClose={() => setIsDownloadModalOpen(false)}
        onToast={addToast}
      />
    </main>
  );
}
