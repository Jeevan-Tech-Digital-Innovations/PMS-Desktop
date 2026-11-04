import { apiClient } from '@/services/apiClient';
import { Project } from '@/types/project';
import { API_ENDPOINTS } from '@/utils/constants';

export async function fetchProjects(search?: string, userId?: string | number): Promise<Project[]> {
  const params: any = { includeStats: false, assignedOnly: true };
  if (search) params.search = search;
  const { data } = await apiClient.get<Project[]>(API_ENDPOINTS.PROJECTS, { params });
  const allProjects: Project[] = Array.isArray(data) ? data : (data as any).content || [];

  // In the Desktop app we always restrict to projects the user is directly
  // assigned to (as a member or as the project manager).
  // The backend already enforces assignedOnly=true. If userId is provided, we can also
  // perform a case-insensitive check against projectManagerId and members as a client safeguard.
  if (userId) {
    const uid = String(userId).toLowerCase().trim();
    const matching = allProjects.filter((p: any) => {
      const isManager = p.projectManagerId && String(p.projectManagerId).toLowerCase() === uid;
      const isMember = Array.isArray(p.members) && p.members.some((m: any) => String(m).toLowerCase() === uid);
      return isManager || isMember;
    });

    if (matching.length > 0) {
      return matching;
    }
  }

  return allProjects;
}
