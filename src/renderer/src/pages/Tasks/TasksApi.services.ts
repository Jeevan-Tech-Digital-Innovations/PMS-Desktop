import { apiClient } from '@/services/apiClient';
import { Task } from '@/types/task';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchTasks(projectId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = search ? { search } : {};
  if (userId) {
    const { data } = await apiClient.get<Task[]>(`/tasks/assignee/${userId}`, { params });
    return data.filter(t => Number(t.projectId) === Number(projectId) && !t.parentTaskId);
  }
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), { params });
  return data;
}

export async function fetchSubTasks(taskId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = search ? { search } : {};
  if (userId) {
    const { data } = await apiClient.get<Task[]>(`/tasks/assignee/${userId}`, { params });
    return data.filter(t => Number(t.parentTaskId) === Number(taskId));
  }
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.SUB_TASKS(taskId), { params });
  return data;
}
