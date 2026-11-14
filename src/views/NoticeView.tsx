import { Button } from "../components/Button/Button";
import { Icon } from "../components/Icon/Icon";
import { useStore } from "../state/StoreProvider";
import styles from "./NoticeView.module.css";

export function NoticeView() {
  const store = useStore();
  return (
    <div className={styles.view}>
      <span className={styles.icon}>
        <Icon name="shield" size={32} />
      </span>
      <h1 className={styles.title}>Before you start</h1>
      <p className={styles.text}>
        This computer&apos;s activity (screenshots, apps and idle time) is tracked by your company while a timer runs.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" size="lg" block onClick={() => void store.acceptFirstRunNotice()}>
          Accept
        </Button>
        <Button variant="ghost" block onClick={() => void store.signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
