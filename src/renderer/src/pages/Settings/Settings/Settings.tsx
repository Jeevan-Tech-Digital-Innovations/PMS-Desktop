import { useAuthStore } from '@/stores/authStore';
import styles from './Settings.module.css';

export function Settings() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={() => window.history.back()}>
        ← Back
      </button>
      <h2 className={styles.title}>Settings</h2>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Account</h3>
        <div className={styles.field}>
          <span className={styles.label}>Email</span>
          <span className={styles.value}>{user?.username || 'N/A'}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Employee ID</span>
          <span className={styles.value}>{user?.empNo || 'N/A'}</span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Application</h3>
        <div className={styles.field}>
          <span className={styles.label}>Version</span>
          <span className={styles.value}>1.0.0</span>
        </div>
        <button
          className={styles.checkBtn}
          onClick={() => window.electronAPI?.checkForUpdates()}
        >
          Check for Updates
        </button>
      </div>
    </div>
  );
}
