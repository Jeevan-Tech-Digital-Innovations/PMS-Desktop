import { create } from 'zustand';

interface TimerState {
  isRunning: boolean;
  isOnBreak: boolean;
  isIdle: boolean;
  workSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  startTime: string | null;
  isOvertime: boolean;

  // Actions
  startTimer: (initialSeconds?: number) => void;
  setWorkSeconds: (seconds: number) => void;
  stopTimer: () => void;
  tick: () => void;
  startIdle: (offsetSeconds: number) => void;
  stopIdle: () => void;
  startBreak: () => void;
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
  idleSeconds: 0,
  breakSeconds: 0,
  startTime: null,
  isOvertime: false,

  startTimer: (initialSeconds = 0) =>
    set({
      isRunning: true,
      isOnBreak: false,
      isIdle: false,
      workSeconds: initialSeconds,
      idleSeconds: 0,
      breakSeconds: 0,
      startTime: new Date().toISOString(),
      isOvertime: false,
    }),

  setWorkSeconds: (seconds) =>
    set({
      workSeconds: seconds,
    }),

  stopTimer: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdle: false,
      isOvertime: false,
    }),

  tick: () => {
    const { isRunning, isOnBreak, isIdle } = get();
    if (!isRunning || isOnBreak) return;
    if (isIdle) {
      set((state) => ({ idleSeconds: state.idleSeconds + 1 }));
    } else {
      set((state) => ({ workSeconds: state.workSeconds + 1 }));
    }
  },

  startIdle: (offsetSeconds) =>
    set((state) => ({
      isIdle: true,
      idleSeconds: state.idleSeconds + offsetSeconds,
    })),

  stopIdle: () => set({ isIdle: false }),

  startBreak: () =>
    set({
      isOnBreak: true,
      breakSeconds: 0,
    }),

  stopBreak: () =>
    set({
      isOnBreak: false,
    }),

  tickBreak: () => {
    const { isOnBreak } = get();
    if (isOnBreak) {
      set((state) => ({ breakSeconds: state.breakSeconds + 1 }));
    }
  },

  setOvertime: (isOvertime) => set({ isOvertime }),

  reset: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdle: false,
      workSeconds: 0,
      idleSeconds: 0,
      breakSeconds: 0,
      startTime: null,
      isOvertime: false,
    }),
}));
