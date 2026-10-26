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

export async function getTaskActualSeconds(taskId: number | string): Promise<number> {
  if (!taskId) return 0;
  try {
    const { data } = await apiClient.get(`/tasks/${taskId}`);
    const taskData = data?.data || data;
    if (typeof taskData?.actualTimeSeconds === 'number' && !isNaN(taskData.actualTimeSeconds)) {
      return Math.max(0, taskData.actualTimeSeconds);
    }
    if (taskData?.actualTime && typeof taskData.actualTime === 'string') {
      const parts = taskData.actualTime.trim().split(':').map((p: string) => parseInt(p, 10) || 0);
      if (parts.length === 3) {
        return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
      }
    }
  } catch (err) {
    console.error('Failed to get task actual seconds from server:', err);
  }
  return getTaskAccumulatedSecondsToday(taskId);
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

    let totalDurationSec = 0;
    const intervals: Array<{ start: number; end: number }> = [];

    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();

    const isLogFromToday = (timeStr?: string) => {
      if (!timeStr) return false;
      let str = timeStr;
      if (str.includes(' ') && !str.includes('T')) str = str.replace(' ', 'T');
      const d = new Date(str);
      return (
        !isNaN(d.getTime()) &&
        d.getFullYear() === todayYear &&
        d.getMonth() === todayMonth &&
        d.getDate() === todayDate
      );
    };

    const parseLogTime = (timeStr: string) => {
      let str = timeStr;
      if (str.includes(' ') && !str.includes('T')) str = str.replace(' ', 'T');
      return new Date(str).getTime();
    };

    for (const log of logs) {
      if (String(log.taskId) === String(taskId)) {
        // Exclude logs from previous days — suitcase only tracks TODAY
        if (log.startTime && !isLogFromToday(log.startTime)) {
          continue;
        }

        const tType = String(log.timeType || '').toUpperCase();
        if (tType === 'BREAK' || tType === 'IDLE' || tType === 'AWAY') {
          continue;
        }

        if (log.durationSeconds != null && Number(log.durationSeconds) > 0) {
          totalDurationSec += Number(log.durationSeconds);
        } else if (log.durationMinutes != null && Number(log.durationMinutes) > 0) {
          totalDurationSec += Number(log.durationMinutes) * 60;
        } else if (log.startTime) {
          const logStart = parseLogTime(log.startTime);
          const logEnd = log.endTime ? parseLogTime(log.endTime) : Date.now();
          if (logEnd > logStart) {
            intervals.push({ start: logStart, end: logEnd });
          }
        }
      }
    }

    if (intervals.length > 0) {
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
      const intervalSec = Math.floor(
        merged.reduce((acc, curr) => acc + (curr.end - curr.start) / 1000, 0)
      );
      totalDurationSec = Math.max(totalDurationSec, intervalSec);
    }

    return totalDurationSec;
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


