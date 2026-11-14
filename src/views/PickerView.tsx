import { useCallback, useState } from "react";
import { taskBreadcrumb } from "../lib/format";
import type { Session, TaskRef } from "../lib/types";
import { Button } from "../components/Button/Button";
import { Header } from "../components/Header/Header";
import { Icon } from "../components/Icon/Icon";
import { OfflineBanner } from "../components/OfflineBanner/OfflineBanner";
import { TaskPicker } from "../components/TaskPicker/TaskPicker";
import { useAppState, useStore } from "../state/StoreProvider";
import styles from "./views.module.css";
import local from "./PickerView.module.css";

/** Timer stopped (or the user is changing task): choose a task and start. */
export function PickerView({ session }: { session: Session }) {
  const store = useStore();
  const running = useAppState((s) => s.timer.state !== "stopped");
  const online = useAppState((s) => s.timer.online);
  const queued = useAppState((s) => s.timer.queued);
  const busy = useAppState((s) => s.busy);
  const [selected, setSelected] = useState<TaskRef | null>(null);
  const onSelect = useCallback((t: TaskRef | null) => setSelected(t), []);

  return (
    <div className={styles.view}>
      <Header session={session} />
      {!online && <OfflineBanner queued={queued} />}
      <main className={styles.body}>
        {running && (
          <button type="button" className={styles.link} onClick={store.closePicker}>
            <Icon name="arrowLeft" size={14} /> Back to timer
          </button>
        )}
        <TaskPicker onSelect={onSelect} onStartRecent={(t) => void store.startTask(t)} disabled={busy} />
      </main>
      <footer className={styles.footer}>
        {selected ? (
          <div className={local.chosen}>
            <span className={local.chosenTitle}>{selected.title}</span>
            <span className={local.chosenPath}>{taskBreadcrumb(selected)}</span>
          </div>
        ) : (
          <div className={local.hint}>Choose a task to start the timer.</div>
        )}
        <Button variant="primary" size="lg" block icon="play" disabled={!selected || busy} onClick={() => selected && void store.startTask(selected)}>
          {running ? "Switch to this task" : "Start"}
        </Button>
      </footer>
    </div>
  );
}
