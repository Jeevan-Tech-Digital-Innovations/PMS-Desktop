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
    
    // We must check all cookies because the cookie might be set on the web URL domain instead of the API URL domain
    const cookies = await session.defaultSession.cookies.get({});
    const refreshCookie = cookies.find((c: any) => c.name === 'axis_refresh_staging' || c.name === 'axis_refresh');
    
    const https = require('https');
    const axios = require('axios');
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    
    if (refreshCookie) {
      // SSO Refresh
      const confirmUrl = axisApiUrl.replace(/\/api\/?$/, '/api/v1') + '/auth/confirm-access';
      const response = await axios.post(confirmUrl, {}, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Cookie': `axis_refresh=${refreshCookie.value}`
        },
        httpsAgent: confirmUrl.startsWith('https') ? httpsAgent : undefined,
        validateStatus: () => true
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
    } else {
      // Local Refresh Fallback
      const { refreshToken } = authStore.getTokens();
      if (!refreshToken) {
        throw new Error('No refresh cookie found and no local refresh token stored');
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
