import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import { logger } from './utils/logger';
import { authStore } from './utils/authStore';
import { IPC } from './utils/ipcChannels';
import { createTray, destroyTray } from './tray';
import {
  startActivityMonitor,
  stopActivityMonitor,
  pauseActivityMonitor,
  resumeActivityMonitor,
  getActivityPercentages,
  resetActivityCounters,
} from './services/activity';
import { startIdleDetection, stopIdleDetection } from './services/idle';
import { startActiveWindowPoll, stopActiveWindowPoll, getActiveWindowTitle } from './services/activeWindow';
import { startUrlTracker, stopUrlTracker } from './services/urlTracker';
import { startHeartbeat, stopHeartbeat, flushHeartbeat } from './services/heartbeat';
import { captureScreenshot, cleanupTempScreenshots } from './services/screenshot';
import { uploadScreenshot } from './services/uploader';

let mainWindow: BrowserWindow | null = null;
let screenshotInterval: ReturnType<typeof setInterval> | null = null;
let currentActiveWindowTitle = '';

const SCREENSHOT_INTERVAL_MS = Number(process.env.SCREENSHOT_INTERVAL_MS) || 600_000; // 10 min

// ── Window Creation ──────────────────────────────────────────────
function createWindow(): void {
  // Remove default menu bar (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null);

  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Workstatus Desktop',
    icon: path.join(__dirname, '../../resources/icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !isDev, // Disable CORS in development only
      backgroundThrottling: false, // Keep timer/idle detection running when not focused
    },
  });

  // Show window once ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  logger.info('Main window created');
}

// ── Background Services Orchestration ────────────────────────────
function startAllBackgroundServices(timeLogId: number, startTime: string): void {
  // Activity monitor
  startActivityMonitor();

  // Active window tracking
  startActiveWindowPoll((title) => {
    currentActiveWindowTitle = title;
    mainWindow?.webContents.send(IPC.ACTIVE_WINDOW_INFO, title);
  });

  // URL tracking
  startUrlTracker(() => {
    // URL entries are collected silently
  });

  // Idle detection
  startIdleDetection(
    (idleMs) => {
      mainWindow?.webContents.send(IPC.IDLE_DETECTED, { idleMs });
    },
    (idleMs) => {
      // User returned from idle
    },
  );

  // Heartbeat sync
  startHeartbeat(timeLogId, startTime);

  // Screenshot loop
  screenshotInterval = setInterval(async () => {
    await captureAndUploadScreenshot(timeLogId);
  }, SCREENSHOT_INTERVAL_MS);

  logger.info('All background services started');
}

function stopAllBackgroundServices(): void {
  stopActivityMonitor();
  stopActiveWindowPoll();
  stopUrlTracker();
  stopIdleDetection();
  stopHeartbeat();

  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }

  logger.info('All background services stopped');
}

async function captureAndUploadScreenshot(timeLogId: number): Promise<void> {
  const filepath = await captureScreenshot();
  if (!filepath) return;

  const { keyboardActivity, mouseActivity } = getActivityPercentages();
  resetActivityCounters();

  await uploadScreenshot({
    timeLogId,
    filepath,
    capturedAt: new Date().toISOString(),
    keyboardActivity,
    mouseActivity,
    activeWindowTitle: currentActiveWindowTitle,
  });

  mainWindow?.webContents.send(IPC.SCREENSHOT_UPLOADED, { timeLogId });
}

// ── IPC Handlers ─────────────────────────────────────────────────
function registerIpcHandlers(): void {
  // Auth
  ipcMain.handle(IPC.AUTH_GET_TOKENS, () => authStore.getTokens());
  ipcMain.handle(IPC.AUTH_SAVE_TOKENS, (_, data) => authStore.saveTokens(data));
  ipcMain.handle(IPC.AUTH_CLEAR_TOKENS, () => authStore.clearTokens());

  // Timer start
  ipcMain.on(IPC.TIMER_START, (_, payload: { timeLogId: number; startTime: string }) => {
    startAllBackgroundServices(payload.timeLogId, payload.startTime);
  });

  // Timer stop
  ipcMain.on(IPC.TIMER_STOP, async () => {
    await flushHeartbeat();
    stopAllBackgroundServices();
  });

  // Break
  ipcMain.on(IPC.BREAK_START, () => pauseActivityMonitor());
  ipcMain.on(IPC.BREAK_STOP, () => resumeActivityMonitor());

  // Idle response
  ipcMain.on(IPC.IDLE_RESPONSE, (_, response: { action: 'keep' | 'discard' }) => {
    // Renderer handles the API call; main just acknowledges
    logger.info(`Idle response: ${response.action}`);
  });

  // Screenshot manual capture
  ipcMain.handle(IPC.SCREENSHOT_CAPTURE, async () => {
    const filepath = await captureScreenshot();
    return filepath;
  });

  // App lifecycle
  ipcMain.on(IPC.APP_QUIT, () => {
    (app as any).isQuitting = true;
    app.quit();
  });

  ipcMain.handle(IPC.APP_CHECK_UPDATES, async () => {
    // electron-updater integration (placeholder)
    logger.info('Check for updates triggered');
    return { updateAvailable: false };
  });

  ipcMain.on(IPC.APP_MINIMIZE_TO_TRAY, () => {
    mainWindow?.hide();
  });
}

// ── App Lifecycle ────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  createTray(mainWindow!);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
  stopAllBackgroundServices();
  cleanupTempScreenshots();
  destroyTray();
});

(app as any).isQuitting = false;
