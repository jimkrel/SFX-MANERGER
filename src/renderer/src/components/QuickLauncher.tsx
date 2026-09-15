import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Play, Pause, X, Music, Volume2, GripVertical, Sparkles } from 'lucide-react';
import { Track } from '../../../preload';
import { audioPlayer, PlayerState } from '../audio/player';
import { getOrPrepareBouncedPath } from '../audio/bouncerService';
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
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tracksRef = useRef<Track[]>(tracks);
  tracksRef.current = tracks;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

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
    async (_e: React.DragEvent, track: Track) => {
      if (!window.api || track.is_missing === 1) return;

      // Stop audio playback immediately when drag starts
      audioPlayer.pause();

      // Generate customized amber drag icon
      const iconDataUrl = generateDragIconDataUrl(track, 1);

      // Hide Quick Launcher immediately so it doesn't obstruct target NLE timeline
      window.api.hideQuickLauncher();

      // On-the-fly bounce or raw file path
      getOrPrepareBouncedPath(track)
        .then((bouncedPath) => {
          window.api.startDrag([bouncedPath], iconDataUrl);
        })
        .catch(() => {
          window.api.startDrag([track.path], iconDataUrl);
        });
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

  return (
    <div className="quick-launcher-backdrop" onClick={() => window.api?.hideQuickLauncher()}>
      <div className="quick-launcher-shell" onClick={(e) => e.stopPropagation()}>
        {/* Header Search Bar */}
        <div className="quick-search-bar">
          <Search size={18} className="quick-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="quick-search-input"
            value={searchQuery}
            onChange={handleQueryChange}
            onFocus={() => console.log('[QuickLauncher Renderer] Search input ON_FOCUS')}
            onBlur={() => console.log('[QuickLauncher Renderer] Search input ON_BLUR')}
            placeholder="Tìm nhanh SFX & Music (tên, tag, thể loại)..."
            autoFocus
          />
          {searchQuery ? (
            <button
              className="quick-clear-btn"
              onClick={() => {
                setSearchQuery('');
                fetchTracks('');
                searchInputRef.current?.focus();
              }}
              title="Xóa tìm kiếm"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="quick-search-kbd">Esc để đóng</kbd>
          )}
        </div>

        {/* Results List */}
        <div className="quick-results-list" ref={listRef}>
          {tracks.length > 0 ? (
            tracks.map((track, idx) => {
              const isSelected = idx === selectedIndex;
              const isPlayingThis = playerState.isPlaying && playerState.currentTrack?.id === track.id;
              const isMusic = isTrackMusic(track);

              return (
                <div
                  key={track.id}
                  className={`quick-item ${isSelected ? 'active' : ''} ${isPlayingThis ? 'playing' : ''}`}
                  onClick={() => {
                    setSelectedIndex(idx);
                    togglePlayTrack(track);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  draggable={track.is_missing !== 1}
                  onDragStart={(e) => handleDragStart(e, track)}
                  title="Nhấn Enter để nghe thử · Kéo thả trực tiếp vào timeline Premiere / CapCut"
                >
                  {/* Play/Pause Button */}
                  <button
                    className={`quick-play-btn ${isPlayingThis ? 'playing' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIndex(idx);
                      togglePlayTrack(track);
                    }}
                  >
                    {isPlayingThis ? <Pause size={12} /> : <Play size={12} />}
                  </button>

                  {/* Track Info */}
                  <div className="quick-item-info">
                    <span className="quick-item-name" title={track.name}>
                      {track.name}
                    </span>
                    <span className="quick-item-folder">
                      {track.path.split(/[/\\]/).slice(-2, -1)[0] || 'Clip lẻ'}
                    </span>
                  </div>

                  {/* Badges & Meta */}
                  <div className="quick-item-meta">
                    <span className={`quick-type-pill ${isMusic ? 'music' : 'sfx'}`}>
                      {isMusic ? <Music size={10} /> : <Volume2 size={10} />}
                      <span>{isMusic ? 'Music' : 'SFX'}</span>
                    </span>

                    {track.category && track.category !== 'Khác' && (
                      <span className="quick-category-pill">{track.category}</span>
                    )}

                    <span className="quick-duration">{formatDuration(track.duration)}</span>

                    {/* Drag Grip Handle */}
                    <div className="quick-drag-handle" title="Kéo vào NLE">
                      <GripVertical size={14} />
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="quick-empty-state">
              {isLoading ? (
                <span>Đang tìm kiếm trong thư viện...</span>
              ) : (
                <>
                  <Sparkles size={24} className="text-accent" />
                  <span>Không tìm thấy file âm thanh phù hợp với “{searchQuery}”</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div className="quick-footer">
          <div className="quick-hints">
            <span className="quick-hint-item">
              <kbd>↑</kbd>
              <kbd>↓</kbd> Chọn
            </span>
            <span className="quick-hint-item">
              <kbd>↵</kbd> Nghe thử
            </span>
            <span className="quick-hint-item">
              <kbd className="kbd-drag">Kéo chuột</kbd> Thả vào NLE
            </span>
            <span className="quick-hint-item">
              <kbd>Esc</kbd> Đóng
            </span>
          </div>
          <div className="quick-stats">
            <span>{tracks.length} kết quả</span>
          </div>
        </div>
      </div>
    </div>
  );
};
