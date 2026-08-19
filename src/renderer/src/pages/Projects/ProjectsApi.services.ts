import { apiClient } from '@/services/apiClient';
import { Project } from '@/types/project';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchProjects(search?: string, userId?: string | number): Promise<Project[]> {
  const params: any = search ? { search } : {};
  if (userId) {
    params.members = userId;
  }
  const { data } = await apiClient.get<Project[]>(API_ENDPOINTS.PROJECTS, { params });
  return data;
}
