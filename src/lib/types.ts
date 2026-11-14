/** Contract types: docs/ARCHITECTURE.md sections 4 and 5. Keep in sync with src-tauri. */

export type ErrorCode = "offline" | "unauthorized" | "server" | "validation" | "busy";
export type AppError = { code: ErrorCode; message: string };

export type Company = { tenantId: string; name: string; status: string };
export type Session = {
  user: { id: string; email: string; displayName: string; avatarUrl?: string };
  companies: Company[];
  activeTenantId: string;
  trackingMode: "visible" | "silent";
  firstRunNoticeAccepted: boolean;
};
export type Project = { id: number; name: string; clientName?: string };
export type TaskNode = { id: number; title: string; status?: string; hasChildren: boolean };
/** `path` = breadcrumb titles. */
export type TaskRef = { taskId: number; title: string; projectId: number; projectName: string; path: string[] };
export type BreakReason = { id: string; reasonText: string; durationLimitMinutes?: number };
export type TimerState = "stopped" | "working" | "paused" | "away" | "break" | "idle";
export type TimerSnapshot = {
  state: TimerState;
  timeLogId: number | null;
  task: TaskRef | null;
  startedAt: string | null;
  elapsedSeconds: number;
  todayWorkSeconds: number;
  todayBreakSeconds: number;
  overtime: boolean;
  breakInfo: { reasonText: string; limitSeconds: number | null; startedAt: string } | null;
  queued: number;
  online: boolean;
};
export type AppInfo = {
  version: string;
  platform: "windows" | "linux" | "macos";
  apiUrl: string;
  dev: boolean;
  /** Linux desktop session; `null` on Windows (and macOS) or when unknown. */
  linuxSession: "x11" | "wayland" | null;
};

export type IdleNoteMode = "off" | "optional" | "mandatory";
export type ToastKind = "info" | "success" | "warning" | "error";

/** command name -> [args, result] */
export type Commands = {
  get_session: [void, Session | null];
  sign_in: [{ email: string; password: string }, Session];
  sign_out: [void, void];
  accept_first_run_notice: [void, void];
  switch_company: [{ tenantId: string }, Session];
  list_projects: [void, Project[]];
  list_tasks: [{ projectId: number }, TaskNode[]];
  list_subtasks: [{ taskId: number }, TaskNode[]];
  search_tasks: [{ query: string }, TaskRef[]];
  recent_tasks: [void, TaskRef[]];
  get_timer: [void, TimerSnapshot];
  start_timer: [{ task: TaskRef }, TimerSnapshot];
  pause_timer: [void, TimerSnapshot];
  resume_timer: [void, TimerSnapshot];
  away_timer: [void, TimerSnapshot];
  stop_timer: [void, TimerSnapshot];
  list_break_reasons: [void, BreakReason[]];
  start_break: [{ reasonId: string }, TimerSnapshot];
  end_break: [void, TimerSnapshot];
  submit_idle_note: [{ text: string }, void];
  overtime_decision: [{ continueOvertime: boolean }, TimerSnapshot];
  open_pms_web: [void, void];
  app_info: [void, AppInfo];
};

/** event name -> payload */
export type Events = {
  "timer:changed": TimerSnapshot;
  "session:changed": Session | null;
  "idle:started": { idleSeconds: number; note: IdleNoteMode };
  "idle:ended": { resumed: boolean };
  "overtime:prompt": Record<string, never>;
  toast: { kind: ToastKind; message: string };
  navigate: { to: "picker" | "timer" };
};

export type CommandName = keyof Commands;
export type EventName = keyof Events;

/** Low-level transport: the real Tauri one or the in-memory mock. */
export interface Backend {
  invoke<K extends CommandName>(cmd: K, ...args: Commands[K][0] extends void ? [] : [Commands[K][0]]): Promise<Commands[K][1]>;
  listen<K extends EventName>(event: K, handler: (payload: Events[K]) => void): Promise<() => void>;
}
