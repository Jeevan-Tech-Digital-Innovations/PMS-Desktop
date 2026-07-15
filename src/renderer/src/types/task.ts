export interface Task {
  id: number;
  title: string;
  description: string;
  assigneeId: number;
  members: number[];
  projectId: number;
  parentTaskId: number | null;
  mainTaskId: number | null;
  status: string;
  priority: string;
  dueDate: string;
  billable: boolean;
  list: string;
  estimatedTime: string;
  timeLogs: TimeLogEntry[];
  subTasks: Task[];
}

export interface TimeLogEntry {
  id: number;
  startTime: string;
  endTime: string | null;
}

export interface TaskListResponse extends Array<Task> {}
