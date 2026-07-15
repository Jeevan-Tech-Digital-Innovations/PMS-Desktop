import screenshot from 'screenshot-desktop';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

const TEMP_DIR = path.join(app.getPath('temp'), 'workstatus-screenshots');

/**
 * Captures a screenshot and saves it to a temp directory.
 * Returns the file path for upload.
 */
export async function captureScreenshot(): Promise<string | null> {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(TEMP_DIR, filename);

    const imgBuffer = await screenshot({ format: 'png' });
    fs.writeFileSync(filepath, imgBuffer);

    logger.info(`Screenshot captured: ${filepath}`);
    return filepath;
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
