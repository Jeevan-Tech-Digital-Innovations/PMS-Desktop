import { Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

function getAppIconPath(): string | undefined {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const devPath = path.join(__dirname, '../../resources', iconFile);
  if (fs.existsSync(devPath)) return devPath;

  const prodResourcePath = path.join(process.resourcesPath, iconFile);
  if (fs.existsSync(prodResourcePath)) return prodResourcePath;

  const prodPngPath = path.join(process.resourcesPath, 'icon.png');
  if (fs.existsSync(prodPngPath)) return prodPngPath;

  return undefined;
}

/**
 * Displays a native Windows / OS system notification when a screenshot
 * has been successfully captured and saved.
 *
 * Uses Electron's native Notification API so it appears non-intrusively
 * on the side of the screen without interrupting active user workflow.
 */
export function showScreenshotNotification(): void {
  try {
    if (!Notification.isSupported()) {
      logger.warn('[Notification] Native notifications are not supported on this platform');
      return;
    }

    const iconPath = getAppIconPath();

    const notification = new Notification({
      title: 'PMS Screenshot Captured',
      body: 'Screenshot captured successfully.',
      ...(iconPath ? { icon: iconPath } : {}),
    });

    notification.show();
    logger.info('[Notification] Screenshot captured notification shown');
  } catch (error) {
    logger.error('[Notification] Failed to show screenshot notification', error);
  }
}
