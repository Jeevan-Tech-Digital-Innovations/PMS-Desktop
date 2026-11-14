import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import * as path from 'path';
import { logger } from './utils/logger';

let tray: Tray | null = null;

/**
 * Creates the system tray icon and context menu.
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  // Resolve tray icon path safely between dev and production
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../resources/icon.png');
    
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Jeevantech Digital Innovations');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Dashboard',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Profile',
      click: () => {
        mainWindow.webContents.send('navigate', '/profile');
        mainWindow.show();
      },
    },
    {
      label: 'Settings',
      click: () => {
        mainWindow.webContents.send('navigate', '/settings');
        mainWindow.show();
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        mainWindow.webContents.send('app:check-updates');
      },
    },
    { type: 'separator' },
    {
      label: 'Sign Out',
      click: () => {
        mainWindow.webContents.send('auth:sign-out');
        mainWindow.show();
      },
    },
    {
      label: 'Quit Application',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  logger.info('System tray created');
  return tray;
}

/**
 * Destroys the tray on app quit.
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
