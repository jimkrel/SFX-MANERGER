import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track, Tag, LibraryStats, SearchFilterOptions } from '../../preload';
import { WaveformThumbnail } from './components/WaveformThumbnail';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { StatBar } from './components/StatBar';
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

  // 2. Load library data with filters
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
        // Keep updated track metadata
        const updated = trackList.find((t) => t.id === selectedTrackRef.current?.id);
        if (updated) setSelectedTrack(updated);
      }
    } catch (error) {
      console.error('Error loading library data:', error);
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

  // 3. Global Keyboard Shortcuts (Space = preview/pause, Up/Down = browse, "/" = focus search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputActive = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      // "/" = Focus Search (Spotlight style)
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
        loadData();
      }
    } catch (error) {
      console.error('Error adding folder:', error);
    }
  };

  const handleRemoveFolder = async (folderPath: string) => {
    if (!window.api) return;
    try {
      await window.api.removeWatchedFolder(folderPath);
      if (selectedFolder === folderPath) {
        setSelectedFolder(null);
      }
      loadData();
    } catch (error) {
      console.error('Error removing folder:', error);
    }
  };

  const handleRescan = async () => {
    if (!window.api) return;
    try {
      const res = await window.api.rescanLibrary();
      setRescanInfo(`Đã kiểm tra ${res.checked} file: ${res.missing} missing, ${res.recovered} phục hồi`);
      setTimeout(() => setRescanInfo(null), 4000);
      loadData();
    } catch (error) {
      console.error('Error rescanning:', error);
    }
  };

  const handleTrackClick = (track: Track) => {
    setSelectedTrack(track);
    if (track.is_missing !== 1) {
      audioPlayer.play(track, 0);
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--bg-main)',
        color: 'var(--text-main)',
        padding: '14px 20px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)'
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '12px',
          marginBottom: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent)'
            }}
          />
          <h1 style={{ fontSize: '17px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            SFX / Music Manager
          </h1>
          <span
            className="mono"
            style={{
              fontSize: '11px',
              color: 'var(--accent)',
              backgroundColor: 'rgba(201, 151, 78, 0.12)',
              padding: '2px 8px',
              borderRadius: '4px'
            }}
          >
            Phase 4: Tag & Search
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {rescanInfo && (
            <span style={{ fontSize: '12px', color: 'var(--accent)' }} className="mono">
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
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px'
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
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px'
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
          gap: '14px',
          flex: 1,
          minHeight: 0
        }}
      >
        {/* Column 1: Sidebar Tags & Folders */}
        <aside
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                onClick={() => setSelectedFolder(null)}
                style={{
                  padding: '6px 8px',
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
                      padding: '6px 8px',
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

              {/* AND / OR Switcher */}
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
                    padding: '2px 6px',
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
                    padding: '2px 6px',
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {tags.map((tag) => {
                  const isChecked = selectedTagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 8px',
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

        {/* Column 2: Grid Clip & Full-Text Search */}
        <section
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
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
                placeholder="Tìm kiếm theo tên file, tag (nhấn / để focus)..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: '#161514',
                  border: '1px solid rgba(232, 227, 218, 0.15)',
                  borderRadius: '6px',
                  color: 'var(--text-main)',
                  padding: '7px 32px 7px 10px',
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
                  borderRadius: '6px',
                  padding: '6px 10px',
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
              <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.5)' }}>
                Đang tìm kiếm dữ liệu...
              </div>
            ) : tracks.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.45)', fontSize: '13px' }}>
                Không tìm thấy clip nào phù hợp với điều kiện tìm kiếm.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'rgba(232, 227, 218, 0.45)', fontSize: '10px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '8px 12px', width: '24px' }}></th>
                    <th style={{ padding: '8px 12px' }}>Tên Clip</th>
                    <th style={{ padding: '8px 12px', width: '115px' }}>Waveform</th>
                    <th style={{ padding: '8px 12px', width: '65px' }}>Độ Dài</th>
                    <th style={{ padding: '8px 12px', width: '140px' }}>Tags</th>
                    <th style={{ padding: '8px 12px', width: '65px' }}>Status</th>
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
                        style={{
                          borderBottom: '1px solid rgba(232, 227, 218, 0.04)',
                          backgroundColor: isSelected ? 'rgba(201, 151, 78, 0.12)' : 'transparent',
                          cursor: isMissing ? 'not-allowed' : 'pointer',
                          opacity: isMissing ? 0.4 : 1
                        }}
                      >
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {isCurrentPlaying ? (
                            <span style={{ color: 'var(--accent)', fontSize: '12px' }}>▶</span>
                          ) : (
                            <span style={{ color: 'rgba(232, 227, 218, 0.2)', fontSize: '10px' }}>●</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: isSelected ? 600 : 500, color: isSelected ? 'var(--accent)' : 'inherit' }}>
                              {track.name}
                            </span>
                            <span className="mono" style={{ fontSize: '9px', color: 'rgba(232, 227, 218, 0.3)' }}>
                              {track.path.split('/').pop()}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <WaveformThumbnail
                            track={track}
                            isPlaying={isCurrentPlaying}
                            isSelected={isSelected}
                            width={105}
                            height={24}
                          />
                        </td>
                        <td className="mono" style={{ padding: '8px 12px', color: 'var(--text-main)' }}>
                          {formatDuration(track.duration)}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {track.tagList && track.tagList.length > 0 ? (
                              track.tagList.slice(0, 3).map((t) => (
                                <span
                                  key={t.id}
                                  style={{
                                    fontSize: '9px',
                                    color: 'var(--accent)',
                                    backgroundColor: 'rgba(201, 151, 78, 0.12)',
                                    padding: '1px 5px',
                                    borderRadius: '8px'
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
                        <td style={{ padding: '8px 12px' }}>
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

      {/* Phase 4: Stat Bar (Bottom) */}
      <StatBar stats={stats} />
    </div>
  );
}
