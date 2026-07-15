import { apiClient } from '@/services/apiClient';
import { API_ENDPOINTS } from '@/utils/constants';

export async function startTimeLog(projectId: number, taskId: number) {
  const { data } = await apiClient.post(API_ENDPOINTS.TIME_LOGS_START(taskId), { projectId });
  return data;
}

export async function stopTimeLog(taskId: number) {
  const { data } = await apiClient.put(API_ENDPOINTS.TIME_LOGS_STOP(taskId));
  return data;
}
