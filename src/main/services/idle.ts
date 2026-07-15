import { logger } from '../utils/logger';

/**
 * Idle detection based on uiohook activity.
 * Tracks the last input event time and checks if idle threshold is crossed.
 * This avoids the native desktop-idle dependency which requires C++ build tools.
 */

const IDLE_THRESHOLD_MS = Number(process.env.IDLE_THRESHOLD_MS) || 300_000; // 5 min default
const POLL_INTERVAL_MS = 10_000; // check every 10 sec

let idlePollingHandle: ReturnType<typeof setInterval> | null = null;
let idleNotified = false;
let idleStartTime: number | null = null;
let onIdleCallback: ((idleMs: number) => void) | null = null;
let onResumeCallback: ((idleMs: number) => void) | null = null;
let lastActivityTime: number = Date.now();

/**
 * Updates the last activity timestamp.
 * Should be called from the activity monitor on every key/mouse event.
 */
export function updateLastActivity(): void {
  lastActivityTime = Date.now();
}

/**
 * Returns current idle time in milliseconds (time since last input event).
 */
export function getCurrentIdleTime(): number {
  return Date.now() - lastActivityTime;
}

/**
 * Starts polling for idle time.
 * @param onIdle - Called once when idle threshold is crossed
 * @param onResume - Called when user returns from idle
 */
export function startIdleDetection(
  onIdle: (idleMs: number) => void,
  onResume: (idleMs: number) => void,
): void {
  onIdleCallback = onIdle;
  onResumeCallback = onResume;
  idleNotified = false;
  idleStartTime = null;
  lastActivityTime = Date.now();

  idlePollingHandle = setInterval(() => {
    const idleMs = getCurrentIdleTime();

    if (idleMs >= IDLE_THRESHOLD_MS && !idleNotified) {
      idleNotified = true;
      idleStartTime = Date.now() - idleMs;
      logger.info(`Idle threshold crossed: ${idleMs}ms`);
      onIdleCallback?.(idleMs);
    } else if (idleMs < IDLE_THRESHOLD_MS && idleNotified) {
      // User returned
      const totalIdleMs = idleStartTime ? Date.now() - idleStartTime : idleMs;
      idleNotified = false;
      idleStartTime = null;
      logger.info(`User returned from idle: ${totalIdleMs}ms`);
      onResumeCallback?.(totalIdleMs);
    }
  }, POLL_INTERVAL_MS);

  logger.info('Idle detection started');
}

/**
 * Stops polling for idle time.
 */
export function stopIdleDetection(): void {
  if (idlePollingHandle) {
    clearInterval(idlePollingHandle);
    idlePollingHandle = null;
  }
  idleNotified = false;
  idleStartTime = null;
  onIdleCallback = null;
  onResumeCallback = null;
  logger.info('Idle detection stopped');
}
