import { app, BrowserWindow, ipcMain, Menu, session, net, screen, shell, Notification, powerMonitor } from 'electron';
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
import { showScreenshotNotification } from './services/notification';
import { Jimp } from 'jimp';

let mainWindow: BrowserWindow | null = null;
let screenshotInterval: ReturnType<typeof setInterval> | null = null;
let currentActiveWindowTitle = '';
let currentTimeLogId: number | null = null;

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

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const windowWidth = 360;
  const windowHeight = 490;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    useContentSize: true,
    x: screenWidth - windowWidth - 20,
    y: 20,
    minWidth: 350,
    minHeight: 480,
    resizable: false,
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
  mainWindow.on('close', (e: any) => {
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
  mainWindow.webContents.on('before-input-event', (_: any, input: any) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  logger.info('Main window created');
}


// ── Background Services Orchestration ────────────────────────────
function startAllBackgroundServices(timeLogId: number, startTime: string): void {
  currentTimeLogId = timeLogId;

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
  currentTimeLogId = null;

  logger.info('All background services stopped');
  console.log('[Background] All background services stopped');
}

async function captureAndUploadScreenshot(timeLogId: number): Promise<void> {
  let imgBuffer = await captureScreenshot();
  if (!imgBuffer) return;

  console.log(`[Screenshot] Captured for timeLogId=${timeLogId} directly to memory`);

  // Fetch latest employee settings from API
  let employeeSettings: any = {};
  try {
    const { accessToken } = authStore.getTokens();
    if (accessToken) {
      // In main process we use API_BASE env, or fallback
      const apiBase = process.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
      const response = await net.fetch(`${apiBase}/employees/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (response.ok) {
        const json = await response.json();
        employeeSettings = json.data || {};
      }
    }
  } catch (err) {
    logger.error('Failed to fetch employee settings for screenshot', err);
  }

  // Apply Blur if enabled
  if (employeeSettings.screenshotBlur === 'On') {
    try {
      console.log('[Screenshot] Applying blur filter...');
      const image = await Jimp.read(imgBuffer);
      image.blur(15); // Apply heavy gaussian blur
      imgBuffer = await image.getBuffer('image/jpeg');
      console.log('[Screenshot] Blur applied successfully');
    } catch (err) {
      logger.error('Failed to blur screenshot', err);
    }
  }

  const { keyboardActivity, mouseActivity } = getActivityPercentages();
  resetActivityCounters();

  const capturedAt = new Date().toISOString();

  const uploadSuccess = await uploadScreenshot({
    timeLogId,
    imgBuffer,
    capturedAt,
    keyboardActivity,
    mouseActivity,
    activeWindowTitle: currentActiveWindowTitle || 'Unknown',
  });

  if (uploadSuccess) {
    if (employeeSettings.screenshotNotifications !== 'Disable') {
      showScreenshotNotification();
    }
    mainWindow?.webContents.send(IPC.SCREENSHOT_UPLOADED, { timeLogId });
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────
function registerIpcHandlers(): void {
  // Auth
  ipcMain.handle(IPC.AUTH_GET_TOKENS, () => authStore.getStartupTokens());
  ipcMain.handle(IPC.AUTH_SAVE_TOKENS, (_: any, data: any) => authStore.saveTokens(data));
  ipcMain.handle(IPC.AUTH_CLEAR_TOKENS, () => authStore.clearTokens());
  ipcMain.handle(IPC.AUTH_GET_USER, () => authStore.getUser());
  ipcMain.handle(IPC.AUTH_SAVE_USER, (_: any, data: any) => authStore.saveUser(data));

  ipcMain.handle(IPC.AUTH_LOGIN_SSO, async (_: any, urls: { axisWebUrl: string, axisApiUrl: string }) => {
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

      authWindow.webContents.on('did-fail-load', (e: any, errorCode: number, errorDescription: string) => {
        console.error('authWindow failed to load:', errorCode, errorDescription);
        if (!isResolved) {
          isResolved = true;
          authWindow.close();
          reject(new Error(`Login page failed to load: ${errorDescription} (Code: ${errorCode})`));
        }
      });

      authWindow.webContents.on('did-fail-provisional-load', (e: any, errorCode: number, errorDescription: string) => {
        console.error('authWindow failed provisional load:', errorCode, errorDescription);
        if (!isResolved) {
          isResolved = true;
          authWindow.close();
          reject(new Error(`Login page blocked or unreachable: ${errorDescription} (Code: ${errorCode})`));
        }
      });

      authWindow.webContents.on('console-message', (event: any, level: number, message: string, line: number, sourceId: string) => {
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
              foundCookieNames = cookies.map((c: any) => c.name);
              const refresh = cookies.find((c: any) => c.name === 'axis_refresh_staging' || c.name === 'axis_refresh');
              if (refresh) {
                refreshCookie = refresh;
                // Force alias the cookie to 'axis_refresh' so the API can read it
                let cookiesToSend = cookies.map((c: any) => `${c.name}=${c.value}`);
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
                // --- NEW CODE: Persist the rotated cookie from SSO ---
                const setCookieRaw = response.headers['set-cookie'];
                if (setCookieRaw) {
                  // Normalize to array (Axios usually returns array, but safe fallback)
                  const setCookieArray = Array.isArray(setCookieRaw) ? setCookieRaw : [setCookieRaw];
                  for (const cookieStr of setCookieArray) {
                    const cookieMatch = cookieStr.match(/(?:axis_refresh_staging|axis_refresh)=([^;]+)/i);
                    if (cookieMatch) {
                      const cookieName = cookieStr.toLowerCase().includes('axis_refresh_staging')
                        ? 'axis_refresh_staging' : 'axis_refresh';
                      await session.defaultSession.cookies.set({
                        url: urls.axisApiUrl,
                        name: cookieName,
                        value: cookieMatch[1],
                        path: '/',
                        httpOnly: true,
                        secure: urls.axisApiUrl.startsWith('https'),
                      });
                      console.log(`[Auth] SSO Rotated ${cookieName} cookie saved to Electron session.`);
                    }
                  }
                }
                // --- END NEW CODE ---

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

      authWindow.webContents.on('will-navigate', (event: any, url: string) => {
        if (url.startsWith(redirectUri) && !isResolved) {
          event.preventDefault(); // Stop the Axis UI from loading the callback route
          handleNavigation(url);
        }
      });

      authWindow.webContents.on('did-redirect-navigation', (event: any, url: string) => {
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

  ipcMain.handle(IPC.AUTH_REFRESH_SESSION, async (_: any, urls: { axisApiUrl: string }) => {
    return await authStore.refreshSession(urls.axisApiUrl);
  });

  // Timer start
  ipcMain.on(IPC.TIMER_START, (_: any, payload: { timeLogId: number; startTime: string }) => {
    startAllBackgroundServices(payload.timeLogId, payload.startTime);
  });

  // Timer stop
  ipcMain.on(IPC.TIMER_STOP, async () => {
    await flushHeartbeat();
    await flushAppActivity();
    stopAllBackgroundServices();
  });

  // OT Warning Notification
  ipcMain.on(IPC.TIMER_OT_WARNING, (event) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'PMS Updated',
        body: 'Your timer has reached 8 hours. Do you want to continue as overtime?',
        actions: [
          { type: 'button', text: 'Continue as OT' },
          { type: 'button', text: 'Stop Timer' }
        ],
        icon: path.join(__dirname, '../../resources/icon.png')
      });

      notification.on('action', (e, index) => {
        if (index === 0) {
          event.sender.send(IPC.TIMER_OT_ACTION, 'continue');
        } else if (index === 1) {
          event.sender.send(IPC.TIMER_OT_ACTION, 'stop');
        }
      });

      notification.on('close', () => {
        event.sender.send(IPC.TIMER_OT_ACTION, 'close');
      });

      notification.show();
    } else {
      console.warn('Native notifications not supported on this OS');
      // If native not supported, fallback by instantly sending 'close' to UI
      // which should ideally handle it or fallback to web modal if necessary
      event.sender.send(IPC.TIMER_OT_ACTION, 'close');
    }
  });

  // Break
  ipcMain.on(IPC.BREAK_START, () => {
    pauseActivityMonitor();
    pauseIdleMonitor();
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
      screenshotInterval = null;
    }
  });

  ipcMain.on(IPC.BREAK_STOP, () => {
    resumeActivityMonitor();
    resumeIdleMonitor();

    // Immediately fire a heartbeat so the web portal shows "Working" status without waiting
    flushHeartbeat().catch(err => logger.error('Failed to flush heartbeat on break stop', err));

    if (currentTimeLogId) {
      if (screenshotInterval) {
        clearInterval(screenshotInterval);
      }
      screenshotInterval = setInterval(async () => {
        if (currentTimeLogId) {
          await captureAndUploadScreenshot(currentTimeLogId);
        }
      }, SCREENSHOT_INTERVAL_MS);
    }
  });

  // Screenshot manual capture
  ipcMain.handle(IPC.SCREENSHOT_CAPTURE, async () => {
    const imgBuffer = await captureScreenshot();
    if (imgBuffer) {
      showScreenshotNotification();
    }
    return imgBuffer;
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
  app.name = 'PMS Desktop';

  if (process.platform === 'win32') {
    const appId = 'PMS Desktop';
    app.setAppUserModelId(appId);

    // In development mode, register a Start Menu shortcut with this AppUserModelId
    // so Windows displays "PMS Desktop" as the application name on notifications
    // instead of the node_modules executable path.
    if (!app.isPackaged) {
      try {
        const shortcutDir = path.join(
          app.getPath('appData'),
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs'
        );
        const shortcutPath = path.join(shortcutDir, 'PMS Desktop.lnk');
        shell.writeShortcutLink(shortcutPath, 'create', {
          target: process.execPath,
          args: process.argv.slice(1).join(' '),
          appUserModelId: appId,
          description: 'PMS Desktop Application',
          icon: path.join(__dirname, '../../resources/icon.ico'),
          iconIndex: 0,
        });
      } catch (err) {
        logger.warn('Failed to create dev shortcut for notifications', err);
      }
    }
  }

  // Ignore certificate errors for the Axis SSO login window behind corporate proxies
  app.on('certificate-error', (event: any, webContents: any, url: string, error: string, certificate: any, callback: any) => {
    event.preventDefault();
    callback(true);
  });

  registerIpcHandlers();

  // Listen for system sleep/resume and screen lock/unlock to immediately refresh heartbeat
  powerMonitor.on('suspend', () => {
    logger.info('[PowerMonitor] System going to sleep / lid closed, flushing heartbeat');
    flushHeartbeat();
  });
  powerMonitor.on('lock-screen', () => {
    logger.info('[PowerMonitor] Screen locked, flushing heartbeat');
    flushHeartbeat();
  });
  powerMonitor.on('resume', () => {
    logger.info('[PowerMonitor] System resumed from sleep, refreshing heartbeat');
    flushHeartbeat();
  });
  powerMonitor.on('unlock-screen', () => {
    logger.info('[PowerMonitor] Screen unlocked, refreshing heartbeat');
    flushHeartbeat();
  });

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
