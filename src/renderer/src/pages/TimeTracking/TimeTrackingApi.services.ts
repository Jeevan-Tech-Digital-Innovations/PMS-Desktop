import { apiClient } from '@/services/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { API_ENDPOINTS } from '@/utils/constants';


/**
 * Builds the ActivityLogRequest payload that the PMS API expects
 * for the start-time-log endpoint.
 * Mirrors the PMS UI's startTaskTimer implementation.
 */
function buildActivityLogPayload(): Array<Record<string, string>> {
  const deviceId =
    localStorage.getItem('device_id') ||
    (crypto.randomUUID
      ? crypto.randomUUID()
      : 'device-' + Math.random().toString(36).substr(2, 9));
  localStorage.setItem('device_id', deviceId);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  const startTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const offset = now.getTimezoneOffset();
  const gmtSign = offset > 0 ? '-' : '+';
  const gmtHours = Math.abs(offset / 60);

  return [
    {
      deviceId,
      deviceType: 'Desktop',
      os_version: navigator.userAgent,
      ip_address: '127.0.0.1',
      timezone,
      start: startTime,
      source_type: 'Desktop',
      timeType: 'Working',
      user_timezone_gmt: `GMT${gmtSign}${gmtHours}`,
      user_timezone_gmt_dst: 'false',
    },
  ];
}

export async function startTimeLog(taskId: number) {
  return enqueueOperation(async () => {
    const activityPayload = buildActivityLogPayload();
    const { data } = await apiClient.post(
      API_ENDPOINTS.TIME_LOGS_START(taskId),
      activityPayload,
    );
    return data?.data ? data.data : data;
  });
}

export async function stopTimeLog(taskId: number) {
  return enqueueOperation(async () => {
    const { data } = await apiClient.put(
      API_ENDPOINTS.TIME_LOGS_STOP(taskId),
    );
    return data?.data ? data.data : data;
  });
}

export async function getActiveTimeLog() {
  const userId = useAuthStore.getState().user?.userId;
  const { data } = await apiClient.get(`${API_ENDPOINTS.TIME_LOGS_ACTIVE}?userId=${userId}`);
  return (data?.data ? data.data : data) || null;
}

export async function getAccumulatedSecondsToday(): Promise<number> {
  try {
    const userId = useAuthStore.getState().user?.userId;
    const url = userId
      ? `${API_ENDPOINTS.TIME_LOGS_ACCUMULATED_TODAY}?userId=${userId}`
      : API_ENDPOINTS.TIME_LOGS_ACCUMULATED_TODAY;
    const { data } = await apiClient.get(url);
    const val = typeof data === 'number' ? data : (data?.data ?? 0);
    return typeof val === 'number' && !isNaN(val) ? Math.max(0, val) : 0;
  } catch (err) {
    console.error('Failed to get accumulated seconds today:', err);
    return 0;
  }
}

export async function getTaskAccumulatedSecondsToday(taskId: number | string): Promise<number> {
  if (!taskId) return 0;
  try {
    const userId = useAuthStore.getState().user?.userId;
    const url = userId
      ? `${API_ENDPOINTS.TASK_ACCUMULATED_TODAY(Number(taskId))}?userId=${userId}`
      : API_ENDPOINTS.TASK_ACCUMULATED_TODAY(Number(taskId));
    const { data } = await apiClient.get(url);
    const val = typeof data === 'number' ? data : (data?.data ?? 0);
    if (typeof val === 'number' && !isNaN(val) && val >= 0) {
      return val;
    }
  } catch {
    // Fallback to client-side logs calculation
  }
  return getPreviousSecondsForTask(taskId);
}

/**
 * Calculates accumulated time logged today for a given task (in seconds).
 * Uses durationMinutes from each completed log as the primary source
 * (already computed server-side), falling back to startTime/endTime arithmetic.
 */
export async function getPreviousSecondsForTask(
  taskId: number | string,
): Promise<number> {
  if (!taskId) return 0;

  try {
    let logs: any[] = [];

    try {
      const userId = useAuthStore.getState().user?.userId;
      const res = await apiClient.get(`${API_ENDPOINTS.TIME_LOGS}?userId=${userId}`);
      logs = Array.isArray(res.data) ? res.data : res.data?.data || [];
    } catch {
      // ignore — will return 0
    }

    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const intervals: Array<{ start: number; end: number }> = [];
    const today = new Date();
    const startOfTodayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const parseLogTime = (timeStr: string) => {
      let str = timeStr;
      if (str.includes(' ') && !str.includes('T')) str = str.replace(' ', 'T');
      return new Date(str).getTime();
    };

    for (const log of logs) {
      // Only count completed work logs (endTime present) for this task today
      if (
        String(log.taskId) === String(taskId) &&
        log.endTime &&
        log.startTime &&
        log.timeType !== 'IDLE' &&
        log.timeType !== 'AWAY' &&
        log.timeType !== 'BREAK'
      ) {
        const logStart = parseLogTime(log.startTime);
        const logEnd = parseLogTime(log.endTime);
        if (logEnd > logStart && logEnd >= startOfTodayMs) {
          intervals.push({
            start: Math.max(logStart, startOfTodayMs),
            end: logEnd,
          });
        }
      }
    }

    if (intervals.length === 0) return 0;

    // Merge overlapping intervals to prevent double counting
    intervals.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1];
      if (intervals[i].start <= last.end) {
        last.end = Math.max(last.end, intervals[i].end);
      } else {
        merged.push(intervals[i]);
      }
    }

    const previousSecondsToday = Math.floor(
      merged.reduce((acc, curr) => acc + (curr.end - curr.start) / 1000, 0)
    );

    return previousSecondsToday;
  } catch (err) {
    console.error('Error calculating previous seconds for task:', err);
    return 0;
  }
}

function getLocalIsoString(d: Date = new Date()): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let timerOperationQueue: Promise<any> = Promise.resolve();

function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    timerOperationQueue = timerOperationQueue.then(async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function transitionTimerState(taskId: number, newState: string, effectiveTime?: string) {
  return enqueueOperation(async () => {
    const url = API_ENDPOINTS.TIME_LOGS_TRANSITION(taskId);
    const payload = {
      newState,
      effectiveTime: effectiveTime || getLocalIsoString()
    };
    const response = await apiClient.post(url, payload);
    return response.data;
  });
}


