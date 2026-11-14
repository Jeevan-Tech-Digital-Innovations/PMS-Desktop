import { createBrowserMock, type MockBackend } from "./mockBackend";
import type {
  AppError,
  AppInfo,
  Backend,
  BreakReason,
  CommandName,
  Commands,
  EventName,
  Events,
  Project,
  Session,
  TaskNode,
  TaskRef,
  TimerSnapshot,
} from "./types";

/** True when running inside the Tauri webview (not a plain browser or a test). */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Real transport: Tauri `invoke` / `listen`. Loaded lazily so the browser build never touches it. */
const tauriBackend: Backend = {
  async invoke(cmd, ...args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(cmd, args[0] as Record<string, unknown> | undefined) as never;
  },
  async listen(event, handler) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(event, (e) => handler(e.payload as never));
  },
};

let current: Backend | undefined;

/** The active transport. Picks Tauri or the in-memory mock on first use. */
export function getBackend(): Backend {
  if (!current) {
    if (isTauri()) {
      current = tauriBackend;
    } else {
      const mock = createBrowserMock(typeof location === "undefined" ? "" : location.search);
      current = mock;
      if (typeof window !== "undefined") (window as unknown as { __pmsMock?: MockBackend }).__pmsMock = mock;
    }
  }
  return current;
}

/** Tests (and the mock) swap the transport here. */
export function setBackend(backend: Backend | undefined): void {
  current = backend;
}

/** Tauri rejects with the serialized `AppError`; anything else becomes a "server" error. */
export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "message" in e && typeof (e as AppError).message === "string") {
    const code = (e as AppError).code;
    return { code: code ?? "server", message: (e as AppError).message };
  }
  if (typeof e === "string" && e) return { code: "server", message: e };
  return { code: "server", message: "Something went wrong. Please try again." };
}

/* ── Typed command wrappers (docs/ARCHITECTURE.md section 4) ─────────────── */

function call<K extends CommandName>(cmd: K, ...args: Commands[K][0] extends void ? [] : [Commands[K][0]]) {
  return getBackend().invoke(cmd, ...args);
}

export const api = {
  getSession: (): Promise<Session | null> => call("get_session"),
  signIn: (email: string, password: string): Promise<Session> => call("sign_in", { email, password }),
  signOut: (): Promise<void> => call("sign_out"),
  acceptFirstRunNotice: (): Promise<void> => call("accept_first_run_notice"),
  switchCompany: (tenantId: string): Promise<Session> => call("switch_company", { tenantId }),
  listProjects: (): Promise<Project[]> => call("list_projects"),
  listTasks: (projectId: number): Promise<TaskNode[]> => call("list_tasks", { projectId }),
  listSubtasks: (taskId: number): Promise<TaskNode[]> => call("list_subtasks", { taskId }),
  searchTasks: (query: string): Promise<TaskRef[]> => call("search_tasks", { query }),
  recentTasks: (): Promise<TaskRef[]> => call("recent_tasks"),
  getTimer: (): Promise<TimerSnapshot> => call("get_timer"),
  startTimer: (task: TaskRef): Promise<TimerSnapshot> => call("start_timer", { task }),
  pauseTimer: (): Promise<TimerSnapshot> => call("pause_timer"),
  resumeTimer: (): Promise<TimerSnapshot> => call("resume_timer"),
  awayTimer: (): Promise<TimerSnapshot> => call("away_timer"),
  stopTimer: (): Promise<TimerSnapshot> => call("stop_timer"),
  listBreakReasons: (): Promise<BreakReason[]> => call("list_break_reasons"),
  startBreak: (reasonId: string): Promise<TimerSnapshot> => call("start_break", { reasonId }),
  endBreak: (): Promise<TimerSnapshot> => call("end_break"),
  submitIdleNote: (text: string): Promise<void> => call("submit_idle_note", { text }),
  overtimeDecision: (continueOvertime: boolean): Promise<TimerSnapshot> => call("overtime_decision", { continueOvertime }),
  openPmsWeb: (): Promise<void> => call("open_pms_web"),
  appInfo: (): Promise<AppInfo> => call("app_info"),
};

/** Subscribe to a backend event; resolves to the unlisten function. */
export function on<K extends EventName>(event: K, handler: (payload: Events[K]) => void): Promise<() => void> {
  return getBackend().listen(event, handler);
}
