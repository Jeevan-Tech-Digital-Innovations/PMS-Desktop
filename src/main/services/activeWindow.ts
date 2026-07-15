import activeWindow from 'active-win';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = Number(process.env.ACTIVE_WINDOW_POLL_MS) || 30_000; // 30s default

let pollingHandle: ReturnType<typeof setInterval> | null = null;
let lastWindowTitle: string = '';
let onWindowChangeCallback: ((title: string) => void) | null = null;

/**
 * Returns the current active window title.
 */
export async function getActiveWindowTitle(): Promise<string> {
  try {
    const result = await activeWindow();
    return result?.title ?? 'Unknown';
  } catch (error) {
    logger.error('Failed to get active window title', error);
    return 'Unknown';
  }
}

/**
 * Starts polling the active window title every N seconds.
 * @param callback - Called with the title whenever it changes
 */
export function startActiveWindowPoll(callback: (title: string) => void): void {
  onWindowChangeCallback = callback;
  lastWindowTitle = '';

  pollingHandle = setInterval(async () => {
    const title = await getActiveWindowTitle();
    if (title !== lastWindowTitle) {
      lastWindowTitle = title;
      onWindowChangeCallback?.(title);
      logger.debug(`Active window changed: ${title}`);
    }
  }, POLL_INTERVAL_MS);

  logger.info('Active window polling started');
}

/**
 * Stops active window polling.
 */
export function stopActiveWindowPoll(): void {
  if (pollingHandle) {
    clearInterval(pollingHandle);
    pollingHandle = null;
  }
  onWindowChangeCallback = null;
  lastWindowTitle = '';
  logger.info('Active window polling stopped');
}
