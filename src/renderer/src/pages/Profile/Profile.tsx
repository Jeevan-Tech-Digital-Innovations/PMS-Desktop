import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
import { fetchMyProfile, switchTenantApi } from '@/services/ProfileApi.services';
import styles from './Profile.module.css';

export function Profile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const updateAuthSession = useAuthStore((s) => s.updateAuthSession);

  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchMyProfile,
  });

  const [isSwitchingTenant, setIsSwitchingTenant] = useState(false);

  const isLoading = isProfileLoading;

  const name = profile?.firstName && profile?.lastName 
    ? `${profile.firstName} ${profile.lastName}`
    : profile?.displayName || user?.name || user?.username || '';
    
  const role = profile?.role || user?.roles?.[0] || '';
  
  // The backend might return email in profile.email, or we use auth user's email
  const email = profile?.email || user?.email || user?.username || '';
  
  // Only bring the tenants which are associated with this member
  const userTenants = user?.tenants || [];
  
  // The selected tenant from the UI dropdown
  const currentOrganizationId = user?.tenantName 
    ? userTenants.find((t: any) => t.name === user.tenantName)?.id || (userTenants.length > 0 ? userTenants[0].id : '')
    : (userTenants.length > 0 ? userTenants[0].id : '');

  const handleTenantChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTenantId = e.target.value;
    const newTenantObj = userTenants.find((t: any) => t.id === newTenantId);
    
    if (!newTenantId || !accessToken || !newTenantObj) return;

    if (useTimerStore.getState().isRunning) {
      const confirmSwitch = window.confirm("Timer is currently running. Do you want to switch tenant? This will stop your current timer.");
      if (!confirmSwitch) {
        return; // User canceled
      }
      // Stop the timer
      useTimerStore.getState().stopTimer();
      useTimerStore.getState().reset();
    }
    
    setIsSwitchingTenant(true);
    const loadingToast = toast.loading('Switching organization...');
    
    try {
      // 1. Call Axis to switch tenant
      const res = await switchTenantApi(newTenantId, accessToken);
      
      // 2. Update local auth session with new token and roles
      updateAuthSession(res.access_token, Object.keys(res.roles), newTenantObj.name);
      
      // 3. Clear all queries so projects, tasks, etc. reload for the new tenant
      queryClient.clear();
      await queryClient.invalidateQueries();
      
      toast.success(`Switched to ${newTenantObj.name}`, { id: loadingToast });

      // Navigate to dashboard to ensure fresh state
      navigate('/');
    } catch (err: any) {
      console.error('Failed to switch tenant', err);
      toast.error(err.message || 'Failed to switch organization', { id: loadingToast });
    } finally {
      setIsSwitchingTenant(false);
    }
  };

  // Extract initials for the avatar
  const getInitials = (nameStr: string) => {
    if (!nameStr) return 'U';
    const parts = nameStr.split(' ');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return nameStr.substring(0, 2).toUpperCase();
  };

  const initials = getInitials(name);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button 
          className={styles.backBtn} 
          onClick={() => navigate('/dashboard')} 
          disabled={isSwitchingTenant}
          title="Back to Dashboard"
          aria-label="Back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h2 className={styles.title}>My Profile</h2>
      </div>

      <div className={styles.content}>
        {isLoading ? (
          <p>Loading profile...</p>
        ) : (
          <>
            <div className={styles.avatarContainer}>
              <div className={styles.avatar}>{initials}</div>
            </div>

            <h2 className={styles.name}>{name}</h2>
            <p className={styles.role}>{isSwitchingTenant ? 'Updating role...' : role}</p>

            <div className={styles.detailsList}>
              <div className={styles.detailItem}>
                <div className={styles.detailIcon}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                </div>
                <div className={styles.detailText}>
                  <span className={styles.detailLabel}>Email</span>
                  <span className={styles.detailValue}>{email}</span>
                </div>
              </div>

              <div className={styles.detailItem}>
                <div className={styles.detailIcon}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                    <path d="M9 22v-4h6v4"></path>
                    <path d="M8 6h.01"></path>
                    <path d="M16 6h.01"></path>
                    <path d="M12 6h.01"></path>
                    <path d="M12 10h.01"></path>
                    <path d="M12 14h.01"></path>
                    <path d="M16 10h.01"></path>
                    <path d="M16 14h.01"></path>
                    <path d="M8 10h.01"></path>
                    <path d="M8 14h.01"></path>
                  </svg>
                </div>
                <div className={styles.detailText}>
                  <span className={styles.detailLabel}>Organization</span>
                  {userTenants.length > 0 ? (
                    <div className={styles.tenantSelectWrapper}>
                      <select 
                        className={styles.tenantSelect}
                        value={currentOrganizationId}
                        onChange={handleTenantChange}
                        disabled={isSwitchingTenant}
                      >
                        {userTenants.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <svg className={styles.selectIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </div>
                  ) : (
                    <span className={styles.detailValue}>{user?.tenantName || 'None'}</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
