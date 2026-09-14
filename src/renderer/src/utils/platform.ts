/**
 * Unified platform utility for SFX Manager renderer.
 * Single source of truth for operating system detection across all renderer components.
 */

export type PlatformType = 'darwin' | 'win32' | 'linux' | string;

// Initialize platform synchronously:
// 1. Electron preload API if available (window.api.platform)
// 2. Fallback to navigator.userAgent / navigator.platform
function detectInitialPlatform(): PlatformType {
  try {
    if (typeof window !== 'undefined') {
      const apiPlatform = (window as unknown as { api?: { platform?: string } })?.api?.platform;
      if (apiPlatform) return apiPlatform;

      const ua = navigator.userAgent;
      if (/Macintosh|Mac OS X|MacIntel/i.test(ua)) return 'darwin';
      if (/Windows|Win32|Win64/i.test(ua)) return 'win32';
      if (/Linux/i.test(ua)) return 'linux';
    }
  } catch {
    // Ignore and fallback
  }
  return 'darwin';
}

let currentPlatform: PlatformType = detectInitialPlatform();

export let isMac: boolean = currentPlatform === 'darwin';
export let isWindows: boolean = currentPlatform === 'win32';
export let isLinux: boolean = currentPlatform === 'linux';

const listeners = new Set<(platform: PlatformType) => void>();

/**
 * Update platform at runtime (e.g. after window.api.getAppInfo() returns)
 */
export function setPlatform(platform: PlatformType): void {
  currentPlatform = platform;
  isMac = platform === 'darwin';
  isWindows = platform === 'win32';
  isLinux = platform === 'linux';
  listeners.forEach((listener) => {
    try {
      listener(platform);
    } catch (err) {
      console.error('[Platform] listener error:', err);
    }
  });
}

/**
 * Get current platform string ('darwin', 'win32', 'linux')
 */
export function getPlatform(): PlatformType {
  return currentPlatform;
}

/**
 * Subscribe to platform changes
 */
export function subscribePlatform(listener: (platform: PlatformType) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Get OS-appropriate modifier key symbol and label
 */
export function getModifierKey(): { symbol: string; label: string } {
  return isMac ? { symbol: '⌘', label: 'Cmd' } : { symbol: 'Ctrl', label: 'Ctrl' };
}

/**
 * File manager name for current OS (Finder on macOS, Explorer on Windows)
 */
export function getFileManagerName(): string {
  return isMac ? 'Finder' : 'Explorer';
}
