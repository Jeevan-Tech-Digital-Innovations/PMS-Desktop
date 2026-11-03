import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  getActiveTimeLog,
  getAccumulatedSecondsToday,
  getAccumulatedBreakSecondsToday,
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
      if (state.isRunning || state.isWorkdayRunning || state.isTaskRunning) {
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
        let activeLog: any = null;
        let isServerError = false;
        try {
          activeLog = await getActiveTimeLog();
        } catch (err) {
          isServerError = true;
          console.warn('[TimerSync] Transient server/network error while verifying active log; maintaining local timer state:', err);
        }

        const [dailyTotal, dailyBreak] = await Promise.all([
          getAccumulatedSecondsToday().catch(() => 0),
          getAccumulatedBreakSecondsToday().catch(() => 0),
        ]);

        const state = useTimerStore.getState();
        const isWorkdayActive = state.isWorkdayRunning || state.isRunning;
        if (!isWorkdayActive) {
          state.setDailyTotalSeconds(dailyTotal);
          state.setDailyBreakSeconds(dailyBreak);
        } else {
          if (dailyTotal > state.dailyTotalSeconds) {
            state.setDailyTotalSeconds(dailyTotal);
          }
          if (dailyBreak > 0) {
            state.setDailyBreakSeconds(dailyBreak);
          }
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

          // If task is actively ticking locally, never overwrite with static/closed server totals
          const isTaskActiveLocally = useTimerStore.getState().isTaskRunning;
          if (!isTaskActiveLocally) {
            const taskSec = await getTaskAccumulatedSecondsToday(activeLog.taskId).catch(() => 0);
            useTimerStore.getState().setTaskSeconds(taskSec);
          }

          const elapsed = activeLog.startTime
            ? Math.max(0, Math.floor((Date.now() - new Date(activeLog.startTime).getTime()) / 1000))
            : 0;

          const isAway = String(activeLog.timeType || '').toUpperCase() === 'AWAY';
          if (!useTimerStore.getState().isRunning) {
            useTimerStore.getState().startTimer(elapsed);
          }
          if (isAway && !useTimerStore.getState().isOnBreak) {
            useTimerStore.getState().startBreak();
          }
        } else if (!isServerError) {
          // If server explicitly confirmed 200 OK with NO active log and grace period has elapsed:
          const isTaskActiveLocally = useTimerStore.getState().isTaskRunning;
          if (isTaskActiveLocally && Date.now() - lastLocalStartTime > 10000) {
            useTimerStore.getState().pauseTask();
            useProjectStore.getState().setActiveTimeLog(null);
          }

          const selTask = useProjectStore.getState().selectedTask;
          if (selTask?.id && !useTimerStore.getState().isTaskRunning) {
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

