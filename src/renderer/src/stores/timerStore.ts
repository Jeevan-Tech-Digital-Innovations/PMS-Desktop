import { create } from 'zustand';

interface TimerState {
  isRunning: boolean;
  isOnBreak: boolean;
  isIdlePaused: boolean;
  workSeconds: number;
  breakSeconds: number;
  startTime: string | null;

  // Actions
  startTimer: () => void;
  stopTimer: () => void;
  pauseForIdle: () => void;
  resumeFromIdle: () => void;
  tick: () => void;
  startBreak: () => void;
  stopBreak: () => void;
  tickBreak: () => void;
  subtractWorkTime: (seconds: number) => void;
  reset: () => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  isRunning: false,
  isOnBreak: false,
  isIdlePaused: false,
  workSeconds: 0,
  breakSeconds: 0,
  startTime: null,

  startTimer: () =>
    set({
      isRunning: true,
      isOnBreak: false,
      isIdlePaused: false,
      workSeconds: 0,
      breakSeconds: 0,
      startTime: new Date().toISOString(),
    }),

  stopTimer: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdlePaused: false,
    }),

  pauseForIdle: () =>
    set({
      isRunning: false,
      isIdlePaused: true,
    }),

  resumeFromIdle: () =>
    set({
      isRunning: true,
      isIdlePaused: false,
    }),

  tick: () => {
    const { isRunning, isOnBreak } = get();
    if (isRunning && !isOnBreak) {
      set((state) => ({ workSeconds: state.workSeconds + 1 }));
    }
  },

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

  subtractWorkTime: (seconds: number) =>
    set((state) => ({
      workSeconds: Math.max(0, state.workSeconds - seconds),
    })),

  reset: () =>
    set({
      isRunning: false,
      isOnBreak: false,
      isIdlePaused: false,
      workSeconds: 0,
      breakSeconds: 0,
      startTime: null,
    }),
}));
