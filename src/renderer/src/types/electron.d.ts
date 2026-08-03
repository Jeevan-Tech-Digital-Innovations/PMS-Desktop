/**
 * Type declarations for the Electron preload API.
 * Available in renderer via window.electronAPI.
 */
interface ElectronAPI {
  // Auth
  getStoredTokens: () => Promise<{ accessToken: string | null; refreshToken: string | null }>;
  saveTokens: (data: { accessToken: string; refreshToken: string; rememberMe: boolean }) => Promise<void>;
  clearTokens: () => Promise<void>;
  getStoredUser: () => Promise<{ userId: number; username: string; empNo: string; roles: string[] } | null>;
  saveUser: (user: { userId: number; username: string; empNo: string; roles: string[] }) => Promise<void>;
  loginSSO: (urls: { axisWebUrl: string; axisApiUrl: string }) => Promise<any>;
  refreshSession: (urls: { axisApiUrl: string }) => Promise<any>;

  // Timer
  startTimer: (payload: { timeLogId: number; startTime: string }) => void;
  stopTimer: () => void;

  // Break
  startBreak: () => void;
  stopBreak: () => void;

  // Idle
  onIdleStarted: (callback: (data: { seconds: number }) => void) => () => void;
  onIdleStopped: (callback: () => void) => () => void;

  // Screenshots
  captureScreenshot: () => Promise<string | null>;
  onScreenshotUploaded: (callback: (data: { timeLogId: number }) => void) => () => void;

  // Active window
  onActiveWindowChange: (
    callback: (data: { app: string; task: string; rawTitle: string }) => void,
  ) => () => void;

  // Tracking (Activity / Heartbeat)
  onActivityUpdated: (callback: (data: { keystrokes: number; mouseActions: number }) => void) => () => void;
  onHeartbeatSynced: (callback: (data: { timeLogId: number; elapsedMinutes: number; timestamp: string }) => void) => () => void;

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
