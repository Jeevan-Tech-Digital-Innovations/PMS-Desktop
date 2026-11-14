import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import styles from './Settings.module.css';

const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

export function Settings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate('/dashboard')}
          title="Back to Dashboard"
          aria-label="Back"
        >
          <ArrowLeftIcon />
        </button>
        <h2 className={styles.title}>Settings</h2>
      </div>

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
