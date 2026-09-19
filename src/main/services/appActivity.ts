import { logger } from '../utils/logger';
import { authStore } from '../utils/authStore';
import { ActiveWindowInfo } from './activeWindow';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
const FLUSH_INTERVAL_MS = 60_000; // 1 minute

interface AppActivityEvent {
  appName: string;
  taskTitle: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

interface CurrentSession {
  appName: string;
  taskTitle: string;
  startTime: number;
}

let timeLogId: number | null = null;
let currentSession: CurrentSession | null = null;
let eventBuffer: AppActivityEvent[] = [];
let flushHandle: ReturnType<typeof setInterval> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function closeCurrentSession(): AppActivityEvent | null {
  if (!currentSession) return null;

  const endTime = Date.now();
  const durationSeconds = Math.max(
    0,
    Math.round((endTime - currentSession.startTime) / 1000),
  );

  const event: AppActivityEvent = {
    appName: currentSession.appName,
    taskTitle: currentSession.taskTitle,
    startTime: new Date(currentSession.startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    durationSeconds,
  };

  currentSession = null;
  return event;
}

function startNewSession(info: ActiveWindowInfo): void {
  currentSession = {
    appName: info.app || 'Unknown',
    taskTitle: info.task || '',
    startTime: Date.now(),
  };
}

export function recordAppActivity(info: ActiveWindowInfo): void {
  if (!timeLogId) return;

  const closedEvent = closeCurrentSession();
  if (closedEvent) {
    eventBuffer.push(closedEvent);
  }

  startNewSession(info);
  logger.debug(`App activity session started: ${info.app}`);
}

export function startAppActivityTracking(logId: number): void {
  stopAppActivityTracking();

  timeLogId = logId;
  startNewSession({ app: 'PMS Desktop', task: '', rawTitle: 'PMS Desktop' });

  flushHandle = setInterval(() => {
    flushAppActivity();
  }, FLUSH_INTERVAL_MS);

  logger.info(`App activity tracking started for timeLogId: ${logId}`);
}

export function stopAppActivityTracking(): void {
  if (flushHandle) {
    clearInterval(flushHandle);
    flushHandle = null;
  }

  const closedEvent = closeCurrentSession();
  if (closedEvent) {
    eventBuffer.push(closedEvent);
  }

  if (timeLogId && eventBuffer.length > 0) {
    sendBatch(timeLogId, [...eventBuffer]);
  }

  eventBuffer = [];
  timeLogId = null;
  logger.info('App activity tracking stopped');
}

export async function flushAppActivity(): Promise<void> {
  if (!timeLogId || eventBuffer.length === 0) return;

  const batch = [...eventBuffer];
  eventBuffer = [];

  await sendBatch(timeLogId, batch);
}

async function sendBatch(logId: number, events: AppActivityEvent[]): Promise<void> {
  const { accessToken } = authStore.getTokens();
  if (!accessToken) {
    logger.warn('App activity batch skipped: no access token');
    return;
  }

  try {
    // 1. Fetch current user settings to get trackAppsUrls preference
    let trackAppsUrls = "Track Apps & URLs both";
    try {
      const settingsResp = await fetch(`${API_BASE}/employees/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (settingsResp.ok) {
        const json = await settingsResp.json();
        trackAppsUrls = json.data?.trackAppsUrls || trackAppsUrls;
      }
    } catch (err) {
      logger.error('Failed to fetch employee settings for app activity', err);
    }

    // 2. If OFF, drop the entire payload to save space
    if (trackAppsUrls === "OFF") {
      logger.debug('App activity tracking is OFF. Dropping payload.');
      return;
    }

    // 3. Mask data based on preferences
    const payload = events.map(e => {
      let finalAppName = e.appName;
      let finalUrl = e.taskTitle; // taskTitle maps to URL in API payload

      if (trackAppsUrls === "Track Apps only") {
        finalUrl = "Restricted";
      } else if (trackAppsUrls === "Track URLs only") {
        finalAppName = "Restricted";
      }

      return {
        appName: finalAppName,
        url: finalUrl,
        startTime: e.startTime,
        endTime: e.endTime,
        durationSeconds: e.durationSeconds,
        timeLogId: logId
      };
    });

    let response = await fetch(`${API_BASE}/activity/apps/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401 || response.status === 403) {
      try {
        logger.info('Access token expired, refreshing session...');
        const newAccessToken = await authStore.refreshSession();
        response = await fetch(`${API_BASE}/activity/apps/bulk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newAccessToken}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (refreshErr) {
        logger.error('Failed to refresh token during app activity batch', refreshErr);
      }
    }

    if (response.ok) {
      logger.debug(`App activity batch sent: ${events.length} events`);
    } else {
      logger.warn(`App activity batch failed: ${response.status}`);
    }
  } catch (error) {
    logger.error('App activity batch network error', error);
  }
}
