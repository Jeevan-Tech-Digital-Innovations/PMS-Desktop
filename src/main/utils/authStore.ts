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
    const refreshToken = store.get('refreshToken');
    if (!refreshToken) {
      throw new Error('No refresh token found in store');
    }

    const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
    const refreshUrl = `${apiUrl}/auth/refresh-token`;
    
    const axios = require('axios');
    const https = require('https');
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.post(refreshUrl, { refreshToken }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      httpsAgent: refreshUrl.startsWith('https') ? httpsAgent : undefined,
      validateStatus: () => true // Handle all statuses
    });
    
    if (response.status >= 200 && response.status < 300) {
      const data = response.data;
      const newAccessToken = data.accessToken || data.data?.accessToken;
      if (newAccessToken) {
        store.set('accessToken', newAccessToken);
        return newAccessToken;
      }
      throw new Error('Refresh session did not return an access token');
    } else {
      throw new Error(`Refresh failed with status: ${response.status}`);
    }
  }
};
