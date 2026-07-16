import { logger } from '../utils/logger';
import { authStore } from '../utils/authStore';
import { IPC } from '../utils/ipcChannels';
import { getMainWindow } from '../index';

const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 300_000; // 5 min
const API_BASE = process.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
let timeLogId: number | null = null;
let startTime: string | null = null;

interface HeartbeatPayload {
  timeLogId: number;
  startTime: string;
  currentDurationMinutes: number;
}

/**
 * Starts periodic heartbeat syncing to the backend.
 * Pings every N minutes to persist current time progress.
 */
export function startHeartbeat(logId: number, start: string): void {
  timeLogId = logId;
  startTime = start;

  heartbeatHandle = setInterval(async () => {
    await syncHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  logger.info(`Heartbeat started for timeLogId: ${logId}`);
}

/**
 * Stops the heartbeat sync.
 */
export function stopHeartbeat(): void {
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }
  timeLogId = null;
  startTime = null;
  logger.info('Heartbeat stopped');
}

/**
 * Sends a single heartbeat ping to the backend.
 *
 * NOTE: The PMS API does not currently provide a heartbeat endpoint.
 * (PUT /tasks/time-logs/{id}/heartbeat does not exist in the backend.)
 * The heartbeat timer still runs so that elapsed time is tracked locally,
 * but the network call is skipped to avoid 404 errors.
 * Once the backend adds a heartbeat endpoint, re-enable the fetch below.
 */
async function syncHeartbeat(): Promise<void> {
  if (!timeLogId || !startTime) return;

  const { accessToken } = authStore.getTokens();
  if (!accessToken) {
    logger.warn('Heartbeat skipped: no access token');
    return;
  }

  const elapsedMinutes = Math.round(
    (Date.now() - new Date(startTime).getTime()) / 60_000,
  );

  // Heartbeat endpoint not yet implemented in PMS API.
  // Logging locally so the elapsed time is still visible in logs.
  const timestamp = new Date().toISOString();
  console.log(`[Heartbeat] timeLogId=${timeLogId} elapsed=${elapsedMinutes}min`);
  getMainWindow()?.webContents.send(IPC.HEARTBEAT_SYNCED, {
    timeLogId,
    elapsedMinutes,
    timestamp,
  });
  logger.debug(`Heartbeat (local only): ${elapsedMinutes}min elapsed for timeLogId ${timeLogId}`);

  /* ── Disabled: endpoint does not exist in PMS API ────────────────
  const payload: HeartbeatPayload = {
    timeLogId,
    startTime,
    currentDurationMinutes: elapsedMinutes,
  };

  try {
    const response = await fetch(`${API_BASE}/tasks/time-logs/${timeLogId}/heartbeat`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      logger.debug(`Heartbeat synced: ${elapsedMinutes}min elapsed`);
    } else {
      logger.warn(`Heartbeat failed: ${response.status}`);
    }
  } catch (error) {
    logger.error('Heartbeat network error', error);
  }
  ──────────────────────────────────────────────────────────────── */
}

/**
 * Immediately fires one heartbeat (e.g., before stopping timer).
 */
export async function flushHeartbeat(): Promise<void> {
  await syncHeartbeat();
}
