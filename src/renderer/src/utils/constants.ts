// API endpoints — verified against PMS API controllers
// Endpoints marked as NOT_IMPLEMENTED do not exist in the PMS API backend.
export const API_ENDPOINTS = {
  // ── Auth (AuthController: /api/v1/auth) ──────────────────────────
  AUTH_LOGIN: '/auth/login',
  AUTH_REFRESH: '/auth/refresh-token',
  AUTH_LOGOUT: '/auth/logout',

  // ── Projects (ProjectController: /api/v1/projects) ──────────────
  PROJECTS: '/projects',
  PROJECT_TASKS: (projectId: number) => `/projects/${projectId}/tasks`,
  // ── Time Logs (ProjectTaskController: /api/v1/tasks) ────────────
  SUB_TASKS: (taskId: number) => `/tasks/${taskId}/subtasks`,
  // The API uses @AuthenticationPrincipal (JWT) for userId — no query param needed.
  TIME_LOGS_START: (taskId: number) => `/tasks/${taskId}/time-logs/start`,
  TIME_LOGS_STOP: (taskId: number) => `/tasks/${taskId}/time-logs/end`,

  // ── NOT IMPLEMENTED in PMS API ─────────────────────────────────
  // The following endpoints do not exist in the PMS API backend.
  // They are kept as comments for reference. When the backend adds
  // these endpoints, uncomment and re-enable the corresponding service calls.
  //
  // BREAK_REASONS: '/breaks/reasons',
  // BREAK_START: (timeLogId: number) => `/tasks/time-logs/${timeLogId}/breaks/start`,
  // BREAK_STOP: (timeLogId: number) => `/tasks/time-logs/${timeLogId}/breaks/stop`,
  //
  // NOTES_ADD: (timeLogId: number) => `/tasks/time-logs/${timeLogId}/notes`,
  //
  // SCREENSHOTS_UPLOAD: (timeLogId: number) => `/time-logs/${timeLogId}/screenshots`,
} as const;

// UI thresholds
export const TIMER_TICK_INTERVAL_MS = 1000; // 1 second

// Available break reasons (fallback if API fails)
export const DEFAULT_BREAK_REASONS = [
  { id: 1, reasonText: 'Lunch Break' },
  { id: 2, reasonText: 'Morning Tea Break' },
  { id: 3, reasonText: 'Evening Tea Break' },
  { id: 4, reasonText: 'Discussion Break' },
  { id: 5, reasonText: 'Meeting Break' },
  { id: 6, reasonText: 'Internal Discussion' },
  { id: 7, reasonText: 'Client Discussion' },
  { id: 8, reasonText: 'Team Meeting' },
  { id: 9, reasonText: 'Client Call' },
  { id: 10, reasonText: 'KT Session' },
  { id: 11, reasonText: 'Training / Learning' },
  { id: 12, reasonText: 'Research & Analysis' },
  { id: 13, reasonText: 'Waiting for Input' },
] as const;
