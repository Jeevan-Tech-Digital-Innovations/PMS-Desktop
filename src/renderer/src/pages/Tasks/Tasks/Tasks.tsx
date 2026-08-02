import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { fetchTasks, fetchSubTasks } from '../TasksApi.services';
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
  const [selectedParentTask, setSelectedParentTask] = useState<Task | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => fetchTasks(Number(projectId)),
    enabled: !!projectId,
  });

  const { data: subTasks = [], isLoading: isSubTasksLoading } = useQuery({
    queryKey: ['subTasks', selectedParentTask?.id],
    queryFn: () => fetchSubTasks(selectedParentTask!.id),
    enabled: !!selectedParentTask?.id,
  });

  const activeProject = draftProject || selectedProject;

  const handleSelect = (task: Task) => {
    if (!selectedParentTask) {
      // Step 1: User selected a parent task/folder. Show its sub-tasks.
      setSelectedParentTask(task);
      setSearch('');
    } else {
      // Step 2: User selected a sub-task. Start tracking!
      setDraftTask(task);
      commitDraftSelection();
      navigate('/dashboard');
    }
  };

  const handleBack = () => {
    if (selectedParentTask) {
      setSelectedParentTask(null);
      setSearch('');
    } else {
      clearDraftSelection();
      navigate('/projects');
    }
  };

  // Filter tasks or subtasks based on the current view and search input
  const displayedList = useMemo(() => {
    const list = selectedParentTask ? subTasks : tasks;
    if (!search.trim()) return list;
    return list.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
  }, [tasks, subTasks, selectedParentTask, search]);

  const currentlyLoading = isLoading || (selectedParentTask && isSubTasksLoading);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={handleBack}>
          ← Back
        </button>
        <h2 className={styles.title}>
          {selectedParentTask 
            ? `Sub-Tasks: ${selectedParentTask.title}`
            : activeProject?.name || 'Select Task'}
        </h2>
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder={selectedParentTask ? "Search sub-tasks..." : "Search tasks..."}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={styles.list}>
        {currentlyLoading ? (
          <p className={styles.loading}>Loading tasks...</p>
        ) : displayedList.length === 0 ? (
          <p className={styles.empty}>
            {selectedParentTask ? 'No sub-tasks found' : 'No tasks found'}
          </p>
        ) : (
          displayedList.map((task: Task) => (
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
