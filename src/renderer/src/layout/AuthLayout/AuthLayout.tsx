import { Outlet } from 'react-router-dom';
import jtLogo from '@/assets/JT_Logo.png';
import styles from './AuthLayout.module.css';

export function AuthLayout() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logoSection}>
          <img src={jtLogo} alt="Jeevantech Digital Innovations" className={styles.logo} />
          <p className={styles.tagline}>Desktop Time Tracking</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
