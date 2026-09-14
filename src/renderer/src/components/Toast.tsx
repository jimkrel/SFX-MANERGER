import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  message: string;
  action?: ToastAction;
  actions?: ToastAction[];
  durationMs?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="toast-container-wrapper">
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
  const duration = toast.durationMs ?? 4000;
  const [isPaused, setIsPaused] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const remainingRef = useRef(duration);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 220);
  };

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      remainingRef.current -= Date.now() - startTimeRef.current;
      return;
    }

    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, Math.max(remainingRef.current, 500));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPaused]);

  // Accent styles per toast type
  const config = {
    success: {
      color: '#10B981',
      bgGlow: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.35)',
      icon: <CheckCircle2 size={16} color="#10B981" />
    },
    error: {
      color: '#EF4444',
      bgGlow: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.35)',
      icon: <AlertCircle size={16} color="#EF4444" />
    },
    warning: {
      color: '#F59E0B',
      bgGlow: 'rgba(245, 158, 11, 0.12)',
      border: 'rgba(245, 158, 11, 0.35)',
      icon: <AlertTriangle size={16} color="#F59E0B" />
    },
    info: {
      color: '#D9A55C',
      bgGlow: 'rgba(217, 165, 92, 0.12)',
      border: 'rgba(217, 165, 92, 0.35)',
      icon: <Info size={16} color="#D9A55C" />
    }
  }[toast.type];

  const allActions = (toast.actions && toast.actions.length > 0)
    ? toast.actions
    : (toast.action ? [toast.action] : []);

  return (
    <div
      className={`toast-card-modern ${toast.type} ${isExiting ? 'exiting' : ''}`}
      style={{
        borderColor: config.border,
        boxShadow: `0 12px 32px rgba(0, 0, 0, 0.5), 0 0 20px ${config.bgGlow}`
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Icon with soft glow background */}
      <div className="toast-icon-badge" style={{ background: config.bgGlow, color: config.color }}>
        {config.icon}
      </div>

      {/* Message content */}
      <div className="toast-body">
        {toast.title && (
          <div className="toast-title" style={{ color: config.color }}>
            {toast.title}
          </div>
        )}
        <div className="toast-message">{toast.message}</div>

        {/* Action buttons if any */}
        {allActions.length > 0 && (
          <div className="toast-actions-row">
            {allActions.map((act, idx) => (
              <button
                key={idx}
                className={`toast-action-btn ${act.primary !== false ? 'primary' : 'secondary'}`}
                onClick={() => {
                  act.onClick();
                  handleDismiss();
                }}
              >
                {act.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Close button */}
      <button
        className="toast-close-btn"
        onClick={handleDismiss}
        title="Đóng thông báo"
      >
        <X size={13} />
      </button>

      {/* Progress countdown bar */}
      <div
        className={`toast-progress-bar ${isPaused ? 'paused' : ''}`}
        style={{
          backgroundColor: config.color,
          animationDuration: `${duration}ms`
        }}
      />
    </div>
  );
};
