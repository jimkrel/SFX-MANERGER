import React, { useEffect, useState } from 'react';
import { AppInfo, DbStatus } from '../../preload';

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);

  useEffect(() => {
    if (window.api) {
      window.api.getAppInfo().then(setAppInfo).catch(console.error);
      window.api.getDbStatus().then(setDbStatus).catch(console.error);
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--bg-main)',
        color: 'var(--text-main)',
        padding: '32px'
      }}
    >
      <header
        style={{
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '16px',
          marginBottom: '24px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent)'
            }}
          />
          <h1 style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.02em' }}>
            SFX / Music Manager
          </h1>
          <span
            className="mono"
            style={{
              fontSize: '12px',
              color: 'var(--accent)',
              backgroundColor: 'rgba(201, 151, 78, 0.12)',
              padding: '2px 8px',
              borderRadius: '4px'
            }}
          >
            Phase 1: Scaffold
          </span>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
        <section
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <h2 style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px', color: 'var(--accent)' }}>
            Main Process & IPC Bridge
          </h2>
          {appInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div>Platform: <span className="mono">{appInfo.platform} ({appInfo.arch})</span></div>
              <div>Electron: <span className="mono">v{appInfo.electronVersion}</span></div>
              <div>Node: <span className="mono">v{appInfo.nodeVersion}</span></div>
              <div>Context Isolation: <span className="mono" style={{ color: '#4ADE80' }}>Enabled</span></div>
              <div>Node Integration: <span className="mono" style={{ color: '#4ADE80' }}>Disabled (Safe)</span></div>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'rgba(232, 227, 218, 0.6)' }}>Đang kiểm tra kết nối IPC...</div>
          )}
        </section>

        <section
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <h2 style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px', color: 'var(--accent)' }}>
            Database Local (better-sqlite3)
          </h2>
          {dbStatus ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div>Trạng thái: <span className="mono" style={{ color: dbStatus.connected ? '#4ADE80' : '#F87171' }}>{dbStatus.connected ? 'Connected' : 'Error'}</span></div>
              {dbStatus.sqliteVersion && (
                <div>SQLite Version: <span className="mono">v{dbStatus.sqliteVersion}</span></div>
              )}
              {dbStatus.path && (
                <div>Database Path: <span className="mono" style={{ fontSize: '11px', wordBreak: 'break-all' }}>{dbStatus.path}</span></div>
              )}
              {dbStatus.error && (
                <div style={{ color: '#F87171' }}>Lỗi: {dbStatus.error}</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'rgba(232, 227, 218, 0.6)' }}>Đang kết nối SQLite...</div>
          )}
        </section>
      </main>
    </div>
  );
}
