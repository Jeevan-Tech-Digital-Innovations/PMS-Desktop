import { app, BrowserWindow, ipcMain, Menu, session, net } from 'electron';
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

const SCREENSHOT_INTERVAL_MS = 600_000; // 10 minutes

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
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, '../../resources', iconFile);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ENJEV | PMS Desktop',
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // F12 to toggle DevTools in production
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

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
  const imgBuffer = await captureScreenshot();
  if (!imgBuffer) return;

  console.log(`[Screenshot] Captured for timeLogId=${timeLogId} directly to memory`);

  const { keyboardActivity, mouseActivity } = getActivityPercentages();
  resetActivityCounters();

  await uploadScreenshot({
    timeLogId,
    imgBuffer,
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
          webSecurity: false, // Force disable web security to bypass Mixed Content/CORS blocks on Staging
        },
      });


      // Use the actual Axis UI login endpoint with return_to parameter
      const redirectUri = `${urls.axisWebUrl}/desktop-callback`;
      const authUrl = `${urls.axisWebUrl}/login?return_to=${encodeURIComponent(redirectUri)}`;

      const domain = new URL(urls.axisApiUrl).hostname;

      authWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
        console.error('authWindow failed to load:', errorCode, errorDescription);
        if (!isResolved) {
          isResolved = true;
          authWindow.close();
          reject(new Error(`Login page failed to load: ${errorDescription} (Code: ${errorCode})`));
        }
      });
      
      authWindow.webContents.on('did-fail-provisional-load', (e, errorCode, errorDescription) => {
        console.error('authWindow failed provisional load:', errorCode, errorDescription);
        if (!isResolved) {
          isResolved = true;
          authWindow.close();
          reject(new Error(`Login page blocked or unreachable: ${errorDescription} (Code: ${errorCode})`));
        }
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
            const parsedUrl = new URL(url);
            const urlRefreshToken = parsedUrl.searchParams.get('refresh_token') || parsedUrl.searchParams.get('refreshToken');
            const urlAccessToken = parsedUrl.searchParams.get('access_token') || parsedUrl.searchParams.get('accessToken');

            if (urlRefreshToken && urlAccessToken) {
              authWindow.close();
              resolve({
                access_token: urlAccessToken,
                refresh_token: urlRefreshToken,
                user: { email: parsedUrl.searchParams.get('email') || '' } // Basic mock if passed in URL
              });
              return;
            }

            // Wait for the cookie to be set (up to 5 seconds)
            let refreshCookie;
            let allCookiesHeader = '';
            let foundCookieNames: string[] = [];
            for (let i = 0; i < 25; i++) {
              // We must check all cookies because the cookie might be set on the web URL domain instead of the API URL domain
              const cookies = await authWindow.webContents.session.cookies.get({});
              foundCookieNames = cookies.map(c => c.name);
              const refresh = cookies.find(c => c.name === 'axis_refresh_staging');
              if (refresh) {
                refreshCookie = refresh;
                // Force alias the cookie to 'axis_refresh' so the API can read it
                let cookiesToSend = cookies.map(c => `${c.name}=${c.value}`);
                if (refresh.name !== 'axis_refresh') {
                  cookiesToSend.push(`axis_refresh=${refresh.value}`);
                }
                allCookiesHeader = cookiesToSend.join('; ');
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }

            if (refreshCookie) {
              // Call Axis API to confirm access using the cookie
              const confirmUrl = urls.axisApiUrl.replace(/\/api\/?$/, '/api/v1') + '/auth/confirm-access';
              
              // Use axios with built-in https agent to bypass strict corporate proxy SSL certificate checks
              const https = require('https');
              const axios = require('axios');
              const httpsAgent = new https.Agent({ rejectUnauthorized: false });

              const response = await axios.post(confirmUrl, {}, {
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'Cookie': allCookiesHeader
                },
                httpsAgent: confirmUrl.startsWith('https') ? httpsAgent : undefined
              });

              if (response.status >= 200 && response.status < 300) {
                const data = response.data;
                authWindow.close();
                resolve(data);
                return;
              } else {
                throw new Error(`Server returned status ${response.status}: ${response.statusText}`);
              }
            } else {
              throw new Error(`axis_refresh cookie not found after 5s. Found cookies: ${foundCookieNames.join(', ')}`);
            }
          } catch (err: any) {
            console.error('SSO confirmation failed:', err);
            authWindow.close();
            
            // Extract axios error message if available
            let errorMsg = err.message || String(err);
            if (err.response) {
               errorMsg = `Status ${err.response.status}: ${JSON.stringify(err.response.data)}`;
            }
            
            reject(new Error(`Failed to obtain session via SSO: ${errorMsg}`));
            return;
          }
        }
      };

      authWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(redirectUri) && !isResolved) {
          event.preventDefault(); // Stop the Axis UI from loading the callback route
          handleNavigation(url);
        }
      });

      authWindow.webContents.on('did-redirect-navigation', (event, url) => {
        if (url.startsWith(redirectUri) && !isResolved) {
          // Cannot preventDefault on did-redirect, but we can stop loading
          authWindow.webContents.stop();
          handleNavigation(url);
        }
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
      // Use default session to find the refresh cookie
      const cookies = await session.defaultSession.cookies.get({ domain });
      const refreshCookie = cookies.find(c => c.name === 'axis_refresh_staging');

      if (!refreshCookie) {
        throw new Error('No refresh cookie found');
      }

      const confirmUrl = urls.axisApiUrl.replace(/\/api\/?$/, '/api/v1') + '/auth/confirm-access';
      const response = await fetch(confirmUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `axis_refresh=${refreshCookie.value}`
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
  // Ignore certificate errors for the Axis SSO login window behind corporate proxies
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
  });

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
