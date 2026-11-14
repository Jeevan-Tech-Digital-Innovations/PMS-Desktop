import { apiClient } from './apiClient';

export interface EmployeeProfile {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
  role: string;
  roles: string[];
  idleNotesSetting?: string;
}

export interface Company {
  companyId: number;
  companyName: string;
  email: string;
}

export const fetchMyProfile = async (): Promise<EmployeeProfile> => {
  const { data } = await apiClient.get<{ status: string; data: EmployeeProfile }>('/employees/me');
  return data.data;
};

export const fetchActiveCompanies = async (): Promise<Company[]> => {
  const { data } = await apiClient.get<Company[]>('/companies/active');
  return data;
};

export const switchTenantApi = async (tenantId: string, currentToken: string): Promise<{ access_token: string, roles: Record<string, any> }> => {
  // Use AXIS_API_URL instead of PMS-API URL because tenant switching is handled by Axis Identity Service
  const axisApiUrl = import.meta.env.VITE_AXIS_API_URL || 'http://localhost:8081/api';
  const response = await fetch(`${axisApiUrl}/v1/auth/switch-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentToken}`,
    },
    body: JSON.stringify({ tenant_id: tenantId }),
  });

  if (!response.ok) {
    throw new Error('Failed to switch tenant');
  }

  const data = await response.json();
  return {
    access_token: data.access_token,
    roles: data.roles || {}
  };
};
