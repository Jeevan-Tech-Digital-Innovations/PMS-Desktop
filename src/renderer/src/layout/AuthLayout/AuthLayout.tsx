import { Outlet } from 'react-router-dom';
import styles from './AuthLayout.module.css';

export function AuthLayout() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logoSection}>
          <h1 className={styles.brand}>Workstatus</h1>
          <p className={styles.tagline}>Desktop Time Tracking</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
