import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchProjects } from '../ProjectsApi.services';
import styles from './Projects.module.css';

const MyRefreshComponent = ({ onClick, disabled }: any) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onClick && !disabled) {
      onClick();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      style={{
        marginLeft: 'auto',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'none',
        border: 'none',
        fontSize: '18px',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      ↻
    </button>
  );
};

export function Projects() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.userId);
  const setDraftProject = useProjectStore((s) => s.setDraftProject);
  const [search, setSearch] = useState('');

  const { data: projects = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['projects', search, userId],
    queryFn: () => fetchProjects(search, userId),
  });

  const handleSelect = (project: any) => {
    setDraftProject(project);
    navigate(`/tasks/${project.id}`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/dashboard')}>
          ← Back
        </button>
        <h2 className={styles.title}>Select Project</h2>
        <MyRefreshComponent onClick={() => refetch()} disabled={isRefetching} />
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="Search projects..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={styles.list}>
        {isLoading ? (
          <p className={styles.loading}>Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className={styles.empty}>No projects found</p>
        ) : (
          projects.map((project) => (
            <button
              key={project.id}
              className={styles.card}
              onClick={() => handleSelect(project)}
            >
              <span className={styles.name}>{project.name}</span>
              <span className={styles.status}>{project.status}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
