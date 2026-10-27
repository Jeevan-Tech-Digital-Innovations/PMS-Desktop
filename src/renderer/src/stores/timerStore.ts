import { create } from 'zustand';

interface TimerState {
  isRunning: boolean;
  isWorkdayRunning: boolean;
  isTaskRunning: boolean;
  isOnBreak: boolean;
  isIdle: boolean;
  workSeconds: number; // session duration
  taskSeconds: number; // individual task duration today
  dailyTotalSeconds: number; // overall working time throughout the day
  idleSeconds: number;
  breakSeconds: number;
  activeBreakLimit: number | null;
  startTime: string | null;
  isOvertime: boolean;
  previousSecondsToday: number;
  lastTickTime: number;

  // Actions
  startTimer: (initialSeconds?: number) => void;
  pauseTask: () => void;
  stopTask: () => void;
  resumeTask: () => void;
  startWorkday: () => void;
  stopWorkday: () => void;
  setWorkSeconds: (seconds: number) => void;
  setTaskSeconds: (seconds: number) => void;
  setDailyTotalSeconds: (seconds: number) => void;
  initDailyTime: (dailySeconds: number, taskSeconds?: number) => void;
  stopTimer: () => void;
  tick: () => void;
  startIdle: (offsetSeconds: number) => void;
  stopIdle: () => void;
  startBreak: (reasonText?: string) => void;
  stopBreak: () => void;
  tickBreak: () => void;
  setOvertime: (isOvertime: boolean) => void;
  reset: () => void;
}

const getTodayKey = () => {
  const d = new Date();
  return `pms_daily_workday_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`;
};

const saveDailyToLocalStorage = (sec: number) => {
  try {
    localStorage.setItem(getTodayKey(), String(sec));
  } catch {}
};

const getDailyFromLocalStorage = (): number => {
  try {
    const val = localStorage.getItem(getTodayKey());
    return val ? Math.max(0, parseInt(val, 10) || 0) : 0;
  } catch {
    return 0;
  }
};

export const useTimerStore = create<TimerState>((set, get) => ({
  isRunning: false,
  isWorkdayRunning: false,
  isTaskRunning: false,
  isOnBreak: false,
  isIdle: false,
  workSeconds: 0,
  taskSeconds: 0,
  dailyTotalSeconds: getDailyFromLocalStorage(),
  idleSeconds: 0,
  breakSeconds: 0,
  activeBreakLimit: null,
  startTime: null,
  isOvertime: false,
  previousSecondsToday: 0,
  lastTickTime: 0,

  startTimer: (initialSeconds = 0) =>
    set((state) => ({
      isRunning: true,
      isWorkdayRunning: true,
      isTaskRunning: true,
      isOnBreak: false,
      isIdle: false,
      workSeconds: initialSeconds,
      previousSecondsToday: initialSeconds,
      idleSeconds: 0,
      breakSeconds: 0,
      activeBreakLimit: null,
      startTime: new Date().toISOString(),
      isOvertime: false,
      lastTickTime: Date.now(),
    })),

  pauseTask: () =>
    set({
      isTaskRunning: false,
      isRunning: true, // overall workday timer remains running
      isWorkdayRunning: true,
    }),

  stopTask: () =>
    set({
      isTaskRunning: false,
      isRunning: true, // overall workday timer remains running
      isWorkdayRunning: true,
    }),

  resumeTask: () =>
    set({
      isTaskRunning: true,
      isWorkdayRunning: true,
      isRunning: true,
      isOnBreak: false,
      isIdle: false,
      lastTickTime: Date.now(),
    }),

  startWorkday: () =>
    set({
      isWorkdayRunning: true,
      isRunning: true,
      isOnBreak: false,
      isIdle: false,
      lastTickTime: Date.now(),
    }),

  stopWorkday: () =>
    set({
      isRunning: false,
      isWorkdayRunning: false,
      isTaskRunning: false,
      isOnBreak: false,
      isIdle: false,
      isOvertime: false,
      activeBreakLimit: null,
      lastTickTime: 0,
    }),

  setWorkSeconds: (seconds) =>
    set({
      workSeconds: Math.max(0, seconds),
    }),

  setTaskSeconds: (seconds) =>
    set({
      taskSeconds: Math.max(0, seconds),
    }),

  setDailyTotalSeconds: (seconds) =>
    set((state) => {
      const isWorkdayActive = state.isWorkdayRunning || state.isRunning;
      // Monotonic guard: When actively on duty, the clock NEVER jumps backward!
      const targetSec = isWorkdayActive
        ? Math.max(state.dailyTotalSeconds, seconds)
        : Math.max(state.dailyTotalSeconds, seconds, getDailyFromLocalStorage());
      saveDailyToLocalStorage(targetSec);
      return { dailyTotalSeconds: targetSec };
    }),

  initDailyTime: (dailySeconds, taskSeconds) =>
    set((state) => {
      const stored = getDailyFromLocalStorage();
      const targetDaily = Math.max(state.dailyTotalSeconds, dailySeconds, stored);
      saveDailyToLocalStorage(targetDaily);
      return {
        dailyTotalSeconds: targetDaily,
        taskSeconds: taskSeconds !== undefined ? Math.max(0, taskSeconds) : state.taskSeconds,
      };
    }),

  stopTimer: () =>
    set({
      isRunning: false,
      isWorkdayRunning: false,
      isTaskRunning: false,
      isOnBreak: false,
      isIdle: false,
      isOvertime: false,
      activeBreakLimit: null,
      lastTickTime: 0,
    }),

  tick: () => {
    const now = Date.now();
    const { isWorkdayRunning, isTaskRunning, isRunning, isOnBreak, isIdle, lastTickTime } = get();
    const isWorkdayActive = isWorkdayRunning || isRunning;
    // Break is the ONLY event that pauses the overall clock
    if ((!isWorkdayActive && !isTaskRunning) || isOnBreak) {
      return;
    }

    const elapsedMs = now - (lastTickTime || now);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    if (elapsedSeconds >= 1) {
      if (isIdle) {
        set((state) => ({ 
          idleSeconds: state.idleSeconds + elapsedSeconds,
          lastTickTime: state.lastTickTime + (elapsedSeconds * 1000)
        }));
      } else {
        set((state) => {
          const nextDaily = (state.isWorkdayRunning || state.isRunning)
            ? state.dailyTotalSeconds + elapsedSeconds
            : state.dailyTotalSeconds;
          if (nextDaily % 5 === 0) {
            saveDailyToLocalStorage(nextDaily);
          }
          return { 
            // Overall workday time advances uninterrupted as long as employee is on duty
            workSeconds: (state.isWorkdayRunning || state.isRunning) ? state.workSeconds + elapsedSeconds : state.workSeconds,
            dailyTotalSeconds: nextDaily,
            // Task time advances ONLY when task tracking is specifically active
            taskSeconds: state.isTaskRunning ? state.taskSeconds + elapsedSeconds : state.taskSeconds,
            lastTickTime: state.lastTickTime + (elapsedSeconds * 1000)
          };
        });
      }
    }
  },

  startIdle: (offsetSeconds) =>
    set((state) => ({
      isIdle: true,
      idleSeconds: state.idleSeconds + offsetSeconds,
      workSeconds: Math.max(0, state.workSeconds - offsetSeconds),
      taskSeconds: Math.max(0, state.taskSeconds - offsetSeconds),
      dailyTotalSeconds: Math.max(0, state.dailyTotalSeconds - offsetSeconds),
      lastTickTime: Date.now(),
    })),

  stopIdle: () => set({ isIdle: false, lastTickTime: Date.now() }),

  startBreak: (reasonText = '') => {
    let limit = null;
    const lowerReason = reasonText.toLowerCase();
    if (lowerReason.includes('tea')) {
      limit = 15 * 60; // 15 mins
    } else if (lowerReason.includes('lunch')) {
      limit = 30 * 60; // 30 mins
    }
    
    set({
      isOnBreak: true,
      breakSeconds: 0,
      activeBreakLimit: limit,
      lastTickTime: Date.now(),
    });
  },

  stopBreak: () =>
    set({
      isOnBreak: false,
      activeBreakLimit: null,
      lastTickTime: Date.now(),
    }),

  tickBreak: () => {
    const now = Date.now();
    const { isOnBreak, lastTickTime } = get();
    if (isOnBreak) {
      const elapsedMs = now - (lastTickTime || now);
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      if (elapsedSeconds >= 1) {
        set((state) => ({ 
          breakSeconds: state.breakSeconds + elapsedSeconds,
          lastTickTime: state.lastTickTime + (elapsedSeconds * 1000)
        }));
      }
    }
  },

  setOvertime: (isOvertime) => set({ isOvertime }),

  reset: () =>
    set({
      isRunning: false,
      isWorkdayRunning: false,
      isTaskRunning: false,
      isOnBreak: false,
      isIdle: false,
      workSeconds: 0,
      taskSeconds: 0,
      dailyTotalSeconds: 0,
      idleSeconds: 0,
      breakSeconds: 0,
      activeBreakLimit: null,
      startTime: null,
      isOvertime: false,
      previousSecondsToday: 0,
      lastTickTime: 0,
    }),
}));

