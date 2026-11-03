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
  getAccumulatedBreakSecondsToday,
  getTaskAccumulatedSecondsToday,
} from '@/pages/TimeTracking/TimeTrackingApi.services';
import { updateTaskStatus } from '@/pages/Tasks/TasksApi.services';
import { stopBreak } from '@/services/BreakApi.services';
import { apiClient } from '@/services/apiClient';
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

const PauseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
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

const AlertTriangleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export function Dashboard() {
  const navigate = useNavigate();
  const {
    isRunning,
    isWorkdayRunning,
    isTaskRunning,
    workSeconds,
    taskSeconds,
    dailyTotalSeconds,
    idleSeconds,
    breakSeconds,
    dailyBreakSeconds,
    activeBreakLimit,
    breakReasonText,
    isBreakExceeded,
    isIdle,
    isOnBreak,
    pauseTask,
    stopTimer,
    setTaskSeconds,
    setDailyTotalSeconds,
    setDailyBreakSeconds,
    stopBreak: stopBreakTimer,
  } = useTimerStore();

  const isOverallActive = isWorkdayRunning || isRunning;

  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);
  const openBreakModal = useUiStore((s) => s.openBreakModal);
  const startMutation = useStartTimeLog();

  const [showStartedBanner, setShowStartedBanner] = useState(false);
  const [reassignFeedback, setReassignFeedback] = useState<string | null>(null);

  // Synchronize daily total and task seconds on mount and whenever selected task changes
  useEffect(() => {
    let isMounted = true;
    const fetchTimes = async () => {
      try {
        const [dailyTotal, taskTotal, dailyBreak] = await Promise.all([
          getAccumulatedSecondsToday().catch(() => 0),
          selectedTask?.id ? getTaskAccumulatedSecondsToday(selectedTask.id).catch(() => 0) : Promise.resolve(0),
          getAccumulatedBreakSecondsToday().catch(() => 0),
        ]);
        if (isMounted) {
          const currentDaily = useTimerStore.getState().dailyTotalSeconds;
          if (!isOverallActive) {
            setDailyTotalSeconds(dailyTotal);
            setDailyBreakSeconds(dailyBreak);
          } else {
            if (dailyTotal > currentDaily) {
              setDailyTotalSeconds(dailyTotal);
            }
            if (dailyBreak > 0) {
              setDailyBreakSeconds(dailyBreak);
            }
          }
          if (taskTotal !== undefined && !isTaskRunning) {
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

  // Auto-fetch feedback note from activities for active task
  useEffect(() => {
    if (!selectedTask?.id) {
      setReassignFeedback(null);
      return;
    }

    const desc = String(selectedTask.description || '').trim();
    const isSystemAudit = desc.toLowerCase().startsWith('changed status');

    apiClient
      .get(`/tasks/${selectedTask.id}/activities`)
      .then(({ data }) => {
        const acts = Array.isArray(data) ? data : ((data as any)?.data || []);
        const sortedActs = acts.slice().sort((a: any, b: any) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          if (timeA !== timeB) return timeB - timeA;
          return (Number(b.id) || 0) - (Number(a.id) || 0);
        });

        const noteAct = sortedActs.find((a: any) => {
          const str = String(a.action || '');
          return /note:\s*"/i.test(str) || (str.toLowerCase().includes('re-assigned') && /note:/i.test(str));
        });

        if (noteAct && noteAct.action) {
          const match =
            noteAct.action.match(/note:\s*"([^"]+)"/i) ||
            noteAct.action.match(/note:\s*([^\n]+)/i);
          if (match && match[1]?.trim()) {
            const actualNote = match[1].trim();
            setReassignFeedback(actualNote);
            if (desc !== actualNote) {
              useProjectStore.getState().setSelectedTask({
                ...selectedTask,
                description: actualNote,
              });
            }
            return;
          }
        }

        // If it was just a system audit log, purge it so it doesn't display as a note
        if (isSystemAudit) {
          useProjectStore.getState().setSelectedTask({
            ...selectedTask,
            description: '',
          });
        }
      })
      .catch(() => {});
  }, [selectedTask?.id]);

  useEffect(() => {
    if (isTaskRunning) {
      setShowStartedBanner(true);
      const timer = setTimeout(() => setShowStartedBanner(false), 5000);
      return () => clearTimeout(timer);
    } else {
      setShowStartedBanner(false);
    }
  }, [isTaskRunning]);

  const stopMutation = useMutation({
    mutationFn: (overrideTaskId?: number) => {
      const taskId = overrideTaskId || activeTimeLog?.taskId || selectedTask?.id;
      if (!taskId) throw new Error('No task ID found to stop');
      return stopTimeLog(Number(taskId));
    },
    onSuccess: async (data: any) => {
      pauseTask();
      setActiveTimeLog(null);
      toast.success('Task paused. Overall workday timer is still running.');

      // 1. Immediately apply the exact accumulated seconds returned by the server
      const returnedAccumulated = data?.accumulatedSecondsToday;
      if (typeof returnedAccumulated === 'number' && returnedAccumulated >= 0) {
        setTaskSeconds(returnedAccumulated);
      }

      // 2. Query official server totals to guarantee 100% parity with Web table
      const targetTaskId = selectedTask?.id || activeTimeLog?.taskId;
      try {
        const [dailyTotal, taskTotal] = await Promise.all([
          getAccumulatedSecondsToday().catch(() => 0),
          targetTaskId ? getTaskAccumulatedSecondsToday(targetTaskId).catch(() => 0) : Promise.resolve(0),
        ]);
        const currentDaily = useTimerStore.getState().dailyTotalSeconds;
        if (!isOverallActive) {
          setDailyTotalSeconds(dailyTotal);
        } else if (dailyTotal > currentDaily) {
          setDailyTotalSeconds(dailyTotal);
        }
        if (taskTotal !== undefined) {
          setTaskSeconds(taskTotal);
        }
      } catch (err) {
        console.error('Failed to sync times after stopping task:', err);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to pause task timer');
      pauseTask();
      setActiveTimeLog(null);
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

  const handlePauseTask = async () => {
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
    pauseTask();
    setActiveTimeLog(null);
  };

  const handleClockOut = async () => {
    const taskId = activeTimeLog?.taskId || selectedTask?.id;
    if (isTaskRunning && taskId) {
      try {
        await stopTimeLog(Number(taskId));
      } catch (e) {
        console.error('Failed to stop task time log during clock out:', e);
      }
    }
    stopTimer();
    setActiveTimeLog(null);
    window.electronAPI?.stopTimer();
    toast.success('Clocked out for the day.');
    try {
      const [dailyTotal, taskTotal] = await Promise.all([
        getAccumulatedSecondsToday().catch(() => 0),
        selectedTask?.id ? getTaskAccumulatedSecondsToday(selectedTask.id).catch(() => 0) : Promise.resolve(0),
      ]);
      if (dailyTotal > 0) {
        setDailyTotalSeconds(dailyTotal);
      }
      if (taskTotal !== undefined) {
        setTaskSeconds(taskTotal);
      }
    } catch {}
  };

  const isTaskNeverStarted = (() => {
    const status = String(selectedTask?.status || '').toLowerCase().trim();
    return status === 'opentask' || status.includes('open') || taskSeconds === 0;
  })();

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

  const overdueSeconds =
    activeBreakLimit && breakSeconds > activeBreakLimit ? breakSeconds - activeBreakLimit : 0;
  const overdueMins = Math.max(1, Math.round(overdueSeconds / 60));

  const handleProjectCardClick = () => {
    if (isTaskRunning) return; // Don't change project while task timer is actively tracking
    if (!selectedProject) {
      navigate('/projects');
    } else {
      navigate(`/tasks/${selectedProject.id}`);
    }
  };

  return (
    <div className={styles.container}>
      {/* Top Banner: "Break limit exceeded" or "Timer started" alert badge matching Figma */}
      <div className={styles.bannerContainer}>
        {isOnBreak && isBreakExceeded ? (
          <div className={styles.exceededBanner}>
            <AlertTriangleIcon />
            <span>
              {breakReasonText || 'Break'} limit ({Math.floor((activeBreakLimit || 0) / 60)}m) exceeded!
            </span>
          </div>
        ) : isTaskRunning && showStartedBanner ? (
          <div className={styles.startedBanner}>
            <CheckCircleIcon />
            <span>Timer started</span>
          </div>
        ) : null}
      </div>

      {/* Status indicator: "• Tracking Task" / "• On Duty (Task Paused)" / "• Ready" */}
      <div className={styles.statusSection}>
        {isOnBreak && isBreakExceeded ? (
          <div className={styles.statusBreakExceeded}>
            <span className={styles.exceededDot} />
            <span>{breakReasonText || 'Break'} Exceeded (+{overdueMins}m)</span>
          </div>
        ) : isTaskRunning ? (
          <div className={styles.statusTracking}>
            <span className={styles.trackingDot} />
            <span>{isIdle ? 'Idle' : isOnBreak ? 'On Break' : 'Tracking'}</span>
          </div>
        ) : isOverallActive ? (
          <div className={styles.statusOnDuty}>
            <span className={styles.onDutyDot} />
            <span>On Duty (Task Paused)</span>
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
        <div className={`${styles.mainTimer} ${isOverallActive ? styles.timerActive : styles.timerReady}`}>
          {formatTime(dailyTotalSeconds)}
        </div>

        {/* Sub-timers row: Suitcase (task time) | Coffee mug (break time) */}
        <div className={styles.subTimersRow}>
          <div className={styles.subTimerItem} title="Task Time">
            <SuitcaseIcon />
            <span>{formatTime(taskSeconds)}</span>
          </div>
          <span className={styles.subTimerDivider}>|</span>
          <div className={styles.subTimerItem} title="Total Break Time Today">
            <CoffeeIcon />
            <span>{formatDuration(dailyBreakSeconds || breakSeconds)}</span>
          </div>
        </div>
      </div>

      {/* Active Project & Task Selector Card */}
      <div
        className={`${styles.activeProjectCard} ${isTaskRunning ? styles.cardRunning : ''}`}
        onClick={handleProjectCardClick}
        title={isTaskRunning ? 'Pause task to switch project or task' : 'Click to select project or task'}
      >
        <div className={styles.folderIconBadge}>
          <FolderIcon />
        </div>

        <div className={styles.cardContent}>
          <div className={styles.labelRow}>
            <span className={styles.cardLabel}>ACTIVE PROJECT</span>
            {(selectedProject?.clientCompanyName || selectedProject?.clientName) && (
              <span
                className={styles.projectClientBadge}
                title={`Client: ${selectedProject.clientCompanyName || selectedProject.clientName}`}
              >
                {selectedProject.clientCompanyName || selectedProject.clientName}
              </span>
            )}
          </div>
          <h3 className={styles.projectName}>
            {selectedProject?.name || 'Select Project'}
          </h3>
          <p className={styles.taskName}>
            {selectedTask?.title || 'Select Task'}
          </p>
          {(() => {
            const rawDesc = String(selectedTask?.description || '').trim();
            const displayNote = reassignFeedback || (!rawDesc.toLowerCase().startsWith('changed status') ? rawDesc : null);
            if (!displayNote) return null;
            const isFeedback =
              Boolean(reassignFeedback) ||
              String(selectedTask?.status || '').toLowerCase().replace(/[^a-z]/g, '').includes('reassign');

            return (
              <div
                className={`${styles.activeTaskNote} ${isFeedback ? styles.noteReassigned : ''}`}
                title={displayNote}
              >
                <span className={styles.noteLabel}>
                  {isFeedback ? 'Feedback:' : 'Note:'}
                </span>{' '}
                <span className={styles.noteBody}>{displayNote}</span>
              </div>
            );
          })()}
        </div>

        {!isTaskRunning && (
          <div className={styles.cardChevron}>
            <ChevronSelectorIcon />
          </div>
        )}
      </div>

      {/* Action Buttons: 
          1. isTaskRunning: Pause Task + Break
          2. On duty (task paused): Start Task (if open/unworked) or Resume Task + Clock Out
          3. Off duty (ready): Start
      */}
      <div className={styles.actionsContainer}>
        {isTaskRunning ? (
          <div className={styles.dualActions}>
            <button
              className={styles.stopBtn}
              onClick={handlePauseTask}
              disabled={stopMutation.isPending}
              title="Pause task tracking"
            >
              <PauseIcon />
              <span>{stopMutation.isPending ? 'Pausing...' : 'Pause Task'}</span>
            </button>
            <button
              className={`${styles.breakBtn} ${
                isOnBreak
                  ? isBreakExceeded
                    ? styles.breakBtnExceeded
                    : styles.breakBtnActive
                  : ''
              }`}
              onClick={handleBreakToggle}
            >
              <CoffeeIcon />
              <span>{isOnBreak ? 'Back to Work' : 'Break'}</span>
            </button>
          </div>
        ) : isOverallActive ? (
          <div className={styles.dualActions}>
            <button
              className={styles.startBtn}
              onClick={handleStart}
              disabled={startMutation.isPending}
              title={isTaskNeverStarted ? 'Start task tracking' : 'Resume task tracking'}
            >
              <PlayIcon />
              <span>
                {startMutation.isPending
                  ? 'Starting...'
                  : isTaskNeverStarted
                    ? 'Start Task'
                    : 'Resume Task'}
              </span>
            </button>
            <button
              className={styles.clockOutBtn}
              onClick={handleClockOut}
              title="End workday and stop overall tracking"
            >
              <SquareIcon />
              <span>Clock Out</span>
            </button>
          </div>
        ) : (
          <button
            className={styles.startBtn}
            onClick={handleStart}
            disabled={startMutation.isPending}
          >
            <PlayIcon />
            <span>{startMutation.isPending ? 'Starting...' : 'Start'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
