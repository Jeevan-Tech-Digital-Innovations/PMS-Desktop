import { apiClient } from '@/services/apiClient';
import { Project } from '@/types/project';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchProjects(search?: string): Promise<Project[]> {
  const params = search ? { search } : {};
  const { data } = await apiClient.get<Project[]>(API_ENDPOINTS.PROJECTS, { params });
  return data;
}
