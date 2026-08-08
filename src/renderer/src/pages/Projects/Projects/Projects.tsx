import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshButton } from "@refinedev/antd";

const MyRefreshComponent = ({ onClick, disabled }: any) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onClick && !disabled) {
      onClick();
    }
  };

  return (
    <div onClickCapture={handleClick} style={{ marginLeft: 'auto', display: 'flex', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <RefreshButton
        hideText
        disabled={disabled}
        style={{ pointerEvents: 'none' }}
      />
    </div>
  );
};
import { useQuery } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { fetchProjects } from '../ProjectsApi.services';
import styles from './Projects.module.css';

export function Projects() {
  const navigate = useNavigate();
  const setDraftProject = useProjectStore((s) => s.setDraftProject);
  const [search, setSearch] = useState('');

  const { data: projects = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['projects', search],
    queryFn: () => fetchProjects(search),
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
