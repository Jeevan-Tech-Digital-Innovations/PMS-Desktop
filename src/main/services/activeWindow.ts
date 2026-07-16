import activeWindow from 'active-win';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = Number(process.env.ACTIVE_WINDOW_POLL_MS) || 30_000; // 30s default

export interface ActiveWindowInfo {
  app: string;
  task: string;
  rawTitle: string;
}

let pollingHandle: ReturnType<typeof setInterval> | null = null;
let lastWindowTitle: string = '';
let onWindowChangeCallback: ((info: ActiveWindowInfo) => void) | null = null;

/**
 * Parses a window title into application name and task/content.
 * Example: "Manage access - Google Chrome" -> { app: "Google Chrome", task: "Manage access" }
 */
export function parseActiveWindowTitle(rawTitle: string): ActiveWindowInfo {
  const separators = [' - ', ' – ', ' — ', ' | ', ' • ', ' · ', ' ‹ ', ' › '];
  for (const sep of separators) {
    if (rawTitle.includes(sep)) {
      const parts = rawTitle.split(sep);
      const app = parts[parts.length - 1].trim();
      const task = parts.slice(0, parts.length - 1).join(sep).trim();
      return { app, task, rawTitle };
    }
  }
  return { app: rawTitle, task: '', rawTitle };
}

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
 * @param callback - Called with parsed window info whenever it changes
 */
export function startActiveWindowPoll(callback: (info: ActiveWindowInfo) => void): void {
  // Ensure any previous poll is stopped before starting a new one
  stopActiveWindowPoll();

  onWindowChangeCallback = callback;
  lastWindowTitle = '';

  pollingHandle = setInterval(async () => {
    const title = await getActiveWindowTitle();
    if (title !== lastWindowTitle) {
      lastWindowTitle = title;
      const info = parseActiveWindowTitle(title);
      onWindowChangeCallback?.(info);
      console.log(`[Active Window] Window: ${info.app} | Task: ${info.task || '(no task)'}`);
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
