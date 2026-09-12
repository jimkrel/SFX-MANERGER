import React from 'react';
import { LibraryStats } from '../../../preload';

interface StatBarProps {
  stats: LibraryStats;
}

export const StatBar: React.FC<StatBarProps> = ({ stats }) => {
  return (
    <footer
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '8px 16px',
        marginTop: '12px',
        fontSize: '11px',
        color: 'rgba(232, 227, 218, 0.7)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div>
          <span>Tổng SFX: </span>
          <strong className="mono" style={{ color: 'var(--text-main)', fontSize: '12px' }}>
            {stats.totalSfx}
          </strong>
        </div>

        <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-color)' }} />

        <div>
          <span>Tổng Nhạc: </span>
          <strong className="mono" style={{ color: 'var(--text-main)', fontSize: '12px' }}>
            {stats.totalMusic}
          </strong>
        </div>

        <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-color)' }} />

        <div>
          <span>Mới tuần này: </span>
          <strong className="mono" style={{ color: 'var(--accent)', fontSize: '12px' }}>
            {stats.newThisWeek}
          </strong>
        </div>

        <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-color)' }} />

        <div>
          <span>File bị thiếu (ổ rời): </span>
          <strong
            className="mono"
            style={{
              color: stats.totalMissing > 0 ? '#F87171' : 'rgba(232, 227, 218, 0.5)',
              fontSize: '12px'
            }}
          >
            {stats.totalMissing}
          </strong>
        </div>
      </div>

      <div className="mono" style={{ fontSize: '10px', color: 'rgba(232, 227, 218, 0.4)' }}>
        LOCAL LIBRARY • ZERO CLOUD
      </div>
    </footer>
  );
};
