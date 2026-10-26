import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useStartTimeLog } from '@/hooks/useStartTimeLog';
import { formatTime, formatDuration } from '@/utils/formatTime';
import {
  stopTimeLog,
  getActiveTimeLog,
  getAccumulatedSecondsToday,
  getTaskAccumulatedSecondsToday,
} from '@/pages/TimeTracking/TimeTrackingApi.services';
import { updateTaskStatus } from '@/pages/Tasks/TasksApi.services';
import { stopBreak } from '@/services/BreakApi.services';
import styles from './Dashboard.module.css';

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

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
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

export function Dashboard() {
  const navigate = useNavigate();
  const {
    isRunning,
    workSeconds,
    taskSeconds,
    dailyTotalSeconds,
    idleSeconds,
    breakSeconds,
    isIdle,
    isOnBreak,
    stopTimer,
    setTaskSeconds,
    setDailyTotalSeconds,
    stopBreak: stopBreakTimer,
  } = useTimerStore();

  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);
  const openBreakModal = useUiStore((s) => s.openBreakModal);
  const startMutation = useStartTimeLog();

  const [showStartedBanner, setShowStartedBanner] = useState(false);

  // Synchronize daily total and task seconds on mount and whenever selected task changes
  useEffect(() => {
    let isMounted = true;
    const fetchTimes = async () => {
      try {
        const [dailyTotal, taskTotal] = await Promise.all([
          getAccumulatedSecondsToday().catch(() => 0),
          selectedTask?.id ? getTaskAccumulatedSecondsToday(selectedTask.id).catch(() => 0) : Promise.resolve(0),
        ]);
        if (isMounted) {
          if (dailyTotal > 0 || !isRunning) {
            setDailyTotalSeconds(dailyTotal);
          }
          if (taskTotal !== undefined) {
            setTaskSeconds(taskTotal);
          }
        }
      } catch (err) {
        console.error('Failed to sync times:', err);
      }
    };
    fetchTimes();
    return () => {
      isMounted = false;
    };
  }, [selectedTask?.id]);

  useEffect(() => {
    if (isRunning) {
      setShowStartedBanner(true);
      const timer = setTimeout(() => setShowStartedBanner(false), 5000);
      return () => clearTimeout(timer);
    } else {
      setShowStartedBanner(false);
    }
  }, [isRunning]);

  const stopMutation = useMutation({
    mutationFn: (overrideTaskId?: number) => {
      const taskId = overrideTaskId || activeTimeLog?.taskId || selectedTask?.id;
      if (!taskId) throw new Error('No task ID found to stop');
      return stopTimeLog(Number(taskId));
    },
    onSuccess: async () => {
      stopTimer();
      setActiveTimeLog(null);
      window.electronAPI?.stopTimer();
      toast.success('Timer stopped');
      try {
        const [dailyTotal, taskTotal] = await Promise.all([
          getAccumulatedSecondsToday().catch(() => 0),
          selectedTask?.id ? getTaskAccumulatedSecondsToday(selectedTask.id).catch(() => 0) : Promise.resolve(0),
        ]);
        setDailyTotalSeconds(dailyTotal);
        if (taskTotal !== undefined) {
          setTaskSeconds(taskTotal);
        }
      } catch {}
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to stop timer');
      stopTimer();
      setActiveTimeLog(null);
      window.electronAPI?.stopTimer();
    },
  });

  const handleStart = async () => {
    if (!selectedProject) {
      navigate('/projects');
      return;
    }
    if (!selectedTask) {
      navigate(`/tasks/${selectedProject.id}`);
      return;
    }

    // Ensure status transitions to 'inprogress' when starting task
    const curStatus = String(selectedTask.status || '').toLowerCase().trim();
    if (curStatus !== 'inprogress' && !curStatus.includes('progress')) {
      try {
        await updateTaskStatus(selectedTask.id, 'inprogress', selectedTask.title);
        useProjectStore.getState().setSelectedTask({ ...selectedTask, status: 'inprogress' });
      } catch (err) {
        console.warn('Could not update task status prior to starting timer:', err);
      }
    }

    startMutation.mutate({ taskId: selectedTask.id });
  };

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

  const totalTimeSeconds = workSeconds + idleSeconds + breakSeconds;

  const handleProjectCardClick = () => {
    if (isRunning) return; // Don't change project while timer is running
    if (!selectedProject) {
      navigate('/projects');
    } else {
      navigate(`/tasks/${selectedProject.id}`);
    }
  };

  return (
    <div className={styles.container}>
      {/* Top Banner: "Timer started" alert badge matching Figma */}
      <div className={styles.bannerContainer}>
        {isRunning && showStartedBanner && (
          <div className={styles.startedBanner}>
            <CheckCircleIcon />
            <span>Timer started</span>
          </div>
        )}
      </div>

      {/* Status indicator: "• Ready" or "• Tracking" or "• Idle" */}
      <div className={styles.statusSection}>
        {isRunning ? (
          <div className={styles.statusTracking}>
            <span className={styles.trackingDot} />
            <span>{isIdle ? 'Idle' : isOnBreak ? 'On Break' : 'Tracking'}</span>
          </div>
        ) : (
          <div className={styles.statusReady}>
            <span className={styles.readyDot}>•</span>
            <span>Ready</span>
          </div>
        )}
      </div>

      {/* Main Digital Clock Display */}
      <div className={styles.timerSection}>
        <div className={`${styles.mainTimer} ${isRunning ? styles.timerActive : styles.timerReady}`}>
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
      <div
        className={`${styles.activeProjectCard} ${isRunning ? styles.cardRunning : ''}`}
        onClick={handleProjectCardClick}
        title={isRunning ? 'Timer is running' : 'Click to select project or task'}
      >
        <div className={styles.folderIconBadge}>
          <FolderIcon />
        </div>

        <div className={styles.cardContent}>
          <span className={styles.cardLabel}>ACTIVE PROJECT</span>
          <h3 className={styles.projectName}>
            {selectedProject?.name || 'Select Project'}
          </h3>
          <p className={styles.taskName}>
            {selectedTask?.title || 'Select Task'}
          </p>
        </div>

        {!isRunning && (
          <div className={styles.cardChevron}>
            <ChevronSelectorIcon />
          </div>
        )}
      </div>

      {/* Action Buttons: Single "Start" or Dual "Stop" / "Break" */}
      <div className={styles.actionsContainer}>
        {!isRunning ? (
          <button
            className={styles.startBtn}
            onClick={handleStart}
            disabled={startMutation.isPending}
          >
            <PlayIcon />
            <span>{startMutation.isPending ? 'Starting...' : 'Start'}</span>
          </button>
        ) : (
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
        )}
      </div>
    </div>
  );
}
