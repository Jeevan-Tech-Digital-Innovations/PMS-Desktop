import screenshot from 'screenshot-desktop';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

const TEMP_DIR = path.join(app.getPath('temp'), 'workstatus-screenshots');

/**
 * Captures a screenshot and returns the image buffer directly.
 * Does not write to local disk.
 */
export async function captureScreenshot(): Promise<Buffer | null> {
  try {
    const imgBuffer = await screenshot({ format: 'png' });
    logger.info(`Screenshot captured directly to memory`);
    return imgBuffer;
  } catch (error) {
    logger.error('Failed to capture screenshot', error);
    return null;
  }
}

/**
 * Deletes a temp screenshot file after upload.
 */
export function deleteScreenshot(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      logger.debug(`Deleted temp screenshot: ${filepath}`);
    }
  } catch (error) {
    logger.warn(`Failed to delete temp screenshot: ${filepath}`, error);
  }
}

/**
 * Cleans up all temp screenshots on app shutdown.
 */
export function cleanupTempScreenshots(): void {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      const files = fs.readdirSync(TEMP_DIR);
      files.forEach((file) => fs.unlinkSync(path.join(TEMP_DIR, file)));
      logger.info(`Cleaned up ${files.length} temp screenshots`);
    }
  } catch (error) {
    logger.warn('Failed to cleanup temp screenshots', error);
  }
}
