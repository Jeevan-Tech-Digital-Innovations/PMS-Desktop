import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { fetchAssignedItems, AssignedItem, updateTaskStatus } from '../TasksApi.services';
import styles from './Tasks.module.css';

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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const ReviewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const RotateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export function Tasks() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const selectedProject = useProjectStore((s) => s.selectedProject);
  const draftProject    = useProjectStore((s) => s.draftProject);
  const selectedTask    = useProjectStore((s) => s.selectedTask);
  const draftTask       = useProjectStore((s) => s.draftTask);
  const setDraftTask    = useProjectStore((s) => s.setDraftTask);
  const commitDraftSelection = useProjectStore((s) => s.commitDraftSelection);
  const clearDraftSelection  = useProjectStore((s) => s.clearDraftSelection);
  const userId = useAuthStore((s) => s.user?.userId);

  const [search, setSearch] = useState('');

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: AssignedItem;
  } | null>(null);

  // Review Status / Complete Task confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    item: AssignedItem;
    targetStatus: string;
    title: string;
    message: string;
    confirmLabel: string;
  } | null>(null);

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const activeProject = draftProject || selectedProject;
  const queryClient = useQueryClient();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const queryKey = ['assignedItems', projectId, userId];

  const { data: items = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey,
    queryFn: () => fetchAssignedItems(Number(projectId), userId),
    enabled: !!projectId,
  });

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['assignedItems'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        if (!isUpdatingStatus) setConfirmModal(null);
      }
    };

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isUpdatingStatus]);

  // Allowed lowercase status keys for Task page
  const ALLOWED_TASK_STATUS_KEYS = new Set(['opentask', 'inprogress', 're-assigned']);

  const normalizeStatusToKey = (raw?: string | null): string => {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'opentask') return 'opentask';
    if (s === 'inprogress') return 'inprogress';
    if (s === 're-assigned' || s === 'reassigned') return 're-assigned';
    if (s.includes('completed') || s.includes('done')) return 'completed';
    if (s.includes('review') || s.includes('need to review') || s.includes('need_to_review')) return 'review';
    if (s.includes('progress')) return 'inprogress';
    if (s.includes('hold')) return 'onhold';
    if (s.includes('re-assign') || s.includes('reassign')) return 're-assigned';
    return 'opentask';
  };

  // Track currently highlighted task in list
  const currentSelectedId = draftTask?.id || selectedTask?.id;

  const displayedList = useMemo(() => {
    // Only display tasks whose status matches: 'opentask', 'inprogress', 're-assigned'
    // Hide all other statuses, such as 'review', 'completed', and 'onhold'
    const filtered = items.filter((i) => ALLOWED_TASK_STATUS_KEYS.has(normalizeStatusToKey(i.status)));
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, search]);

  const handleStartTask = async (e: React.MouseEvent, item: AssignedItem) => {
    e.stopPropagation();
    try {
      setIsUpdatingStatus(true);
      const sKey = normalizeStatusToKey(item.status);
      if (sKey !== 'inprogress') {
        await updateTaskStatus(item.id, 'inprogress', item.title);
        toast.success(`Task "${item.title}" moved to In progress`);
      }
      const updatedItem = { ...item, status: 'inprogress' };
      setDraftTask(updatedItem);
      commitDraftSelection();
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start task');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleCardClick = (item: AssignedItem) => {
    setDraftTask(item);
  };

  const handleContextMenu = (e: React.MouseEvent, item: AssignedItem) => {
    e.preventDefault();
    e.stopPropagation();

    // Select this card as draft task
    setDraftTask(item);

    const menuWidth = 190;
    const menuHeight = 140;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({ x, y, item });
  };

  const handleSelectStatusAction = (item: AssignedItem, targetStatus: string) => {
    setContextMenu(null);

    if (targetStatus === 'Completed') {
      setConfirmModal({
        item,
        targetStatus: 'Completed',
        title: 'Complete Task',
        message: `Do you want to mark "${item.title}" as complete?`,
        confirmLabel: 'Complete',
      });
    } else if (targetStatus === 'Need to review') {
      setConfirmModal({
        item,
        targetStatus: 'Need to review',
        title: 'Submit for Review',
        message: `Do you want to submit "${item.title}" for review?`,
        confirmLabel: 'Submit',
      });
    } else {
      setConfirmModal({
        item,
        targetStatus: 'In progress',
        title: 'Move to In Progress',
        message: `Do you want to mark "${item.title}" as in progress?`,
        confirmLabel: 'Confirm',
      });
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmModal) return;
    const { item, targetStatus } = confirmModal;

    try {
      setIsUpdatingStatus(true);
      await updateTaskStatus(item.id, targetStatus, item.title);

      toast.success(
        targetStatus === 'Completed'
          ? 'Task marked as complete'
          : targetStatus === 'Need to review'
            ? 'Task submitted for review'
            : 'Task status updated'
      );

      // If this item was selected in draftTask, update draftTask too
      if (draftTask && draftTask.id === item.id) {
        setDraftTask({ ...draftTask, status: targetStatus });
      }

      setConfirmModal(null);
      await queryClient.invalidateQueries({ queryKey });
      await refetch();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update task status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleConfirmSelect = () => {
    if (draftTask && ALLOWED_TASK_STATUS_KEYS.has(normalizeStatusToKey(draftTask.status))) {
      commitDraftSelection();
      navigate('/dashboard');
    } else if (displayedList.length > 0) {
      setDraftTask(displayedList[0]);
      commitDraftSelection();
      navigate('/dashboard');
    } else {
      navigate('/dashboard');
    }
  };

  const formatDateDisplay = (dateStr?: string | null) => {
    if (!dateStr) return 'No start date';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const normalizeStatus = (raw?: string | null): string => {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'opentask') return 'Open task';
    if (s === 'inprogress') return 'In progress';
    if (s === 're-assigned' || s === 'reassigned') return 'Re-assigned';
    if (s.includes('completed')) return 'Completed';
    if (s.includes('need to review') || s.includes('need_to_review') || s.includes('review')) return 'Need to review';
    if (s.includes('progress')) return 'In progress';
    if (s.includes('hold')) return 'On Hold';
    if (s.includes('reassign') || s.includes('re-assign')) return 'Re-assigned';
    return 'Open task';
  };

  const getStatusBadgeClass = (status?: string | null) => {
    const key = normalizeStatusToKey(status);
    if (key === 'inprogress') return styles.statusInProgress;
    if (key === 're-assigned') return styles.statusReassigned || styles.statusOpen;
    if (key === 'review') return styles.statusReview;
    if (key === 'completed') return styles.statusCompleted;
    if (key === 'onhold') return styles.statusOnHold;
    return styles.statusOpen;
  };

  const isSubTaskMode = items.some((i) => i.itemType === 'subtask' && draftTask?.id === i.id);

  return (
    <div className={styles.container}>
      {/* Header with Back button and Title; Refresh button */}
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => { clearDraftSelection(); navigate('/projects'); }}
          title="Back to Projects"
          aria-label="Back"
        >
          <ArrowLeftIcon />
        </button>
        <h2 className={styles.title}>{isSubTaskMode ? 'Select Sub-Task' : 'Select Task'}</h2>
        <button
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={isRefetching || isManualRefreshing}
          title={isSubTaskMode ? 'Refresh sub-tasks' : 'Refresh tasks'}
          aria-label="Refresh"
        >
          <span className={isRefetching || isManualRefreshing ? styles.spinning : ''}>
            <RefreshIcon />
          </span>
        </button>
      </div>

      {/* Project Selector Box */}
      <div
        className={styles.projectSelectorBox}
        onClick={() => navigate('/projects')}
        title="Click to switch project"
      >
        <div className={styles.projectBoxLeft}>
          <span className={styles.folderIcon}>
            <FolderIcon />
          </span>
          <span className={styles.projectBoxName}>{activeProject?.name || 'Project'}</span>
        </div>
        <span className={styles.chevronIcon}>
          <ChevronDownIcon />
        </span>
      </div>

      {/* Search Input matching Frame 6 & 7 */}
      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          className={styles.searchInput}
          type="text"
          placeholder={isSubTaskMode ? "Find a Sub-task..." : "Find a task..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tasks List */}
      <div className={styles.list}>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Loading tasks...</p>
          </div>
        ) : displayedList.length === 0 ? (
          <div className={styles.emptyContainer}>
            <p className={styles.emptyText}>
              {search ? 'No matching tasks found' : 'No tasks assigned in this project'}
            </p>
          </div>
        ) : (
          displayedList.map((item) => {
            const isSelected = currentSelectedId === item.id;
            const subtitleDate = item.dueDate
              ? `${formatDateDisplay(item.startDate)} – ${formatDateDisplay(item.dueDate)}`
              : (item.startDate ? `Started ${formatDateDisplay(item.startDate)}` : 'No start date – Today');

            return (
              <div
                key={`${item.itemType}-${item.id}`}
                className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                onClick={() => handleCardClick(item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
              >
                <div className={styles.cardLeft}>
                  <div
                    className={styles.playBadge}
                    title="Start task (In progress)"
                    onClick={(e) => handleStartTask(e, item)}
                  >
                    <PlayIcon />
                  </div>
                  <div className={styles.textContainer}>
                    <div className={styles.titleRow}>
                      <span className={styles.taskTitle}>{item.title}</span>
                      <span className={`${styles.statusBadge} ${getStatusBadgeClass(item.status)}`}>
                        {normalizeStatus(item.status)}
                      </span>
                    </div>
                    <span className={styles.taskSubtitle}>
                      {item.parentTaskTitle ? `↳ ${item.parentTaskTitle} · ` : ''}
                      {subtitleDate}
                    </span>
                    {item.description && item.description.trim() && !item.description.toLowerCase().startsWith('changed status') && (
                      <div
                        className={`${styles.feedbackNoteBox} ${
                          normalizeStatusToKey(item.status) === 're-assigned'
                            ? styles.feedbackReassigned
                            : ''
                        }`}
                        title={item.description}
                      >
                        <span className={styles.feedbackLabel}>
                          {normalizeStatusToKey(item.status) === 're-assigned'
                            ? 'Feedback:'
                            : 'Note:'}
                        </span>
                        <span className={styles.feedbackText}>{item.description}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.cardRight}>
                  <div className={`${styles.radioCircle} ${isSelected ? styles.radioSelected : ''}`} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Fixed Bottom Action Button */}
      <div className={styles.bottomBar}>
        <button
          className={styles.selectTaskBtn}
          onClick={handleConfirmSelect}
          disabled={isLoading || displayedList.length === 0}
        >
          {isSubTaskMode ? 'Select sub-task' : 'Select task'}
        </button>
      </div>

      {/* Right-Click Context Menu for Review Status */}
      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.contextMenuHeader}>Review Status</div>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => handleSelectStatusAction(contextMenu.item, 'Need to review')}
          >
            <ReviewIcon />
            <span>Submit for Review</span>
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => handleSelectStatusAction(contextMenu.item, 'Completed')}
          >
            <CheckCircleIcon />
            <span>Complete Task</span>
          </button>
          {(contextMenu.item.status &&
            (contextMenu.item.status.toLowerCase().includes('completed') ||
              contextMenu.item.status.toLowerCase().includes('review'))) && (
            <button
              type="button"
              className={styles.contextMenuItem}
              onClick={() => handleSelectStatusAction(contextMenu.item, 'In progress')}
            >
              <RotateIcon />
              <span>Mark as In Progress</span>
            </button>
          )}
        </div>
      )}

      {/* Review Status & Complete Task Confirmation Modal matching Reference Design (Screenshot 2) */}
      {confirmModal && (
        <div
          className={styles.confirmModalOverlay}
          onClick={() => !isUpdatingStatus && setConfirmModal(null)}
        >
          <div
            className={styles.confirmModalCard}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.confirmModalTitle}>{confirmModal.title}</h3>
            <p className={styles.confirmModalText}>{confirmModal.message}</p>
            <div className={styles.confirmModalActions}>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                onClick={() => setConfirmModal(null)}
                disabled={isUpdatingStatus}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmActionBtn}
                onClick={handleConfirmStatusChange}
                disabled={isUpdatingStatus}
              >
                {isUpdatingStatus ? 'Updating...' : confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
