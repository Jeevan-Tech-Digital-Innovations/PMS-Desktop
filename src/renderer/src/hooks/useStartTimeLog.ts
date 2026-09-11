import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { startTimeLog, getPreviousSecondsTodayForTask } from '@/pages/TimeTracking/TimeTrackingApi.services';

export function useStartTimeLog() {
  const navigate = useNavigate();
  const startTimer = useTimerStore((s) => s.startTimer);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);

  const mutation = useMutation({
    mutationFn: (payload: { taskId: number }) => startTimeLog(payload.taskId),
    onSuccess: async (data, variables) => {
      setActiveTimeLog(data);

      const previousSecondsToday = await getPreviousSecondsTodayForTask(variables.taskId);
      startTimer(previousSecondsToday);

      window.electronAPI?.startTimer({
        timeLogId: data.id,
        startTime: data.startTime,
      });
      navigate('/tracking');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to start time tracking');
    },
  });

  return mutation;
}
