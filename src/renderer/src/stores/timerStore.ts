import { create } from 'zustand';

interface TimerState {
  isRunning: boolean;
  isOnBreak: boolean;
  isIdle: boolean;
  workSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  activeBreakLimit: number | null;
  startTime: string | null;
  isOvertime: boolean;

  // Actions
  startTimer: (initialSeconds?: number) => void;
  setWorkSeconds: (seconds: number) => void;
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
  idleSeconds: 0,
  breakSeconds: 0,
  activeBreakLimit: null,
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
      activeBreakLimit: null,
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
      activeBreakLimit: null,
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
    });
  },

  stopBreak: () =>
    set({
      isOnBreak: false,
      activeBreakLimit: null,
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
      activeBreakLimit: null,
      startTime: null,
      isOvertime: false,
    }),
}));
