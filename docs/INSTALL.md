# Installing PMS Desktop

PMS Desktop is the time-tracking app for PMS. It lives in the system tray (menu bar on Mac). You pick a task, start the
timer, and the app keeps the timer running while you work.

Installers are built by CI. Ask your admin or the developer for the latest build if you do not have one.

## Windows

1. Download the `.exe` installer (named like `PMS Desktop_2.0.0_x64-setup.exe`) and run it.
2. Windows shows **"Windows protected your PC"**. This is expected: the app is not code-signed yet. Click **More info**,
   then **Run anyway**.
3. The app installs for your Windows user only. You do not need administrator rights.
4. If Microsoft Edge WebView2 is missing, the installer downloads it automatically. This needs internet access.

**If the installer is blocked:** PCs with **Smart App Control** turned on, or company policies that block unsigned apps,
cannot install PMS Desktop yet. Ask IT to allow it. Until the app is signed, these PCs cannot run it.

## macOS

1. Open the `.dmg` file and drag **PMS Desktop** into **Applications**.
2. The first launch is blocked because the app is not notarized. Open **System Settings → Privacy & Security**, scroll to
   the message about PMS Desktop, click **Open Anyway**, then confirm.
3. Grant **Screen Recording** permission: **System Settings → Privacy & Security → Screen Recording**, turn on
   **PMS Desktop**. This is needed for screenshots and window titles. If the app asks you to restart, quit and reopen it.

## Moving from the old app

The old Electron app is called **ENJEV | PMS Desktop**. Remove it first, then install the new one.

- **Windows:** **Settings → Apps → Installed apps**, find **ENJEV | PMS Desktop**, select **Uninstall**.
- **macOS:** drag it from **Applications** to the Trash.

Open PMS Desktop and sign in again with your PMS account.

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
