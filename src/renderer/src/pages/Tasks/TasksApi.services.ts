import { apiClient } from '@/services/apiClient';
import { Task } from '@/types/task';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchTasks(projectId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = { size: 200, page: 0 };
  if (search) params.search = search;
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), { params });
  // Backend returns a paginated Page<> object; unwrap the content array.
  const taskList: any[] = Array.isArray(data) ? data : (data as any).content || [];

  // Only top-level tasks (no parentTaskId).
  const topLevel = taskList.filter((t: any) => !t.parentTaskId);

  // In Desktop, always restrict to tasks where the user is the assignee or a member,
  // regardless of backend permission level.
  if (userId) {
    const uid = String(userId);
    return topLevel.filter((t: any) => {
      const isAssignee = String(t.assignee || t.assigneeId || '') === uid;
      const isMember = Array.isArray(t.members) && t.members.map(String).includes(uid);
      return isAssignee || isMember;
    });
  }

  return topLevel;
}

export async function fetchSubTasks(taskId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = {};
  if (search) params.search = search;
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.SUB_TASKS(taskId), { params });
  const subList: any[] = Array.isArray(data) ? data : (data as any).content || [];

  // Filter subtasks to only those assigned to the user.
  if (userId) {
    const uid = String(userId);
    return subList.filter((t: any) => {
      const isAssignee = String(t.assignee || t.assigneeId || '') === uid;
      const isMember = Array.isArray(t.members) && t.members.map(String).includes(uid);
      return isAssignee || isMember;
    });
  }

  return subList;
}
