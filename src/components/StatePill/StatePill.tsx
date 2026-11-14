import type { TimerState } from "../../lib/types";
import styles from "./StatePill.module.css";

const LABEL: Record<TimerState, string> = {
  stopped: "Stopped",
  working: "Working",
  paused: "Paused",
  away: "Away",
  break: "On break",
  idle: "Idle",
};

const TONE: Record<TimerState, string> = {
  stopped: styles.grey,
  working: styles.teal,
  paused: styles.amber,
  away: styles.amber,
  break: styles.amber,
  idle: styles.grey,
};

export function StatePill({ state, overtime }: { state: TimerState; overtime?: boolean }) {
  return (
    <span className={`${styles.pill} ${TONE[state]}`} data-state={state}>
      <span className={styles.dot} aria-hidden="true" />
      {LABEL[state]}
      {overtime && state !== "stopped" ? " · Overtime" : ""}
    </span>
  );
}
