import { apiClient } from '@/services/apiClient';
import { Task } from '@/types/task';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchTasks(projectId: number, search?: string): Promise<Task[]> {
  const params = search ? { search } : {};
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), { params });
  return data;
}

export async function fetchSubTasks(taskId: number, search?: string): Promise<Task[]> {
  const params = search ? { search } : {};
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.SUB_TASKS(taskId), { params });
  return data;
}
