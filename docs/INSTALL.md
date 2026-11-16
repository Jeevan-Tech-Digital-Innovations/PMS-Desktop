# Installing PMS Desktop

PMS Desktop is the time-tracking app for PMS. It runs on **Windows** and **Ubuntu** and lives in the system tray (the
top bar on Ubuntu). You pick a task, start the timer, and the app keeps the timer running while you work.

Installers are built by CI and published on the repository's **Releases** page: production releases are tagged
`desktop-v<version>`, staging pre-releases `desktop-staging-v<version>-<build>`. Ask your admin which one to use.

## Windows

1. Download the `.exe` installer (named like `PMS.Desktop_2.0.0_x64-setup.exe`) and run it.
2. Windows shows **"Windows protected your PC"**. This is expected: the app is not code-signed yet. Click **More info**,
   then **Run anyway**.
3. The app installs for your Windows user only. You do not need administrator rights.
4. If Microsoft Edge WebView2 is missing, the installer downloads it automatically. This needs internet access.

**If the installer is blocked:** PCs with **Smart App Control** turned on, or company policies that block unsigned apps,
cannot install PMS Desktop yet. Ask IT to allow it. Until the app is signed, these PCs cannot run it.

## Ubuntu

Supported: Ubuntu 22.04 and 24.04 (64-bit, GNOME desktop). Two formats are published; use one of them.

**`.deb` package (recommended):**

```sh
cd ~/Downloads
sudo apt install ./PMS*Desktop_2.0.0_amd64.deb
```

Replace `2.0.0` with the version you downloaded. On the Releases page the file is named `PMS.Desktop_<version>_amd64.deb`
(GitHub turns spaces into dots; inside a CI artifact it is `PMS Desktop_…`). The staging file is
`PMS.Desktop.Staging_<version>_amd64.deb`. Keep the `./`: it tells `apt` to install a local file. `apt` also installs the libraries the app needs. Start **PMS Desktop** from the app grid.
To remove it: `sudo apt remove pms-desktop` (staging: `pms-desktop-staging`). Installing a newer `.deb` the same way
upgrades the app.

**AppImage (no installation):**

```sh
cd ~/Downloads
chmod +x PMS*Desktop_2.0.0_amd64.AppImage
./PMS*Desktop_2.0.0_amd64.AppImage
```

If it does not start and mentions FUSE, install it once with `sudo apt install libfuse2` (Ubuntu 22.04) or
`sudo apt install libfuse2t64` (Ubuntu 24.04).

**Tray icon:** PMS Desktop appears in the top bar. Ubuntu shows tray icons through the "Ubuntu AppIndicators" extension,
which is on by default. On other GNOME desktops, install and enable the AppIndicator extension. Click the icon to open the
menu; choose **Open PMS Desktop** to show the window.

**Passwords:** your sign-in is kept in the Ubuntu keyring (GNOME Keyring), which is unlocked when you log in. If no keyring
service is running, the app still works but you have to sign in again each time it starts.

### Xorg vs Wayland

Ubuntu starts a **Wayland** session by default. On Wayland, PMS Desktop cannot read which app or window you are using, and
screenshots go through Ubuntu's screenshot service, which may ask for permission. For full tracking, use **Xorg**:

1. Sign out.
2. On the login screen, select your name, then click the **gear icon** in the bottom-right corner.
3. Choose **Ubuntu on Xorg** and sign in. Ubuntu remembers this choice.

The app shows a one-time notice when it runs on Wayland. What still works on Wayland:

| | Xorg | Wayland |
|---|---|---|
| Timer, breaks, idle rules, activity % | Yes | Yes |
| Screen lock and sleep detection | Yes | Yes |
| App name and window title | Yes | Only for some apps (older X11 apps); otherwise recorded as "Unknown" |
| Screenshots | Yes | Through the screenshot service; may ask for permission or fail |

**For IT:** the `.deb` depends on WebKitGTK 4.1, GTK 3 and `libayatana-appindicator3-1`, which `apt` installs. Ubuntu's
standard desktop already includes the other libraries it uses (D-Bus, OpenSSL, libxcb).

## Moving from the old app

The old Electron app is called **ENJEV | PMS Desktop**. Remove it first, then install the new one.

- **Windows:** **Settings → Apps → Installed apps**, find **ENJEV | PMS Desktop**, select **Uninstall**.

Open PMS Desktop and sign in again with your PMS account.

## Staging vs production builds

There are two builds of the app:

| | Production | Staging |
|---|---|---|
| App name (Start menu or app grid, window title) | **PMS Desktop** | **PMS Desktop Staging** |
| Server | `pms.enjev.com` | `stagingpms.enjev.com` |
| Windows installer | `PMS.Desktop_<version>_x64-setup.exe` | `PMS.Desktop.Staging_<version>_x64-setup.exe` |
| Ubuntu package | `pms-desktop` | `pms-desktop-staging` |
| Release tag | `desktop-v<version>` | `desktop-staging-v<version>-<build>` (pre-release) |

Both can be installed on the same computer at the same time. They keep separate sign-ins, settings and offline data, and
each has its own tray icon. To see which one is running, look at the window title (and, on Windows, the tray icon
tooltip): it says **PMS Desktop** or **PMS Desktop Staging**. Employees should use production unless they are asked to
test.

## For IT: Microsoft Defender

If Microsoft Defender flags the installer as malware, submit it as a false positive. Do this for each new release.

1. Go to https://www.microsoft.com/en-us/wdsi/filesubmission
2. Choose the option for a **software developer** submission.
3. Upload the installer file.
4. Select that the file was **incorrectly detected** as malware.
5. Keep the submission ID. Microsoft usually answers within a few days, after which the detection is removed.

## What PMS Desktop tracks

Tracking happens **only while a timer is running**. When no timer runs, nothing is captured.

- **Screenshots** at the interval your admin sets (for example every 5, 10 or 15 minutes). Your admin may also turn on
  blurring.
- **Active app and window title**, following your admin's setting: apps only, URLs only, both, or off.
- **Activity level** from keyboard and mouse use, as a percentage. What you type is not recorded.
- **Idle time.** After 5 minutes without keyboard or mouse input, the timer is marked idle and that time is not counted as
  work. You may be asked for a short note, depending on your admin's setting.

Screenshots and app usage are stored on your computer if the network is down, and sent when it returns.

**First sign-in:** the app shows a one-time notice that you must accept:

> This computer's activity (screenshots, apps and idle time) is tracked by your company while a timer runs.

Your admin may set the app to **silent mode**. In silent mode there are no notifications or pop-ups, but tracking works the
same way.
