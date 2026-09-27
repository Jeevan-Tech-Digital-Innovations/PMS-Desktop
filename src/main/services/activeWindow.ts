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
 * Returns the current active window information directly from the OS.
 */
export async function getActiveWindowInfo(): Promise<ActiveWindowInfo | null> {
  try {
    const result = await activeWindow();
    if (!result) return null;
    
    // For Windows/macOS, active-win provides owner.name which is the actual app name
    let appName = result.owner?.name;
    let taskName = result.title;

    // If owner name is missing or we just want a fallback clean name
    if (!appName) {
      const parsed = parseActiveWindowTitle(result.title);
      appName = parsed.app;
    }
    
    return {
      app: appName,
      task: taskName,
      rawTitle: result.title
    };
  } catch (error) {
    logger.error('Failed to get active window info', error);
    return null;
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
    try {
      const info = await getActiveWindowInfo();
      if (info && info.rawTitle !== lastWindowTitle) {
        lastWindowTitle = info.rawTitle;
        onWindowChangeCallback?.(info);
        console.log(`[Active Window] App: ${info.app} | Task: ${info.task || '(no task)'}`);
        logger.debug(`Active window changed: ${info.rawTitle}`);
      }
    } catch (err) {
      logger.error('Error in active window poll loop', err);
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
