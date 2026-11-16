import { useEffect, useId, useState } from "react";
import { api, toAppError } from "../../lib/backend";
import { taskBreadcrumb } from "../../lib/format";
import type { TaskRef } from "../../lib/types";
import { Icon } from "../Icon/Icon";
import { SearchField } from "../SearchField/SearchField";
import { Spinner } from "../Spinner/Spinner";
import { useCascade } from "./useCascade";
import styles from "./TaskPicker.module.css";

const DEBOUNCE_MS = 250;

type Props = {
  /** Called whenever the chosen task changes (null when nothing is chosen). */
  onSelect: (task: TaskRef | null) => void;
  /** One click on a recent task starts it. */
  onStartRecent: (task: TaskRef) => void;
  disabled?: boolean;
};

type SearchState = { status: "idle" | "loading" | "done" | "error"; results: TaskRef[]; error?: string };

export function TaskPicker({ onSelect, onStartRecent, disabled }: Props) {
  const cascade = useCascade();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle", results: [] });
  const [picked, setPicked] = useState<TaskRef | null>(null);
  const [recent, setRecent] = useState<TaskRef[]>([]);
  const baseId = useId();

  const searching = query.trim().length > 0;

  useEffect(() => {
    let live = true;
    api
      .recentTasks()
      .then((r) => live && setRecent(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Debounced search; a newer query makes the older response irrelevant.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearch({ status: "idle", results: [] });
      return;
    }
    let live = true;
    setSearch((s) => ({ ...s, status: "loading" }));
    const handle = setTimeout(() => {
      api
        .searchTasks(q)
        .then((results) => live && setSearch({ status: "done", results }))
        .catch((e) => live && setSearch({ status: "error", results: [], error: toAppError(e).message }));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [query]);

  const chosen = searching ? picked : cascade.task;
  const chosenId = chosen?.taskId ?? null;
  useEffect(() => {
    onSelect(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenId]);

  return (
    <div className={styles.picker}>
      <SearchField label="Find a task" placeholder="Find a task…" value={query} onChange={(v) => { setQuery(v); setPicked(null); }} />

      {searching ? (
        <section className={styles.panel} aria-label="Search results">
          {search.status === "loading" && search.results.length === 0 && (
            <div className={styles.note}>
              <Spinner label="Searching" /> Searching…
            </div>
          )}
          {search.status === "error" && <div className={styles.error} role="alert">{search.error}</div>}
          {search.status === "done" && search.results.length === 0 && <div className={styles.note}>No tasks match “{query.trim()}”.</div>}
          <ul className={styles.list}>
            {search.results.map((t) => (
              <li key={t.taskId}>
                <button
                  type="button"
                  className={`${styles.row} ${picked?.taskId === t.taskId ? styles.selected : ""}`}
                  aria-pressed={picked?.taskId === t.taskId}
                  disabled={disabled}
                  onClick={() => setPicked(t)}
                >
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{t.title}</span>
                    <span className={styles.rowPath}>{taskBreadcrumb(t)}</span>
                  </span>
                  {picked?.taskId === t.taskId && <Icon name="check" size={16} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <section className={styles.cascade} aria-label="Choose a task">
            <Field id={`${baseId}-project`} label="Project">
              <select
                id={`${baseId}-project`}
                className={styles.select}
                value={cascade.projectId ?? ""}
                disabled={disabled}
                onChange={(e) => cascade.selectProject(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select a project…</option>
                {cascade.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName ? `${p.name} (${p.clientName})` : p.name}
                  </option>
                ))}
              </select>
            </Field>
            {cascade.levels.map((level, i) => (
              <Field key={i} id={`${baseId}-level-${i}`} label={level.label}>
                <select
                  id={`${baseId}-level-${i}`}
                  className={styles.select}
                  value={level.selectedId ?? ""}
                  disabled={disabled}
                  onChange={(e) => cascade.selectNode(i, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select a {level.label.toLowerCase()}…</option>
                  {level.options.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.hasChildren ? `${n.title} ›` : n.title}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            {cascade.loading && cascade.projectId !== null && (
              <div className={styles.loading}>
                <Spinner label="Loading" />
              </div>
            )}
            {cascade.error && <div className={styles.error} role="alert">{cascade.error}</div>}
          </section>

          {recent.length > 0 && (
            <section className={`${styles.panel} ${styles.recent}`} aria-labelledby={`${baseId}-recent`}>
              <h2 id={`${baseId}-recent`} className={styles.heading}>
                Recent
              </h2>
              <ul className={styles.list}>
                {recent.map((t) => (
                  <li key={t.taskId}>
                    <button
                      type="button"
                      className={styles.row}
                      disabled={disabled}
                      aria-label={`Start ${t.title}`}
                      onClick={() => onStartRecent(t)}
                    >
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>{t.title}</span>
                        <span className={styles.rowPath}>{taskBreadcrumb(t)}</span>
                      </span>
                      <span className={styles.play}>
                        <Icon name="play" size={14} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
    </div>
  );
}
