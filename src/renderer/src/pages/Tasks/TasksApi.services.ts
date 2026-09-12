import { apiClient } from '@/services/apiClient';
import { Task } from '@/types/task';
import { API_ENDPOINTS } from '@/utils/constants';

export type ItemType = 'task' | 'subtask';

export interface AssignedItem extends Task {
  itemType: ItemType;
}

/**
 * Fetch ONLY the tasks and subtasks directly assigned to the user.
 * Each appears as an independent flat card — no parent shown unless user is assigned to it too.
 */
export async function fetchAssignedItems(
  projectId: number,
  userId?: string | number
): Promise<AssignedItem[]> {
  const uid = userId ? String(userId) : null;

  const isAssigned = (t: any): boolean => {
    if (!uid) return true;
    const isAssignee = String(t.assignee || t.assigneeId || '') === uid;
    const isMember = Array.isArray(t.members) && t.members.map(String).includes(uid);
    return isAssignee || isMember;
  };

  // 1. Fetch all tasks for the project
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), {
    params: { size: 500, page: 0 },
  });
  const allTasks: any[] = Array.isArray(data) ? data : (data as any).content || [];

  const topLevel = allTasks.filter((t: any) => !t.parentTaskId);
  const subTasksFromList = allTasks.filter((t: any) => !!t.parentTaskId);

  const result: AssignedItem[] = [];

  // 2. Add top-level tasks directly assigned to user
  for (const task of topLevel) {
    if (isAssigned(task)) {
      result.push({ ...task, itemType: 'task' });
    }
  }

  // 3. Collect subtasks: from list + fetch for each top-level task
  const allSubTasks: any[] = [...subTasksFromList];

  // Fetch subtasks for each top-level task if not already in list
  const topLevelIds = new Set(topLevel.map((t: any) => String(t.id)));
  const fetchedIds = new Set(subTasksFromList.map((s: any) => String(s.parentTaskId)));

  for (const task of topLevel) {
    if (!fetchedIds.has(String(task.id))) {
      try {
        const subRes = await apiClient.get<Task[]>(API_ENDPOINTS.SUB_TASKS(task.id));
        const subData: any[] = Array.isArray(subRes.data)
          ? subRes.data
          : (subRes.data as any).content || [];
        allSubTasks.push(...subData);
      } catch {
        // ignore
      }
    }
  }

  // 4. Add only subtasks directly assigned to user
  for (const sub of allSubTasks) {
    if (isAssigned(sub)) {
      result.push({ ...sub, itemType: 'subtask' });
    }
  }

  return result;
}

/** Legacy exports kept for compatibility */
export async function fetchTasks(projectId: number, search?: string, userId?: string | number): Promise<Task[]> {
  const params: any = { size: 200, page: 0 };
  if (search) params.search = search;
  const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), { params });
  const taskList: any[] = Array.isArray(data) ? data : (data as any).content || [];
  const topLevel = taskList.filter((t: any) => !t.parentTaskId);
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
