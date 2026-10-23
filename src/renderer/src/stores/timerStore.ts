import { create } from 'zustand';

interface TimerState {
  isRunning: boolean;
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

export const useTimerStore = create<TimerState>((set, get) => ({
  isRunning: false,
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

  startTimer: (initialSeconds = 0) =>
    set((state) => ({
      isRunning: true,
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

  setWorkSeconds: (seconds) =>
    set({
      workSeconds: Math.max(0, seconds),
    }),

  setTaskSeconds: (seconds) =>
    set({
      taskSeconds: Math.max(0, seconds),
    }),

  setDailyTotalSeconds: (seconds) =>
    set({
      dailyTotalSeconds: Math.max(0, seconds),
    }),

  initDailyTime: (dailySeconds, taskSeconds) =>
    set((state) => ({
      dailyTotalSeconds: Math.max(state.dailyTotalSeconds, dailySeconds),
      taskSeconds: taskSeconds !== undefined ? Math.max(0, taskSeconds) : state.taskSeconds,
    })),

  stopTimer: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdle: false,
      isOvertime: false,
      activeBreakLimit: null,
      lastTickTime: 0,
    }),

  tick: () => {
    const now = Date.now();
    const { isRunning, isOnBreak, isIdle, lastTickTime } = get();
    if (!isRunning || isOnBreak) {
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
        set((state) => ({ 
          workSeconds: state.workSeconds + elapsedSeconds,
          taskSeconds: state.taskSeconds + elapsedSeconds,
          dailyTotalSeconds: state.dailyTotalSeconds + elapsedSeconds,
          lastTickTime: state.lastTickTime + (elapsedSeconds * 1000)
        }));
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

