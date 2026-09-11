import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { getActiveTimeLog, getPreviousSecondsTodayForTask } from '@/pages/TimeTracking/TimeTrackingApi.services';

export function useTimerSync() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tick = useTimerStore((s) => s.tick);
  const tickBreak = useTimerStore((s) => s.tickBreak);

  const isSyncingRef = useRef(false);

  // Global 1-second ticker when timer is running
  useEffect(() => {
    if (!isAuthenticated) return;

    const tickInterval = setInterval(() => {
      const isRunning = useTimerStore.getState().isRunning;
      if (isRunning) {
        tick();
        tickBreak();
      }
    }, 1000);

    return () => clearInterval(tickInterval);
  }, [isAuthenticated, tick, tickBreak]);

  // Periodic active timer sync with API (every 3 seconds)
  useEffect(() => {
    if (!isAuthenticated) return;

    const syncActiveTimer = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;

      try {
        const activeLog = await getActiveTimeLog();
        const { isRunning, startTime } = useTimerStore.getState();
        const activeTimeLog = useProjectStore.getState().activeTimeLog;

        if (activeLog && activeLog.id && !activeLog.endTime) {
          // If website paused the task (PRODUCTIVE_PAUSE):
          if (activeLog.timeType === 'PRODUCTIVE_PAUSE') {
            if (isRunning || activeTimeLog !== null) {
              console.log('[TimerSync] Web is paused (PRODUCTIVE_PAUSE). Stopping desktop timer.');
              useTimerStore.getState().stopTimer();
              useTimerStore.getState().reset();
              useProjectStore.getState().setActiveTimeLog(null);
              window.electronAPI?.stopTimer();
              toast('Timer paused from web', { icon: '⏸️' });
              if (location.pathname === '/tracking') {
                navigate('/dashboard');
              }
            }
            return;
          }

          // An active log exists on the server (running or away)
          if (!isRunning || !activeTimeLog || activeTimeLog.id !== activeLog.id) {
            console.log('[TimerSync] Active timer detected from web:', activeLog);

            // Populate project and task stores
            const project = {
              id: activeLog.projectId,
              name: activeLog.projectName || `Project #${activeLog.projectId}`,
              status: 'In Progress',
            } as any;

            const task = {
              id: activeLog.taskId,
              title: activeLog.taskName || `Task #${activeLog.taskId}`,
              projectId: activeLog.projectId,
              status: 'In Progress',
            } as any;

            useProjectStore.setState({
              selectedProject: project,
              selectedTask: task,
              activeTimeLog: activeLog,
            });

            // Fetch accumulated seconds already logged today for this task
            const previousSecondsToday = await getPreviousSecondsTodayForTask(activeLog.taskId);

            // Calculate current session elapsed seconds
            let currentSessionElapsed = 0;
            if (activeLog.startTime) {
              const startMs = new Date(activeLog.startTime).getTime();
              if (!isNaN(startMs)) {
                currentSessionElapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
              }
            }

            const totalInitialSeconds = previousSecondsToday + currentSessionElapsed;
            const isAway = activeLog.timeType === 'AWAY' || activeLog.timeType === 'BREAK';

            // Start desktop timer store resuming from total seconds today
            useTimerStore.setState({
              isRunning: true,
              isOnBreak: isAway,
              isIdle: false,
              workSeconds: totalInitialSeconds,
              idleSeconds: 0,
              breakSeconds: 0,
              startTime: activeLog.startTime,
            });

            // Start background electron processes
            window.electronAPI?.startTimer({
              timeLogId: activeLog.id,
              startTime: activeLog.startTime,
            });

            if (isAway) {
              window.electronAPI?.startBreak();
            }

            toast.success(`Timer running: ${activeLog.taskName || 'Task'}`);

            // Automatically navigate to /tracking if not already there
            if (location.pathname !== '/tracking') {
              navigate('/tracking');
            }
          } else {
            // Already running same log: synchronize Break / Away state
            const isAway = activeLog.timeType === 'AWAY' || activeLog.timeType === 'BREAK';
            const { isOnBreak } = useTimerStore.getState();

            if (isAway && !isOnBreak) {
              console.log('[TimerSync] Web is Away. Starting break on desktop.');
              useTimerStore.getState().startBreak();
              window.electronAPI?.startBreak();
              toast('Break started from web (Away)', { icon: '☕' });
            } else if (!isAway && isOnBreak) {
              console.log('[TimerSync] Web resumed from Away. Stopping break on desktop.');
              useTimerStore.getState().stopBreak();
              window.electronAPI?.stopBreak();
              toast('Break stopped from web (Resumed)', { icon: '▶️' });
            }

            // Reconcile drift if greater than 10 seconds
            if (activeLog.startTime && !isOnBreak) {
              const startMs = new Date(activeLog.startTime).getTime();
              if (!isNaN(startMs)) {
                const calculated = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
                const currentSec = useTimerStore.getState().workSeconds;
                if (Math.abs(calculated - currentSec) > 10) {
                  useTimerStore.setState({ workSeconds: calculated });
                }
              }
            }
          }
        } else {
          // No active log on server
          if (isRunning || activeTimeLog !== null) {
            console.log('[TimerSync] Active timer stopped from web, stopping desktop timer');

            useTimerStore.getState().stopTimer();
            useTimerStore.getState().reset();
            useProjectStore.getState().setActiveTimeLog(null);
            window.electronAPI?.stopTimer();

            toast('Timer stopped from web', { icon: '⏹️' });

            // If on /tracking page, navigate back to /dashboard
            if (location.pathname === '/tracking') {
              navigate('/dashboard');
            }
          }
        }
      } catch (e) {
        console.error('[TimerSync] Error synchronizing active timer:', e);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Run initial sync immediately
    syncActiveTimer();

    const interval = setInterval(syncActiveTimer, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, location.pathname, navigate]);
}
