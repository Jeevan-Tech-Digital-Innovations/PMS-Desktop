import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  getActiveTimeLog,
  getAccumulatedSecondsToday,
  getTaskAccumulatedSecondsToday,
} from '@/pages/TimeTracking/TimeTrackingApi.services';

// Module-level timestamp — only set when the USER explicitly clicks Start locally.
// The sync must NOT set this when it auto-starts from a web-detected timer.
let lastLocalStartTime = 0;

export function markLocalTimerStart() {
  lastLocalStartTime = Date.now();
  console.log('[TimerSync] Local timer start marked, grace period begins.');
}

export function useTimerSync() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tick = useTimerStore((s) => s.tick);
  const tickBreak = useTimerStore((s) => s.tickBreak);

  // Global 1-second ticker when timer is running
  useEffect(() => {
    if (!isAuthenticated) return;

    const tickInterval = setInterval(() => {
      const state = useTimerStore.getState();
      if (state.isRunning) {
        tick();
        tickBreak();

        if (state.workSeconds + 1 === 28800 && !state.isOvertime) {
          setTimeout(async () => {
            const isOT = window.confirm('Your timer has reached 8 hours. Do you want to continue as overtime?');
            const activeLog = useProjectStore.getState().activeTimeLog;
            if (isOT) {
              try {
                if (activeLog?.id) {
                  const { transitionTimerState } = await import('@/pages/TimeTracking/TimeTrackingApi.services');
                  await transitionTimerState(activeLog.taskId, 'OVERTIME');
                }
                useTimerStore.getState().setOvertime(true);
              } catch (e) {
                console.error(e);
              }
            } else {
              try {
                if (activeLog?.id) {
                  const { stopTimeLog } = await import('@/pages/TimeTracking/TimeTrackingApi.services');
                  await stopTimeLog(activeLog.id);
                }
                useTimerStore.getState().stopTimer();
                useProjectStore.getState().setActiveTimeLog(null);
                window.electronAPI?.stopTimer();
              } catch (e) {
                console.error(e);
              }
            }
          }, 0);
        }

        // Forgotten Timer Protection: 1 hour (3600 seconds) IDLE auto-stop
        if (state.isIdle && state.idleSeconds === 3600) {
          setTimeout(async () => {
            const activeLog = useProjectStore.getState().activeTimeLog;
            try {
              if (activeLog?.id) {
                const { stopTimeLog } = await import('@/pages/TimeTracking/TimeTrackingApi.services');
                await stopTimeLog(activeLog.id);
              }
              useTimerStore.getState().stopTimer();
              useProjectStore.getState().setActiveTimeLog(null);
              window.electronAPI?.stopTimer();

              new Notification('PMS Tracker', {
                body: 'Your timer was auto-stopped due to 60 minutes of inactivity.'
              });
            } catch (e) {
              console.error(e);
            }
          }, 0);
        }
      }
    }, 1000);

    return () => clearInterval(tickInterval);
  }, [isAuthenticated, tick, tickBreak]);

  // Restore daily accumulated time and active timer on mount
  useEffect(() => {
    if (!isAuthenticated) return;

    const syncTimes = async () => {
      try {
        const [activeLog, dailyTotal] = await Promise.all([
          getActiveTimeLog().catch(() => null),
          getAccumulatedSecondsToday().catch(() => 0),
        ]);

        if (dailyTotal > 0) {
          useTimerStore.getState().setDailyTotalSeconds(dailyTotal);
        }

        if (activeLog && activeLog.taskId) {
          useProjectStore.getState().setActiveTimeLog(activeLog);
          if (!useProjectStore.getState().selectedTask) {
            useProjectStore.getState().setSelectedTask({
              id: activeLog.taskId,
              title: activeLog.taskName || 'Active Task',
              projectId: activeLog.projectId,
            } as any);
          }
          if (activeLog.projectId && !useProjectStore.getState().selectedProject) {
            useProjectStore.getState().setSelectedProject({
              id: activeLog.projectId,
              name: activeLog.projectName || 'Active Project',
            } as any);
          }

          const taskSec = await getTaskAccumulatedSecondsToday(activeLog.taskId).catch(() => 0);
          useTimerStore.getState().setTaskSeconds(taskSec);

          const elapsed = activeLog.startTime
            ? Math.max(0, Math.floor((Date.now() - new Date(activeLog.startTime).getTime()) / 1000))
            : 0;

          if (!useTimerStore.getState().isRunning) {
            useTimerStore.getState().startTimer(elapsed);
          }
        } else {
          const selTask = useProjectStore.getState().selectedTask;
          if (selTask?.id) {
            const taskSec = await getTaskAccumulatedSecondsToday(selTask.id).catch(() => 0);
            useTimerStore.getState().setTaskSeconds(taskSec);
          }
        }
      } catch (err) {
        console.error('[TimerSync] Failed to restore active time log:', err);
      }
    };

    syncTimes();

    // Periodic sync with backend every 60 seconds to ensure time logs alignment
    const syncInterval = setInterval(syncTimes, 60000);
    return () => clearInterval(syncInterval);
  }, [isAuthenticated]);
}

