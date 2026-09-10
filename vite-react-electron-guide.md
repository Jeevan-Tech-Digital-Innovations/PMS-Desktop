# Packaging your Vite + React app with Electron (shared backend)

This guide takes an **existing Vite + React app** and adds Electron on top of it, so you ship the same codebase as:
- a normal web app (deployed to any static host), and
- a desktop app (Windows/Mac/Linux installer),

both talking to the **same backend API**. Nothing in your `src/` folder gets restructured — Electron is added alongside it.

We'll use `vite-plugin-electron`, which is the standard way to retrofit Electron onto an existing Vite project (as opposed to `electron-vite`, which scaffolds a brand-new project layout).

---

## 0. Prerequisites

- Your Vite React app already runs with `npm run dev` / `npm run build`.
- Node.js 18+ installed.
- Your backend is a separate service reachable over HTTP (Express, Fastify, Django, whatever) — this guide doesn't touch the backend's own code, just how both frontends talk to it.

---

## 1. Install Electron and tooling

From your existing project root:

```bash
npm install -D electron electron-builder vite-plugin-electron vite-plugin-electron-renderer
```

- `electron` — the desktop runtime
- `electron-builder` — packages your app into `.exe` / `.dmg` / `.AppImage`
- `vite-plugin-electron` — bundles your main/preload scripts with Vite and wires up the dev workflow
- `vite-plugin-electron-renderer` — lets renderer code safely use Node/Electron built-ins if you ever need them

---

## 2. New folder structure

Add one new top-level folder. Everything else in your project stays exactly where it is.

```
your-app/
├── electron/
│   ├── main.js        ← Electron main process (new)
│   └── preload.js      ← contextBridge script (new)
├── src/                 ← your existing React app (untouched)
├── public/
├── index.html
├── vite.config.js       ← you'll add a few lines here
├── package.json         ← you'll add a few lines here
```

---

## 3. Create the Electron main process

`electron/main.js`:

```js
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Where the built renderer (your React app) lives after `vite build`
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let win

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,   // keep this true
      nodeIntegration: false,   // keep this false
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    // Dev mode: point at the running Vite dev server (hot reload works)
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Production: load the built static files
    win.loadFile(path.join(process.env.DIST, 'index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

**Why `contextIsolation: true` and `nodeIntegration: false`**: this keeps your renderer (the React app) sandboxed from raw Node.js access, which is the secure default Electron recommends. Anything the UI needs from the OS gets exposed deliberately through the preload script below — never given wholesale.

---

## 4. Create the preload script

`electron/preload.js`:

```js
import { contextBridge } from 'electron'

// Whatever you expose here becomes window.electronAPI in your React app
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  // add more bridges here as you need native features, e.g.:
  // saveFile: (data) => ipcRenderer.invoke('save-file', data),
})
```

This is the **only** bridge between your web UI and native OS capabilities. If you later want file system access, native notifications, or auto-updates, you add a narrow, specific method here — you don't turn on blanket Node access.

---

## 5. Wire it into `vite.config.js`

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.js',
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.js'),
      },
      renderer: {},
    }),
  ],
  base: './', // important — see "common pitfalls" below
})
```

`vite-plugin-electron` hooks into Vite's dev server lifecycle, so running plain `vite` in dev will also launch the Electron window pointed at that dev server. You get hot reload in Electron for free.

---

## 6. Update `package.json`

```json
{
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:electron": "vite build && electron-builder"
  },
  "build": {
    "appId": "com.yourcompany.yourapp",
    "productName": "YourApp",
    "files": ["dist/**/*", "dist-electron/**/*"],
    "directories": { "output": "release" },
    "mac": { "target": "dmg" },
    "win": { "target": "nsis" },
    "linux": { "target": "AppImage" }
  }
}
```

- `npm run dev` — normal Vite dev server, plus Electron opens automatically
- `npm run build` — builds just the web app (deploy `dist/` anywhere, unchanged from before)
- `npm run build:electron` — builds the web app **and** packages Electron installers into `release/`

---

## 7. Point both builds at the same backend

This is the part that actually makes "same backend" true — and it's mostly about not letting Electron-specific code leak into how you call the API.

**Use Vite env variables**, so the API URL is just configuration:

`.env.development`
```
VITE_API_URL=http://localhost:5000/api
```

`.env.production`
```
VITE_API_URL=https://api.yourapp.com/api
```

`src/lib/api.js`
```js
const API_URL = import.meta.env.VITE_API_URL

export async function fetchUser() {
  const res = await fetch(`${API_URL}/user`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  })
  return res.json()
}
```

This function is identical whether it runs in a browser tab or inside the Electron renderer — same fetch, same headers, same backend. That's the whole point of keeping Electron additive rather than forking your app logic.

**A note on auth:** prefer a `Bearer` token in `localStorage` (as above) over cookie-based sessions. Packaged Electron apps load `index.html` from disk, which gives the page a `file://` origin; browsers and Chromium treat that as a `null` origin for CORS/cookie purposes, which causes headaches with cookie-based auth. Token-in-header sidesteps that entirely and behaves identically on web and desktop.

**Backend CORS**, if you're using Express:

```js
import cors from 'cors'

app.use(cors({
  origin: ['https://yourapp.com', 'http://localhost:5173', null], // null covers the packaged Electron app's file:// origin
  credentials: true,
}))
```

---

## 8. Detect Electron in your React code (only where you need to)

Most of your app shouldn't care where it's running. For the rare case where you want a desktop-only feature (native menu, tray icon, auto-launch):

```jsx
const isElectron = window.electronAPI?.isElectron ?? false

function App() {
  return (
    <>
      <MainUI />
      {isElectron && <DesktopOnlyPanel />}
    </>
  )
}
```

---

## 9. Run it in dev

```bash
npm run dev
```

This starts the Vite dev server and opens the Electron window automatically, loading from that dev server with full hot reload. Open a normal browser tab at the same dev URL to test the web version side by side.

---

## 10. Build for production

```bash
# Web app — deploy dist/ to Vercel, Netlify, S3, wherever you already deploy it
npm run build

# Desktop app — installers land in release/
npm run build:electron
```

Both consume the exact same `src/` — there's no separate "desktop version" of your components to maintain.

---

## 11. Updating Local Shared Packages (.tgz)

If your app relies on shared internal packages that are not published to an npm registry (for example, `@axis/auth-client` included as `file:./axis-auth-client-0.1.0.tgz`), you will need to manually pack and update them when changes are made in the source repository.

To update a local `.tgz` dependency:
1. Navigate to the package source in the other repository (e.g., `cd path/to/axis-ui/packages/auth-client`).
2. Run `npm pack` to generate a new `.tgz` file.
3. Copy the generated `.tgz` file into your Electron app's root directory.
4. Update your `package.json` to point to the new filename if the version changed:
   `"@axis/auth-client": "file:./axis-auth-client-0.1.1.tgz"`
5. Run `npm install` to apply the update and delete the old `.tgz` file.

---

## Common pitfalls

- **Blank screen when the packaged app opens**: 
  - **Asset paths**: Make sure `base: './'` is set in `vite.config.js` (step 5) so built asset URLs are relative, since Electron loads `index.html` via `file://`.
  - **React Router**: If you use React Router, you *must* use `<HashRouter>` instead of `<BrowserRouter>`. `BrowserRouter` relies on a web server to route fallback requests to `index.html`. Since packaged Electron apps load from the local filesystem (`file://`), `BrowserRouter` will fail to resolve routes and result in a blank white screen.
- **Missing Window/Tray Icons in production**: `electron-builder` by default excludes the `resources/` folder from the packaged `app.asar` archive to save space. If you dynamically set icons at runtime (e.g. `mainWindow.setIcon(...)` or `new Tray(...)`), you must explicitly include them using the `extraResources` block in `electron-builder.yml`. In your code, resolve the path dynamically: `app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../../resources/icon.png')`. Using relative paths like `../../resources` in production can result in fatal "File Not Found" crashes.
- **SSO / OAuth Race Conditions**: If your Electron main process intercepts an OAuth redirect to complete a login (e.g., intercepting `/desktop-callback`), make sure to call `event.preventDefault()` and `webContents.stop()` inside the `will-navigate` event. Otherwise, the frontend React app will *also* load the callback route and might attempt the same token exchange concurrently, resulting in `401 Unauthorized` errors and infinite logout loops.
- **Native Module Build Failures (`node-gyp`)**: If your dependencies include native C++ modules (like `active-win` or `uiohook-napi`), Windows builds will fail if Visual Studio Build Tools are missing. You must install the "Desktop development with C++" workload via the Visual Studio Installer.
- **CORS errors only in the packaged app, not in dev**: the packaged app's `file://` origin comes through as `null`. Add `null` to your backend's allowed origins, or switch to Bearer-token auth as noted in step 7.
- **`import.meta.env.VITE_*` is `undefined` in `electron/main.js`**: Vite env vars are only injected into the *renderer* bundle, not the Electron main process. If your main process itself needs config, load it separately with `dotenv` in `main.js`.
- **Don't set `nodeIntegration: true`** to work around a missing API — add a specific bridge method in `preload.js` instead. Turning on full Node access in the renderer removes the sandboxing that protects you if a dependency or a compromised remote script ever runs in that window.
- **Auto-updates**: out of scope here, but when you're ready, `electron-updater` (from the same team as `electron-builder`) is the standard pairing — it reads the same `build` config you already have in `package.json`.

---

## Recap of what's shared vs. what's separate

| | Web app | Desktop app |
|---|---|---|
| `src/` (components, logic) | ✅ same | ✅ same |
| Backend API + auth | ✅ same | ✅ same |
| Build tool | Vite | Vite (same config) |
| Entry point | `index.html` in a browser tab | `index.html` loaded by Electron |
| Extra code | none | `electron/main.js` + `electron/preload.js` only |
