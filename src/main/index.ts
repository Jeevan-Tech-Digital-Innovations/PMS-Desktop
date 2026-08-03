import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
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
import {
  startIdleMonitor,
  stopIdleMonitor,
  pauseIdleMonitor,
  resumeIdleMonitor,
} from './services/idle';
import { startActiveWindowPoll, stopActiveWindowPoll, getActiveWindowTitle } from './services/activeWindow';
import { startHeartbeat, stopHeartbeat, flushHeartbeat } from './services/heartbeat';
import {
  startAppActivityTracking,
  stopAppActivityTracking,
  flushAppActivity,
  recordAppActivity,
} from './services/appActivity';
import { captureScreenshot, cleanupTempScreenshots } from './services/screenshot';
import { uploadScreenshot } from './services/uploader';

let mainWindow: BrowserWindow | null = null;
let screenshotInterval: ReturnType<typeof setInterval> | null = null;
let currentActiveWindowTitle = '';

const SCREENSHOT_INTERVAL_MS = Number(process.env.SCREENSHOT_INTERVAL_MS) || 600_000; // 10 min

/**
 * Returns the main BrowserWindow instance.
 * Used by background services to send IPC messages to the renderer.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

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
    title: 'PMS Desktop',
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

  // Idle detection
  startIdleMonitor();

  // Active window tracking
  startActiveWindowPoll((info) => {
    currentActiveWindowTitle = info.rawTitle;
    mainWindow?.webContents.send(IPC.ACTIVE_WINDOW_INFO, info);
    recordAppActivity(info);
  });

  // App activity tracking
  startAppActivityTracking(timeLogId);

  // Heartbeat sync
  startHeartbeat(timeLogId, startTime);

  // Screenshot loop
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
  screenshotInterval = setInterval(async () => {
    await captureAndUploadScreenshot(timeLogId);
  }, SCREENSHOT_INTERVAL_MS);

  logger.info('All background services started');
}

function stopAllBackgroundServices(): void {
  console.log('[Background] Stopping all background services');
  stopAppActivityTracking();
  stopActivityMonitor();
  stopIdleMonitor();
  stopActiveWindowPoll();
  stopHeartbeat();

  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }

  logger.info('All background services stopped');
  console.log('[Background] All background services stopped');
}

async function captureAndUploadScreenshot(timeLogId: number): Promise<void> {
  const filepath = await captureScreenshot();
  if (!filepath) return;

  console.log(`[Screenshot] Captured for timeLogId=${timeLogId}: ${filepath}`);

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
  ipcMain.handle(IPC.AUTH_GET_TOKENS, () => authStore.getStartupTokens());
  ipcMain.handle(IPC.AUTH_SAVE_TOKENS, (_, data) => authStore.saveTokens(data));
  ipcMain.handle(IPC.AUTH_CLEAR_TOKENS, () => authStore.clearTokens());
  ipcMain.handle(IPC.AUTH_GET_USER, () => authStore.getUser());
  ipcMain.handle(IPC.AUTH_SAVE_USER, (_, data) => authStore.saveUser(data));

  ipcMain.handle(IPC.AUTH_LOGIN_SSO, async (_, urls: { axisWebUrl: string, axisApiUrl: string }) => {
    return new Promise((resolve, reject) => {
      const isDev = !app.isPackaged;
      const authWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: !isDev,
        },
      });
      authWindow.webContents.openDevTools();

      // Use the actual Axis UI login endpoint with return_to parameter
      const redirectUri = `${urls.axisWebUrl}/desktop-callback`;
      const authUrl = `${urls.axisWebUrl}/login?return_to=${encodeURIComponent(redirectUri)}`;
      
      const domain = new URL(urls.axisApiUrl).hostname;
      
      authWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
         console.error('authWindow failed to load:', errorCode, errorDescription);
      });

      authWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
         console.log(`[authWindow console] level: ${level} message: ${message} line: ${line} sourceId: ${sourceId}`);
      });

      authWindow.loadURL(authUrl);
      authWindow.show();

      let isResolved = false;

      const handleNavigation = async (url: string) => {
          if (url.startsWith(redirectUri) && !isResolved) {
            isResolved = true;
            try {
              // Get the refresh cookie that was set by Axis login
              const cookies = await authWindow.webContents.session.cookies.get({ domain });
              const refreshCookie = cookies.find(c => c.name === 'axis_refresh');
              
              if (refreshCookie) {
                // Call Axis API to confirm access using the cookie
                const confirmUrl = urls.axisApiUrl.replace(/\/api$/, '/v1') + '/auth/confirm-access';
                const response = await fetch(confirmUrl, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Cookie': `${refreshCookie.name}=${refreshCookie.value}`
                  }
                });
              
              if (response.ok) {
                const data = await response.json();
                authWindow.close();
                resolve(data);
                return;
              } else {
                console.error(`Confirm access failed with status: ${response.status}`);
              }
            } else {
               console.error('axis_refresh cookie not found after login');
            }
          } catch (err) {
            console.error('SSO confirmation failed:', err);
          }
          
          authWindow.close();
          reject(new Error('Failed to obtain session via SSO'));
        }
      };

      authWindow.webContents.on('will-navigate', (event, url) => {
        handleNavigation(url);
      });

      authWindow.webContents.on('did-redirect-navigation', (event, url) => {
        handleNavigation(url);
      });
      
      authWindow.on('closed', () => {
        if (!isResolved) {
          reject(new Error('Auth window was closed by user'));
        }
      });
    });
  });

  ipcMain.handle(IPC.AUTH_REFRESH_SESSION, async (_, urls: { axisApiUrl: string }) => {
    try {
      const domain = new URL(urls.axisApiUrl).hostname;
      // Use default session to find the axis_refresh cookie
      const cookies = await session.defaultSession.cookies.get({ domain });
      const refreshCookie = cookies.find(c => c.name === 'axis_refresh');
      
      if (!refreshCookie) {
        throw new Error('No refresh cookie found');
      }

      const confirmUrl = urls.axisApiUrl.replace(/\/api$/, '/v1') + '/auth/confirm-access';
      const response = await fetch(confirmUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': `${refreshCookie.name}=${refreshCookie.value}`
        }
      });
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error(`Refresh failed with status: ${response.status}`);
      }
    } catch (err) {
      console.error('Session refresh failed:', err);
      throw err;
    }
  });

  // Timer start
  ipcMain.on(IPC.TIMER_START, (_, payload: { timeLogId: number; startTime: string }) => {
    startAllBackgroundServices(payload.timeLogId, payload.startTime);
  });

  // Timer stop
  ipcMain.on(IPC.TIMER_STOP, async () => {
    await flushHeartbeat();
    await flushAppActivity();
    stopAllBackgroundServices();
  });

  // Break
  ipcMain.on(IPC.BREAK_START, () => {
    pauseActivityMonitor();
    pauseIdleMonitor();
  });
  ipcMain.on(IPC.BREAK_STOP, () => {
    resumeActivityMonitor();
    resumeIdleMonitor();
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

app.on('before-quit', async () => {
  (app as any).isQuitting = true;
  await flushAppActivity();
  stopAllBackgroundServices();
  cleanupTempScreenshots();
  destroyTray();
});

(app as any).isQuitting = false;
