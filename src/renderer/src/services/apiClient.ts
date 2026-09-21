import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { config } from '@/config/config';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

/**
 * Global Axios instance with auth interceptors.
 */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // For auth_token cookie
});

// Request interceptor: attach Bearer token
apiClient.interceptors.request.use((config) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor: handle 401/403 and auto-refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Spring Security may return 403 (default) or 401 (with AuthenticationEntryPoint)
    // for missing/expired tokens. Handle both to trigger auto-refresh.
    if (
      (error.response?.status === 401 || error.response?.status === 403) &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      try {
        const data = await window.electronAPI!.refreshSession({ axisApiUrl: config.AXIS_API_URL });

        // authStore.refreshSession() directly returns the newAccessToken string
        const newAccessToken = typeof data === 'string' ? data : (data.accessToken || data.data?.accessToken);

        if (newAccessToken) {
          const currentUser = useAuthStore.getState().user;
          const returnedUser = data.user || data.data?.user;
          
          let nextUser = currentUser;
          if (returnedUser) {
            nextUser = {
              ...(currentUser || {}),
              ...returnedUser,
              userId: returnedUser.id || returnedUser.userId || currentUser?.userId || 1,
            } as any;
          }

          const currentRefreshToken = useAuthStore.getState().refreshToken;
          useAuthStore.getState().setAuth({
            user: nextUser as any,
            accessToken: newAccessToken,
            refreshToken: currentRefreshToken || '', // Preserve existing value; token is managed via Set-Cookie by Axis
            rememberMe: true, // Preserve remember me state
          });

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return apiClient(originalRequest);
        } else {
          throw new Error('Refresh session did not return an access token');
        }
      } catch (refreshError: any) {
        // Refresh failed. 
        // Only force logout if the server explicitly rejected the token (400, 401, 403) 
        // or if the refresh cookie is missing. 
        // Do NOT log out for 404 (Staging bug), 500, or Network Errors!
        const msg = refreshError.message || String(refreshError);
        const isAuthRejection = msg.includes('Refresh failed with status: 401') || 
                                msg.includes('Refresh failed with status: 403') || 
                                msg.includes('Refresh failed with status: 400') ||
                                msg.includes('No refresh cookie found');

        if (isAuthRejection) {
          console.error('[Auth] Refresh explicitly rejected. Logging out.', msg);
          useAuthStore.getState().logout();
        } else {
          console.warn('[Auth] Refresh failed due to network or lock screen error. Not logging out.', msg);
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);
