import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { fetchTasks } from '../TasksApi.services';
import { Task } from '@/types/task';
import styles from './Tasks.module.css';

export function Tasks() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const draftProject = useProjectStore((s) => s.draftProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const setDraftTask = useProjectStore((s) => s.setDraftTask);
  const commitDraftSelection = useProjectStore((s) => s.commitDraftSelection);
  const clearDraftSelection = useProjectStore((s) => s.clearDraftSelection);
  const [search, setSearch] = useState('');

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', projectId, search],
    queryFn: () => fetchTasks(Number(projectId), search),
    enabled: !!projectId,
  });

  const activeProject = draftProject || selectedProject;

  const handleSelect = (task: Task) => {
    setDraftTask(task);
    commitDraftSelection();
    navigate('/dashboard');
  };

  const handleBack = () => {
    clearDraftSelection();
    navigate('/projects');
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={handleBack}>
          ← Back
        </button>
        <h2 className={styles.title}>{activeProject?.name || 'Select Task'}</h2>
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={styles.list}>
        {isLoading ? (
          <p className={styles.loading}>Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <p className={styles.empty}>No tasks found</p>
        ) : (
          tasks.map((task: Task) => (
            <button
              key={task.id}
              className={`${styles.card} ${selectedTask?.id === task.id ? styles.selected : ''}`}
              onClick={() => handleSelect(task)}
            >
              <span className={styles.name}>{task.title}</span>
              <span className={styles.meta}>
                {task.status} · {task.priority}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
