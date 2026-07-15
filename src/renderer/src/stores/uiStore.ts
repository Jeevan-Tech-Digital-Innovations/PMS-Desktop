import { create } from 'zustand';

interface UiState {
  showBreakModal: boolean;
  showNoteModal: boolean;
  showIdleModal: boolean;
  idleTimeMs: number;
  isProfileMenuOpen: boolean;

  openBreakModal: () => void;
  closeBreakModal: () => void;
  openNoteModal: () => void;
  closeNoteModal: () => void;
  openIdleModal: (idleMs: number) => void;
  closeIdleModal: () => void;
  toggleProfileMenu: () => void;
  closeProfileMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showBreakModal: false,
  showNoteModal: false,
  showIdleModal: false,
  idleTimeMs: 0,
  isProfileMenuOpen: false,

  openBreakModal: () => set({ showBreakModal: true }),
  closeBreakModal: () => set({ showBreakModal: false }),
  openNoteModal: () => set({ showNoteModal: true }),
  closeNoteModal: () => set({ showNoteModal: false }),
  openIdleModal: (idleMs) => set({ showIdleModal: true, idleTimeMs: idleMs }),
  closeIdleModal: () => set({ showIdleModal: false, idleTimeMs: 0 }),
  toggleProfileMenu: () => set((s) => ({ isProfileMenuOpen: !s.isProfileMenuOpen })),
  closeProfileMenu: () => set({ isProfileMenuOpen: false }),
}));
