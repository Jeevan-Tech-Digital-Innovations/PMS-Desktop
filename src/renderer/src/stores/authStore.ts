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
  logout: () => void;
  checkStoredTokens: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: ({ user, accessToken, refreshToken, rememberMe }) => {
    // Persist tokens AND user via Electron main process so they survive app restart
    window.electronAPI?.saveTokens?.({ accessToken, refreshToken, rememberMe });
    if (typeof window.electronAPI?.saveUser === 'function') {
      window.electronAPI.saveUser(user);
    }

    set({
      user,
      accessToken,
      refreshToken,
      isAuthenticated: true,
    });
  },

  logout: () => {
    const { refreshToken } = get();
    // Stop timer and reset all stores
    useTimerStore.getState().stopTimer();
    useTimerStore.getState().reset();
    useProjectStore.getState().clearSelection();
    useUiStore.getState().closeIdleModal();
    useUiStore.getState().closeBreakModal();
    useUiStore.getState().closeNoteModal();
    // Stop Electron background services (screenshots, idle, heartbeat)
    window.electronAPI?.stopTimer();
    // Fire-and-forget: invalidate refresh token server-side
    if (refreshToken) {
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
      if (tokens?.accessToken && tokens?.refreshToken) {
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
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
