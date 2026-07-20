import { apiClient } from './apiClient';

export const addNote = async (timeLogId: number, noteText: string) => {
  const response = await apiClient.post(
    `/tasks/time-logs/${timeLogId}/notes`,
    { noteText }
  );
  return response.data;
};
