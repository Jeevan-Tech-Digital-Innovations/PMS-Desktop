import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchProjects } from '../ProjectsApi.services';
import { Project } from '@/types/project';
import styles from './Projects.module.css';

// SVG Icons
const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ClearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const FolderIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const BuildingIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <line x1="8" y1="6" x2="8.01" y2="6" />
    <line x1="16" y1="6" x2="16.01" y2="6" />
    <line x1="12" y1="6" x2="12.01" y2="6" />
    <line x1="8" y1="10" x2="8.01" y2="10" />
    <line x1="16" y1="10" x2="16.01" y2="10" />
    <line x1="12" y1="10" x2="12.01" y2="10" />
    <line x1="8" y1="14" x2="8.01" y2="14" />
    <line x1="16" y1="14" x2="16.01" y2="14" />
    <line x1="12" y1="14" x2="12.01" y2="14" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

interface ClientGroup {
  clientName: string;
  projects: Project[];
}

export function Projects() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.userId);
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const draftProject = useProjectStore((s) => s.draftProject);
  const setDraftProject = useProjectStore((s) => s.setDraftProject);
  const [search, setSearch] = useState('');
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const queryKey = ['projects', userId];

  const { data: projects = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey,
    queryFn: () => fetchProjects(undefined, userId),
  });

  const getClientDisplayName = (p: Project): string => {
    return (p.clientCompanyName || p.clientName || '').trim() || 'Internal Projects';
  };

  // Unified Search + Client Grouping (Approach B)
  const groupedProjects = useMemo<ClientGroup[]>(() => {
    const q = search.trim().toLowerCase();

    // 1. Filter projects by Project Name, Client Name, Company Name, or Project Code
    const filtered = projects.filter((p) => {
      if (!q) return true;
      const nameMatch = p.name?.toLowerCase().includes(q);
      const companyMatch = p.clientCompanyName?.toLowerCase().includes(q);
      const clientMatch = p.clientName?.toLowerCase().includes(q);
      const codeMatch = p.code?.toLowerCase().includes(q);
      return Boolean(nameMatch || companyMatch || clientMatch || codeMatch);
    });

    // 2. Group filtered projects by Client Name
    const map = new Map<string, Project[]>();
    for (const p of filtered) {
      const client = getClientDisplayName(p);
      if (!map.has(client)) {
        map.set(client, []);
      }
      map.get(client)!.push(p);
    }

    // 3. Sort groups alphabetically with 'Internal Projects' at the end
    const groups: ClientGroup[] = Array.from(map.entries()).map(([clientName, projs]) => ({
      clientName,
      projects: projs,
    }));

    groups.sort((a, b) => {
      if (a.clientName === 'Internal Projects') return 1;
      if (b.clientName === 'Internal Projects') return -1;
      return a.clientName.localeCompare(b.clientName);
    });

    return groups;
  }, [projects, search]);

  const totalFilteredCount = useMemo(() => {
    return groupedProjects.reduce((acc, g) => acc + g.projects.length, 0);
  }, [groupedProjects]);

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const handleSelect = (project: Project) => {
    setDraftProject(project);
    navigate(`/tasks/${project.id}`);
  };

  const activeProjId = draftProject?.id || selectedProject?.id;

  return (
    <div className={styles.container}>
      {/* Header with Back Arrow and Title */}
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate('/dashboard')}
          title="Back to Dashboard"
          aria-label="Back"
        >
          <ArrowLeftIcon />
        </button>
        <div className={styles.titleWrapper}>
          <h2 className={styles.title}>Select Project</h2>
          {projects.length > 0 && (
            <span className={styles.totalBadge}>
              {totalFilteredCount} {totalFilteredCount === 1 ? 'project' : 'projects'}
            </span>
          )}
        </div>
        <button
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={isRefetching || isManualRefreshing}
          title="Refresh projects"
          aria-label="Refresh"
        >
          <span className={isRefetching || isManualRefreshing ? styles.spinning : ''}>
            <RefreshIcon />
          </span>
        </button>
      </div>

      {/* Unified Search Input (Project, Client, Code) */}
      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search by project, client, or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim().length > 0 && (
          <button
            className={styles.clearSearchBtn}
            onClick={() => setSearch('')}
            title="Clear search"
            type="button"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {/* Grouped Project list or Loading / Empty state */}
      <div className={styles.content}>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Loading projects...</p>
          </div>
        ) : groupedProjects.length === 0 ? (
          <div className={styles.emptyContainer}>
            <p className={styles.emptyText}>
              {search ? `No projects match "${search}"` : 'No projects found'}
            </p>
            {search && (
              <button
                className={styles.clearFilterBtn}
                onClick={() => setSearch('')}
                type="button"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className={styles.groupList}>
            {groupedProjects.map((group) => (
              <div key={group.clientName} className={styles.clientGroup}>
                {/* Client Section Header */}
                <div className={styles.groupHeader}>
                  <div className={styles.groupHeaderLeft}>
                    <span className={styles.clientIcon}>
                      <BuildingIcon />
                    </span>
                    <span className={styles.groupClientTitle} title={group.clientName}>
                      {group.clientName}
                    </span>
                  </div>
                  <span className={styles.groupProjectCount}>
                    {group.projects.length}
                  </span>
                </div>

                {/* Projects belonging to this client */}
                <div className={styles.groupProjects}>
                  {group.projects.map((project) => {
                    const isSelected = activeProjId === project.id;
                    const clientLabel = getClientDisplayName(project);

                    return (
                      <button
                        key={project.id}
                        className={`${styles.itemBtn} ${isSelected ? styles.selectedItem : ''}`}
                        onClick={() => handleSelect(project)}
                      >
                        <span className={styles.itemIcon}>
                          <FolderIcon />
                        </span>

                        <div className={styles.itemInfo}>
                          <div className={styles.titleRow}>
                            <span className={styles.itemName} title={project.name}>
                              {project.name}
                            </span>
                            {project.code && (
                              <span className={styles.codeBadge}>
                                {project.code}
                              </span>
                            )}
                          </div>

                          {/* Highlighted Client Badge under project title (Approach B) */}
                          <div className={styles.badgeRow}>
                            <span className={styles.clientBadge} title={`Client: ${clientLabel}`}>
                              <BuildingIcon />
                              <span className={styles.clientBadgeText}>{clientLabel}</span>
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
