import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track } from '../../preload';
import { WaveformThumbnail } from './components/WaveformThumbnail';
import { NowPlayingPanel } from './components/NowPlayingPanel';
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
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(audioPlayer.getState());
  const [rescanInfo, setRescanInfo] = useState<string | null>(null);

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

  // 2. Load library data
  const loadData = useCallback(async () => {
    if (!window.api) return;
    try {
      const [trackList, folderList] = await Promise.all([
        window.api.getTracks(),
        window.api.getWatchedFolders()
      ]);
      setTracks(trackList);
      setFolders(folderList);

      if (trackList.length > 0 && !selectedTrackRef.current) {
        setSelectedTrack(trackList[0]);
      }
    } catch (error) {
      console.error('Error loading library data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    if (window.api) {
      const unsubscribe = window.api.onLibraryUpdated(() => {
        loadData();
      });
      return () => unsubscribe();
    }
  }, [loadData]);

  // 3. Global Keyboard Shortcuts (Space = preview/pause, Up/Down = browse)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

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
        padding: '16px 24px',
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
          marginBottom: '14px'
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
            Phase 3: Waveform & Preview
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
              padding: '6px 12px',
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
              padding: '6px 14px',
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
          gap: '16px',
          flex: 1,
          minHeight: 0
        }}
      >
        {/* Column 1: Sidebar Folders */}
        <aside
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            overflowY: 'auto'
          }}
        >
          <h2 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', margin: 0 }}>
            Thư mục ({folders.length})
          </h2>

          {folders.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'rgba(232, 227, 218, 0.45)', marginTop: '8px', lineHeight: 1.4 }}>
              Nhấn "+ Thêm Thư Mục" để nạp kho SFX/nhạc.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {folders.map((folder) => (
                <div
                  key={folder}
                  style={{
                    backgroundColor: 'rgba(28, 27, 25, 0.7)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📁 {folder.split('/').pop()}
                    </span>
                    <button
                      onClick={() => handleRemoveFolder(folder)}
                      title="Ngừng theo dõi"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(232, 227, 218, 0.4)',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <span
                    className="mono"
                    style={{ fontSize: '9px', color: 'rgba(232, 227, 218, 0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {folder}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Column 2: Clip Grid / List (Waveform Thumbnails) */}
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
          {/* Table Header / Subheader */}
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <h2 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', margin: 0 }}>
              Danh sách Clip ({totalTracks})
            </h2>
            <div style={{ display: 'flex', gap: '14px', fontSize: '11px' }}>
              <span>Khả dụng: <strong className="mono" style={{ color: '#4ADE80' }}>{availableTracks}</strong></span>
              <span>Bị thiếu: <strong className="mono" style={{ color: missingTracks > 0 ? '#F87171' : 'inherit' }}>{missingTracks}</strong></span>
            </div>
          </div>

          {/* Table Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.5)' }}>
                Đang nạp danh sách âm thanh...
              </div>
            ) : tracks.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.45)', fontSize: '13px' }}>
                Chưa có clip âm thanh nào. Nhấn "+ Thêm Thư Mục" để tự động quét.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'rgba(232, 227, 218, 0.45)', fontSize: '10px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '8px 14px', width: '30px' }}></th>
                    <th style={{ padding: '8px 14px' }}>Tên Clip</th>
                    <th style={{ padding: '8px 14px', width: '130px' }}>Waveform</th>
                    <th style={{ padding: '8px 14px', width: '70px' }}>Độ Dài</th>
                    <th style={{ padding: '8px 14px', width: '80px' }}>Sample Rate</th>
                    <th style={{ padding: '8px 14px', width: '70px' }}>Status</th>
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
                          backgroundColor: isSelected
                            ? 'rgba(201, 151, 78, 0.12)'
                            : 'transparent',
                          cursor: isMissing ? 'not-allowed' : 'pointer',
                          opacity: isMissing ? 0.4 : 1
                        }}
                      >
                        <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                          {isCurrentPlaying ? (
                            <span style={{ color: 'var(--accent)', fontSize: '12px' }}>▶</span>
                          ) : (
                            <span style={{ color: 'rgba(232, 227, 218, 0.2)', fontSize: '10px' }}>●</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: isSelected ? 600 : 500, color: isSelected ? 'var(--accent)' : 'inherit' }}>
                              {track.name}
                            </span>
                            <span className="mono" style={{ fontSize: '9px', color: 'rgba(232, 227, 218, 0.3)' }}>
                              {track.path.split('/').pop()}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <WaveformThumbnail
                            track={track}
                            isPlaying={isCurrentPlaying}
                            isSelected={isSelected}
                            width={110}
                            height={26}
                          />
                        </td>
                        <td className="mono" style={{ padding: '8px 14px', color: 'var(--text-main)' }}>
                          {formatDuration(track.duration)}
                        </td>
                        <td className="mono" style={{ padding: '8px 14px', color: 'rgba(232, 227, 218, 0.6)' }}>
                          {track.sample_rate ? `${(track.sample_rate / 1000).toFixed(1)}k` : '—'}
                        </td>
                        <td style={{ padding: '8px 14px' }}>
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
          <NowPlayingPanel selectedTrack={selectedTrack} />
        </aside>
      </div>
    </div>
  );
}
