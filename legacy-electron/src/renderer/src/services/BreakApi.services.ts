import { apiClient } from './apiClient';

export interface BreakReason {
  id: string;
  reasonText: string;
  durationLimitMinutes?: number | null;
}

export const getBreakReasons = async () => {
  const response = await apiClient.get('/breaks/reasons');
  return response.data;
};

export const startBreak = async (timeLogId: number, breakReasonId: string) => {
  const response = await apiClient.post(
    `/tasks/time-logs/${timeLogId}/breaks/start`,
    { breakReasonId }
  );
  return response.data;
};

export const stopBreak = async (timeLogId: number) => {
  const response = await apiClient.put(
    `/tasks/time-logs/${timeLogId}/breaks/stop`
  );
  return response.data;
};
