import { useAppState, useStore } from "../../state/StoreProvider";
import { Icon, type IconName } from "../Icon/Icon";
import type { ToastKind } from "../../lib/types";
import styles from "./Toasts.module.css";

const ICON: Record<ToastKind, IconName> = { info: "info", success: "check", warning: "alert", error: "alert" };

/** Top-of-window toasts; the store removes each after 3 s. */
export function Toasts() {
  const toasts = useAppState((s) => s.toasts);
  const store = useStore();
  return (
    <div className={styles.host} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`} role={t.kind === "error" ? "alert" : "status"}>
          <Icon name={ICON[t.kind]} size={16} />
          <span className={styles.msg}>{t.message}</span>
          <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => store.dismissToast(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
