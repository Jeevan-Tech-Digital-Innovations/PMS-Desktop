import { apiClient } from '@/services/apiClient';
import { Task } from '@/types/task';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchTasks(projectId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = search ? { search } : {};
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), { params });
  if (userId) {
    return data.filter((t: any) => (String(t.assignee || t.assigneeId) === String(userId) || t.members?.map(String).includes(String(userId))) && !t.parentTaskId);
  }
  return data;
}

export async function fetchSubTasks(taskId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = search ? { search } : {};
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.SUB_TASKS(taskId), { params });
  if (userId) {
    return data.filter((t: any) => String(t.assignee || t.assigneeId) === String(userId) || t.members?.map(String).includes(String(userId)));
  }
  return data;
}
