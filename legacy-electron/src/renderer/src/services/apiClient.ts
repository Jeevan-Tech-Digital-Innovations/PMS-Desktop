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

// ── Response interceptor: handle 401/403 + queue concurrent requests ──
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null): void => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      (error.response?.status === 401 || error.response?.status === 403) &&
      !originalRequest._retry
    ) {
      // Skip auth endpoints to prevent infinite refresh loops
      if (originalRequest.url?.match(/\/auth\/(login|logout|refresh-token|authenticate|register)/)) {
        return Promise.reject(error);
      }

      // If a refresh is already in flight, queue this request
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest._retry = true; // Mark queued request too, before re-issuing
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        }).catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Returns a typed result object — never throws for auth rejections
        const result = await window.electronAPI!.refreshSession({ axisApiUrl: config.AXIS_API_URL });

        const newAccessToken = result?.access_token || result?.accessToken || result?.data?.accessToken;

        if (!result?.success || !newAccessToken) {
          throw result; // Pass the typed result to catch block
        }

        // Carry forward existing user and refreshToken — only accessToken changes
        const currentState = useAuthStore.getState();
        useAuthStore.getState().setAuth({
          user: currentState.user!,
          accessToken: newAccessToken,
          refreshToken: currentState.refreshToken || '',
          rememberMe: true,
        });

        processQueue(null, newAccessToken);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);

      } catch (refreshResult: any) {
        processQueue(refreshResult, null);

        // statusCode: 400 | 401 | 403 = explicit Axis rejection → logout
        // statusCode: 0 = missing cookie → logout
        // statusCode: -1 = network/proxy error → do NOT logout (transient)
        const statusCode = refreshResult?.statusCode ?? -1;
        const isAuthRejection = statusCode === 400 || statusCode === 401 ||
                                statusCode === 403 || statusCode === 0;

        if (isAuthRejection) {
          console.error('[Auth] Refresh explicitly rejected by Axis. Logging out.', refreshResult?.message);
          useAuthStore.getState().logout(true); // skipApiCall = true: token is already dead
        } else {
          console.warn('[Auth] Transient refresh failure (network/proxy). Not logging out.', refreshResult?.message);
        }
        return Promise.reject(error); // Reject with the original API error, not the refresh error
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);
