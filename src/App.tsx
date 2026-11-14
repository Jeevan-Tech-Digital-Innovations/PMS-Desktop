import { IdleNoteSheet } from "./components/IdleNoteSheet/IdleNoteSheet";
import { OvertimeDialog } from "./components/OvertimeDialog/OvertimeDialog";
import { Spinner } from "./components/Spinner/Spinner";
import { Toasts } from "./components/Toasts/Toasts";
import { useAppState } from "./state/StoreProvider";
import { NoticeView } from "./views/NoticeView";
import { PickerView } from "./views/PickerView";
import { SignInView } from "./views/SignInView";
import { TimerView } from "./views/TimerView";
import styles from "./views/views.module.css";

function Screen() {
  const booted = useAppState((s) => s.booted);
  const session = useAppState((s) => s.session);
  const stopped = useAppState((s) => s.timer.state === "stopped");
  const pickerOpen = useAppState((s) => s.pickerOpen);

  if (!booted) {
    return (
      <div className={styles.splash}>
        <Spinner label="Starting" />
      </div>
    );
  }
  if (!session) return <SignInView />;
  if (!session.firstRunNoticeAccepted) return <NoticeView />;
  if (stopped || pickerOpen) return <PickerView session={session} />;
  return <TimerView session={session} />;
}

export default function App() {
  const signedIn = useAppState((s) => s.session?.firstRunNoticeAccepted === true);
  return (
    <>
      <Screen />
      {signedIn && (
        <>
          <IdleNoteSheet />
          <OvertimeDialog />
        </>
      )}
      <Toasts />
    </>
  );
}
