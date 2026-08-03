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

        // Our new Identity Service returns { data: { accessToken, ... } } or just { accessToken } depending on payload shape.
        // Let's assume it returns { accessToken, user }
        const newAccessToken = data.accessToken || data.data?.accessToken;

        if (newAccessToken) {
          useAuthStore.getState().setAuth({
            user: data.user || data.data?.user || useAuthStore.getState().user,
            accessToken: newAccessToken,
            refreshToken: '', // Refresh token is now in a secure cookie, not state
            rememberMe: true, // Preserve remember me state
          });

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return apiClient(originalRequest);
        } else {
          throw new Error('Refresh session did not return an access token');
        }
      } catch (refreshError) {
        // Refresh failed "?" force logout
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);
