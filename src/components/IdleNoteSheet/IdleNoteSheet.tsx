import { useState } from "react";
import { formatDuration } from "../../lib/format";
import { useAppState, useStore } from "../../state/StoreProvider";
import { Button } from "../Button/Button";
import { Sheet } from "../Sheet/Sheet";
import styles from "./IdleNoteSheet.module.css";

/** Shown on `idle:started` when the company wants an idle note (visible mode only). */
export function IdleNoteSheet() {
  const idle = useAppState((s) => s.idle);
  const store = useStore();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  if (!idle) return null;

  const optional = idle.note === "optional";
  const submit = async () => {
    setSending(true);
    const res = await store.submitIdleNote(text.trim());
    setSending(false);
    if (res.ok) setText("");
  };

  return (
    <Sheet
      title="You were idle"
      onClose={optional ? store.skipIdleNote : undefined}
      footer={
        <>
          {optional && (
            <Button onClick={store.skipIdleNote} disabled={sending}>
              Skip
            </Button>
          )}
          <Button variant="primary" disabled={sending || !text.trim()} onClick={() => void submit()}>
            Submit
          </Button>
        </>
      }
    >
      <p className={styles.text}>
        No activity for {formatDuration(idle.idleSeconds)}. {optional ? "What were you doing? (optional)" : "Please say what you were doing."}
      </p>
      <label className={styles.label} htmlFor="idle-note">
        Note{!optional && " (required)"}
      </label>
      <textarea
        id="idle-note"
        data-autofocus
        className={styles.textarea}
        rows={4}
        maxLength={500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Meeting, call, away from desk"
      />
    </Sheet>
  );
}
