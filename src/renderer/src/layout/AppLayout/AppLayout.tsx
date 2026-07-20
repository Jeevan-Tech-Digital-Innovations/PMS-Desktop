import { Outlet } from 'react-router-dom';
import { ProfileMenu } from '@/components/ProfileMenu/ProfileMenu';
import { BreakModal } from '@/components/BreakModal/BreakModal';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import styles from './AppLayout.module.css';

export function AppLayout() {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.brand}>Workstatus</h1>
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
