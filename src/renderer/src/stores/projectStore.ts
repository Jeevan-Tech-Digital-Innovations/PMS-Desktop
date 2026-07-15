import { create } from 'zustand';
import { Project } from '@/types/project';
import { Task } from '@/types/task';
import { TimeLog } from '@/types/timeLog';

interface ProjectState {
  selectedProject: Project | null;
  selectedTask: Task | null;
  activeTimeLog: TimeLog | null;

  // Draft selections used during the change flow so the previous
  // project/task remain committed until both are successfully reselected.
  draftProject: Project | null;
  draftTask: Task | null;

  setSelectedProject: (project: Project | null) => void;
  setSelectedTask: (task: Task | null) => void;
  setDraftProject: (project: Project | null) => void;
  setDraftTask: (task: Task | null) => void;
  commitDraftSelection: () => void;
  clearDraftSelection: () => void;
  setActiveTimeLog: (timeLog: TimeLog | null) => void;
  clearSelection: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  selectedProject: null,
  selectedTask: null,
  activeTimeLog: null,
  draftProject: null,
  draftTask: null,

  setSelectedProject: (project) => set({ selectedProject: project, selectedTask: null }),
  setSelectedTask: (task) => set({ selectedTask: task }),
  setDraftProject: (project) => set({ draftProject: project, draftTask: null }),
  setDraftTask: (task) => set({ draftTask: task }),
  commitDraftSelection: () =>
    set((state) => ({
      selectedProject: state.draftProject,
      selectedTask: state.draftTask,
      draftProject: null,
      draftTask: null,
    })),
  clearDraftSelection: () => set({ draftProject: null, draftTask: null }),
  setActiveTimeLog: (timeLog) => set({ activeTimeLog: timeLog }),
  clearSelection: () =>
    set({
      selectedProject: null,
      selectedTask: null,
      activeTimeLog: null,
      draftProject: null,
      draftTask: null,
    }),
}));
