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
  return data;
}

export async function stopTimeLog(taskId: number) {
  const userId = useAuthStore.getState().user?.userId;
  const { data } = await apiClient.put(
    `${API_ENDPOINTS.TIME_LOGS_STOP(taskId)}?userId=${userId}`,
  );
  return data;
}
