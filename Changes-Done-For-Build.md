# PMS Desktop - Architecture & Fixes Review

This document reviews the recent changes made to the `PMS-Desktop` project. It breaks down what the code looked like before, what it was changed to, and exactly how the change solved the underlying bugs we encountered during our debugging session.

---

## 1. White Screen on Launch (React Router Fix)

**What existed:**
The application's routing was handled by `<BrowserRouter>` in `src/renderer/src/main.tsx`.

**What it was changed to:**
`<BrowserRouter>` was replaced with `<HashRouter>`.

**How it solved the problem:**
`BrowserRouter` relies on the HTML5 History API, which requires a web server to catch unknown routes and redirect them back to `index.html`. Because packaged Electron apps load from the local filesystem via the `file://` protocol, there is no web server. When `BrowserRouter` attempted to route the initial load, it failed to resolve the path against the filesystem, resulting in a blank white screen. `<HashRouter>` uses the URL hash (e.g., `file:///index.html#/login`), which correctly navigates within the filesystem constraints.

---

## 2. Invisible Window (Fatal `setIcon` Crash)

**What existed:**
In `src/main/index.ts`, there was a manual block of code immediately after the `BrowserWindow` creation that attempted to set the window icon:
```typescript
const iconPath = path.join(__dirname, '../../resources/icon.ico');
if (process.platform === 'win32') {
  mainWindow.setIcon(iconPath);
}
```

**What it was changed to:**
This block was entirely removed. The `BrowserWindow` constructor's existing `icon:` property is now handling the icon setting automatically.

**How it solved the problem:**
When `electron-builder` packages the application, it creates an encrypted archive called `app.asar`. It **excludes** the source `resources` folder by default. When the packaged app ran, `path.join` resolved to an invalid location because the file didn't exist in the `.asar` archive. When `setIcon` was called with an invalid path, it threw a fatal JavaScript exception. 

Because this exception occurred *before* the `mainWindow.once('ready-to-show')` event listener could fire, the window remained permanently invisible (`show: false`), leaving zombie processes running in the background. Removing the manual call prevented the crash.

---

## 3. Missing Tray Icon in Production

**What existed:**
1. In `electron-builder.yml`, there was no instruction to package the `icon.png` into the final app.
2. In `src/main/tray.ts`, the code hardcoded a relative path to find the icon: `path.join(__dirname, '../../resources/icon.png')`.

**What it was changed to:**
1. Added an `extraResources` block in `electron-builder.yml` to force the builder to include the icon at runtime:
   ```yaml
   extraResources:
     - from: resources/icon.png
       to: icon.png
   ```
2. Updated `tray.ts` to dynamically resolve the path depending on whether the app is running locally or packaged:
   ```typescript
   const iconPath = app.isPackaged
     ? path.join(process.resourcesPath, 'icon.png')
     : path.join(__dirname, '../../resources/icon.png');
   ```

**How it solved the problem:**
Because `electron-builder` ignores the `buildResources` folder when packing the app, the tray icon code couldn't find the image, resulting in a blank space in the Windows system tray. By explicitly defining `extraResources`, the icon is copied to `process.resourcesPath`, allowing `tray.ts` to load and display the Jeevantech logo successfully.

---

## 4. SSO "Log In then Auto Log Out" Bug (Race Condition)

**What existed:**
When the Axis authentication popup redirected to `/desktop-callback`, `src/main/index.ts` intercepted the URL using `will-navigate` to grab the session cookie, while also allowing the popup to continue navigating to the React frontend.
```typescript
authWindow.webContents.on('will-navigate', (event, url) => {
  handleNavigation(url); // Grabbed cookie, but didn't stop navigation
});
```

**What it was changed to:**
Added `event.preventDefault()` and `webContents.stop()` to the intercept handler, freezing the popup window in place:
```typescript
authWindow.webContents.on('will-navigate', (event, url) => {
  if (url.startsWith(redirectUri) && !isResolved) {
    event.preventDefault(); // <--- FIX
    handleNavigation(url);
  }
});
```

**How it solved the problem:**
Because the popup window was allowed to continue navigating to `/desktop-callback`, the frontend React app booted up and attempted to verify the login state by calling the `/auth/confirm-access` API endpoint. At the exact same millisecond, the Desktop App's main process intercepted the redirect and *also* called `/auth/confirm-access`. 

This created a severe race condition. The token exchange API rejected the duplicate concurrent request with a `401 Unauthorized` error. When the frontend React app received the 401 error, it assumed the session was invalid and immediately triggered an auto-logout, kicking you back to the "Welcome Back" screen. Freezing the navigation prevented the React frontend from running its duplicate API call, allowing the Desktop App to authenticate smoothly.

---

## 5. Development Guide Updates

**What existed:**
The `vite-react-electron-guide.md` file contained standard boilerplate instructions for running Vite with Electron.

**What it was changed to:**
The "Common pitfalls" section was extensively rewritten to include all of our findings.

**How it solved the problem:**
This ensures that any future developers on the PMS Desktop project will not run into the same Native C++ Module errors (`node-gyp`), React Router white screens, SSO Race Conditions, or Tray Icon packaging bugs.
