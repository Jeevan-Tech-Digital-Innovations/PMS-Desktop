/**
 * Type declarations for the Electron preload API.
 * Available in renderer via window.electronAPI.
 */
interface ElectronAPI {
  // Auth
  getStoredTokens: () => Promise<{ accessToken: string | null; refreshToken: string | null }>;
  saveTokens: (data: { accessToken: string; refreshToken: string; rememberMe: boolean }) => Promise<void>;
  clearTokens: () => Promise<void>;

  // Timer
  startTimer: (payload: { timeLogId: number; startTime: string }) => void;
  stopTimer: () => void;

  // Idle
  onIdleDetected: (callback: (data: { idleMs: number }) => void) => () => void;
  respondToIdle: (action: 'keep' | 'discard') => void;

  // Break
  startBreak: () => void;
  stopBreak: () => void;

  // Screenshots
  captureScreenshot: () => Promise<string | null>;
  onScreenshotUploaded: (callback: (data: { timeLogId: number }) => void) => () => void;

  // Active window
  onActiveWindowChange: (callback: (title: string) => void) => () => void;

  // App lifecycle
  quitApp: () => void;
  checkForUpdates: () => Promise<{ updateAvailable: boolean }>;
  minimizeToTray: () => void;

  // Navigation from tray
  onNavigate: (callback: (path: string) => void) => () => void;
  onSignOut: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
