import { create } from 'zustand';

interface UiState {
  showBreakModal: boolean;
  showNoteModal: boolean;
  isProfileMenuOpen: boolean;
  isNoteModalMandatory: boolean;

  openBreakModal: () => void;
  closeBreakModal: () => void;
  openNoteModal: (isMandatory?: boolean) => void;
  closeNoteModal: () => void;
  toggleProfileMenu: () => void;
  closeProfileMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  showBreakModal: false,
  showNoteModal: false,
  isProfileMenuOpen: false,
  isNoteModalMandatory: false,

  openBreakModal: () => set({ showBreakModal: true }),
  closeBreakModal: () => set({ showBreakModal: false }),
  openNoteModal: (isMandatory = false) => set({ showNoteModal: true, isNoteModalMandatory: isMandatory }),
  closeNoteModal: () => set({ showNoteModal: false, isNoteModalMandatory: false }),
  toggleProfileMenu: () => set((s) => ({ isProfileMenuOpen: !s.isProfileMenuOpen })),
  closeProfileMenu: () => set({ isProfileMenuOpen: false }),
}));
