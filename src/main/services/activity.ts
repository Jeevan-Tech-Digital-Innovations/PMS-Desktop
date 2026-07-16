import { uIOhook } from 'uiohook-napi';
import { logger } from '../utils/logger';
import { updateLastActivity } from './idle';
import { IPC } from '../utils/ipcChannels';
import { getMainWindow } from '../index';

interface ActivityCounters {
  keystrokes: number;
  mouseActions: number;
}

let counters: ActivityCounters = { keystrokes: 0, mouseActions: 0 };
let running = false;
let broadcastHandle: ReturnType<typeof setInterval> | null = null;

const BROADCAST_INTERVAL_MS = 60_000; // log every 60s

/**
 * Starts counting keyboard and mouse events globally.
 * Does NOT capture what is typed — only counts events.
 */
export function startActivityMonitor(): void {
  if (running) return;
  running = true;
  counters = { keystrokes: 0, mouseActions: 0 };

  uIOhook.on('keydown', () => {
    counters.keystrokes++;
    updateLastActivity();
  });

  uIOhook.on('mousedown', () => {
    counters.mouseActions++;
    updateLastActivity();
  });

  uIOhook.on('wheel', () => {
    counters.mouseActions++;
    updateLastActivity();
  });

  uIOhook.start();

  // Broadcast current activity counts every minute
  broadcastHandle = setInterval(() => {
    const snapshot = { ...counters };
    console.log('[Activity] keystrokes:', snapshot.keystrokes, 'mouseActions:', snapshot.mouseActions);
    getMainWindow()?.webContents.send(IPC.ACTIVITY_UPDATED, snapshot);
  }, BROADCAST_INTERVAL_MS);

  logger.info('Activity monitor started');
}

/**
 * Stops the activity monitor and resets counters.
 */
export function stopActivityMonitor(): void {
  if (!running) return;
  running = false;
  uIOhook.stop();
  if (broadcastHandle) {
    clearInterval(broadcastHandle);
    broadcastHandle = null;
  }
  counters = { keystrokes: 0, mouseActions: 0 };
  logger.info('Activity monitor stopped');
}

/**
 * Pauses counting (e.g., during break) without resetting.
 */
export function pauseActivityMonitor(): void {
  if (!running) return;
  uIOhook.stop();
  running = false;
  logger.info('Activity monitor paused (break)');
}

/**
 * Resumes counting after a break.
 */
export function resumeActivityMonitor(): void {
  if (running) return;
  running = true;
  uIOhook.start();
  logger.info('Activity monitor resumed');
}

/**
 * Returns activity percentages for the last 10-minute block.
 * Call this every 10 minutes, then reset.
 */
export function getActivityPercentages(): { keyboardActivity: number; mouseActivity: number } {
  // Cap at 100 based on expected max events in 10 min
  // Typical active coding: ~3000 keystrokes, ~500 mouse events per 10 min
  const keyboardActivity = Math.min(100, Math.round((counters.keystrokes / 3000) * 100));
  const mouseActivity = Math.min(100, Math.round((counters.mouseActions / 500) * 100));
  return { keyboardActivity, mouseActivity };
}

/**
 * Resets counters after a screenshot/upload cycle.
 */
export function resetActivityCounters(): void {
  counters = { keystrokes: 0, mouseActions: 0 };
}
