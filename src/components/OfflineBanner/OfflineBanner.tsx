import { Icon } from "../Icon/Icon";
import styles from "./OfflineBanner.module.css";

export function OfflineBanner({ queued }: { queued: number }) {
  return (
    <div className={styles.banner} role="status">
      <Icon name="wifiOff" size={16} />
      <span>
        Offline — tracking is saved and will sync ({queued} waiting)
      </span>
    </div>
  );
}
