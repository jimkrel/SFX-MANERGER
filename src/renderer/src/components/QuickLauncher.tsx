import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Play, Pause, X, Music, Volume2, GripVertical, Sparkles } from 'lucide-react';
import { Track } from '../../../preload';
import { audioPlayer, PlayerState } from '../audio/player';
import { getInstantBouncedPath, prewarmBounce } from '../audio/bouncerService';
import { generateDragIconDataUrl } from '../utils/dragIconGenerator';
import { isTrackMusic } from '../utils/audioClassifierUtils';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

export const QuickLauncher: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tracksRef = useRef<Track[]>(tracks);
  tracksRef.current = tracks;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  // Auto-resize window height to fit rendered shell with zero dead space
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !window.api?.setQuickLauncherHeight) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.ceil(entry.contentRect.height);
        if (h > 0) {
          window.api?.setQuickLauncherHeight(h + 20);
        }
      }
    });

    ro.observe(shell);
    return () => ro.disconnect();
  }, []);

  // 1. Subscribe to audio player state
  useEffect(() => {
    const unsubscribe = audioPlayer.subscribe((state) => {
      setPlayerState(state);
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch tracks from SQLite FTS5 index (limit 50 for max speed)
  const fetchTracks = useCallback(async (query: string) => {
    if (!window.api) return;
    setIsLoading(true);
    try {
      const results = await window.api.getTracks({
        searchQuery: query.trim() || undefined,
        onlyAvailable: true,
        limit: 40
      });
      setTracks(results);
      setSelectedIndex(0);
    } catch (err) {
      console.error('[QuickLauncher] Search error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTracks('');
  }, [fetchTracks]);

  // Debounced search on input change
  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextQuery = e.target.value;
    setSearchQuery(nextQuery);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchTracks(nextQuery);
    }, 60);
  };

  // 3. Listen to window show/hide events from Main process
  useEffect(() => {
    if (!window.api) return;

    const cleanupShown = window.api.onQuickLauncherShown(() => {
      console.log('[QuickLauncher Renderer] onQuickLauncherShown received. Scheduling input focus...');
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
          console.log('[QuickLauncher Renderer] searchInput focused! activeElement:', document.activeElement?.className);
        }
      }, 50);
      setSelectedIndex(0);
    });

    const cleanupHidden = window.api.onQuickLauncherHidden(() => {
      console.log('[QuickLauncher Renderer] onQuickLauncherHidden received. Pausing audio.');
      audioPlayer.pause();
    });

    return () => {
      cleanupShown();
      cleanupHidden();
    };
  }, []);

  // 4. Auto scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedItem = listRef.current.querySelector(`.quick-item.active`);
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // 5. Play / Pause preview of track
  const togglePlayTrack = useCallback((track: Track) => {
    if (track.is_missing === 1) return;
    audioPlayer.togglePlay(track);
  }, []);

  // 6. Handle Native Drag out to NLE (Premiere, CapCut, Resolve)
  const handleDragStart = useCallback(
    (e: React.DragEvent, track: Track) => {
      if (!window.api || track.is_missing === 1) return;

      // Stop audio playback immediately when drag starts
      audioPlayer.pause();

      // Calling e.preventDefault() is REQUIRED by Electron:
      // It prevents Chromium from starting an HTML DOM text drag, allowing Electron's
      // native startDrag IPC to launch real OS file dragging (CF_HDROP) into CapCut, Premiere, Resolve.
      e.preventDefault();

      // Generate customized amber drag icon
      const iconDataUrl = generateDragIconDataUrl(track, 1);

      // Instant synchronous drag start: zero delay!
      const dragPath = getInstantBouncedPath(track);
      window.api.startDrag([dragPath], iconDataUrl);

      // Defer hiding Quick Launcher slightly so OS drag drop session has initialized
      setTimeout(() => {
        window.api?.hideQuickLauncher();
      }, 50);
    },
    []
  );

  // 7. Global Keyboard Handlers (using capture phase to guarantee interception)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log(
        `[QuickLauncher Renderer] keydown received: key="${e.key}", code="${e.code}", activeElement=<${document.activeElement?.tagName} class="${document.activeElement?.className}">`
      );

      // Escape: Hide Quick Launcher immediately
      if (e.key === 'Escape' || e.code === 'Escape') {
        console.log('[QuickLauncher Renderer] Esc key pressed -> hiding Quick Launcher');
        e.preventDefault();
        e.stopPropagation();
        audioPlayer.pause();
        if (window.api) window.api.hideQuickLauncher();
        return;
      }

      const currentList = tracksRef.current;
      if (currentList.length === 0) return;

      // Arrow Down
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < currentList.length - 1 ? prev + 1 : 0));
        return;
      }

      // Arrow Up
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : currentList.length - 1));
        return;
      }

      // Enter: Play / Pause selected track
      if (e.key === 'Enter') {
        e.preventDefault();
        const currentTrack = currentList[selectedIndexRef.current];
        if (currentTrack) {
          togglePlayTrack(currentTrack);
        }
        return;
      }

      // Space: Toggle play if not actively modifying search text (or when Alt/Ctrl pressed)
      if (e.code === 'Space' && (e.ctrlKey || e.metaKey || document.activeElement !== searchInputRef.current)) {
        e.preventDefault();
        const currentTrack = currentList[selectedIndexRef.current];
        if (currentTrack) {
          togglePlayTrack(currentTrack);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [togglePlayTrack]);

  const activeTrack = playerState.currentTrack;

  return (
    <div
      className="ql-backdrop"
      onClick={() => window.api?.hideQuickLauncher()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="ql-shell"
        ref={shellRef}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >

        {/* ── Search bar ── */}
        <div className="ql-search">
          <Search size={16} className="ql-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="ql-search-input"
            value={searchQuery}
            onChange={handleQueryChange}
            onFocus={() => console.log('[QuickLauncher Renderer] Search input ON_FOCUS')}
            onBlur={() => console.log('[QuickLauncher Renderer] Search input ON_BLUR')}
            placeholder="Tìm SFX & Music..."
            autoFocus
          />
          {searchQuery ? (
            <button
              className="ql-clear"
              onClick={() => { setSearchQuery(''); fetchTracks(''); searchInputRef.current?.focus(); }}
              title="Xóa nội dung tìm kiếm"
            >
              <X size={13} />
            </button>
          ) : null}
          <button
            className="ql-close-btn"
            onClick={() => { audioPlayer.pause(); window.api?.hideQuickLauncher(); }}
            title="Đóng cửa sổ tìm kiếm (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Results ── */}
        <div className="ql-list" ref={listRef}>
          {tracks.length > 0 ? tracks.map((track, idx) => {
            const isSelected = idx === selectedIndex;
            const isPlayingThis = playerState.isPlaying && activeTrack?.id === track.id;
            const isPausedThis  = !playerState.isPlaying && activeTrack?.id === track.id;
            const isMusic = isTrackMusic(track);
            const folder = track.path.split(/[/\\]/).slice(-2, -1)[0] || '';

            return (
              <div
                key={track.id}
                className={`ql-row${isSelected ? ' ql-row--active' : ''}${isPlayingThis ? ' ql-row--playing' : ''}`}
                onClick={() => { setSelectedIndex(idx); togglePlayTrack(track); }}
                onMouseEnter={() => { setSelectedIndex(idx); prewarmBounce(track); }}
                draggable={track.is_missing !== 1}
                onDragStart={(e) => handleDragStart(e, track)}
              >
                {/* Active left bar */}
                {isSelected && <span className="ql-row-bar" />}

                {/* Play button */}
                <button
                  className={`ql-play${isPlayingThis ? ' ql-play--on' : ''}${isPausedThis ? ' ql-play--paused' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx); togglePlayTrack(track); }}
                >
                  {isPlayingThis ? <Pause size={11} /> : <Play size={11} />}
                </button>

                {/* Name + folder */}
                <div className="ql-info">
                  <span className="ql-name" title={track.name}>{track.name}</span>
                  {folder && <span className="ql-folder">{folder}</span>}
                </div>

                {/* Right meta */}
                <div className="ql-meta">
                  <span className={`ql-badge${isMusic ? ' ql-badge--music' : ' ql-badge--sfx'}`}>
                    {isMusic ? <Music size={9} /> : <Volume2 size={9} />}
                    {isMusic ? 'Music' : 'SFX'}
                  </span>
                  {track.category && track.category !== 'Khác' && (
                    <span className="ql-cat">{track.category}</span>
                  )}
                  <span className="ql-dur">{formatDuration(track.duration)}</span>
                  <GripVertical size={13} className="ql-grip" />
                </div>
              </div>
            );
          }) : (
            <div className="ql-empty">
              {isLoading ? (
                <span>Đang tìm...</span>
              ) : (
                <>
                  <Sparkles size={20} />
                  <span>Không tìm thấy "{searchQuery}"</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="ql-footer">
          <div className="ql-hints">
            <span><kbd>↑↓</kbd> Chọn</span>
            <span><kbd>↵</kbd> Nghe</span>
            <span><kbd className="ql-kbd-drag">Kéo</kbd> vào NLE</span>
            <span><kbd>Esc</kbd> Đóng</span>
          </div>
          <span className="ql-count">{tracks.length} kết quả</span>
        </div>
      </div>
    </div>
  );
};
