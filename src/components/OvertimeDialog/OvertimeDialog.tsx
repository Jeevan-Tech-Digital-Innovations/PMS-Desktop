import { useAppState, useStore } from "../../state/StoreProvider";
import { Button } from "../Button/Button";
import { Sheet } from "../Sheet/Sheet";

/** `overtime:prompt` (visible mode): continue as overtime, or stop. */
export function OvertimeDialog() {
  const open = useAppState((s) => s.overtimePrompt);
  const store = useStore();
  if (!open) return null;
  return (
    <Sheet
      variant="dialog"
      title="Overtime"
      footer={
        <>
          <Button onClick={() => void store.overtimeDecision(false)}>Stop timer</Button>
          <Button variant="primary" data-autofocus onClick={() => void store.overtimeDecision(true)}>
            Continue
          </Button>
        </>
      }
    >
      You&apos;ve worked 8 hours. Continue as overtime?
    </Sheet>
  );
}
