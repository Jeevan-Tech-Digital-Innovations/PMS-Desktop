import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import styles from './ProfileMenu.module.css';

// SVG Icons matching Figma design
const ThreeDotsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </svg>
);

const DashboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const ProfileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const SignOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const QuitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

export function ProfileMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isProfileMenuOpen = useUiStore((s) => s.isProfileMenuOpen);
  const toggleProfileMenu = useUiStore((s) => s.toggleProfileMenu);
  const closeProfileMenu = useUiStore((s) => s.closeProfileMenu);

  const handleNavigate = (path: string) => {
    navigate(path);
    closeProfileMenu();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleQuit = () => {
    window.electronAPI?.quitApp();
  };

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.name || user?.username || 'Hari Haran';
  const email = user?.email || user?.username || 'hariharan@jeevantech.in';

  return (
    <div className={styles.wrapper}>
      <button 
        className={styles.triggerBtn} 
        onClick={toggleProfileMenu}
        aria-label="Open menu"
        title="Menu"
      >
        <ThreeDotsIcon />
      </button>

      {isProfileMenuOpen && (
        <>
          <div className={styles.backdrop} onClick={closeProfileMenu} />
          <div className={styles.menu}>
            <div className={styles.menuHeader}>
              <p className={styles.menuTitle}>Signed in as <strong>{displayName}</strong></p>
              <p className={styles.menuEmail}>{email}</p>
            </div>
            
            <div className={styles.divider} />
            
            <div className={styles.menuList}>
              <button className={styles.menuItem} onClick={() => handleNavigate('/dashboard')}>
                <span className={styles.itemIcon}><DashboardIcon /></span>
                <span>Dashboard</span>
              </button>

              <button className={styles.menuItem} onClick={() => handleNavigate('/profile')}>
                <span className={styles.itemIcon}><ProfileIcon /></span>
                <span>Profile</span>
              </button>

              <button className={styles.menuItem} onClick={() => handleNavigate('/settings')}>
                <span className={styles.itemIcon}><SettingsIcon /></span>
                <span>Settings</span>
              </button>
            </div>

            <div className={styles.divider} />

            <div className={styles.menuList}>
              <button className={`${styles.menuItem} ${styles.danger}`} onClick={handleLogout}>
                <span className={styles.itemIcon}><SignOutIcon /></span>
                <span>Sign out</span>
              </button>
              <button className={styles.menuItem} onClick={handleQuit}>
                <span className={styles.itemIcon}><QuitIcon /></span>
                <span>Quit App</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
