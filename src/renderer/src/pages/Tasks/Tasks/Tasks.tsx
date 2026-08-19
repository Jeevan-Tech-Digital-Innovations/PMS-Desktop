import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
        opacity: disabled ? 0.5 : 1
      }}
    >
      ↻
    </button>
  );
};
import { useQuery } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { fetchTasks, fetchSubTasks } from '../TasksApi.services';
import { Task } from '@/types/task';
import styles from './Tasks.module.css';
import { useAuthStore } from '@/stores/authStore';

export function Tasks() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const draftProject = useProjectStore((s) => s.draftProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const setDraftTask = useProjectStore((s) => s.setDraftTask);
  const commitDraftSelection = useProjectStore((s) => s.commitDraftSelection);
  const clearDraftSelection = useProjectStore((s) => s.clearDraftSelection);
  
  const userId = useAuthStore((s) => s.user?.userId);
  
  const [search, setSearch] = useState('');
  const [parentStack, setParentStack] = useState<Task[]>([]);
  const currentParent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

  const { data: tasks = [], isLoading, refetch: refetchTasks, isRefetching: isRefetchingTasks } = useQuery({
    queryKey: ['tasks', projectId, userId],
    queryFn: () => fetchTasks(Number(projectId), search, userId),
    enabled: !!projectId && parentStack.length === 0,
  });

  const { data: subTasks = [], isLoading: isSubTasksLoading, refetch: refetchSubTasks, isRefetching: isRefetchingSubTasks } = useQuery({
    queryKey: ['subTasks', currentParent?.id, userId],
    queryFn: () => fetchSubTasks(Number(currentParent?.id), search, userId),
    enabled: !!currentParent?.id,
  });

  const activeProject = draftProject || selectedProject;

  const handleSelect = (task: Task) => {
    setDraftTask(task);
    commitDraftSelection();
    navigate('/dashboard');
  };

  const handleNavigate = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    setParentStack([...parentStack, task]);
    setSearch('');
  };

  const handleBack = () => {
    if (parentStack.length > 0) {
      const newStack = [...parentStack];
      newStack.pop();
      setParentStack(newStack);
      setSearch('');
    } else {
      clearDraftSelection();
      navigate('/projects');
    }
  };

  const displayedList = useMemo(() => {
    const list = currentParent ? subTasks : tasks;
    if (!search.trim()) return list;
    return list.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
  }, [tasks, subTasks, currentParent, search]);

  const currentlyLoading = isLoading || (currentParent && isSubTasksLoading);
  const isRefetching = isRefetchingTasks || isRefetchingSubTasks;

  const handleRefresh = () => {
    if (currentParent) {
      refetchSubTasks();
    } else {
      refetchTasks();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={handleBack}>
          ← Back
        </button>
        <h2 className={styles.title}>
          {currentParent 
            ? currentParent.title
            : activeProject?.name || 'Select Task'}
        </h2>
        <MyRefreshComponent onClick={handleRefresh} disabled={isRefetching} />
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder={currentParent ? "Search sub-tasks..." : "Search tasks..."}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={styles.list}>
        {currentlyLoading ? (
          <p className={styles.loading}>Loading tasks...</p>
        ) : displayedList.length === 0 ? (
          <p className={styles.empty}>
            {currentParent ? 'No sub-tasks found' : 'No tasks found'}
          </p>
        ) : (
          displayedList.map((task: Task) => (
            <div key={task.id} className={styles.taskRow}>
              <button
                className={`${styles.card} ${selectedTask?.id === task.id ? styles.selected : ''}`}
                onClick={() => handleSelect(task)}
                title="Select & Start Task"
              >
                <span className={styles.name}>{task.title}</span>
                <span className={styles.meta}>
                  {task.status} · {task.priority}
                </span>
              </button>
              <button
                className={styles.navigateBtn}
                onClick={(e) => handleNavigate(e, task)}
                title="View Sub-tasks"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
