import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchAssignedItems, AssignedItem } from '../TasksApi.services';
import styles from './Tasks.module.css';

// ─── Refresh button ───────────────────────────────────────────────────────────
const RefreshButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
  <button
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) onClick();
    }}
    disabled={disabled}
    className={styles.refreshBtn}
    title="Refresh"
  >
    ↻
  </button>
);

// ─── Task / Subtask card ──────────────────────────────────────────────────────
interface ItemCardProps {
  item: AssignedItem;
  isSelected: boolean;
  onSelect: (item: AssignedItem) => void;
}

const ItemCard = ({ item, isSelected, onSelect }: ItemCardProps) => (
  <button
    className={`${styles.card} ${isSelected ? styles.selected : ''} ${item.itemType === 'subtask' ? styles.subtaskCard : ''}`}
    onClick={() => onSelect(item)}
    title="Select & Start"
  >
    <div className={styles.cardTop}>
      <span className={styles.name}>{item.title}</span>
      {item.itemType === 'subtask' && (
        <span className={styles.subtaskBadge}>Subtask</span>
      )}
    </div>
    <span className={styles.meta}>
      {item.status}
      {item.priority && ` · ${item.priority}`}
    </span>
  </button>
);

// ─── Main Tasks page ──────────────────────────────────────────────────────────
export function Tasks() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const selectedProject = useProjectStore((s) => s.selectedProject);
  const draftProject    = useProjectStore((s) => s.draftProject);
  const selectedTask    = useProjectStore((s) => s.selectedTask);
  const setDraftTask    = useProjectStore((s) => s.setDraftTask);
  const commitDraftSelection = useProjectStore((s) => s.commitDraftSelection);
  const clearDraftSelection  = useProjectStore((s) => s.clearDraftSelection);
  const userId = useAuthStore((s) => s.user?.userId);

  const [search, setSearch] = useState('');
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const activeProject = draftProject || selectedProject;
  const queryClient = useQueryClient();

  const queryKey = ['assignedItems', projectId, userId];

  const { data: items = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey,
    queryFn: () => fetchAssignedItems(Number(projectId), userId),
    enabled: !!projectId,
  });

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      // Invalidate cache first so staleTime doesn't block the network call
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const taskCount    = items.filter((i) => i.itemType === 'task').length;
  const subtaskCount = items.filter((i) => i.itemType === 'subtask').length;

  const displayedList = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, search]);

  const handleSelect = (item: AssignedItem) => {
    setDraftTask(item);
    commitDraftSelection();
    navigate('/dashboard');
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => { clearDraftSelection(); navigate('/projects'); }}
        >
          ← Back
        </button>
        <h2 className={styles.title}>{activeProject?.name || 'My Tasks'}</h2>
        <RefreshButton onClick={handleRefresh} disabled={isRefetching || isManualRefreshing} />
      </div>

      {/* Search */}
      <input
        className={styles.search}
        type="text"
        placeholder="Search tasks & subtasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Count summary */}
      {!isLoading && items.length > 0 && (
        <div className={styles.summary}>
          {taskCount > 0 && <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>}
          {taskCount > 0 && subtaskCount > 0 && <span className={styles.dot}>·</span>}
          {subtaskCount > 0 && <span>{subtaskCount} subtask{subtaskCount !== 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* List */}
      <div className={styles.list}>
        {isLoading ? (
          <p className={styles.loading}>Loading your tasks...</p>
        ) : displayedList.length === 0 ? (
          <p className={styles.empty}>
            {search ? 'No matching tasks found' : 'No tasks assigned to you in this project'}
          </p>
        ) : (
          displayedList.map((item) => (
            <ItemCard
              key={`${item.itemType}-${item.id}`}
              item={item}
              isSelected={selectedTask?.id === item.id}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
