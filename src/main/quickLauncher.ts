import { app, BrowserWindow, globalShortcut, screen, systemPreferences, shell } from 'electron';
import path from 'path';
import { getAppSetting, setAppSetting } from './db';

let quickLauncherWindow: BrowserWindow | null = null;
let currentRegisteredShortcut: string | null = null;
let isOpeningTransition = false;

export const SETTING_QUICK_LAUNCHER_SHORTCUT = 'quick_launcher_shortcut';

export function getDefaultShortcut(): string {
  return process.platform === 'darwin' ? 'Command+Shift+.' : 'Control+Shift+.';
}

export function getCurrentShortcut(): string {
  const saved = getAppSetting(SETTING_QUICK_LAUNCHER_SHORTCUT);
  return saved && saved.trim().length > 0 ? saved.trim() : getDefaultShortcut();
}

/**
 * Check whether the app is trusted as an Accessibility client (macOS only).
 * On non-macOS platforms, always returns true.
 */
export function checkAccessibilityPermission(prompt = false): boolean {
  if (process.platform !== 'darwin') return true;
  try {
    return systemPreferences.isTrustedAccessibilityClient(prompt);
  } catch (err) {
    console.warn('[QuickLauncher] isTrustedAccessibilityClient check failed:', err);
    return false;
  }
}

/**
 * Open macOS System Settings > Privacy & Security > Accessibility.
 */
export function openAccessibilitySettings(): void {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch((err) => {
      console.error('[QuickLauncher] Failed to open accessibility settings:', err);
    });
  }
}

/**
 * Creates the transparent floating Quick Launcher window.
 */
export function createQuickLauncherWindow(): BrowserWindow {
  if (quickLauncherWindow && !quickLauncherWindow.isDestroyed()) {
    return quickLauncherWindow;
  }

  quickLauncherWindow = new BrowserWindow({
    width: 640,
    height: 420,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (process.env.VITE_DEV_SERVER_URL) {
    quickLauncherWindow.loadURL(`${devServerUrl}?window=quick-launcher`);
  } else {
    quickLauncherWindow
      .loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { window: 'quick-launcher' }
      })
      .catch(() => {
        quickLauncherWindow?.loadURL(`${devServerUrl}?window=quick-launcher`);
      });
  }

  if (process.platform === 'darwin') {
    quickLauncherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    quickLauncherWindow.setAlwaysOnTop(true, 'floating');
  }

  quickLauncherWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[QuickLauncher WebContents] ${message}`);
  });

  // Auto-hide when window loses focus (click outside / blur)
  quickLauncherWindow.on('blur', () => {
    if (isOpeningTransition) {
      console.log('[QuickLauncher] Blur event ignored during opening/focus transition');
      return;
    }
    console.log('[QuickLauncher] Window blurred -> auto-hiding');
    if (quickLauncherWindow && !quickLauncherWindow.isDestroyed() && quickLauncherWindow.isVisible()) {
      hideQuickLauncher();
    }
  });

  quickLauncherWindow.on('closed', () => {
    quickLauncherWindow = null;
  });

  return quickLauncherWindow;
}

let accessibilityPollTimer: ReturnType<typeof setInterval> | null = null;
let onAccessibilityGrantedCallback: (() => void) | null = null;

export function setOnAccessibilityGranted(callback: () => void): void {
  onAccessibilityGrantedCallback = callback;
}

export function startAccessibilityWatcher(): void {
  if (process.platform !== 'darwin') return;
  if (accessibilityPollTimer) return;

  const isAlreadyGranted = checkAccessibilityPermission(false);
  if (isAlreadyGranted) return;

  console.log('[QuickLauncher] Starting Accessibility permission poller (checking every 2s)...');
  accessibilityPollTimer = setInterval(() => {
    const grantedNow = checkAccessibilityPermission(false);
    if (grantedNow) {
      console.log('[QuickLauncher] 🎉 macOS Accessibility permission has been GRANTED dynamically!');
      if (accessibilityPollTimer) {
        clearInterval(accessibilityPollTimer);
        accessibilityPollTimer = null;
      }
      // Re-register global shortcut with fresh accessibility privileges
      registerQuickLauncherShortcut();
      if (onAccessibilityGrantedCallback) {
        onAccessibilityGrantedCallback();
      }
    }
  }, 2000);
}

export function stopAccessibilityWatcher(): void {
  if (accessibilityPollTimer) {
    clearInterval(accessibilityPollTimer);
    accessibilityPollTimer = null;
  }
}

/**
 * Positions the Quick Launcher window on the active display (where mouse cursor currently is),
 * horizontally centered and in the upper 30% area (Spotlight / Raycast style).
 */
export function positionQuickLauncherOnActiveDisplay(): void {
  if (!quickLauncherWindow || quickLauncherWindow.isDestroyed()) return;

  const cursorPoint = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x: displayX, y: displayY, width: displayW, height: displayH } = activeDisplay.workArea;

  const [winW, winH] = quickLauncherWindow.getSize();

  // Horizontally centered on the active screen
  const posX = Math.round(displayX + (displayW - winW) / 2);
  // Upper 30% vertically, leaving comfortable breathing room from top edge
  const posY = Math.round(displayY + Math.max(60, (displayH - winH) * 0.28));

  quickLauncherWindow.setPosition(posX, posY);
}

/**
 * Resizes the Quick Launcher window height to fit its content cleanly.
 */
export function setQuickLauncherHeight(targetHeight: number): void {
  if (!quickLauncherWindow || quickLauncherWindow.isDestroyed()) return;
  const [currentWidth, currentHeight] = quickLauncherWindow.getSize();
  const clampedHeight = Math.max(100, Math.min(520, Math.round(targetHeight)));
  if (Math.abs(currentHeight - clampedHeight) > 2) {
    quickLauncherWindow.setSize(currentWidth, clampedHeight);
  }
}

/**
 * Shows and focuses the Quick Launcher window.
 */
export function showQuickLauncher(): void {
  const win = quickLauncherWindow && !quickLauncherWindow.isDestroyed()
    ? quickLauncherWindow
    : createQuickLauncherWindow();

  positionQuickLauncherOnActiveDisplay();

  isOpeningTransition = true;

  const activateAndFocus = () => {
    if (!win || win.isDestroyed()) {
      isOpeningTransition = false;
      return;
    }
    try {
      if (process.platform === 'darwin') {
        app.focus({ steal: true });
      }
      win.show();
      win.focus();
      win.webContents.focus();
      win.webContents.send('quickLauncher:shown');
      console.log(`[QuickLauncher] Window shown & focused | isFocused=${win.isFocused()} | isVisible=${win.isVisible()}`);
    } catch (err) {
      console.error('[QuickLauncher] Error in activateAndFocus:', err);
    } finally {
      setTimeout(() => {
        isOpeningTransition = false;
      }, 150);
    }
  };

  if (!win.isVisible()) {
    win.once('show', () => {
      setTimeout(activateAndFocus, 50);
    });
    win.show();
  } else {
    setTimeout(activateAndFocus, 50);
  }
}

/**
 * Hides the Quick Launcher window.
 */
export function hideQuickLauncher(): void {
  if (quickLauncherWindow && !quickLauncherWindow.isDestroyed()) {
    quickLauncherWindow.hide();
    quickLauncherWindow.webContents.send('quickLauncher:hidden');
    console.log('[QuickLauncher] Window hidden via hideQuickLauncher()');
  }
}

/**
 * Toggles Quick Launcher visibility.
 */
export function toggleQuickLauncher(): void {
  if (quickLauncherWindow && !quickLauncherWindow.isDestroyed() && quickLauncherWindow.isVisible()) {
    hideQuickLauncher();
  } else {
    showQuickLauncher();
  }
}

/**
 * Register global shortcut with Electron globalShortcut API.
 */
export function registerQuickLauncherShortcut(shortcut?: string): boolean {
  const targetShortcut = shortcut || getCurrentShortcut();

  // Unregister existing shortcut if any
  if (currentRegisteredShortcut) {
    try {
      globalShortcut.unregister(currentRegisteredShortcut);
    } catch {}
    currentRegisteredShortcut = null;
  }

  // On macOS, verify accessibility permission
  const isTrusted = checkAccessibilityPermission(false);
  if (process.platform === 'darwin') {
    if (!isTrusted) {
      console.warn(`[QuickLauncher] ⚠️ macOS Accessibility permission NOT granted! (isTrustedAccessibilityClient(false) = false). Global shortcut "${targetShortcut}" will NOT intercept while other apps (e.g. CapCut) are focused.`);
      // Prompt user clearly via macOS system dialog
      systemPreferences.isTrustedAccessibilityClient(true);
      startAccessibilityWatcher();
    } else {
      console.log(`[QuickLauncher] ✅ macOS Accessibility permission is GRANTED. Global shortcuts are trusted.`);
      stopAccessibilityWatcher();
    }
  }

  try {
    const registered = globalShortcut.register(targetShortcut, () => {
      const trustedNow = checkAccessibilityPermission(false);
      console.log(`[QuickLauncher] >>> GLOBAL SHORTCUT TRIGGERED: "${targetShortcut}" | Timestamp: ${new Date().toISOString()} | Accessibility trusted: ${trustedNow}`);
      if (process.platform === 'darwin' && !trustedNow) {
        console.warn(`[QuickLauncher] ⚠️ Shortcut caught but Accessibility is NOT trusted (isTrustedAccessibilityClient = false).`);
      }
      toggleQuickLauncher();
    });

    if (registered) {
      currentRegisteredShortcut = targetShortcut;
      console.log(`[QuickLauncher] Registered global shortcut successfully: "${targetShortcut}" (Accessibility trusted: ${isTrusted})`);
      return true;
    } else {
      console.warn(`[QuickLauncher] Failed to register global shortcut: "${targetShortcut}" (already bound or unsupported)`);
      return false;
    }
  } catch (err) {
    console.error(`[QuickLauncher] Error registering shortcut "${targetShortcut}":`, err);
    return false;
  }
}

/**
 * Normalizes user-input accelerator strings to Electron standard format.
 */
export function normalizeAccelerator(shortcut: string): string {
  const parts = shortcut
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  const modifiers: string[] = [];
  let key = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'cmd' || lower === 'command') {
      if (!modifiers.includes('Command')) modifiers.push('Command');
    } else if (lower === 'ctrl' || lower === 'control') {
      if (!modifiers.includes('Control')) modifiers.push('Control');
    } else if (lower === 'alt' || lower === 'option') {
      if (!modifiers.includes('Alt')) modifiers.push('Alt');
    } else if (lower === 'shift') {
      if (!modifiers.includes('Shift')) modifiers.push('Shift');
    } else if (lower === 'cmdorctrl' || lower === 'commandorcontrol') {
      if (!modifiers.includes('CommandOrControl')) modifiers.push('CommandOrControl');
    } else {
      key = part;
    }
  }

  return modifiers.length > 0 && key ? [...modifiers, key].join('+') : shortcut.trim();
}

/**
 * Set and persist a new shortcut. If registration fails, restores previous shortcut.
 */
export function updateQuickLauncherShortcut(newShortcut: string): { success: boolean; error?: string } {
  const rawShortcut = newShortcut.trim();
  if (!rawShortcut) {
    return { success: false, error: 'Tổ hợp phím không được để trống.' };
  }

  const cleanShortcut = normalizeAccelerator(rawShortcut);

  // Validate: must contain at least 1 modifier key (unless function key like F1-F12)
  const isFunctionKey = /^F\d{1,2}$/i.test(cleanShortcut);
  const hasModifier = /Command|Control|Alt|Shift|Option|Cmd|Ctrl/i.test(cleanShortcut);
  if (!isFunctionKey && !hasModifier) {
    return {
      success: false,
      error: `Tổ hợp phím "${cleanShortcut}" không hợp lệ. Phím tắt toàn cục cần bao gồm ít nhất một phím bổ trợ (Cmd, Ctrl, Alt hoặc Shift). Ví dụ: Cmd+Shift+K.`
    };
  }

  const previousShortcut = currentRegisteredShortcut || getCurrentShortcut();

  // Unregister old shortcut
  if (currentRegisteredShortcut) {
    try {
      globalShortcut.unregister(currentRegisteredShortcut);
    } catch {}
    currentRegisteredShortcut = null;
  }

  try {
    const success = globalShortcut.register(cleanShortcut, () => {
      toggleQuickLauncher();
    });

    if (success) {
      currentRegisteredShortcut = cleanShortcut;
      setAppSetting(SETTING_QUICK_LAUNCHER_SHORTCUT, cleanShortcut);
      console.log(`[QuickLauncher] Global shortcut updated successfully to: "${cleanShortcut}"`);
      return { success: true };
    } else {
      // Re-register previous shortcut
      if (previousShortcut) {
        try {
          globalShortcut.register(previousShortcut, () => {
            toggleQuickLauncher();
          });
          currentRegisteredShortcut = previousShortcut;
        } catch {}
      }
      return {
        success: false,
        error: `Không thể đăng ký phím tắt "${cleanShortcut}". Tổ hợp phím này đã bị chiếm giữ bởi hệ điều hành hoặc phần mềm khác (hoặc không được hỗ trợ). Vui lòng chọn tổ hợp phím khác.`
      };
    }
  } catch (err: any) {
    // Restore previous
    if (previousShortcut) {
      try {
        globalShortcut.register(previousShortcut, () => {
          toggleQuickLauncher();
        });
        currentRegisteredShortcut = previousShortcut;
      } catch {}
    }
    return {
      success: false,
      error: `Lỗi hệ thống khi đăng ký phím tắt "${cleanShortcut}": ${err?.message || String(err)}`
    };
  }
}

/**
 * Unregisters shortcut on app shutdown.
 */
export function unregisterAllQuickLauncherShortcuts(): void {
  if (currentRegisteredShortcut) {
    try {
      globalShortcut.unregister(currentRegisteredShortcut);
    } catch {}
    currentRegisteredShortcut = null;
  }
}
