# Workstatus Desktop Application — Tech Stack

## Overview
A cross-platform desktop time-tracking application with real-time activity monitoring,
periodic screenshots, and backend synchronization. Built with Electron + React.

---

## Core Technology Stack

### Desktop Framework
| Technology     | Version  | Purpose                                      |
|----------------|----------|----------------------------------------------|
| **Electron**   | ^31.x    | Desktop shell, system APIs, tray, auto-update |
| **electron-builder** | ^25.x | Packaging & distribution (Windows .exe/.msi) |
| **electron-updater** | ^6.x  | Auto-update via GitHub Releases or S3       |
| **electron-store**   | ^10.x | Persistent local config (Remember Me, tokens) |

### Frontend (Renderer Process)
| Technology          | Version  | Purpose                                |
|---------------------|----------|----------------------------------------|
| **React**           | ^18.x    | UI component library                   |
| **TypeScript**      | ^5.x     | Type safety across the app             |
| **Vite**            | ^5.x     | Fast dev server & bundler for Electron |
| **React Router**    | ^6.x     | Client-side navigation                 |
| **Tailwind CSS**    | ^3.x     | Utility-first styling                  |
| **Zustand**         | ^4.x     | Lightweight global state management    |
| **Axios**           | ^1.x     | HTTP client with interceptors          |
| **React Query**     | ^5.x     | Server state, caching, and refetching  |
| **react-hot-toast** | ^2.x     | Toast notifications                    |

### Backend Communication
| Technology          | Purpose                                         |
|---------------------|-------------------------------------------------|
| **Axios**           | REST API calls with Bearer token interceptors    |
| **WebSocket / SSE** | Optional: real-time connection status indicators |

### Node.js Addons (Main Process — OS-level features)
| Technology              | Purpose                                          |
|-------------------------|--------------------------------------------------|
| **desktop-idle**        | Idle time detection (mouse/keyboard inactivity)   |
| **active-win**          | Get active window title & application name        |
| **screenshot-desktop**  | Periodic full-screen screenshot capture            |
| **uiohook-napi**        | Global keyboard/mouse event counting (no keylogging) |
| **node-fetch**          | Multipart screenshot uploads from main process     |

### Build & Dev Tooling
| Technology       | Purpose                                 |
|------------------|-----------------------------------------|
| **electron-vite**| Unified Electron + Vite build pipeline  |
| **ESLint**       | Code linting                            |
| **Prettier**     | Code formatting                         |
| **Husky**        | Git hooks (pre-commit lint)             |

---

## Architecture Decision Summary

### Why Electron over Tauri?
- Mature ecosystem for **system tray**, **auto-updater**, and **global shortcuts**
- Direct access to Node.js native addons for **idle detection**, **active window**, and **input monitoring**
- Better Windows support for enterprise deployment
- `uiohook-napi` and `active-win` have proven Electron compatibility

### Why React + Vite over Electron's default renderer?
- Vite provides **instant HMR** during development
- React's component model maps cleanly to the modular UI (Dashboard, Timer, Project List, etc.)
- `electron-vite` handles main/preload/renderer builds seamlessly

### Why Zustand over Redux?
- Minimal boilerplate for a relatively simple state tree (auth, timer, active project/task)
- No provider wrappers — works well with Electron's multi-window scenarios
- Built-in `persist` middleware for offline state

---

## Module-to-Technology Mapping

| Module                  | Key Technologies Used                          |
|-------------------------|------------------------------------------------|
| Authentication          | Axios, electron-store (token persistence)      |
| Dashboard / Timer       | React, Zustand (timer state), setInterval      |
| Project & Task Selection| React Query (fetch/cache), Axios               |
| Time Tracking           | Zustand, desktop-idle, active-win              |
| Break Management        | React UI, Axios API calls                      |
| Notes                   | React form, Axios                              |
| Screenshots (10min)     | screenshot-desktop, node-fetch (multipart)     |
| Activity Monitoring     | uiohook-napi (keystroke/mouse counts)          |
| Idle Detection          | desktop-idle (poll OS idle time)               |
| Active Window Tracking  | active-win (poll every N seconds)              |
| Auto-Update             | electron-updater                               |
| Heartbeat Sync          | setInterval + Axios (every 5 min)              |

---

## API Base Configuration

```
VITE_API_BASE_URL=https://api.workstatus.com/api/v1
VITE_WS_URL=wss://api.workstatus.com/ws   (optional)
```

All API calls require:
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

---

## Token Management Strategy

| Token         | Storage           | Lifetime   | Refresh Strategy             |
|---------------|-------------------|------------|------------------------------|
| accessToken   | Memory (Zustand)  | 15 min     | Auto-refresh via interceptor |
| refreshToken  | electron-store    | 7 days     | Used to obtain new access    |
| auth_token    | HttpOnly cookie   | Server-set | Automatic via browser        |

On 401 response → Axios interceptor calls `POST /api/v1/auth/refresh` with stored refresh token.

---

## Security Considerations
- **No keylogging**: uiohook-napi counts events only — never captures typed characters
- **Context Isolation**: Electron preload script exposes only safe IPC channels
- **CSP Headers**: Restrict renderer to load only from trusted origins
- **Screenshot encryption**: Screenshots are uploaded over HTTPS; local temp files deleted after upload
