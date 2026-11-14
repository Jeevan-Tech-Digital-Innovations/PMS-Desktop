import { useState } from "react";
import { formatClock, formatDuration, formatMinutes, secondsSince, taskBreadcrumb } from "../lib/format";
import type { Session, TimerSnapshot, TimerState } from "../lib/types";
import { BreakSheet } from "../components/BreakSheet/BreakSheet";
import { Button } from "../components/Button/Button";
import { Header } from "../components/Header/Header";
import { Icon } from "../components/Icon/Icon";
import { OfflineBanner } from "../components/OfflineBanner/OfflineBanner";
import { StatePill } from "../components/StatePill/StatePill";
import { useAppState, useStore } from "../state/StoreProvider";
import shared from "./views.module.css";
import styles from "./TimerView.module.css";

const HINT: Partial<Record<TimerState, string>> = {
  paused: "Timer is paused. Nothing is being tracked.",
  away: "You are marked away. Resume when you are back.",
  idle: "No keyboard or mouse activity. Move the mouse to continue.",
};

/** Timer running (or paused/away/break/idle): renders the latest `timer:changed` snapshot. */
export function TimerView({ session }: { session: Session }) {
  const store = useStore();
  const timer = useAppState((s) => s.timer);
  const busy = useAppState((s) => s.busy);
  const [breakOpen, setBreakOpen] = useState(false);
  const { state, task } = timer;
  const working = state === "working";
  const onBreak = state === "break";

  return (
    <div className={shared.view}>
      <Header session={session} />
      {!timer.online && <OfflineBanner queued={timer.queued} />}

      <main className={styles.main}>
        <section className={styles.task} aria-label="Current task">
          <div className={styles.taskTop}>
            <StatePill state={state} overtime={timer.overtime} />
            <button type="button" className={shared.link} onClick={store.openPicker}>
              Change task
            </button>
          </div>
          <h1 className={styles.title} title={task?.title}>
            {task?.title ?? "No task"}
          </h1>
          {task && <p className={styles.path}>{taskBreadcrumb(task)}</p>}
        </section>

        <div className={`${styles.clock} ${styles[`state_${state}`]}`} role="timer" aria-label={`Elapsed time on this task ${formatClock(timer.elapsedSeconds)}`}>
          {formatClock(timer.elapsedSeconds)}
        </div>

        <dl className={styles.stats}>
          <div>
            <dt>Today’s work</dt>
            <dd>{formatDuration(timer.todayWorkSeconds)}</dd>
          </div>
          <div>
            <dt>Today’s breaks</dt>
            <dd>{formatDuration(timer.todayBreakSeconds)}</dd>
          </div>
        </dl>

        {onBreak && timer.breakInfo ? <BreakPanel info={timer.breakInfo} /> : HINT[state] && <p className={styles.hint}>{HINT[state]}</p>}
      </main>

      <footer className={shared.footer}>
        {onBreak ? (
          <Button variant="primary" size="lg" block icon="play" disabled={busy} onClick={() => void store.endBreak()}>
            End break
          </Button>
        ) : (
          <div className={styles.actions}>
            {working ? (
              <Button size="lg" icon="pause" disabled={busy} onClick={() => void store.pause()}>
                Pause
              </Button>
            ) : (
              <Button variant="primary" size="lg" icon="play" disabled={busy} onClick={() => void store.resume()}>
                Resume
              </Button>
            )}
            <Button size="lg" icon="moon" disabled={busy || !working} onClick={() => void store.away()}>
              Away
            </Button>
            <Button size="lg" icon="coffee" disabled={busy || !working} onClick={() => setBreakOpen(true)}>
              Break
            </Button>
          </div>
        )}
        <Button variant="danger" size="lg" block icon="stop" disabled={busy} onClick={() => void store.stop()}>
          Stop
        </Button>
      </footer>

      {breakOpen && working && <BreakSheet onClose={() => setBreakOpen(false)} />}
    </div>
  );
}

/** Time on the current break against its limit. Re-rendered by each 1 s snapshot. */
function BreakPanel({ info }: { info: NonNullable<TimerSnapshot["breakInfo"]> }) {
  const spent = secondsSince(info.startedAt, Date.now());
  const limit = info.limitSeconds;
  const over = limit !== null && spent > limit;
  const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;

  return (
    <section className={`${styles.break} ${over ? styles.over : ""}`} aria-label="Break">
      <div className={styles.breakHead}>
        <Icon name={over ? "alert" : "coffee"} size={16} />
        <span>{info.reasonText}</span>
      </div>
      <div className={styles.breakTime}>
        <strong>{formatMinutes(spent)}</strong>
        <span>{limit !== null ? ` of ${formatMinutes(limit)} limit` : " · no time limit"}</span>
      </div>
      {limit !== null && (
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Break time used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {over && limit !== null && (
        <p className={styles.overText} role="alert">
          Over the limit by {formatMinutes(spent - limit)}
        </p>
      )}
    </section>
  );
}
