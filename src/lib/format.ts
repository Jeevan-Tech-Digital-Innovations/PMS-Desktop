import type { TaskRef } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");

function whole(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
}

/** 3725 -> "1:02:05" */
export function formatClock(seconds: number): string {
  const s = whole(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad2(m)}:${pad2(s % 60)}`;
}

/** 4 minutes 12 seconds -> "04:12"; an hour or more -> "1:02:05". Used for break clocks. */
export function formatMinutes(seconds: number): string {
  const s = whole(seconds);
  return s >= 3600 ? formatClock(s) : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** 21900 -> "6h 05m"; 540 -> "9m"; 0 -> "0m" */
export function formatDuration(seconds: number): string {
  const s = whole(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m`;
}

/** "Anita Rao" -> "AR"; "anita.rao@acme.com" -> "AR"; "" -> "?" */
export function initials(name: string): string {
  const base = name.includes("@") ? name.split("@")[0] : name;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

/**
 * Titles of the task's ancestors, excluding the project and the task itself.
 * Tolerates `path` being either the parents only or the whole chain.
 */
export function taskParents(task: Pick<TaskRef, "title" | "projectName" | "path">): string[] {
  let path = [...task.path];
  if (path.length > 0 && path[0] === task.projectName) path = path.slice(1);
  if (path.length > 0 && path[path.length - 1] === task.title) path = path.slice(0, -1);
  return path;
}

/** "Website Redesign › Homepage › Hero" (project and parents, not the task title). */
export function taskBreadcrumb(task: Pick<TaskRef, "title" | "projectName" | "path">): string {
  return [task.projectName, ...taskParents(task)].filter(Boolean).join(" › ");
}

/** Whole seconds from an ISO timestamp to `now` (never negative). */
export function secondsSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 1000));
}
