import { apiClient } from './apiClient';

export const addNote = async (timeLogId: number, noteText: string) => {
  try {
    const response = await apiClient.post(
      `/tasks/time-logs/${timeLogId}/notes`,
      { noteText }
    );
    return response.data;
  } catch (err: any) {
    console.error('ADD NOTE ERROR:', err, err.response?.data);
    throw err;
  }
};

export const getNotes = async (timeLogId: number) => {
  const response = await apiClient.get(
    `/tasks/time-logs/${timeLogId}/notes`
  );
  return response.data.data;
};

export const getNotesForTask = async (taskId: number) => {
  const response = await apiClient.get(
    `/tasks/${taskId}/notes`
  );
  return response.data.data;
};

export const updateNote = async (noteId: number, noteText: string) => {
  const response = await apiClient.put(
    `/notes/${noteId}`,
    { noteText }
  );
  return response.data;
};

export const deleteNote = async (noteId: number) => {
  const response = await apiClient.delete(
    `/notes/${noteId}`
  );
  return response.data;
};
