import { useEffect, useMemo, useState } from "react";
import { api, toAppError } from "../../lib/backend";
import type { BreakReason } from "../../lib/types";
import { useStore } from "../../state/StoreProvider";
import { Button } from "../Button/Button";
import { SearchField } from "../SearchField/SearchField";
import { Sheet } from "../Sheet/Sheet";
import { Spinner } from "../Spinner/Spinner";
import styles from "./BreakSheet.module.css";

/** Pick a break reason; choosing one starts the break. */
export function BreakSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [reasons, setReasons] = useState<BreakReason[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .listBreakReasons()
      .then((r) => live && setReasons(r))
      .catch((e) => live && setError(toAppError(e).message));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (reasons ?? []).filter((r) => r.reasonText.toLowerCase().includes(q));
  }, [reasons, query]);

  const choose = async (r: BreakReason) => {
    setStarting(true);
    const res = await store.startBreak(r.id);
    setStarting(false);
    if (res.ok) onClose();
  };

  return (
    <Sheet title="Take a break" onClose={onClose} footer={<Button onClick={onClose}>Cancel</Button>}>
      <div className={styles.body}>
        <SearchField label="Find a reason" placeholder="Find a reason…" value={query} onChange={setQuery} />
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {!reasons && !error && (
          <div className={styles.note}>
            <Spinner label="Loading reasons" /> Loading…
          </div>
        )}
        {reasons && shown.length === 0 && <div className={styles.note}>No matching reason.</div>}
        <ul className={styles.list}>
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" className={styles.row} disabled={starting} onClick={() => void choose(r)}>
                <span className={styles.name}>{r.reasonText}</span>
                <span className={styles.limit}>{r.durationLimitMinutes ? `${r.durationLimitMinutes} min limit` : "No limit"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
