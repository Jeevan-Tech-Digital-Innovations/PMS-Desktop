import { create } from 'zustand';
import { User } from '@/types/auth';
import { logoutApi } from '@/pages/Login/LoginApi.services';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  setAuth: (data: { user: User; accessToken: string; refreshToken: string; rememberMe: boolean }) => void;
  logout: (skipApiCall?: boolean) => void;
  checkStoredTokens: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  updateAuthSession: (accessToken: string, roles: string[], tenantName: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: ({ user, accessToken, refreshToken, rememberMe }) => {
    let activeTenantId: string | undefined;
    try {
      const parts = accessToken.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1]));
        activeTenantId = payload.active_tenant_id || payload.tenant_id;
      }
    } catch {}

    const enrichedUser = {
      ...user,
      tenantId: activeTenantId || user.tenantId
    };

    // Persist active tenant and user id into localStorage for scoped cache keys
    try {
      localStorage.setItem('pms_active_tenant_id', String(activeTenantId || user.tenantName || 'default'));
      localStorage.setItem('pms_active_user_id', String(user.userId || 'unknown'));
    } catch {}

    // Persist tokens AND user via Electron main process so they survive app restart
    window.electronAPI?.saveTokens?.({ accessToken, refreshToken, rememberMe });
    if (typeof window.electronAPI?.saveUser === 'function') {
      window.electronAPI.saveUser(enrichedUser as any);
    }

    set({
      user: enrichedUser,
      accessToken,
      refreshToken,
      isAuthenticated: true,
    });
  },

  updateAuthSession: (accessToken: string, roles: string[], tenantName: string) => {
    const currentState = get();
    if (!currentState.user) return;

    let activeTenantId: string | undefined;
    try {
      const parts = accessToken.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1]));
        activeTenantId = payload.active_tenant_id || payload.tenant_id;
      }
    } catch {}
    
    const updatedUser = {
      ...currentState.user,
      roles,
      tenantName,
      tenantId: activeTenantId || currentState.user.tenantId
    };

    try {
      localStorage.setItem('pms_active_tenant_id', String(activeTenantId || tenantName || 'default'));
      localStorage.setItem('pms_active_user_id', String(currentState.user?.userId || 'unknown'));
    } catch {}

    // Complete isolation: Stop timer, clear selections, and reset timer store for the new tenant
    useTimerStore.getState().stopTimer();
    useTimerStore.getState().reset();
    useProjectStore.getState().clearSelection();
    window.electronAPI?.stopTimer?.();

    window.electronAPI?.saveTokens?.({ 
      accessToken, 
      refreshToken: currentState.refreshToken || '', 
      rememberMe: true 
    });
    if (typeof window.electronAPI?.saveUser === 'function') {
      window.electronAPI.saveUser(updatedUser as any);
    }

    set({
      accessToken,
      user: updatedUser
    });
  },

  logout: (skipApiCall = false) => {
    const { refreshToken } = get();
    try {
      localStorage.removeItem('pms_active_tenant_id');
      localStorage.removeItem('pms_active_user_id');
    } catch {}
    // Stop timer and reset all stores
    useTimerStore.getState().stopTimer();
    useTimerStore.getState().reset();
    useProjectStore.getState().clearSelection();
    useUiStore.getState().closeBreakModal();
    useUiStore.getState().closeNoteModal();
    // Stop Electron background services (screenshots, idle, heartbeat)
    window.electronAPI?.stopTimer();
    // Fire-and-forget: invalidate refresh token server-side if not skipping
    if (refreshToken && !skipApiCall) {
      logoutApi(refreshToken);
    }
    window.electronAPI?.clearTokens();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  checkStoredTokens: async () => {
    try {
      const tokens = await window.electronAPI?.getStoredTokens?.();
      const user =
        typeof window.electronAPI?.getStoredUser === 'function'
          ? await window.electronAPI.getStoredUser()
          : null;
      if (tokens?.accessToken) {
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || '',
          user: user ?? null,
          isAuthenticated: true,
        });
      }
    } catch (error) {
      console.error('Failed to retrieve stored tokens', error);
    } finally {
      set({ isLoading: false });
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));
