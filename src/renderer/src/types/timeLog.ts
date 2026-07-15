import { Break } from './break';
import { Note } from './note';

export interface TimeLog {
  id: number;
  projectId: number;
  taskId: number;
  userId: number;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  breaks: Break[];
  notes: Note[];
}

export interface StartTimeLogRequest {
  projectId: number;
  taskId: number;
}

export interface StartTimeLogResponse {
  status: string;
  message: string;
  data: TimeLog;
  timestamp: string;
}
