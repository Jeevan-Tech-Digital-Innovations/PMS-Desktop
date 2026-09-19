import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
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
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

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

  useEffect(() => {
    // Idle state changes from the main process activity monitor
    if (typeof window.electronAPI?.onIdleStarted !== 'function') return;
    const unsubscribeStart = window.electronAPI.onIdleStarted(async (data) => {
      console.log('[Idle] Started');
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
    });
    const unsubscribeStop = window.electronAPI.onIdleStopped(() => {
      console.log('[Idle] Stopped');
      useTimerStore.getState().stopIdle();
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
        <Route
          element={
            <PublicRoute>
              <AuthLayout />
            </PublicRoute>
          }
        >
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Protected routes */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/tasks/:projectId" element={<Tasks />} />
          <Route path="/tracking" element={<TimeTracking />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
