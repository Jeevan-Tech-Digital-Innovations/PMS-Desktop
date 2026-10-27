import { Outlet } from 'react-router-dom';
import { ProfileMenu } from '@/components/ProfileMenu/ProfileMenu';
import { BreakModal } from '@/components/BreakModal/BreakModal';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import pmsLogo from '@/assets/pms-logo.png';
import styles from './AppLayout.module.css';

export function AppLayout() {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logoBadge}>
            <img src={pmsLogo} alt="JTDI Logo" className={styles.logoImg} />
          </div>
          <div className={styles.brandInfo}>
            <span className={styles.brandTitle} title="Jeevan Tech Digital Innovations">
              Jeevan Tech Digital Innovations...
            </span>
            <span className={styles.brandSubtitle}>PMS</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <ProfileMenu />
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <BreakModal />
      <NoteModal />
    </div>
  );
}
