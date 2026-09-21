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
    const { net } = require('electron');
    const axisApiUrl = import.meta.env.VITE_AXIS_API_URL || 'http://localhost:8081/api';
    const confirmUrl = axisApiUrl.replace(/\/api\/?$/, '/api/v1') + '/auth/confirm-access';

    // We don't need to manually extract and send cookies!
    // By using Electron's native net.fetch with credentials: 'include', Chromium handles everything:
    // 1. Automatically attaches the correct axis_refresh cookie (and JSESSIONID if needed).
    // 2. Automatically processes any Set-Cookie headers for refresh token rotation!

    try {
      const response = await net.fetch(confirmUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        const newAccessToken = data.access_token || data.accessToken || data.data?.accessToken;
        if (newAccessToken) {
          store.set('accessToken', newAccessToken);
          return newAccessToken;
        }
        throw new Error('Refresh session did not return an access token');
      } else {
        throw new Error(`Refresh failed with status: ${response.status}`);
      }
    } catch (err: any) {
      // Fallback for network errors or if confirm-access fails completely
      const { refreshToken } = authStore.getTokens();
      if (!refreshToken) {
        throw err; // Re-throw the confirm-access error if no local fallback is possible
      }

      const localApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';
      const refreshUrl = `${localApiUrl}/auth/refresh-token`;

      const response = await axios.post(refreshUrl, { refreshToken }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        httpsAgent: refreshUrl.startsWith('https') ? httpsAgent : undefined,
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        // Depending on how local API structures it, usually { accessToken, refreshToken }
        // or { data: { accessToken, refreshToken } }
        const newAccessToken = data.accessToken || data.data?.accessToken;
        const newRefreshToken = data.refreshToken || data.data?.refreshToken;

        if (newAccessToken) {
          store.set('accessToken', newAccessToken);
          if (newRefreshToken) {
            store.set('refreshToken', newRefreshToken);
          }
          return newAccessToken;
        }
        throw new Error('Local refresh session did not return an access token');
      } else {
        throw new Error(`Refresh failed with status: ${response.status}`);
      }
    }
  }
};
