import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useStartTimeLog } from '@/hooks/useStartTimeLog';
import { formatTime } from '@/utils/formatTime';
import { stopTimeLog } from '../TimeTrackingApi.services';
import styles from './TimeTracking.module.css';

export function TimeTracking() {
  const navigate = useNavigate();
  const {
    isRunning,
    workSeconds,
    breakSeconds,
    isOnBreak,
    isIdlePaused,
    startTimer,
    stopTimer,
    tick,
    tickBreak,
  } = useTimerStore();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);
  const openBreakModal = useUiStore((s) => s.openBreakModal);
  const openNoteModal = useUiStore((s) => s.openNoteModal);
  const startMutation = useStartTimeLog();

  // Resume timer UI if we arrive here with an active time log
  useEffect(() => {
    if (activeTimeLog && !isRunning) {
      startTimer();
    }
  }, [activeTimeLog, isRunning, startTimer]);

  useEffect(() => {
    const interval = setInterval(() => {
      tick();
      tickBreak();
    }, 1000);
    return () => clearInterval(interval);
  }, [tick, tickBreak]);

  const stopMutation = useMutation({
    mutationFn: () => stopTimeLog(activeTimeLog!.taskId),
    onSuccess: () => {
      stopTimer();
      setActiveTimeLog(null);
      window.electronAPI?.stopTimer();
      toast.success('Timer stopped');
      navigate('/dashboard');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to stop timer');
    },
  });

  const handleStart = () => {
    if (!selectedProject || !selectedTask) return;
    startMutation.mutate({ taskId: selectedTask.id });
  };

  const handleStop = () => {
    if (!activeTimeLog) {
      stopTimer();
      window.electronAPI?.stopTimer();
      navigate('/dashboard');
      return;
    }
    stopMutation.mutate();
  };

  if (!selectedProject || !selectedTask) {
    return (
      <div className={styles.container}>
        <div className={styles.timerSection}>
          <p className={styles.emptyText}>No project or task selected.</p>
          <button className={styles.startBtn} onClick={() => navigate('/projects')}>
            Select Project
          </button>
        </div>
      </div>
    );
  }

  // Show start prompt if timer is not running
  if (!isRunning) {
    return (
      <div className={styles.container}>
        <div className={styles.timerSection}>
          <div className={styles.timer}>{formatTime(0)}</div>
        </div>

        <div className={styles.projectCard}>
          <h3 className={styles.projectName}>{selectedProject.name}</h3>
          <p className={styles.taskName}>{selectedTask.title}</p>
        </div>

        <button
          className={styles.startBtn}
          onClick={handleStart}
          disabled={startMutation.isPending}
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.connectionStatus}>
        <span className={styles.statusDot} />
        {isIdlePaused ? 'Idle — timer paused' : 'Connected'}
      </div>

      <div className={styles.timerSection}>
        <div className={styles.timer}>{formatTime(workSeconds)}</div>
        <div className={styles.counters}>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>Work</span>
            <span className={styles.counterValue}>{formatTime(workSeconds)}</span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>Break</span>
            <span className={styles.counterValue}>{formatTime(breakSeconds)}</span>
          </div>
        </div>
      </div>

      <div className={styles.projectCard}>
        <h3 className={styles.projectName}>{selectedProject.name}</h3>
        <p className={styles.taskName}>{selectedTask.title}</p>
      </div>

      <div className={styles.actions}>
        <button className={styles.breakBtn} onClick={openBreakModal}>
          {isOnBreak ? 'Stop Break' : 'Break'}
        </button>
        <button className={styles.noteBtn} onClick={openNoteModal}>
          Add Note
        </button>
        <button
          className={styles.stopBtn}
          onClick={handleStop}
          disabled={stopMutation.isPending}
        >
          {stopMutation.isPending ? 'Stopping...' : 'Stop'}
        </button>
      </div>
    </div>
  );
}
