import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchProjects } from '../ProjectsApi.services';
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

const FolderIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

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

  const displayedProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const handleSelect = (project: any) => {
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
        <h2 className={styles.title}>Select Project</h2>
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

      {/* Search Input matching Frame 4 & 5 */}
      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Find a project..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Project list or Loading state */}
      <div className={styles.content}>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Loading projects...</p>
          </div>
        ) : displayedProjects.length === 0 ? (
          <div className={styles.emptyContainer}>
            <p className={styles.emptyText}>
              {search ? 'No projects match your search' : 'No projects found'}
            </p>
          </div>
        ) : (
          <div className={styles.list}>
            {displayedProjects.map((project) => {
              const isSelected = activeProjId === project.id;
              return (
                <button
                  key={project.id}
                  className={`${styles.itemBtn} ${isSelected ? styles.selectedItem : ''}`}
                  onClick={() => handleSelect(project)}
                >
                  <span className={styles.itemIcon}>
                    <FolderIcon />
                  </span>
                  <span className={styles.itemName}>{project.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
