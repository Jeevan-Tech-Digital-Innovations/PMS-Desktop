import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useStartTimeLog } from '@/hooks/useStartTimeLog';
import { formatTime } from '@/utils/formatTime';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const navigate = useNavigate();
  const { isRunning, workSeconds, breakSeconds, isIdlePaused, tick, tickBreak } = useTimerStore();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const startMutation = useStartTimeLog();

  useEffect(() => {
    const interval = setInterval(() => {
      tick();
      tickBreak();
    }, 1000);
    return () => clearInterval(interval);
  }, [tick, tickBreak]);

  const getStatusText = () => {
    if (isIdlePaused) return 'Idle — Paused';
    if (isRunning) return 'Working';
    return 'Ready';
  };

  const getStatusClass = () => {
    if (isIdlePaused) return styles.statusPaused;
    if (isRunning) return styles.statusWorking;
    return styles.statusReady;
  };

  return (
    <div className={styles.container}>
      <div className={styles.statusSection}>
        <div className={`${styles.statusBadge} ${getStatusClass()}`}>
          <span className={styles.statusDot} />
          {getStatusText()}
        </div>
      </div>

      <div className={styles.timerSection}>
        <div className={styles.timer}>{formatTime(workSeconds)}</div>
        <div className={styles.counters}>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>Work Time</span>
            <span className={styles.counterValue}>{formatTime(workSeconds)}</span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>Break Time</span>
            <span className={styles.counterValue}>{formatTime(breakSeconds)}</span>
          </div>
        </div>
      </div>

      {selectedProject ? (
        <div className={styles.projectCard}>
          <div className={styles.projectInfo}>
            <h3 className={styles.projectName}>{selectedProject.name}</h3>
            <p className={styles.projectStatus}>{selectedTask?.title || selectedProject.status}</p>
          </div>
          {!isRunning && (
            <button className={styles.changeBtn} onClick={() => navigate('/projects')}>
              Change
            </button>
          )}
        </div>
      ) : (
        <button className={styles.selectBtn} onClick={() => navigate('/projects')}>
          Select Project
        </button>
      )}

      {selectedProject && selectedTask && !isRunning && (
        <button
          className={styles.startBtn}
          onClick={() =>
            startMutation.mutate({ taskId: selectedTask.id })
          }
          disabled={startMutation.isPending}
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </button>
      )}

      {isRunning && (
        <div className={styles.activitySection}>
          <h3 className={styles.sectionTitle}>Today's Activity</h3>
          <p className={styles.activityPlaceholder}>Activity data will appear here</p>
        </div>
      )}
    </div>
  );
}
