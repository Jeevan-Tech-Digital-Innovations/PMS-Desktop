import { IPC } from '../utils/ipcChannels';
import { logger } from '../utils/logger';
import { getMainWindow } from '../index';
import { getIdleTimeMs, resetLastActivity } from './activity';

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_THRESHOLD_SECONDS = Math.round(IDLE_THRESHOLD_MS / 1000);
const POLL_INTERVAL_MS = 1000;

let running = false;
let idle = false;
let pollHandle: ReturnType<typeof setInterval> | null = null;

function broadcast(channel: string, data?: unknown): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
  mainWindow.webContents.send(channel, data);
}

function tick(): void {
  if (!running) return;

  const idleMs = getIdleTimeMs();

  if (!idle && idleMs >= IDLE_THRESHOLD_MS) {
    idle = true;
    logger.info(`Idle threshold crossed after ${Math.round(idleMs / 1000)}s`);
    console.log(`[Idle] Started after ${Math.round(idleMs / 1000)}s of inactivity`);
    broadcast(IPC.IDLE_STARTED, { seconds: IDLE_THRESHOLD_SECONDS });
    return;
  }

  if (idle && idleMs < IDLE_THRESHOLD_MS) {
    idle = false;
    logger.info('Activity resumed; idle period ended');
    console.log('[Idle] Stopped – activity detected');
    broadcast(IPC.IDLE_STOPPED);
  }
}

export function startIdleMonitor(): void {
  if (running) return;
  running = true;
  idle = false;
  pollHandle = setInterval(tick, POLL_INTERVAL_MS);
  logger.info('Idle monitor started');
  console.log('[Idle] Monitor started');
}

export function stopIdleMonitor(): void {
  if (!running && !idle) return;
  running = false;
  idle = false;
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  logger.info('Idle monitor stopped');
  console.log('[Idle] Monitor stopped');
}

export function pauseIdleMonitor(): void {
  if (!running) return;
  running = false;
  logger.info('Idle monitor paused (break)');
  console.log('[Idle] Monitor paused (break)');
}

export function resumeIdleMonitor(): void {
  if (running) return;
  // Reset activity baseline so the post-break period does not instantly trigger idle.
  resetLastActivity();
  running = true;
  logger.info('Idle monitor resumed');
  console.log('[Idle] Monitor resumed');
}
