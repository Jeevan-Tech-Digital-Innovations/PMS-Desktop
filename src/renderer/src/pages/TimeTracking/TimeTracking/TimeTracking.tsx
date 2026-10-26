import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { formatTime, formatDuration } from '@/utils/formatTime';
import { stopTimeLog, getActiveTimeLog } from '../TimeTrackingApi.services';
import { stopBreak } from '@/services/BreakApi.services';
import { getNotesForTask, updateNote, deleteNote } from '@/services/NoteApi.services';
import styles from './TimeTracking.module.css';

// SVG Icons matching Figma design
const SuitcaseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

const CoffeeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
    <line x1="6" y1="1" x2="6" y2="4" />
    <line x1="10" y1="1" x2="10" y2="4" />
    <line x1="14" y1="1" x2="14" y2="4" />
  </svg>
);

const FolderIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronSelectorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="7 15 12 20 17 15" />
    <polyline points="7 9 12 4 17 9" />
  </svg>
);

const SquareIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="9 12 11.5 14.5 15.5 9.5" />
  </svg>
);

const NoteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export function TimeTracking() {
  const navigate = useNavigate();
  const {
    isRunning,
    workSeconds,
    taskSeconds,
    dailyTotalSeconds,
    idleSeconds,
    breakSeconds,
    isOnBreak,
    isIdle,
    startTimer,
    stopTimer,
    stopBreak: stopBreakTimer,
  } = useTimerStore();

  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);
  const openBreakModal = useUiStore((s) => s.openBreakModal);
  const openNoteModal = useUiStore((s) => s.openNoteModal);
  const showNoteModal = useUiStore((s) => s.showNoteModal);

  const [notes, setNotes] = useState<any[]>([]);
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  const [showStartedBanner, setShowStartedBanner] = useState(true);

  const fetchNotes = () => {
    if (selectedTask?.id) {
      getNotesForTask(selectedTask.id)
        .then(setNotes)
        .catch(console.error);
    }
  };

  useEffect(() => {
    if (!showNoteModal) {
      fetchNotes();
    }
  }, [selectedTask?.id, showNoteModal]);

  useEffect(() => {
    const timer = setTimeout(() => setShowStartedBanner(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // Resume timer UI if we arrive here with an active time log
  useEffect(() => {
    if (activeTimeLog && !isRunning) {
      const diffSec = activeTimeLog.startTime
        ? Math.max(0, Math.floor((Date.now() - new Date(activeTimeLog.startTime).getTime()) / 1000))
        : 0;
      startTimer(diffSec);
    }
  }, [activeTimeLog, isRunning, startTimer]);

  const stopMutation = useMutation({
    mutationFn: (overrideTaskId?: number) => {
      const taskId = overrideTaskId || activeTimeLog?.taskId || selectedTask?.id;
      if (!taskId) throw new Error('No task ID found to stop');
      return stopTimeLog(Number(taskId));
    },
    onSuccess: () => {
      stopTimer();
      setActiveTimeLog(null);
      window.electronAPI?.stopTimer();
      toast.success('Timer stopped');
      navigate('/dashboard');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to stop timer');
      stopTimer();
      setActiveTimeLog(null);
      window.electronAPI?.stopTimer();
      navigate('/dashboard');
    },
  });

  const handleStop = async () => {
    const taskId = activeTimeLog?.taskId || selectedTask?.id;
    if (taskId) {
      stopMutation.mutate(Number(taskId));
      return;
    }
    try {
      const active = await getActiveTimeLog();
      if (active?.taskId) {
        stopMutation.mutate(Number(active.taskId));
        return;
      }
    } catch (e) {}
    stopTimer();
    window.electronAPI?.stopTimer();
    navigate('/dashboard');
  };

  const handleBreakToggle = async () => {
    if (isOnBreak) {
      if (!activeTimeLog) return;
      try {
        await stopBreak(activeTimeLog.id);
        stopBreakTimer();
        window.electronAPI?.stopBreak();
        toast.success('Break stopped');
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Failed to stop break');
      }
    } else {
      openBreakModal();
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
      await deleteNote(noteId);
      toast.success('Note deleted');
      fetchNotes();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete note');
    }
  };

  const totalTimeSeconds = workSeconds + idleSeconds + breakSeconds;

  return (
    <div className={styles.container}>
      {/* Top Banner: "Timer started" alert badge matching Figma */}
      <div className={styles.bannerContainer}>
        {showStartedBanner && (
          <div className={styles.startedBanner}>
            <CheckCircleIcon />
            <span>Timer started</span>
          </div>
        )}
      </div>

      {/* Status indicator: Mint badge with glowing teal dot "• Tracking" */}
      <div className={styles.statusSection}>
        <div className={styles.statusTracking}>
          <span className={styles.trackingDot} />
          <span>{isIdle ? 'Idle' : isOnBreak ? 'On Break' : 'Tracking'}</span>
        </div>
      </div>

      {/* Main Digital Clock Display: Solid bold black */}
      <div className={styles.timerSection}>
        <div className={styles.mainTimer}>
          {formatTime(dailyTotalSeconds)}
        </div>

        {/* Sub-timers row: Suitcase (task time) | Coffee mug (break time) */}
        <div className={styles.subTimersRow}>
          <div className={styles.subTimerItem} title="Task Time">
            <SuitcaseIcon />
            <span>{formatTime(taskSeconds)}</span>
          </div>
          <span className={styles.subTimerDivider}>|</span>
          <div className={styles.subTimerItem} title="Break Time">
            <CoffeeIcon />
            <span>{formatDuration(breakSeconds)}</span>
          </div>
        </div>
      </div>

      {/* Active Project & Task Selector Card */}
      <div className={styles.activeProjectCard}>
        <div className={styles.folderIconBadge}>
          <FolderIcon />
        </div>

        <div className={styles.cardContent}>
          <span className={styles.cardLabel}>ACTIVE PROJECT</span>
          <h3 className={styles.projectName}>
            {selectedProject?.name || 'VP Tex'}
          </h3>
          <p className={styles.taskName} title={selectedTask?.title}>
            {((selectedTask as any)?.parentTaskTitle || selectedTask?.parentTaskName)
              ? `↳ ${(selectedTask as any)?.parentTaskTitle || selectedTask?.parentTaskName} · `
              : ''}
            {selectedTask?.title || 'Select Task'}
            {selectedTask?.estimatedTime && selectedTask.estimatedTime !== '00:00:00'
              ? ` (Est: ${selectedTask.estimatedTime})`
              : ''}
          </p>
        </div>

        <div className={styles.cardChevron}>
          <ChevronSelectorIcon />
        </div>
      </div>

      {/* Action Buttons: Dual Stop / Break matching Frame 3 & 9 */}
      <div className={styles.actionsContainer}>
        <div className={styles.dualActions}>
          <button
            className={styles.stopBtn}
            onClick={handleStop}
            disabled={stopMutation.isPending}
          >
            <SquareIcon />
            <span>{stopMutation.isPending ? 'Stopping...' : 'Stop'}</span>
          </button>
          <button
            className={`${styles.breakBtn} ${isOnBreak ? styles.breakBtnActive : ''}`}
            onClick={handleBreakToggle}
          >
            <CoffeeIcon />
            <span>{isOnBreak ? 'Back to Work' : 'Break'}</span>
          </button>
        </div>

        {/* Session Note utility row */}
        <div className={styles.noteToolbar}>
          <button
            className={styles.noteAddBtn}
            onClick={() => openNoteModal()}
            title="Add a note to this session"
          >
            <NoteIcon />
            <span>Add Note</span>
          </button>
          {notes.length > 0 && (
            <button
              className={styles.notesCountBtn}
              onClick={() => setShowNotesDrawer(!showNotesDrawer)}
            >
              <span>{notes.length} Note{notes.length > 1 ? 's' : ''}</span>
              <span>{showNotesDrawer ? '▲' : '▼'}</span>
            </button>
          )}
        </div>

        {/* Notes Drawer */}
        {showNotesDrawer && notes.length > 0 && (
          <div className={styles.notesList}>
            {notes.map((note) => (
              <div key={note.noteId} className={styles.noteCard}>
                <p className={styles.noteText}>{note.noteText}</p>
                <button
                  className={styles.noteDeleteBtn}
                  onClick={() => handleDeleteNote(note.noteId)}
                  title="Delete Note"
                >
                  <DeleteIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
