import activeWindow from 'active-win';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 10_000; // 10s

interface UrlEntry {
  url: string;
  title: string;
  timestamp: string;
}

let pollingHandle: ReturnType<typeof setInterval> | null = null;
let urlLog: UrlEntry[] = [];
let onUrlCallback: ((entry: UrlEntry) => void) | null = null;

/**
 * Extracts URL from browser window titles.
 * Works with Chrome, Firefox, Edge title formats.
 */
function extractUrlFromTitle(windowTitle: string, appName: string): string | null {
  const browserPatterns = [
    /Google Chrome$/,
    /Mozilla Firefox$/,
    /Microsoft Edge$/,
    /Brave$/,
    /Opera$/,
  ];

  const isBrowser = browserPatterns.some((p) => p.test(appName));
  if (!isBrowser) return null;

  // Chrome/Edge format: "Page Title - https://example.com - Google Chrome"
  const urlMatch = windowTitle.match(/https?:\/\/[^\s-]+/);
  return urlMatch ? urlMatch[0] : null;
}

/**
 * Starts URL tracking by monitoring active window for browser usage.
 * @param callback - Called each time a new URL is detected
 */
export function startUrlTracker(callback: (entry: UrlEntry) => void): void {
  onUrlCallback = callback;
  urlLog = [];

  pollingHandle = setInterval(async () => {
    try {
      const win = await activeWindow();
      if (!win) return;

      const url = extractUrlFromTitle(win.title, win.owner?.name ?? '');
      if (url) {
        const entry: UrlEntry = {
          url,
          title: win.title,
          timestamp: new Date().toISOString(),
        };
        urlLog.push(entry);
        onUrlCallback?.(entry);
        logger.debug(`URL tracked: ${url}`);
      }
    } catch (error) {
      logger.error('URL tracker poll failed', error);
    }
  }, POLL_INTERVAL_MS);

  logger.info('URL tracker started');
}

/**
 * Stops URL tracking.
 */
export function stopUrlTracker(): void {
  if (pollingHandle) {
    clearInterval(pollingHandle);
    pollingHandle = null;
  }
  onUrlCallback = null;
  logger.info('URL tracker stopped');
}

/**
 * Returns collected URL entries since tracking started.
 */
export function getUrlLog(): UrlEntry[] {
  return [...urlLog];
}

/**
 * Clears the URL log (e.g., after syncing to backend).
 */
export function clearUrlLog(): void {
  urlLog = [];
}
