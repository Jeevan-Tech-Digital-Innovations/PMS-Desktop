import Store from 'electron-store';

interface StoredUser {
  userId: number;
  username: string;
  empNo: string;
  roles: string[];
}

interface AuthSchema {
  accessToken: string | null;
  refreshToken: string | null;
  rememberMe: boolean;
  user: StoredUser | null;
}

const store = new Store<AuthSchema>({
  name: 'auth',
  defaults: {
    accessToken: null,
    refreshToken: null,
    rememberMe: false,
    user: null,
  },
});

export const authStore = {
  getTokens() {
    return {
      accessToken: store.get('accessToken'),
      refreshToken: store.get('refreshToken'),
    };
  },

  getStartupTokens() {
    if (!store.get('rememberMe')) {
      return { accessToken: null, refreshToken: null };
    }
    return this.getTokens();
  },

  saveTokens(data: { accessToken: string; refreshToken: string; rememberMe: boolean }) {
    store.set('accessToken', data.accessToken);
    store.set('refreshToken', data.refreshToken);
    store.set('rememberMe', data.rememberMe);
  },

  getUser(): StoredUser | null {
    if (!store.get('rememberMe')) {
      return null;
    }
    return store.get('user');
  },

  saveUser(user: StoredUser) {
    store.set('user', user);
  },

  clearTokens() {
    store.set('accessToken', null);
    store.set('refreshToken', null);
    store.set('rememberMe', false);
    store.set('user', null);
  },

  async refreshSession(): Promise<string> {
    const { session } = require('electron');
    const axisApiUrl = import.meta.env.VITE_AXIS_API_URL || 'http://localhost:8081/api';
    
    // Use default session to find the refresh cookie valid for the specific API URL
    const cookies = await session.defaultSession.cookies.get({ url: axisApiUrl });
    const refreshCookie = cookies.find((c: any) => c.name === 'axis_refresh_staging' || c.name === 'axis_refresh');
    
    if (!refreshCookie) {
      throw new Error('No refresh cookie found');
    }

    const confirmUrl = axisApiUrl.replace(/\/api\/?$/, '/api/v1') + '/auth/confirm-access';
    const response = await fetch(confirmUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': `axis_refresh=${refreshCookie.value}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const newAccessToken = data.accessToken || data.data?.accessToken;
      if (newAccessToken) {
        store.set('accessToken', newAccessToken);
        // Inform the renderer that the token has changed! Wait, we can't easily IPC back, 
        // but next time renderer fetches or reloads, it gets from authStore
        return newAccessToken;
      }
      throw new Error('Refresh session did not return an access token');
    } else {
      throw new Error(`Refresh failed with status: ${response.status}`);
    }
  }
};
