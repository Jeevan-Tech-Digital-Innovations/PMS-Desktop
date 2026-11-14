import { apiClient } from '@/services/apiClient';
import { LoginRequest, LoginResponse } from '@/types/auth';
import { API_ENDPOINTS } from '@/utils/constants';

export async function loginApi(payload: LoginRequest): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>(API_ENDPOINTS.AUTH_LOGIN, payload);
  return data;
}

export async function logoutApi(refreshToken: string): Promise<void> {
  try {
    await apiClient.post(API_ENDPOINTS.AUTH_LOGOUT, { refreshToken });
  } catch {
    // Ignore errors — we still clear local tokens
  }
}
