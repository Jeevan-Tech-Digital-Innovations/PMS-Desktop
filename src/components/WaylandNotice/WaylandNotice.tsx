import { useState } from "react";
import { useAppState } from "../../state/StoreProvider";
import { Icon } from "../Icon/Icon";
import styles from "./WaylandNotice.module.css";

/** localStorage key; UI-only flag, so per-machine browser storage is enough. */
export const WAYLAND_NOTICE_KEY = "pms.waylandNoticeDismissed";

export const WAYLAND_NOTICE_TEXT =
  "For full tracking on Ubuntu, choose “Ubuntu on Xorg” at the login screen (gear icon).";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(WAYLAND_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

/** One-time notice on a Linux Wayland session, where window titles can't be read and screenshots may prompt. */
export function WaylandNotice() {
  const wayland = useAppState((s) => s.appInfo?.linuxSession === "wayland");
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!wayland || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(WAYLAND_NOTICE_KEY, "1");
    } catch {
      // Storage unavailable: hide for this run only.
    }
    setDismissed(true);
  };

  return (
    <div className={styles.banner} role="note">
      <span className={styles.icon}>
        <Icon name="info" size={16} />
      </span>
      <span className={styles.msg}>{WAYLAND_NOTICE_TEXT}</span>
      <button type="button" className={styles.close} aria-label="Dismiss" onClick={dismiss}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
