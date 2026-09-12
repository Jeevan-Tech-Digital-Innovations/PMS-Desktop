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

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.name || user?.username || 'User';
  
  const getInitials = (nameStr: string) => {
    if (!nameStr) return 'U';
    const parts = nameStr.split(' ');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return nameStr.substring(0, 2).toUpperCase();
  };

  return (
    <div className={styles.wrapper}>
      <button className={styles.trigger} onClick={toggleProfileMenu}>
        <div className={styles.avatar}>
          {getInitials(displayName)}
        </div>
        <span className={styles.name}>{displayName}</span>
      </button>

      {isProfileMenuOpen && (
        <>
          <div className={styles.backdrop} onClick={closeProfileMenu} />
          <div className={styles.menu}>
            <div className={styles.menuHeader}>
              <p className={styles.menuName}>{displayName}</p>
              <p className={styles.menuEmpNo}>{user?.email || user?.username}</p>
            </div>
            <hr className={styles.divider} />
            <button className={styles.menuItem} onClick={() => handleNavigate('/profile')}>
              My Profile
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
