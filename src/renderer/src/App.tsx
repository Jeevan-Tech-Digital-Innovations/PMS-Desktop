import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { IdleModal } from '@/components/IdleModal/IdleModal';

// Page imports
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { Tasks } from '@/pages/Tasks';
import { TimeTracking } from '@/pages/TimeTracking';
import { Settings } from '@/pages/Settings';

// Layout imports
import { AuthLayout } from '@/layout/AuthLayout/AuthLayout';
import { AppLayout } from '@/layout/AppLayout/AppLayout';

// Auth guard
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const navigate = useNavigate();
  const checkStoredTokens = useAuthStore((s) => s.checkStoredTokens);

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
    // Global idle detection: pause timer and show modal regardless of current page
    const unsubscribe = window.electronAPI?.onIdleDetected((data) => {
      console.log('[Idle] User idle detected:', {
        idleMs: data.idleMs,
        idleSeconds: Math.round(data.idleMs / 1000),
        timestamp: new Date().toISOString(),
      });
      const { isRunning, isIdlePaused } = useTimerStore.getState();
      if (isRunning && !isIdlePaused) {
        useTimerStore.getState().pauseForIdle();
        useUiStore.getState().openIdleModal(data.idleMs);
      }
    });
    return () => unsubscribe?.();
  }, []);

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
    const unsubscribe = window.electronAPI?.onActiveWindowChange((title) => {
      console.log('[Active Window] Changed:', {
        title,
        timestamp: new Date().toISOString(),
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    // URL tracking
    const unsubscribe = window.electronAPI?.onUrlTracked((data) => {
      console.log('[URL] Tracked:', {
        url: data.url,
        title: data.title,
        timestamp: data.timestamp,
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    // Activity level monitoring
    const unsubscribe = window.electronAPI?.onActivityUpdated((data) => {
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
    const unsubscribe = window.electronAPI?.onHeartbeatSynced((data) => {
      console.log('[Heartbeat] Synced:', {
        timeLogId: data.timeLogId,
        elapsedMinutes: data.elapsedMinutes,
        timestamp: data.timestamp,
      });
    });
    return () => unsubscribe?.();
  }, []);

  return (
    <>
      <Toaster position="top-right" />
      <IdleModal />
      <Routes>
        {/* Public routes */}
        <Route element={<AuthLayout />}>
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
        </Route>

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}
