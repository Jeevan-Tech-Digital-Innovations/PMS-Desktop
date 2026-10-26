import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { startTimeLog, getTaskAccumulatedSecondsToday } from '@/pages/TimeTracking/TimeTrackingApi.services';
import { markLocalTimerStart } from '@/hooks/useTimerSync';

export function useStartTimeLog() {
  const navigate = useNavigate();
  const location = useLocation();
  const startTimer = useTimerStore((s) => s.startTimer);
  const setTaskSeconds = useTimerStore((s) => s.setTaskSeconds);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);

  const mutation = useMutation({
    mutationFn: (payload: { taskId: number }) => startTimeLog(payload.taskId),
    onSuccess: async (data, variables) => {
      setActiveTimeLog(data);

      // Ensure active selectedTask status is inprogress
      const currentSelected = useProjectStore.getState().selectedTask;
      if (currentSelected && currentSelected.id === variables.taskId) {
        useProjectStore.getState().setSelectedTask({
          ...currentSelected,
          status: 'inprogress',
        });
      }

      // Mark a local start so the sync grace period activates.
      // Must be called BEFORE startTimer to cover the API propagation delay.
      markLocalTimerStart();
      startTimer(0);

      try {
        const taskSec = await getTaskAccumulatedSecondsToday(variables.taskId).catch(() => 0);
        setTaskSeconds(taskSec);
      } catch {}

      window.electronAPI?.startTimer({
        timeLogId: data.id,
        startTime: data.startTime,
      });

      // Keep user on the Dashboard widget instead of navigating to /tracking
      if (location.pathname !== '/dashboard') {
        navigate('/dashboard');
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to start time tracking');
    },
  });

  return mutation;
}
