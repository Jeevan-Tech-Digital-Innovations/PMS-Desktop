import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, toAppError } from "../../lib/backend";
import type { Project, TaskNode, TaskRef } from "../../lib/types";

export type Level = { label: string; options: TaskNode[]; selectedId: number | null };
type Slot = { options: TaskNode[]; selectedId: number | null };

const LABELS = ["Task", "Sub-task", "Sub-sub-task"];
export const levelLabel = (i: number): string => LABELS[Math.min(i, LABELS.length - 1)];

/**
 * Project -> Task -> Sub-task -> Sub-sub-task. A level appears only when the node selected
 * above it `hasChildren`. Stale responses (from a selection that was changed meanwhile) are dropped.
 */
export function useCascade() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => {
    let live = true;
    api
      .listProjects()
      .then((p) => live && setProjects(p))
      .catch((e) => live && setError(toAppError(e).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const selectProject = useCallback((id: number | null) => {
    const mine = ++token.current;
    setProjectId(id);
    setSlots([]);
    setError(null);
    if (id === null) return;
    setLoading(true);
    api
      .listTasks(id)
      .then((tasks) => token.current === mine && setSlots([{ options: tasks, selectedId: null }]))
      .catch((e) => token.current === mine && setError(toAppError(e).message))
      .finally(() => token.current === mine && setLoading(false));
  }, []);

  const selectNode = useCallback(
    (level: number, id: number | null) => {
      const mine = ++token.current;
      setError(null);
      setSlots((prev) => prev.slice(0, level + 1).map((s, i) => (i === level ? { ...s, selectedId: id } : s)));
      if (id === null) return;
      const node = slots[level]?.options.find((n) => n.id === id);
      if (!node?.hasChildren) return;
      setLoading(true);
      api
        .listSubtasks(id)
        .then((children) => token.current === mine && setSlots((prev) => [...prev.slice(0, level + 1), { options: children, selectedId: null }]))
        .catch((e) => token.current === mine && setError(toAppError(e).message))
        .finally(() => token.current === mine && setLoading(false));
    },
    [slots],
  );

  const levels: Level[] = useMemo(
    () => slots.filter((s) => s.options.length > 0).map((s, i) => ({ label: levelLabel(i), options: s.options, selectedId: s.selectedId })),
    [slots],
  );

  /** The deepest selected node as a TaskRef, or null. */
  const task: TaskRef | null = useMemo(() => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return null;
    const chain: TaskNode[] = [];
    for (const s of slots) {
      const node = s.options.find((n) => n.id === s.selectedId);
      if (!node) break;
      chain.push(node);
    }
    const leaf = chain[chain.length - 1];
    if (!leaf) return null;
    return { taskId: leaf.id, title: leaf.title, projectId: project.id, projectName: project.name, path: chain.map((n) => n.title) };
  }, [projects, projectId, slots]);

  return { projects, projectId, levels, loading, error, task, selectProject, selectNode };
}
