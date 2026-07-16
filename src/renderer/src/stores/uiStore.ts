import { create } from 'zustand';

interface UiState {
  showBreakModal: boolean;
  showNoteModal: boolean;
  isProfileMenuOpen: boolean;

  openBreakModal: () => void;
  closeBreakModal: () => void;
  openNoteModal: () => void;
  closeNoteModal: () => void;
  toggleProfileMenu: () => void;
  closeProfileMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showBreakModal: false,
  showNoteModal: false,
  isProfileMenuOpen: false,

  openBreakModal: () => set({ showBreakModal: true }),
  closeBreakModal: () => set({ showBreakModal: false }),
  openNoteModal: () => set({ showNoteModal: true }),
  closeNoteModal: () => set({ showNoteModal: false }),
  toggleProfileMenu: () => set((s) => ({ isProfileMenuOpen: !s.isProfileMenuOpen })),
  closeProfileMenu: () => set({ isProfileMenuOpen: false }),
}));
