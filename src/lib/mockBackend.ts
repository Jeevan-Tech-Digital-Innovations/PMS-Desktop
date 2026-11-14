import type {
  AppError,
  AppInfo,
  Backend,
  BreakReason,
  CommandName,
  Commands,
  Company,
  EventName,
  Events,
  IdleNoteMode,
  Project,
  Session,
  TaskNode,
  TaskRef,
  TimerSnapshot,
  ToastKind,
} from "./types";

/**
 * In-memory stand-in for the Rust core, used by `npm run dev` in a normal browser and by tests.
 * It follows the same contract (command names, payloads, events) as docs/ARCHITECTURE.md.
 *
 * Sign in with any email and any password except "wrong" (unauthorized) or an email that
 * starts with "offline@" (offline error).
 */

type Node = { id: number; title: string; status?: string; children?: Node[] };
type MockProject = { id: number; name: string; clientName?: string; tasks: Node[] };

const PROJECTS: MockProject[] = [
  {
    id: 1,
    name: "Website Redesign",
    clientName: "Acme Pvt Ltd",
    tasks: [
      {
        id: 101,
        title: "Homepage",
        status: "In Progress",
        children: [
          {
            id: 1011,
            title: "Hero section",
            children: [
              { id: 10111, title: "Animation polish" },
              { id: 10112, title: "Copy review" },
            ],
          },
          { id: 1012, title: "Footer links" },
        ],
      },
      { id: 102, title: "Pricing page", status: "To Do" },
      { id: 103, title: "Accessibility audit", status: "In Progress" },
    ],
  },
  {
    id: 2,
    name: "Mobile App",
    clientName: "Globex",
    tasks: [
      {
        id: 201,
        title: "Onboarding flow",
        children: [
          { id: 2011, title: "Welcome screens" },
          { id: 2012, title: "Permissions prompt" },
        ],
      },
      { id: 202, title: "Push notifications" },
    ],
  },
  {
    id: 3,
    name: "Internal Operations",
    tasks: [
      { id: 301, title: "Weekly status report" },
      { id: 302, title: "Team meeting" },
    ],
  },
];

const BREAK_REASONS: BreakReason[] = [
  { id: "tea", reasonText: "Tea / coffee break", durationLimitMinutes: 15 },
  { id: "lunch", reasonText: "Lunch", durationLimitMinutes: 30 },
  { id: "snack", reasonText: "Snack", durationLimitMinutes: 15 },
  { id: "personal", reasonText: "Personal errand" },
  { id: "prayer", reasonText: "Prayer", durationLimitMinutes: 20 },
  { id: "health", reasonText: "Health / doctor", durationLimitMinutes: 60 },
];

const COMPANIES: Company[] = [
  { tenantId: "t-acme", name: "Acme Pvt Ltd", status: "active" },
  { tenantId: "t-globex", name: "Globex Corporation", status: "active" },
  { tenantId: "t-initech", name: "Initech Software", status: "active" },
];

function flatten(): TaskRef[] {
  const out: TaskRef[] = [];
  const walk = (project: MockProject, nodes: Node[], parents: string[]) => {
    for (const n of nodes) {
      const path = [...parents, n.title];
      out.push({ taskId: n.id, title: n.title, projectId: project.id, projectName: project.name, path });
      if (n.children) walk(project, n.children, path);
    }
  };
  for (const p of PROJECTS) walk(p, p.tasks, []);
  return out;
}

function findNode(nodes: Node[], id: number): Node | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children && findNode(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}

const toNode = (n: Node): TaskNode => ({
  id: n.id,
  title: n.title,
  status: n.status,
  hasChildren: (n.children?.length ?? 0) > 0,
});

export type MockOptions = {
  /** Start already signed in. Default false. */
  signedIn?: boolean;
  /** First-run notice already accepted. Default true once signed in via `signedIn`, else false. */
  noticeAccepted?: boolean;
  trackingMode?: "visible" | "silent";
  /** Simulated network delay per command, ms. Default 0. */
  latencyMs?: number;
  /** Tick the timer every second like the Rust side does. Default false (tests call `tick()`). */
  autoTick?: boolean;
  /** `app_info.linuxSession`. Default null (Windows). */
  linuxSession?: AppInfo["linuxSession"];
};

const IDLE_TIMER: TimerSnapshot = {
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

export class MockBackend implements Backend {
  private listeners = new Map<string, Set<(payload: never) => void>>();
  private session: Session | null;
  private timer: TimerSnapshot = { ...IDLE_TIMER, todayWorkSeconds: 6 * 3600 + 5 * 60, todayBreakSeconds: 18 * 60 };
  private nextLogId = 5000;
  private interval: ReturnType<typeof setInterval> | undefined;
  private recents: TaskRef[] = flatten()
    .filter((t) => [103, 2011, 301].includes(t.taskId))
    .reverse();
  private opts: Required<Pick<MockOptions, "latencyMs" | "trackingMode" | "linuxSession">>;
  private noticeAccepted: boolean;
  /** Notes submitted through `submit_idle_note` (inspectable in tests). */
  readonly idleNotes: string[] = [];

  constructor(options: MockOptions = {}) {
    this.opts = {
      latencyMs: options.latencyMs ?? 0,
      trackingMode: options.trackingMode ?? "visible",
      linuxSession: options.linuxSession ?? null,
    };
    this.noticeAccepted = options.noticeAccepted ?? options.signedIn === true;
    this.session = options.signedIn ? this.makeSession("anita.rao@acme.com") : null;
    if (options.autoTick) this.interval = setInterval(() => this.tick(), 1000);
  }

  dispose(): void {
    if (this.interval) clearInterval(this.interval);
    this.listeners.clear();
  }

  /* ── Backend ─────────────────────────────────────────────────────────── */

  async listen<K extends EventName>(event: K, handler: (payload: Events[K]) => void): Promise<() => void> {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (payload: never) => void);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler as (payload: never) => void);
    };
  }

  async invoke<K extends CommandName>(
    cmd: K,
    ...rest: Commands[K][0] extends void ? [] : [Commands[K][0]]
  ): Promise<Commands[K][1]> {
    if (this.opts.latencyMs > 0) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const args = rest[0] as never;
    const result = this.handle(cmd, args);
    return result as Commands[K][1];
  }

  /* ── Debug hooks (browser: window.__pmsMock) ─────────────────────────── */

  /** Advance the simulated timer by one second. */
  tick(): void {
    const t = this.timer;
    if (t.state === "stopped") return;
    if (t.state === "working") {
      t.elapsedSeconds += 1;
      t.todayWorkSeconds += 1;
    } else if (t.state === "break") {
      t.todayBreakSeconds += 1;
    }
    if (!t.online) t.queued += 1;
    this.emitTimer();
  }

  setOnline(online: boolean): void {
    this.timer.online = online;
    this.timer.queued = online ? 0 : this.timer.queued || 3;
    this.emitTimer();
  }

  triggerIdle(note: IdleNoteMode = "optional"): void {
    if (this.timer.state === "stopped") return;
    this.timer.state = "idle";
    this.emitTimer();
    if (this.opts.trackingMode === "visible") this.emit("idle:started", { idleSeconds: 300, note });
  }

  endIdle(resumed = true): void {
    if (this.timer.state === "idle" && resumed) this.timer.state = "working";
    this.emitTimer();
    this.emit("idle:ended", { resumed });
    if (resumed) this.emit("toast", { kind: "info", message: "Tracking resumed" });
  }

  /** Pretend the current break started `secondsAgo` ago (to show the over-limit state). */
  backdateBreak(secondsAgo: number): void {
    if (!this.timer.breakInfo) return;
    this.timer.breakInfo = { ...this.timer.breakInfo, startedAt: new Date(Date.now() - secondsAgo * 1000).toISOString() };
    this.emitTimer();
  }

  triggerOvertime(): void {
    if (this.opts.trackingMode === "visible") this.emit("overtime:prompt", {});
  }

  toast(kind: ToastKind, message: string): void {
    this.emit("toast", { kind, message });
  }

  navigate(to: "picker" | "timer"): void {
    this.emit("navigate", { to });
  }

  /* ── Internals ───────────────────────────────────────────────────────── */

  private emit<K extends EventName>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as (p: Events[K]) => void)(payload));
  }

  private emitTimer(): void {
    this.emit("timer:changed", { ...this.timer });
  }

  private makeSession(email: string, activeTenantId = COMPANIES[0].tenantId): Session {
    const name = email
      .split("@")[0]
      .split(/[._-]/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join(" ");
    return {
      user: { id: "u-1", email, displayName: name || email },
      companies: COMPANIES,
      activeTenantId,
      trackingMode: this.opts.trackingMode,
      firstRunNoticeAccepted: this.noticeAccepted,
    };
  }

  private fail(code: AppError["code"], message: string): never {
    throw { code, message } satisfies AppError;
  }

  private requireSession(): Session {
    if (!this.session) this.fail("unauthorized", "Please sign in again.");
    return this.session;
  }

  private snapshot(): TimerSnapshot {
    return { ...this.timer };
  }

  private setTimer(patch: Partial<TimerSnapshot>): TimerSnapshot {
    this.timer = { ...this.timer, ...patch };
    this.emitTimer();
    return this.snapshot();
  }

  private rememberRecent(task: TaskRef): void {
    this.recents = [task, ...this.recents.filter((r) => r.taskId !== task.taskId)].slice(0, 5);
  }

  private stopInternal(): void {
    this.timer = { ...this.timer, state: "stopped", timeLogId: null, task: null, startedAt: null, elapsedSeconds: 0, breakInfo: null, overtime: false };
  }

  private handle(cmd: CommandName, args: never): unknown {
    const a = args as Record<string, never> & never;
    switch (cmd) {
      case "get_session":
        return this.session;
      case "sign_in": {
        const { email, password } = a as unknown as Commands["sign_in"][0];
        if (!email.trim() || !password) this.fail("validation", "Enter your email and password.");
        if (email.startsWith("offline@")) this.fail("offline", "Can't reach PMS. Check your internet connection.");
        if (password === "wrong") this.fail("unauthorized", "Incorrect email or password.");
        this.session = this.makeSession(email.trim());
        this.emit("session:changed", this.session);
        return this.session;
      }
      case "sign_out":
        this.stopInternal();
        this.session = null;
        this.emitTimer();
        this.emit("session:changed", null);
        return undefined;
      case "accept_first_run_notice": {
        const s = this.requireSession();
        this.noticeAccepted = true;
        this.session = { ...s, firstRunNoticeAccepted: true };
        this.emit("session:changed", this.session);
        return undefined;
      }
      case "switch_company": {
        const s = this.requireSession();
        if (this.timer.state !== "stopped") this.fail("busy", "Stop the timer before switching company.");
        const { tenantId } = a as unknown as Commands["switch_company"][0];
        if (!s.companies.some((c) => c.tenantId === tenantId)) this.fail("validation", "Unknown company.");
        this.session = { ...s, activeTenantId: tenantId };
        this.emit("session:changed", this.session);
        return this.session;
      }
      case "list_projects":
        this.requireSession();
        return PROJECTS.map<Project>((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
      case "list_tasks": {
        const { projectId } = a as unknown as Commands["list_tasks"][0];
        return (PROJECTS.find((p) => p.id === projectId)?.tasks ?? []).map(toNode);
      }
      case "list_subtasks": {
        const { taskId } = a as unknown as Commands["list_subtasks"][0];
        for (const p of PROJECTS) {
          const hit = findNode(p.tasks, taskId);
          if (hit) return (hit.children ?? []).map(toNode);
        }
        return [];
      }
      case "search_tasks": {
        const q = (a as unknown as Commands["search_tasks"][0]).query.trim().toLowerCase();
        if (!q) return [];
        return flatten()
          .filter((t) => [t.title, t.projectName, ...t.path].join(" ").toLowerCase().includes(q))
          .slice(0, 30);
      }
      case "recent_tasks":
        return this.recents.slice(0, 5);
      case "get_timer":
        return this.snapshot();
      case "start_timer": {
        const { task } = a as unknown as Commands["start_timer"][0];
        this.rememberRecent(task);
        return this.setTimer({
          state: "working",
          timeLogId: this.nextLogId++,
          task,
          startedAt: new Date().toISOString(),
          elapsedSeconds: 0,
          breakInfo: null,
          overtime: false,
        });
      }
      case "pause_timer":
        return this.setTimer({ state: "paused" });
      case "resume_timer":
        return this.setTimer({ state: "working", breakInfo: null });
      case "away_timer":
        return this.setTimer({ state: "away" });
      case "stop_timer":
        this.stopInternal();
        this.emitTimer();
        return this.snapshot();
      case "list_break_reasons":
        return BREAK_REASONS;
      case "start_break": {
        const { reasonId } = a as unknown as Commands["start_break"][0];
        const reason = BREAK_REASONS.find((r) => r.id === reasonId);
        if (!reason) this.fail("validation", "Unknown break reason.");
        return this.setTimer({
          state: "break",
          breakInfo: {
            reasonText: reason.reasonText,
            limitSeconds: reason.durationLimitMinutes ? reason.durationLimitMinutes * 60 : null,
            startedAt: new Date().toISOString(),
          },
        });
      }
      case "end_break":
        return this.setTimer({ state: "working", breakInfo: null });
      case "submit_idle_note":
        this.idleNotes.push((a as unknown as Commands["submit_idle_note"][0]).text);
        return undefined;
      case "overtime_decision": {
        const { continueOvertime } = a as unknown as Commands["overtime_decision"][0];
        if (!continueOvertime) {
          this.stopInternal();
          this.emitTimer();
          return this.snapshot();
        }
        return this.setTimer({ overtime: true });
      }
      case "open_pms_web":
        if (typeof window !== "undefined" && typeof window.open === "function" && !navigator.userAgent.includes("jsdom")) {
          window.open("https://stagingpms.enjev.com", "_blank", "noopener");
        }
        return undefined;
      case "app_info":
        return {
          version: "2.0.0",
          platform: this.opts.linuxSession ? "linux" : "windows",
          apiUrl: "mock://pms",
          dev: true,
          linuxSession: this.opts.linuxSession,
        } satisfies AppInfo;
    }
  }
}

/** Mock configured from the URL, for `npm run dev` in a browser. ?signedin=1 &silent=1 &notice=1 &wayland=1 */
export function createBrowserMock(search: string): MockBackend {
  const q = new URLSearchParams(search);
  const signedIn = q.has("signedin");
  return new MockBackend({
    signedIn,
    noticeAccepted: signedIn && !q.has("notice"),
    trackingMode: q.has("silent") ? "silent" : "visible",
    linuxSession: q.has("wayland") ? "wayland" : null,
    latencyMs: 150,
    autoTick: true,
  });
}
