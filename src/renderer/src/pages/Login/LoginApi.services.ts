import { apiClient } from '@/services/apiClient';
import { LoginRequest, LoginResponse } from '@/types/auth';
import { API_ENDPOINTS } from '@/utils/constants';

export async function loginApi(payload: LoginRequest): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>(API_ENDPOINTS.AUTH_LOGIN, payload);
  return data;
}
