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

/**
 * Activity log entry sent to POST /tasks/{taskId}/time-logs/start.
 * Mirrors the PMS API's ActivityLogRequest DTO.
 */
export interface ActivityLogRequest {
  deviceId: string;
  deviceType: string;
  os_version: string;
  ip_address: string;
  timezone: string;
  start: string;
  source_type: string;
  timeType: string;
  user_timezone_gmt: string;
  user_timezone_gmt_dst: string;
}

/**
 * Response from POST /tasks/{taskId}/time-logs/start and
 * PUT /tasks/{taskId}/time-logs/end.
 * The PMS API returns TaskTimeLogResponse directly (not wrapped in { data }).
 */
export interface TaskTimeLogResponse {
  id: number;
  userId: number;
  taskId: number;
  projectId: number;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
}
