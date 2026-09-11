import { apiClient } from '@/services/apiClient';
import { Project } from '@/types/project';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchProjects(search?: string, userId?: string | number): Promise<Project[]> {
  const params: any = search ? { search } : {};
  const { data } = await apiClient.get<Project[]>(API_ENDPOINTS.PROJECTS, { params });
  const allProjects: Project[] = Array.isArray(data) ? data : (data as any).content || [];

  // In the Desktop app we always restrict to projects the user is directly
  // assigned to (as a member or as the project manager), regardless of their
  // backend permission level (Read_All / Read_Own).
  if (userId) {
    const uid = String(userId);
    return allProjects.filter((p: any) => {
      const isManager = String(p.projectManagerId) === uid;
      const isMember = Array.isArray(p.members) && p.members.map(String).includes(uid);
      return isManager || isMember;
    });
  }

  return allProjects;
}
