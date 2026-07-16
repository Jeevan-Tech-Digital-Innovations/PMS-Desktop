# Workstatus Desktop Application — Architecture & Project Structure

## Application Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                       │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────────────┐  │
│  │  Tray Manager│ │  Screenshot   │ │  Background Services   │  │
│  │  (system     │ │  Service      │ │  - Activity Monitor    │  │
│  │   tray icon) │ │  (10min loop) │ │  - Idle Detector       │  │
│  └──────┬───────┘ └──────┬────────┘ │  - Active Window Track │  │
│  ┌──────┴───────┐ ┌──────┴────────┐ │  - Heartbeat Sync     │  │
│  │  Auth Store  │ │  Upload Queue │ └──────────┬─────────────┘  │
│  │  (electron-  │ │  (screenshots │            │                │
│  │   store)     │ │   to S3)      │            │                │
│  └──────────────┘ └───────────────┘            │                │
└──────────────────────────────┬──────────────────────────────────┘
                               │ IPC (contextBridge)
┌──────────────────────────────┴──────────────────────────────────┐
│                   Electron Renderer Process                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     React App                             │   │
│  │  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │  Login   │→│  Dashboard │→│ Projects │→│  Tasks   │  │   │
│  │  └──────────┘ └──────┬─────┘ └──────────┘ └────┬─────┘  │   │
│  │                       │                         │         │   │
│  │              ┌────────┴──────┐    ┌─────────────┴──────┐  │   │
│  │              │ Time Tracking │    │  Break / Notes     │  │   │
│  │              │   Session     │    │  Modals            │  │   │
│  │              └───────────────┘    └────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐  │
│  │  Zustand     │ │  React Query │ │  Axios Interceptor      │  │
│  │  (timer, UI) │ │  (API cache) │ │  (auth, refresh, retry) │  │
│  └──────────────┘ └──────────────┘ └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External Backend API                        │
│            https://api.workstatus.com/api/v1/...                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Folder & Naming Conventions

Adapted from the simta_react standard. Every rule below applies to the renderer (React) code.

### Casing Rule of Thumb
- **PascalCase** for anything that is a React page or component (`Login`, `Dashboard`, `Timer`).
- **lowercase** for structural/container folders (`pages`, `components`, `hooks`, `services`, `stores`, `utils`, `types`, `layout`, `route`, `styles`).

### File Naming Rules
- **No "Page" or "Component" suffix in filenames** — `Login.tsx` not `LoginPage.tsx`.
- Route files: `Login.routes.tsx`
- API service files: `LoginApi.services.ts`
- CSS Modules: `Login.module.css`
- Barrel exports: `index.ts`

---

## 1. Page Module Structure

Every top-level page is a self-contained module under `src/renderer/src/pages/`.

### Standard Layout

```text
src/renderer/src/pages/Login/
├── index.ts                          # Public barrel export (required)
├── Login.routes.tsx                  # Route definitions (required)
├── LoginApi.services.ts              # API/data layer (required)
└── Login/                            # Page entry component folder (required)
    ├── Login.tsx                     # Page component
    └── Login.module.css              # Scoped page styles
```

### Rules
- Use **PascalCase** for page folder names (`Login`, `Dashboard`, `Projects`).
- Every page module **must** contain `index.ts`, `PageName.routes.tsx`, `PageNameApi.services.ts`, and a `PageName/` sub-folder.
- The page entry component lives in a sub-folder with the same name as the page: `Login/Login.tsx`.
- Page-level styles are **CSS Modules**: `Login/Login.module.css`.

---

## 2. Page Components (Local Sections)

Sections or blocks that belong to a single page live inside that page's `components/` folder.

### Standard Layout

```text
src/renderer/src/pages/Dashboard/components/Timer/
├── Timer.tsx
└── Timer.module.css
```

### Rules
- **PascalCase** for component folder and file names.
- Every local component gets its own folder with a matching CSS Module.
- Do **not** create nested `components` folders inside a component.

---

## 3. Shared Components

### 3.1 Application-wide primitives (`src/renderer/src/components/`)

Generic UI building blocks independent of any page.

```text
src/renderer/src/components/LoadingSpinner/
├── LoadingSpinner.tsx
└── LoadingSpinner.module.css
```

Examples: `LoadingSpinner`, `SearchInput`, `ErrorBoundary`, `ConnectionStatus`.

### Rules
- Same naming rules as local components.
- If a component is reused across pages but is generic, prefer `src/renderer/src/components/`.
- Don't put page-specific sections in the shared `components/` folder.

---

## 4. Route Files

Each page module owns its routes.

```text
src/renderer/src/pages/Login/Login.routes.tsx
```

```tsx
import type { RouteObject } from "react-router-dom";

export const loginRoutes: RouteObject[] = [
  { index: true, lazy: () => import("./Login/Login") },
];
```

Rules:
- File name: `PageName.routes.tsx`
- Export name: `pageNameRoutes` (camelCase)
- Lazy-load the page entry component

---

## 5. Barrel Exports

Each page module exposes its public API through `index.ts`.

```ts
// src/renderer/src/pages/Login/index.ts
export { loginRoutes } from "./Login.routes";
export * from "./LoginApi.services";
```

---

## 6. CSS Module Conventions

- Component/page styles: `ComponentName.module.css`
- Import: `import styles from './ComponentName.module.css'`
- Usage: `className={styles.heroSection}` or `className={styles['hero-section']}`
- Use `:global(...)` sparingly for un-scoped selectors
- Global design tokens/utilities go in `src/renderer/src/styles/`

---

## 7. Naming Summary

| Item | Convention | Example |
|------|------------|---------|
| Structural folders | lowercase | `pages/`, `components/`, `hooks/`, `stores/` |
| Page folder | PascalCase | `Dashboard` |
| Page component folder | Same as page | `Dashboard/Dashboard/` |
| Page component file | PascalCase | `Dashboard.tsx` |
| Page CSS Module | `*.module.css` | `Dashboard.module.css` |
| Route file | `PageName.routes.tsx` | `Dashboard.routes.tsx` |
| Service/API file | `PageNameApi.services.ts` | `DashboardApi.services.ts` |
| Component folder | PascalCase | `Timer` |
| Component file | PascalCase | `Timer.tsx` |
| Component CSS Module | `*.module.css` | `Timer.module.css` |

---

## 8. Do's and Don'ts

### Do
- Use **CSS Modules** for all component and page styles
- Keep one component per folder with its own module CSS
- Use path aliases for cross-module imports (`@renderer/components/...`, `@renderer/hooks/...`)
- Run `npm run build` after structural changes
- Place page-specific code inside the page module
- Use the barrel `index.ts` to expose public page APIs

### Don't
- Don't put page-specific sections in `src/renderer/src/components/`
- Don't use plain `.css` for component styles unless intentionally global
- Don't import styles from another component's module
- Don't create deeply nested `components/components/...` folders
- Don't use "Page" or "Component" as a word in filenames

---

## Full Folder Structure

```
pms_desktop/
├── TECH_STACK.md
├── PROJECT_STRUCTURE.md              ← This file
├── package.json
├── electron-builder.yml
├── electron.vite.config.ts
├── tsconfig.json
├── .env.example
├── .gitignore
│
├── resources/                        ← App icons, installer assets
│   ├── icon.ico
│   └── icon.png
│
├── src/
│   ├── main/                         ← Electron Main Process
│   │   ├── index.ts                  ← App entry, window creation, tray
│   │   ├── tray.ts                   ← System tray menu
│   │   │
│   │   ├── services/
│   │   │   ├── screenshot.ts         ← Capture screenshot every 10 min
│   │   │   ├── activity.ts           ← Keystroke/mouse event counting
│   │   │   ├── idle.ts              ← Idle time detection
│   │   │   ├── activeWindow.ts       ← Active window title polling
│   │   │   ├── heartbeat.ts          ← 5-min backend sync ping
│   │   │   └── uploader.ts           ← Multipart screenshot upload queue
│   │   │
│   │   └── utils/
│   │       ├── authStore.ts          ← electron-store for tokens
│   │       ├── ipcChannels.ts        ← IPC channel name constants
│   │       └── logger.ts             ← Main process logging
│   │
│   ├── preload/                      ← Preload Script (security boundary)
│   │   └── index.ts                  ← Exposes safe IPC to renderer
│   │
│   └── renderer/                     ← React Frontend (Renderer Process)
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx              ← React DOM entry point
│       │   ├── App.tsx               ← Root component + router
│       │   │
│       │   ├── pages/
│       │   │   ├── Login/
│       │   │   │   ├── index.ts
│       │   │   │   ├── Login.routes.tsx
│       │   │   │   ├── LoginApi.services.ts
│       │   │   │   ├── Login/
│       │   │   │   │   ├── Login.tsx
│       │   │   │   │   └── Login.module.css
│       │   │   │   └── components/
│       │   │   │       └── LoginForm/
│       │   │   │           ├── LoginForm.tsx
│       │   │   │           └── LoginForm.module.css
│       │   │   │
│       │   │   ├── Dashboard/
│       │   │   │   ├── index.ts
│       │   │   │   ├── Dashboard.routes.tsx
│       │   │   │   ├── DashboardApi.services.ts
│       │   │   │   ├── Dashboard/
│       │   │   │   │   ├── Dashboard.tsx
│       │   │   │   │   └── Dashboard.module.css
│       │   │   │   └── components/
│       │   │   │       ├── Timer/
│       │   │   │       ├── WorkTimeCounter/
│       │   │   │       ├── BreakTimeCounter/
│       │   │   │       ├── ActiveProjectCard/
│       │   │   │       ├── StartButton/
│       │   │   │       ├── StatusIndicator/
│       │   │   │       └── TodaysActivity/
│       │   │   │
│       │   │   ├── Projects/
│       │   │   │   ├── index.ts
│       │   │   │   ├── Projects.routes.tsx
│       │   │   │   ├── ProjectsApi.services.ts
│       │   │   │   ├── Projects/
│       │   │   │   │   ├── Projects.tsx
│       │   │   │   │   └── Projects.module.css
│       │   │   │   └── components/
│       │   │   │       ├── ProjectList/
│       │   │   │       └── ProjectSearchBar/
│       │   │   │
│       │   │   ├── Tasks/
│       │   │   │   ├── index.ts
│       │   │   │   ├── Tasks.routes.tsx
│       │   │   │   ├── TasksApi.services.ts
│       │   │   │   ├── Tasks/
│       │   │   │   │   ├── Tasks.tsx
│       │   │   │   │   └── Tasks.module.css
│       │   │   │   └── components/
│       │   │   │       ├── TaskList/
│       │   │   │       ├── TaskSearchBar/
│       │   │   │       └── CreateTaskButton/
│       │   │   │
│       │   │   ├── TimeTracking/
│       │   │   │   ├── index.ts
│       │   │   │   ├── TimeTracking.routes.tsx
│       │   │   │   ├── TimeTrackingApi.services.ts
│       │   │   │   ├── TimeTracking/
│       │   │   │   │   ├── TimeTracking.tsx
│       │   │   │   │   └── TimeTracking.module.css
│       │   │   │   └── components/
│       │   │   │       ├── RunningTimer/
│       │   │   │       ├── StopButton/
│       │   │   │       ├── BreakButton/
│       │   │   │       └── AddNoteButton/
│       │   │   │
│       │   │   └── Settings/
│       │   │       ├── index.ts
│       │   │       ├── Settings.routes.tsx
│       │   │       ├── SettingsApi.services.ts
│       │   │       └── Settings/
│       │   │           ├── Settings.tsx
│       │   │           └── Settings.module.css
│       │   │
│       │   ├── components/               ← Shared app-wide components
│       │   │   ├── LoadingSpinner/
│       │   │   │   ├── LoadingSpinner.tsx
│       │   │   │   └── LoadingSpinner.module.css
│       │   │   ├── SearchInput/
│       │   │   │   ├── SearchInput.tsx
│       │   │   │   └── SearchInput.module.css
│       │   │   ├── ErrorBoundary/
│       │   │   │   └── ErrorBoundary.tsx
│       │   │   └── ProfileMenu/
│       │   │       ├── ProfileMenu.tsx
│       │   │       └── ProfileMenu.module.css
│       │   │
│       │   ├── layout/                   ← Layout shell
│       │   │   ├── AppLayout/
│       │   │   │   ├── AppLayout.tsx
│       │   │   │   └── AppLayout.module.css
│       │   │   └── AuthLayout/
│       │   │       ├── AuthLayout.tsx
│       │   │       └── AuthLayout.module.css
│       │   │
│       │   ├── modals/                   ← Global modals
│       │   │   ├── BreakReason/
│       │   │   │   ├── BreakReason.tsx
│       │   │   │   └── BreakReason.module.css
│       │   │   ├── NoteModal/
│       │   │   │   ├── NoteModal.tsx
│       │   │   │   └── NoteModal.module.css
│       │   │   └── IdleTime/
│       │   │       ├── IdleTime.tsx
│       │   │       └── IdleTime.module.css
│       │   │
│       │   ├── hooks/                    ← Shared hooks
│       │   │   ├── useTimer.ts
│       │   │   ├── useBreak.ts
│       │   │   ├── useIdleDetection.ts
│       │   │   ├── useActivityMonitor.ts
│       │   │   └── useAuth.ts
│       │   │
│       │   ├── stores/                   ← Zustand stores
│       │   │   ├── authStore.ts
│       │   │   ├── timerStore.ts
│       │   │   ├── projectStore.ts
│       │   │   └── uiStore.ts
│       │   │
│       │   ├── services/                 ← Global API client & helpers
│       │   │   └── apiClient.ts          ← Axios instance + interceptors
│       │   │
│       │   ├── types/                    ← Shared TypeScript types
│       │   │   ├── auth.ts
│       │   │   ├── project.ts
│       │   │   ├── task.ts
│       │   │   ├── timeLog.ts
│       │   │   ├── break.ts
│       │   │   └── note.ts
│       │   │
│       │   ├── utils/                    ← Pure helper functions
│       │   │   ├── formatTime.ts
│       │   │   └── constants.ts
│       │   │
│       │   ├── styles/                   ← Global styles & design tokens
│       │   │   └── globals.css
│       │   │
│       │   └── assets/                   ← Static assets
│       │       └── logo.svg
│       │
│       └── tailwind.config.js
│
└── tests/
    ├── main/
    └── renderer/
```

---

## Process Architecture (Electron)

### Main Process (`src/main/`)
Owns OS-level operations. Never directly manipulates the UI.
- Creates the `BrowserWindow`
- Manages system tray
- Runs background services on intervals
- Sends data to renderer via `ipcMain.handle()` / `webContents.send()`

### Preload Script (`src/preload/`)
Security boundary. Exposes a narrow `window.electronAPI` object via `contextBridge`.

### Renderer Process (`src/renderer/`)
Standard React SPA. No Node.js access. All OS operations go through `window.electronAPI`.

---

## Data Flow — Time Tracking Session

```
1. User selects Project → API: GET /projects
2. User selects Task    → API: GET /projects/{id}/tasks
3. User clicks Start    → Renderer sends IPC 'timer:start'
                          Main process begins:
                            - Heartbeat (every 5 min → POST time-log sync)
                            - Activity monitor (uiohook-napi event counters)
                            - Active window polling (every 30 sec)
                            - Screenshot timer (every 10 min)
                          Renderer starts:
                            - UI timer (setInterval every 1 sec)
                            - Updates Zustand timerStore

4. User clicks Break    → BreakReason modal opens
                          User selects reason
                          API: POST /time-logs/{id}/breaks/start
                          Main process pauses activity monitor

5. User stops Break     → API: PUT /time-logs/{id}/breaks/stop
                          Main process resumes activity monitor

6. Screenshot fires     → Main: captures → uploads with activity %
                          Main: deletes temp file

7. Idle detected        → Main: IPC 'idle:detected' to renderer
                          Renderer: shows IdleTime modal
                          User chooses keep/discard → API call

8. User clicks Stop     → API: PUT /time-logs/{id}/stop
                          Main: stops all background services
                          Renderer: resets timer
```

---

## Key TypeScript Interfaces

```ts
// Auth
interface LoginRequest { email: string; password: string; rememberMe: boolean; }
interface AuthTokens  { accessToken: string; refreshToken: string; expiresIn: number; }
interface User        { userId: number; username: string; empNo: string; roles: string[]; }

// Project
interface Project {
  id: number; name: string; description: string; status: string;
  clientName: string; logoUrl: string; totalWorkingHours: number;
  billable: boolean; members: number[];
}

// Task
interface Task {
  id: number; title: string; description: string; projectId: number;
  status: string; priority: string; dueDate: string;
  assigneeId: number; members: number[]; billable: boolean;
  estimatedTime: string; subTasks: Task[];
}

// Time Log
interface TimeLog {
  id: number; projectId: number; taskId: number; userId: number;
  startTime: string; endTime: string | null; durationMinutes: number;
  breaks: Break[]; notes: Note[]; screenshots: Screenshot[];
}

// Break
interface BreakReason { id: number; reasonText: string; }
interface Break {
  breakId: number; timeLogId: number; breakReason: string;
  startTime: string; endTime: string | null; durationMinutes: number;
}

// Note
interface Note {
  noteId: number; timeLogId: number; noteText: string; createdAt: string;
}

// Screenshot upload payload
interface ScreenshotPayload {
  capturedAt: string;
  keyboardActivity: number;
  mouseActivity: number;
  activeWindowTitle: string;
}
```

---

## IPC Channel Registry

| Channel                  | Direction        | Purpose                          |
|--------------------------|------------------|----------------------------------|
| `auth:get-tokens`        | renderer → main  | Retrieve stored tokens           |
| `auth:save-tokens`       | renderer → main  | Persist tokens after login       |
| `auth:clear-tokens`      | renderer → main  | Remove tokens on logout          |
| `timer:start`            | renderer → main  | Start background tracking        |
| `timer:stop`             | renderer → main  | Stop all background tracking     |
| `timer:tick`             | main → renderer  | Push elapsed time to UI          |
| `idle:detected`          | main → renderer  | Notify idle threshold crossed    |
| `idle:response`          | renderer → main  | User chose keep/discard          |
| `break:start`            | renderer → main  | Pause activity monitor           |
| `break:stop`             | renderer → main  | Resume activity monitor          |
| `screenshot:capture`     | renderer → main  | Trigger manual screenshot        |
| `screenshot:uploaded`    | main → renderer  | Notify upload complete           |
| `app:quit`               | renderer → main  | Graceful shutdown                |
| `app:check-updates`      | renderer → main  | Trigger electron-updater         |

---

## Must-Haves for a New Page

Before a page is considered complete, it must have:

1. `src/renderer/src/pages/PageName/` folder
2. `PageName.routes.tsx` with the route export
3. `index.ts` barrel export
4. `PageName/PageName.tsx` entry component
5. `PageName/PageName.module.css` scoped styles
6. `PageNameApi.services.ts` page service file
7. A successful `npm run build` after creation

---

## Development Milestones

| Phase | Milestone                              | Estimated Effort |
|-------|----------------------------------------|------------------|
| 1     | Electron + React boilerplate           | 2 days           |
| 2     | Authentication (login, tokens, guard)  | 2 days           |
| 3     | Dashboard UI + Timer logic             | 3 days           |
| 4     | Project & Task selection flows         | 2 days           |
| 5     | Time Tracking (start/stop, heartbeat)  | 3 days           |
| 6     | Break management                       | 1 day            |
| 7     | Notes module                           | 1 day            |
| 8     | Screenshot capture + upload            | 2 days           |
| 9     | Activity monitoring (keys/mouse)       | 2 days           |
| 10    | Idle detection + modal                 | 2 days           |
| 11    | Active window tracking                 | 2 days           |
| 12    | Profile menu, settings, auto-update    | 2 days           |
| 13    | Packaging & distribution               | 2 days           |
