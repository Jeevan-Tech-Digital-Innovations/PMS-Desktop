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

  refreshPromise: null as Promise<any> | null,

  async refreshSession(axisApiUrl?: string): Promise<any> {
    if (this.refreshPromise) return this.refreshPromise;

    const url = axisApiUrl || import.meta.env.VITE_AXIS_API_URL || 'http://localhost:8081/api';

    this.refreshPromise = (async () => {
      try {
        const { session } = require('electron');
        const cookies = await session.defaultSession.cookies.get({ url });
        const refreshCookie = cookies.find((c: any) => c.name === 'axis_refresh_staging' || c.name === 'axis_refresh');

        if (!refreshCookie) {
          return { success: false, statusCode: 0, message: 'No refresh cookie found' };
        }

        const confirmUrl = url.replace(/\/api\/?$/, '/api/v1') + '/auth/confirm-access';
        const response = await fetch(confirmUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `${refreshCookie.name}=${refreshCookie.value}; axis_refresh=${refreshCookie.value}`
          }
        });

        const contentType = response.headers.get('content-type') || '';

        if (response.ok) {
          // getSetCookie() is available in Node 18+ fetch and avoids comma-concatenation bugs
          const setCookieArray = typeof response.headers.getSetCookie === 'function' 
            ? response.headers.getSetCookie() 
            : [response.headers.get('set-cookie')].filter(Boolean) as string[];
          
          if (setCookieArray && setCookieArray.length > 0) {
            for (const cookieStr of setCookieArray) {
              const cookieMatch = cookieStr.match(/(?:axis_refresh_staging|axis_refresh)=([^;]+)/i);
              if (cookieMatch) {
                const cookieName = cookieStr.toLowerCase().includes('axis_refresh_staging')
                  ? 'axis_refresh_staging' : 'axis_refresh';
                await session.defaultSession.cookies.set({
                  url: url,
                  name: cookieName,
                  value: cookieMatch[1],
                  path: '/',
                  httpOnly: true,
                  secure: url.startsWith('https'),
                });
                console.log(`[AuthStore] Rotated ${cookieName} cookie saved to Electron session.`);
              }
            }
          } else {
            console.warn('[AuthStore] No Set-Cookie header — Axis may not have rotated the token.');
          }
          
          const data = await response.json();
          const newAccessToken = data.access_token || data.accessToken || data.data?.accessToken;
          if (newAccessToken) {
            store.set('accessToken', newAccessToken);
          }
          return { success: true, ...data };
        } else {
          if (!contentType.includes('application/json')) {
            return { success: false, statusCode: -1, message: `Network interception detected (Status: ${response.status})` };
          }
          return { success: false, statusCode: response.status, message: `Refresh failed with status: ${response.status}` };
        }
      } catch (err: any) {
        console.error('[AuthStore] Session refresh failed:', err);
        return { success: false, statusCode: -1, message: err.message || String(err) };
      } finally {
        this.refreshPromise = null;
      }
    })();
    
    return this.refreshPromise;
  }
};
