import React, { useEffect, useState, useCallback } from 'react';
import { Track } from '../../preload';

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
  const [rescanInfo, setRescanInfo] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!window.api) return;
    try {
      const [trackList, folderList] = await Promise.all([
        window.api.getTracks(),
        window.api.getWatchedFolders()
      ]);
      setTracks(trackList);
      setFolders(folderList);
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
        padding: '24px 32px',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '16px',
          marginBottom: '20px'
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
          <h1 style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '-0.02em' }}>
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
            Phase 2: Indexing & Metadata
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
              padding: '6px 14px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            🔄 Quét lại & Kiểm tra Missing
          </button>
          <button
            onClick={handleAddFolder}
            style={{
              backgroundColor: 'var(--accent)',
              border: 'none',
              color: '#1C1B19',
              fontWeight: 600,
              padding: '6px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            + Thêm Thư Mục
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px', flex: 1, minHeight: 0 }}>
        {/* Left: Watched Folders */}
        <aside
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>
              Thư mục theo dõi ({folders.length})
            </h2>
          </div>

          {folders.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'rgba(232, 227, 218, 0.5)', marginTop: '8px' }}>
              Chưa có thư mục nào. Nhấn "+ Thêm Thư Mục" để bắt đầu tự động quét file âm thanh.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {folders.map((folder) => (
                <div
                  key={folder}
                  style={{
                    backgroundColor: 'rgba(28, 27, 25, 0.6)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        fontSize: '13px',
                        padding: '2px 4px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <span
                    className="mono"
                    style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {folder}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Right: Tracks List */}
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
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <h2 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>
              Danh sách Clip Âm Thanh ({totalTracks})
            </h2>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
              <span>Khả dụng: <strong className="mono" style={{ color: '#4ADE80' }}>{availableTracks}</strong></span>
              <span>Bị thiếu: <strong className="mono" style={{ color: missingTracks > 0 ? '#F87171' : 'inherit' }}>{missingTracks}</strong></span>
            </div>
          </div>

          {/* Table Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.5)' }}>
                Đang tải dữ liệu thư viện...
              </div>
            ) : tracks.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(232, 227, 218, 0.5)', fontSize: '13px' }}>
                Hệ thống chưa tìm thấy file âm thanh nào (.wav, .mp3, .aiff, .flac). Hãy thêm thư mục có chứa audio clip để bắt đầu.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'rgba(232, 227, 218, 0.5)', fontSize: '11px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 16px' }}>Tên Clip</th>
                    <th style={{ padding: '10px 16px' }}>Thời Lượng</th>
                    <th style={{ padding: '10px 16px' }}>Sample Rate</th>
                    <th style={{ padding: '10px 16px' }}>Channels</th>
                    <th style={{ padding: '10px 16px' }}>Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => {
                    const isMissing = track.is_missing === 1;
                    return (
                      <tr
                        key={track.id}
                        style={{
                          borderBottom: '1px solid rgba(232, 227, 218, 0.05)',
                          opacity: isMissing ? 0.45 : 1,
                          backgroundColor: isMissing ? 'rgba(248, 113, 113, 0.03)' : 'transparent'
                        }}
                      >
                        <td style={{ padding: '10px 16px', fontWeight: 500 }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>{track.name}</span>
                            <span className="mono" style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.35)' }}>
                              {track.path}
                            </span>
                          </div>
                        </td>
                        <td className="mono" style={{ padding: '10px 16px', color: 'var(--text-main)' }}>
                          {formatDuration(track.duration)}
                        </td>
                        <td className="mono" style={{ padding: '10px 16px', color: 'rgba(232, 227, 218, 0.7)' }}>
                          {track.sample_rate ? `${track.sample_rate.toLocaleString()} Hz` : '—'}
                        </td>
                        <td className="mono" style={{ padding: '10px 16px', color: 'rgba(232, 227, 218, 0.7)' }}>
                          {track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : track.channels ? `${track.channels} ch` : '—'}
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          {isMissing ? (
                            <span
                              className="mono"
                              style={{
                                fontSize: '10px',
                                color: '#F87171',
                                backgroundColor: 'rgba(248, 113, 113, 0.15)',
                                padding: '2px 6px',
                                borderRadius: '4px'
                              }}
                            >
                              MISSING
                            </span>
                          ) : (
                            <span
                              className="mono"
                              style={{
                                fontSize: '10px',
                                color: '#4ADE80',
                                backgroundColor: 'rgba(74, 222, 128, 0.15)',
                                padding: '2px 6px',
                                borderRadius: '4px'
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
      </div>
    </div>
  );
}
