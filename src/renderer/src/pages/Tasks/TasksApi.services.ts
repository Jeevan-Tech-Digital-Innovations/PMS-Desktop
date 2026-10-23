import { apiClient } from '@/services/apiClient';
import { Task } from '@/types/task';
import { API_ENDPOINTS } from '@/utils/constants';
import { useAuthStore } from '@/stores/authStore';

export type ItemType = 'task' | 'subtask';

export interface AssignedItem extends Task {
  itemType: ItemType;
  level: number;
  parentTaskTitle?: string;
  hierarchyPath?: string[];
}

/**
 * Gather all candidate user identifiers (UUID, ID, username, email)
 * from the passed parameter, zustand auth store, and JWT token payload.
 */
function getUserIdentifiers(userId?: string | number): Set<string> {
  const ids = new Set<string>();
  if (userId != null && String(userId).trim()) {
    ids.add(String(userId).trim().toLowerCase());
  }

  try {
    const user = useAuthStore.getState().user;
    if (user) {
      if (user.userId != null) ids.add(String(user.userId).trim().toLowerCase());
      if ((user as any).id != null) ids.add(String((user as any).id).trim().toLowerCase());
      if (user.email) ids.add(user.email.trim().toLowerCase());
      if (user.username) ids.add(user.username.trim().toLowerCase());
    }
  } catch {
    // ignore
  }

  try {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.sub) ids.add(String(payload.sub).trim().toLowerCase());
        if (payload.userId) ids.add(String(payload.userId).trim().toLowerCase());
        if (payload.id) ids.add(String(payload.id).trim().toLowerCase());
        if (payload.user_id) ids.add(String(payload.user_id).trim().toLowerCase());
        if (payload.email) ids.add(String(payload.email).trim().toLowerCase());
      }
    }
  } catch {
    // ignore
  }

  return ids;
}

/**
 * Check whether a task or subtask is assigned to any of the user's identifiers.
 */
function isTaskAssigned(t: any, userIds: Set<string>): boolean {
  if (userIds.size === 0) return true;

  // 1. Check assignee
  const assigneeVal = typeof t.assignee === 'object' && t.assignee !== null
    ? (t.assignee.id || t.assignee.userId || '')
    : t.assignee;
  if (assigneeVal && userIds.has(String(assigneeVal).trim().toLowerCase())) return true;

  // 2. Check assigneeId
  const assigneeIdVal = typeof t.assigneeId === 'object' && t.assigneeId !== null
    ? (t.assigneeId.id || t.assigneeId.userId || '')
    : t.assigneeId;
  if (assigneeIdVal && userIds.has(String(assigneeIdVal).trim().toLowerCase())) return true;

  // 3. Check members array (array of strings, UUIDs, or member objects)
  if (Array.isArray(t.members)) {
    for (const m of t.members) {
      const mVal = typeof m === 'object' && m !== null
        ? (m.id || m.userId || m.memberId || '')
        : m;
      if (mVal && userIds.has(String(mVal).trim().toLowerCase())) return true;
    }
  }

  // 4. Check membersString (comma-separated string of UUIDs)
  if (typeof t.membersString === 'string' && t.membersString) {
    const parts = t.membersString.split(',');
    for (const p of parts) {
      if (userIds.has(p.trim().toLowerCase())) return true;
    }
  }

  return false;
}

/**
 * Calculate the depth / level of a task (1 = main task, 2 = subtask, 3 = sub-subtask, 4 = 4th level, etc.)
 */
function calculateTaskLevel(task: any, taskMap: Map<number, any>): number {
  let level = 1;
  let currentParentId = task.parentTaskId;
  const visited = new Set<number>([Number(task.id)]);

  while (currentParentId && taskMap.has(Number(currentParentId))) {
    level++;
    const parentIdNum = Number(currentParentId);
    if (visited.has(parentIdNum)) break;
    visited.add(parentIdNum);
    const parent = taskMap.get(parentIdNum);
    currentParentId = parent?.parentTaskId;
  }
  return level;
}

/**
 * Find root task ID for logical tree grouping
 */
function getRootTaskId(task: any, taskMap: Map<number, any>): number {
  let current = task;
  const visited = new Set<number>([Number(task.id)]);

  while (current.parentTaskId && taskMap.has(Number(current.parentTaskId))) {
    const parentIdNum = Number(current.parentTaskId);
    if (visited.has(parentIdNum)) break;
    visited.add(parentIdNum);
    current = taskMap.get(parentIdNum);
  }
  return Number(current.id);
}

/**
 * Retrieve the parent task title if available
 */
function getParentTitle(task: any, taskMap: Map<number, any>): string | undefined {
  if (!task.parentTaskId) return undefined;
  const parent = taskMap.get(Number(task.parentTaskId));
  return parent ? (parent.title || parent.projectTaskName) : undefined;
}

/**
 * Fetch all tasks and subtasks directly assigned to the user across ALL 4+ levels.
 * Each item is an independent selectable card with its level and parent context.
 */
export async function fetchAssignedItems(
  projectId: number,
  userId?: string | number
): Promise<AssignedItem[]> {
  const userIds = getUserIdentifiers(userId);
  const taskMap = new Map<number, any>();

  // Helper to safely store tasks in map
  const addTask = (t: any) => {
    if (!t) return;
    const id = Number(t.id || t.projectTaskId);
    if (!id || isNaN(id)) return;
    if (!taskMap.has(id)) {
      taskMap.set(id, {
        ...t,
        id,
        title: t.title || t.projectTaskName || 'Untitled Task',
        parentTaskId: t.parentTaskId != null ? Number(t.parentTaskId) : null,
      });
    } else {
      const existing = taskMap.get(id);
      taskMap.set(id, {
        ...existing,
        ...t,
        id,
        title: t.title || existing.title || t.projectTaskName || 'Untitled Task',
        parentTaskId: t.parentTaskId != null ? Number(t.parentTaskId) : existing.parentTaskId,
      });
    }
  };

  // Helper to extract nested tasks
  const extractNested = (item: any) => {
    if (!item) return;
    if (Array.isArray(item.subTasks)) {
      for (const s of item.subTasks) {
        if (s) {
          if (!s.parentTaskId && item.id) s.parentTaskId = item.id;
          addTask(s);
          extractNested(s);
        }
      }
    }
    if (Array.isArray(item.taskList)) {
      for (const s of item.taskList) {
        if (s) {
          if (!s.parentTaskId && item.id) s.parentTaskId = item.id;
          addTask(s);
          extractNested(s);
        }
      }
    }
  };

  // 1. Fetch from /tasks (which queries all tasks across all levels for the project)
  try {
    const res = await apiClient.get<Task[]>('/tasks', {
      params: { projectId, size: 1000, page: 1 },
    });
    const list: any[] = Array.isArray(res.data) ? res.data : (res.data as any)?.content || [];
    for (const t of list) addTask(t);
  } catch {
    // ignore
  }

  // 2. Fetch from PROJECT_TASKS (/projects/${projectId}/tasks)
  try {
    const { data } = await apiClient.get<Task[]>(API_ENDPOINTS.PROJECT_TASKS(projectId), {
      params: { size: 500, page: 0 },
    });
    const list: any[] = Array.isArray(data) ? data : (data as any)?.content || [];
    for (const t of list) addTask(t);
  } catch {
    // ignore
  }

  // 3. Extract any nested subtasks from items fetched so far
  for (const t of Array.from(taskMap.values())) {
    extractNested(t);
  }

  // 4. Iteratively querying subtasks is removed because the `/tasks` endpoint already 
  // returns the complete task hierarchy including all subtasks in a single payload.

  // 5. Build assigned items list with level and parent title
  const result: AssignedItem[] = [];

  for (const task of Array.from(taskMap.values())) {
    if (isTaskAssigned(task, userIds)) {
      const level = calculateTaskLevel(task, taskMap);
      const parentTaskTitle = getParentTitle(task, taskMap);
      const itemType: ItemType = level === 1 ? 'task' : 'subtask';

      result.push({
        ...task,
        itemType,
        level,
        parentTaskTitle,
      });
    }
  }

  // 6. Sort logically: group by root task tree, then level, then id
  result.sort((a, b) => {
    const rootA = getRootTaskId(a, taskMap);
    const rootB = getRootTaskId(b, taskMap);
    if (rootA !== rootB) return rootA - rootB;
    if (a.level !== b.level) return a.level - b.level;
    return a.id - b.id;
  });

  return result;
}

export async function createTask(payload: {
  title: string;
  projectId: number;
  parentTaskId?: number | null;
  description?: string;
  dueDate?: string;
  estimatedTime?: string;
  assigneeId?: string | number | null;
}): Promise<any> {
  const { data } = await apiClient.post('/tasks', {
    ...payload,
    status: 'OPEN',
    priority: 'MEDIUM',
    billable: true,
    list: 'General',
    estimatedTime: payload.estimatedTime || '00:00:00',
  });
  return data?.data ? data.data : data;
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

export async function updateTaskStatus(taskId: number, status: string, title?: string): Promise<any> {
  const { data } = await apiClient.put(`/tasks/${taskId}`, {
    status,
    ...(title ? { title } : {}),
  });
  return data?.data ? data.data : data;
}

export async function completeTask(task: Task | AssignedItem): Promise<any> {
  return updateTaskStatus(task.id, 'Completed', task.title);
}
