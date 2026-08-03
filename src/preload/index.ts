import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — security boundary between main and renderer.
 * Only exposes a narrow, typed API via window.electronAPI.
 */

const IPC = {
  AUTH_GET_TOKENS: 'auth:get-tokens',
  AUTH_SAVE_TOKENS: 'auth:save-tokens',
  AUTH_CLEAR_TOKENS: 'auth:clear-tokens',
  AUTH_GET_USER: 'auth:get-user',
  AUTH_SAVE_USER: 'auth:save-user',
  AUTH_LOGIN_SSO: 'auth:login-sso',
  AUTH_REFRESH_SESSION: 'auth:refresh-session',
  TIMER_START: 'timer:start',
  TIMER_STOP: 'timer:stop',
  TIMER_TICK: 'timer:tick',
  BREAK_START: 'break:start',
  BREAK_STOP: 'break:stop',
  IDLE_STARTED: 'idle:started',
  IDLE_STOPPED: 'idle:stopped',
  SCREENSHOT_CAPTURE: 'screenshot:capture',
  SCREENSHOT_UPLOADED: 'screenshot:uploaded',
  ACTIVITY_UPDATED: 'tracking:activity',
  HEARTBEAT_SYNCED: 'tracking:heartbeat',
  APP_QUIT: 'app:quit',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_MINIMIZE_TO_TRAY: 'app:minimize-to-tray',
  ACTIVE_WINDOW_INFO: 'active-window:info',
};

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Auth ──────────────────────────────────────────────────────
  getStoredTokens: () => ipcRenderer.invoke(IPC.AUTH_GET_TOKENS),
  saveTokens: (data: { accessToken: string; refreshToken: string; rememberMe: boolean }) =>
    ipcRenderer.invoke(IPC.AUTH_SAVE_TOKENS, data),
  clearTokens: () => ipcRenderer.invoke(IPC.AUTH_CLEAR_TOKENS),
  getStoredUser: () =>
    ipcRenderer.invoke(IPC.AUTH_GET_USER) as Promise<{
      userId: number;
      username: string;
      empNo: string;
      roles: string[];
    } | null>,
  saveUser: (user: { userId: number; username: string; empNo: string; roles: string[] }) =>
    ipcRenderer.invoke(IPC.AUTH_SAVE_USER, user),
  loginSSO: (urls: { axisWebUrl: string, axisApiUrl: string }) => ipcRenderer.invoke(IPC.AUTH_LOGIN_SSO, urls),
  refreshSession: (urls: { axisApiUrl: string }) => ipcRenderer.invoke(IPC.AUTH_REFRESH_SESSION, urls),

  // ── Timer ─────────────────────────────────────────────────────
  startTimer: (payload: { timeLogId: number; startTime: string }) =>
    ipcRenderer.send(IPC.TIMER_START, payload),
  stopTimer: () => ipcRenderer.send(IPC.TIMER_STOP),

  // ── Break ─────────────────────────────────────────────────────
  startBreak: () => ipcRenderer.send(IPC.BREAK_START),
  stopBreak: () => ipcRenderer.send(IPC.BREAK_STOP),

  // ── Idle ──────────────────────────────────────────────────────
  onIdleStarted: (callback: (data: { seconds: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { seconds: number }) => callback(data);
    ipcRenderer.on(IPC.IDLE_STARTED, handler);
    return () => ipcRenderer.removeListener(IPC.IDLE_STARTED, handler);
  },
  onIdleStopped: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.IDLE_STOPPED, handler);
    return () => ipcRenderer.removeListener(IPC.IDLE_STOPPED, handler);
  },

  // ── Screenshots ───────────────────────────────────────────────
  captureScreenshot: () => ipcRenderer.invoke(IPC.SCREENSHOT_CAPTURE),
  onScreenshotUploaded: (callback: (data: { timeLogId: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { timeLogId: number }) => callback(data);
    ipcRenderer.on(IPC.SCREENSHOT_UPLOADED, handler);
    return () => ipcRenderer.removeListener(IPC.SCREENSHOT_UPLOADED, handler);
  },

  // ── Active Window ─────────────────────────────────────────────
  onActiveWindowChange: (callback: (data: { app: string; task: string; rawTitle: string }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { app: string; task: string; rawTitle: string },
    ) => callback(data);
    ipcRenderer.on(IPC.ACTIVE_WINDOW_INFO, handler);
    return () => ipcRenderer.removeListener(IPC.ACTIVE_WINDOW_INFO, handler);
  },

  // ── Tracking (Activity / Heartbeat) ───────────────────────────
  onActivityUpdated: (callback: (data: { keystrokes: number; mouseActions: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { keystrokes: number; mouseActions: number }) =>
      callback(data);
    ipcRenderer.on(IPC.ACTIVITY_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC.ACTIVITY_UPDATED, handler);
  },
  onHeartbeatSynced: (callback: (data: { timeLogId: number; elapsedMinutes: number; timestamp: string }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { timeLogId: number; elapsedMinutes: number; timestamp: string },
    ) => callback(data);
    ipcRenderer.on(IPC.HEARTBEAT_SYNCED, handler);
    return () => ipcRenderer.removeListener(IPC.HEARTBEAT_SYNCED, handler);
  },

  // ── App Lifecycle ─────────────────────────────────────────────
  quitApp: () => ipcRenderer.send(IPC.APP_QUIT),
  checkForUpdates: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATES),
  minimizeToTray: () => ipcRenderer.send(IPC.APP_MINIMIZE_TO_TRAY),

  // ── Navigation from tray ──────────────────────────────────────
  onNavigate: (callback: (path: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.removeListener('navigate', handler);
  },

  // ── Auth sign-out from tray ───────────────────────────────────
  onSignOut: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('auth:sign-out', handler);
    return () => ipcRenderer.removeListener('auth:sign-out', handler);
  },
});
