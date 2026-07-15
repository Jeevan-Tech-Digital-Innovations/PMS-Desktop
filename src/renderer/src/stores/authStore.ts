import { create } from 'zustand';
import { User } from '@/types/auth';

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
    // Persist tokens via Electron main process
    window.electronAPI?.saveTokens({ accessToken, refreshToken, rememberMe });

    set({
      user,
      accessToken,
      refreshToken,
      isAuthenticated: true,
    });
  },

  logout: () => {
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
      const tokens = await window.electronAPI?.getStoredTokens();
      if (tokens?.accessToken && tokens?.refreshToken) {
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
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
