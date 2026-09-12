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
  const userId = useAuthStore.getState().user?.userId;
  const activityPayload = buildActivityLogPayload();
  const { data } = await apiClient.post(
    `${API_ENDPOINTS.TIME_LOGS_START(taskId)}?userId=${userId}`,
    activityPayload,
  );
  return data?.data ? data.data : data;
}

export async function stopTimeLog(taskId: number) {
  const userId = useAuthStore.getState().user?.userId;
  const { data } = await apiClient.put(
    `${API_ENDPOINTS.TIME_LOGS_STOP(taskId)}?userId=${userId}`,
  );
  return data?.data ? data.data : data;
}

export async function getActiveTimeLog() {
  const { data } = await apiClient.get(API_ENDPOINTS.TIME_LOGS_ACTIVE);
  return (data?.data ? data.data : data) || null;
}

/**
 * Calculates accumulated time logged today for a given task (in seconds).
 * Uses durationMinutes from each completed log as the primary source
 * (already computed server-side), falling back to startTime/endTime arithmetic.
 */
export async function getPreviousSecondsTodayForTask(
  taskId: number | string,
): Promise<number> {
  if (!taskId) return 0;

  try {
    let logs: any[] = [];

    try {
      const res = await apiClient.get(API_ENDPOINTS.TIME_LOGS);
      logs = Array.isArray(res.data) ? res.data : res.data?.data || [];
    } catch {
      // ignore — will return 0
    }

    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();

    let previousSecondsToday = 0;
    for (const log of logs) {
      // Only count completed logs (endTime present) for this task
      if (
        String(log.taskId) === String(taskId) &&
        log.endTime &&
        log.startTime
      ) {
        // Verify the log is from today
        const logStart = new Date(log.startTime).getTime();
        if (logStart >= startOfToday) {
          if (log.durationMinutes != null && log.durationMinutes > 0) {
            // Use server-computed duration (most accurate)
            previousSecondsToday += log.durationMinutes * 60;
          } else {
            // Fallback: compute from timestamps
            const logEnd = new Date(log.endTime).getTime();
            if (logEnd > logStart) {
              previousSecondsToday += Math.floor((logEnd - logStart) / 1000);
            }
          }
        }
      }
    }

    return previousSecondsToday;
  } catch (err) {
    console.error('Error calculating previous seconds for task:', err);
    return 0;
  }
}

