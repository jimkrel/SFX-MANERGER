import React, { useEffect } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  durationMs?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '50px',
        right: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 9999,
        pointerEvents: 'none'
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.durationMs ?? 5000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  const borderColor =
    toast.type === 'success'
      ? '#4ADE80'
      : toast.type === 'error'
      ? '#F87171'
      : toast.type === 'warning'
      ? 'var(--accent)'
      : 'rgba(232, 227, 218, 0.3)';

  const icon =
    toast.type === 'success'
      ? '✓'
      : toast.type === 'error'
      ? '✕'
      : toast.type === 'warning'
      ? '⚠'
      : 'ℹ';

  return (
    <div
      style={{
        pointerEvents: 'auto',
        backgroundColor: '#242220',
        border: `1px solid ${borderColor}`,
        borderRadius: '6px',
        padding: '10px 14px',
        color: '#E8E3DA',
        fontSize: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        maxWidth: '380px',
        animation: 'fadeIn 0.2s ease-in-out'
      }}
    >
      <span
        style={{
          color: borderColor,
          fontWeight: 'bold',
          fontSize: '14px',
          lineHeight: '16px'
        }}
      >
        {icon}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
        {toast.title && (
          <div style={{ fontWeight: 600, fontSize: '12px', color: borderColor }}>
            {toast.title}
          </div>
        )}
        <div style={{ fontSize: '11px', color: 'rgba(232, 227, 218, 0.85)', lineHeight: 1.4 }}>
          {toast.message}
        </div>
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            style={{
              marginTop: '6px',
              padding: '4px 10px',
              backgroundColor: '#d9a55c',
              color: '#141516',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'opacity 0.15s'
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(232, 227, 218, 0.4)',
          cursor: 'pointer',
          padding: 0,
          fontSize: '12px',
          marginLeft: '4px'
        }}
      >
        ✕
      </button>
    </div>
  );
};
