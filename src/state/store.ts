import { api, on, toAppError } from "../lib/backend";
import type { AppError, AppInfo, IdleNoteMode, Session, TaskRef, TimerSnapshot, ToastKind } from "../lib/types";

export const TOAST_MS = 3000;
const MAX_TOASTS = 3;

export const STOPPED_TIMER: TimerSnapshot = {
  state: "stopped",
  timeLogId: null,
  task: null,
  startedAt: null,
  elapsedSeconds: 0,
  todayWorkSeconds: 0,
  todayBreakSeconds: 0,
  overtime: false,
  breakInfo: null,
  queued: 0,
  online: true,
};

export type Toast = { id: number; kind: ToastKind; message: string };
export type IdlePrompt = { idleSeconds: number; note: Exclude<IdleNoteMode, "off"> };

export type AppState = {
  /** First session/timer fetch finished. */
  booted: boolean;
  session: Session | null;
  /** Latest `timer:changed` snapshot. The UI never counts time itself. */
  timer: TimerSnapshot;
  appInfo: AppInfo | null;
  toasts: Toast[];
  idle: IdlePrompt | null;
  overtimePrompt: boolean;
  /** User asked for the task picker while a timer is running. */
  pickerOpen: boolean;
  /** A command is in flight. */
  busy: boolean;
};

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: AppError };

const INITIAL: AppState = {
  booted: false,
  session: null,
  timer: STOPPED_TIMER,
  appInfo: null,
  toasts: [],
  idle: null,
  overtimePrompt: false,
  pickerOpen: false,
  busy: false,
};

/**
 * Holds the session, the latest timer snapshot and transient UI state.
 * Subscribes to backend events once in `start()`.
 */
export class AppStore {
  private state: AppState = INITIAL;
  private listeners = new Set<() => void>();
  private toastId = 0;
  private timerSeq = 0;
  private toastTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  getState = (): AppState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Wire up events and load the first state. Returns a cleanup function. */
  start(): () => void {
    this.disposed = false;
    let stopped = false;
    const unlisten: Array<() => void> = [];
    const reg = (p: Promise<() => void>) =>
      p.then((u) => {
        if (stopped) u();
        else unlisten.push(u);
      });

    void reg(on("timer:changed", (snap) => this.applyTimer(snap, true)));
    void reg(
      on("session:changed", (s) => {
        this.set({ session: s });
        if (!s) this.set({ timer: STOPPED_TIMER, idle: null, overtimePrompt: false, pickerOpen: false });
      }),
    );
    void reg(
      on("idle:started", (p) => {
        if (this.visible() && p.note !== "off") this.set({ idle: { idleSeconds: p.idleSeconds, note: p.note } });
      }),
    );
    void reg(on("idle:ended", () => this.set({ idle: null })));
    void reg(
      on("overtime:prompt", () => {
        if (this.visible()) this.set({ overtimePrompt: true });
      }),
    );
    void reg(
      on("toast", (t) => {
        if (this.visible()) this.pushToast(t.kind, t.message);
      }),
    );
    void reg(on("navigate", (n) => this.set({ pickerOpen: n.to === "picker" })));

    void this.load();

    return () => {
      stopped = true;
      this.disposed = true;
      unlisten.splice(0).forEach((u) => u());
      this.toastTimers.forEach(clearTimeout);
      this.toastTimers.clear();
    };
  }

  private async load(): Promise<void> {
    const [session, timer, info] = await Promise.allSettled([api.getSession(), api.getTimer(), api.appInfo()]);
    if (this.disposed) return;
    this.set({
      booted: true,
      session: session.status === "fulfilled" ? session.value : null,
      appInfo: info.status === "fulfilled" ? info.value : null,
    });
    if (timer.status === "fulfilled" && this.timerSeq === 0) this.applyTimer(timer.value, false);
    if (session.status === "rejected") this.pushToast("error", toAppError(session.reason).message);
  }

  private visible(): boolean {
    // Silent mode: the Rust side sends no toasts/idle/overtime, and we ignore stragglers.
    return this.state.session?.trackingMode !== "silent";
  }

  private applyTimer(snap: TimerSnapshot, fromEvent: boolean): void {
    if (fromEvent) this.timerSeq += 1;
    const patch: Partial<AppState> = { timer: snap };
    if (snap.state === "stopped") {
      patch.pickerOpen = false;
      patch.overtimePrompt = false;
    }
    if (snap.state !== "idle") patch.idle = null;
    this.set(patch);
  }

  /* ── UI state ──────────────────────────────────────────────────────── */

  pushToast(kind: ToastKind, message: string): void {
    const id = ++this.toastId;
    const toasts = [...this.state.toasts, { id, kind, message }].slice(-MAX_TOASTS);
    this.set({ toasts });
    const timer = setTimeout(() => {
      this.toastTimers.delete(timer);
      this.dismissToast(id);
    }, TOAST_MS);
    this.toastTimers.add(timer);
  }

  dismissToast(id: number): void {
    if (this.state.toasts.some((t) => t.id === id)) this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  openPicker = (): void => this.set({ pickerOpen: true });
  closePicker = (): void => this.set({ pickerOpen: false });

  /* ── Commands ──────────────────────────────────────────────────────── */

  private async guarded<T>(fn: () => Promise<T>, opts: { toastErrors?: boolean } = {}): Promise<Result<T>> {
    const toastErrors = opts.toastErrors ?? true;
    this.set({ busy: true });
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      const error = toAppError(e);
      if (toastErrors) this.pushToast(error.code === "busy" ? "warning" : "error", error.message);
      return { ok: false, error };
    } finally {
      if (!this.disposed) this.set({ busy: false });
    }
  }

  /** Run a command that returns a snapshot; ignore it if a newer event already landed. */
  private async timerCommand(fn: () => Promise<TimerSnapshot>): Promise<Result<TimerSnapshot>> {
    const seq = this.timerSeq;
    const res = await this.guarded(fn);
    if (res.ok && this.timerSeq === seq) this.applyTimer(res.value, false);
    return res;
  }

  /** Sign-in errors are shown inline by the form, not as a toast. */
  async signIn(email: string, password: string): Promise<Result<Session>> {
    const res = await this.guarded(() => api.signIn(email, password), { toastErrors: false });
    if (res.ok) {
      this.set({ session: res.value, pickerOpen: false });
      void api.getTimer().then((t) => this.applyTimer(t, false), () => undefined);
    }
    return res;
  }

  async signOut(): Promise<Result> {
    const res = await this.guarded(() => api.signOut());
    if (res.ok) this.set({ session: null, timer: STOPPED_TIMER, idle: null, overtimePrompt: false, pickerOpen: false });
    return res;
  }

  async acceptFirstRunNotice(): Promise<Result> {
    const res = await this.guarded(() => api.acceptFirstRunNotice());
    if (res.ok && this.state.session) this.set({ session: { ...this.state.session, firstRunNoticeAccepted: true } });
    return res;
  }

  async switchCompany(tenantId: string): Promise<Result<Session>> {
    const res = await this.guarded(() => api.switchCompany(tenantId));
    if (res.ok) this.set({ session: res.value });
    return res;
  }

  startTask = (task: TaskRef) => this.timerCommand(() => api.startTimer(task)).then((r) => {
    if (r.ok) this.set({ pickerOpen: false });
    return r;
  });
  pause = () => this.timerCommand(() => api.pauseTimer());
  resume = () => this.timerCommand(() => api.resumeTimer());
  away = () => this.timerCommand(() => api.awayTimer());
  stop = () => this.timerCommand(() => api.stopTimer());
  startBreak = (reasonId: string) => this.timerCommand(() => api.startBreak(reasonId));
  endBreak = () => this.timerCommand(() => api.endBreak());

  async submitIdleNote(text: string): Promise<Result> {
    const res = await this.guarded(() => api.submitIdleNote(text));
    if (res.ok) this.set({ idle: null });
    return res;
  }

  /** Close the idle sheet without a note (only offered when the note is optional). */
  skipIdleNote = (): void => this.set({ idle: null });

  async overtimeDecision(continueOvertime: boolean): Promise<Result<TimerSnapshot>> {
    this.set({ overtimePrompt: false });
    return this.timerCommand(() => api.overtimeDecision(continueOvertime));
  }

  openPms = () => this.guarded(() => api.openPmsWeb());
}
