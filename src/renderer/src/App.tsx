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
      const { isRunning, isIdlePaused } = useTimerStore.getState();
      if (isRunning && !isIdlePaused) {
        useTimerStore.getState().pauseForIdle();
        useUiStore.getState().openIdleModal(data.idleMs);
      }
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
