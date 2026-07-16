import { create } from 'zustand';

interface TimerState {
  isRunning: boolean;
  isOnBreak: boolean;
  isIdle: boolean;
  workSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  startTime: string | null;

  // Actions
  startTimer: () => void;
  stopTimer: () => void;
  tick: () => void;
  startIdle: (offsetSeconds: number) => void;
  stopIdle: () => void;
  startBreak: () => void;
  stopBreak: () => void;
  tickBreak: () => void;
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

  startTimer: () =>
    set({
      isRunning: true,
      isOnBreak: false,
      isIdle: false,
      workSeconds: 0,
      idleSeconds: 0,
      breakSeconds: 0,
      startTime: new Date().toISOString(),
    }),

  stopTimer: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdle: false,
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

  reset: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdle: false,
      workSeconds: 0,
      idleSeconds: 0,
      breakSeconds: 0,
      startTime: null,
    }),
}));
