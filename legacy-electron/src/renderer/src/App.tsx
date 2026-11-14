import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { useEffect, useRef } from 'react';
import { markLocalTimerStart } from '@/hooks/useTimerSync';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useTimerSync } from '@/hooks/useTimerSync';
import { fetchMyProfile } from '@/services/ProfileApi.services';

// Page imports
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { Tasks } from '@/pages/Tasks';
import { TimeTracking } from '@/pages/TimeTracking';
import { Settings } from '@/pages/Settings';
import { Profile } from '@/pages/Profile';

// Layout imports
import { AuthLayout } from '@/layout/AuthLayout/AuthLayout';
import { AppLayout } from '@/layout/AppLayout/AppLayout';

// Auth guards
import LoginGuard from '@/components/LoginGuard/LoginGuard';
import AuthGuard from '@/components/AuthGuard/AuthGuard';

export default function App() {
  const navigate = useNavigate();
  const checkStoredTokens = useAuthStore((s) => s.checkStoredTokens);

  useTimerSync();

  useEffect(() => {
    // Check for stored tokens on app start
    checkStoredTokens();
  }, [checkStoredTokens]);

  useEffect(() => {
    // Listen for navigation from tray menu
    const unsubscribe = window.electronAPI?.onNavigate((path: string) => {
      navigate(path);
    });
    return () => unsubscribe?.();
  }, [navigate]);

  useEffect(() => {
    // Listen for sign-out from tray menu
    const unsubscribe = window.electronAPI?.onSignOut(() => {
      useAuthStore.getState().logout();
      navigate('/login');
    });
    return () => unsubscribe?.();
  }, [navigate]);

  useEffect(() => {
    // Screenshot capture notifications
    const unsubscribe = window.electronAPI?.onScreenshotUploaded((data) => {
      console.log('[Screenshot] Captured and saved:', {
        timeLogId: data.timeLogId,
        timestamp: new Date().toISOString(),
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    // Active window tracking
    const unsubscribe = window.electronAPI?.onActiveWindowChange((data) => {
      // Defensive: old preload sends a string; new preload sends { app, task, rawTitle }
      const info =
        typeof data === 'string'
          ? { window: data, task: '', rawTitle: data }
          : { window: data?.app, task: data?.task, rawTitle: data?.rawTitle };
      console.log('[Active Window] Changed:', {
        window: info.window,
        task: info.task,
        rawTitle: info.rawTitle,
        timestamp: new Date().toISOString(),
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    // Activity level monitoring
    if (typeof window.electronAPI?.onActivityUpdated !== 'function') return;
    const unsubscribe = window.electronAPI.onActivityUpdated((data) => {
      console.log('[Activity] Updated:', {
        keystrokes: data.keystrokes,
        mouseActions: data.mouseActions,
        timestamp: new Date().toISOString(),
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    // Heartbeat syncing
    if (typeof window.electronAPI?.onHeartbeatSynced !== 'function') return;
    const unsubscribe = window.electronAPI.onHeartbeatSynced((data) => {
      console.log('[Heartbeat] Synced:', {
        timeLogId: data.timeLogId,
        elapsedMinutes: data.elapsedMinutes,
        timestamp: data.timestamp,
      });
    });
    return () => unsubscribe?.();
  }, []);

  const wasTaskRunningBeforeIdleRef = useRef(false);

  useEffect(() => {
    // Idle state changes from the main process activity monitor
    if (typeof window.electronAPI?.onIdleStarted !== 'function') return;
    const unsubscribeStart = window.electronAPI.onIdleStarted(async (data) => {
      console.log('[Idle] Started after', data.seconds, 'seconds');
      wasTaskRunningBeforeIdleRef.current = useTimerStore.getState().isTaskRunning;
      useTimerStore.getState().startIdle(data.seconds);

      // Check user setting for idle notes
      try {
        const profile = await fetchMyProfile();
        const setting = profile.idleNotesSetting || "Disabled";
        
        if (setting === "Enable But Not Mandatory") {
          useUiStore.getState().openNoteModal(false);
        } else if (setting === "Enabled & Mandatory") {
          useUiStore.getState().openNoteModal(true);
        }
      } catch (err) {
        console.error("Failed to fetch profile for idle notes check", err);
      }

      // Sync IDLE state to API
      const isWorkdayActive = useTimerStore.getState().isRunning || useTimerStore.getState().isWorkdayRunning;
      if (isWorkdayActive) {
        const taskId = useProjectStore.getState().activeTimeLog?.taskId || (useProjectStore.getState().selectedTask as any)?.id;
        if (taskId) {
          try {
            const { transitionTimerState } = await import('@/pages/TimeTracking/TimeTrackingApi.services');
            const idleLog = await transitionTimerState(Number(taskId), 'IDLE');
            if (idleLog?.id) {
              useProjectStore.getState().setActiveTimeLog(idleLog);
              window.electronAPI?.startTimer({
                timeLogId: idleLog.id,
                startTime: idleLog.startTime || new Date().toISOString(),
              });
            }
          } catch (e) {
            console.error('[Idle] Failed to transition to IDLE', e);
          }
        }
      }
    });

    const unsubscribeStop = window.electronAPI.onIdleStopped(async () => {
      console.log('[Idle] Stopped – activity detected');
      const shouldResumeTask = wasTaskRunningBeforeIdleRef.current;
      useTimerStore.getState().stopIdle();

      const isWorkdayActive = useTimerStore.getState().isRunning || useTimerStore.getState().isWorkdayRunning;
      if (isWorkdayActive && shouldResumeTask) {
        console.log('[Idle] Auto-resuming task tracking due to user activity');
        // 1. Immediately resume task in local store
        useTimerStore.getState().resumeTask();
        markLocalTimerStart();

        // 2. Automatically sync active state back to API, start heartbeat and update UI
        const taskId = useProjectStore.getState().activeTimeLog?.taskId || (useProjectStore.getState().selectedTask as any)?.id;
        if (taskId) {
          try {
            const { transitionTimerState, startTimeLog, getTaskAccumulatedSecondsToday } = await import('@/pages/TimeTracking/TimeTrackingApi.services');
            let activeLog = null;
            try {
              activeLog = await transitionTimerState(Number(taskId), 'ACTIVE_PRODUCTIVE');
            } catch (err) {
              console.warn('[Idle] transition to ACTIVE_PRODUCTIVE failed; starting fresh time log:', err);
              activeLog = await startTimeLog(Number(taskId)).catch(() => null);
            }

            if (activeLog?.id) {
              useProjectStore.getState().setActiveTimeLog(activeLog);
              window.electronAPI?.startTimer({
                timeLogId: activeLog.id,
                startTime: activeLog.startTime || new Date().toISOString(),
              });
            }

            try {
              const taskSec = await getTaskAccumulatedSecondsToday(Number(taskId)).catch(() => 0);
              useTimerStore.getState().setTaskSeconds(taskSec);
            } catch {}

            toast.success('Activity detected — task tracking auto-resumed!', { id: 'idle-resume', duration: 3000 });
          } catch (e) {
            console.error('[Idle] Failed to transition to ACTIVE_PRODUCTIVE', e);
          }
        }
      }
    });

    return () => {
      unsubscribeStart?.();
      unsubscribeStop?.();
    };
  }, []);

  return (
    <>
      <Toaster position="top-right" />
      <Routes>
        {/* Public routes */}
        <Route element={<LoginGuard />}>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
          </Route>
        </Route>

        {/* Protected routes */}
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/tasks/:projectId" element={<Tasks />} />
          <Route path="/tracking" element={<TimeTracking />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
