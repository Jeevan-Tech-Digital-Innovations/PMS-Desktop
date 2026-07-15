import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import styles from './ProfileMenu.module.css';

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

  return (
    <div className={styles.wrapper}>
      <button className={styles.trigger} onClick={toggleProfileMenu}>
        <div className={styles.avatar}>
          {user?.username?.charAt(0).toUpperCase() || 'U'}
        </div>
        <span className={styles.name}>{user?.username || 'User'}</span>
      </button>

      {isProfileMenuOpen && (
        <>
          <div className={styles.backdrop} onClick={closeProfileMenu} />
          <div className={styles.menu}>
            <div className={styles.menuHeader}>
              <p className={styles.menuName}>{user?.username}</p>
              <p className={styles.menuEmpNo}>{user?.empNo}</p>
            </div>
            <hr className={styles.divider} />
            <button className={styles.menuItem} onClick={() => handleNavigate('/dashboard')}>
              Dashboard
            </button>
            <button className={styles.menuItem} onClick={() => handleNavigate('/settings')}>
              Settings
            </button>
            <button className={styles.menuItem} onClick={() => window.electronAPI?.checkForUpdates()}>
              Check for Updates
            </button>
            <hr className={styles.divider} />
            <button className={styles.menuItem} onClick={handleLogout}>
              Sign Out
            </button>
            <button className={`${styles.menuItem} ${styles.danger}`} onClick={handleQuit}>
              Quit Application
            </button>
          </div>
        </>
      )}
    </div>
  );
}
