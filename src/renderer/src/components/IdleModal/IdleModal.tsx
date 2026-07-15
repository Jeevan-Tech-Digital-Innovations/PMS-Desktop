import { useEffect } from 'react';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { formatIdleTime } from '@/utils/formatTime';
import styles from './IdleModal.module.css';

export function IdleModal() {
  const { showIdleModal, idleTimeMs, closeIdleModal } = useUiStore();
  const { resumeFromIdle, subtractWorkTime } = useTimerStore();

  useEffect(() => {
    if (showIdleModal) {
      // Notify main process that idle was detected (renderer handles the decision)
      window.electronAPI?.respondToIdle('keep');
    }
  }, [showIdleModal]);

  const handleKeep = () => {
    resumeFromIdle();
    closeIdleModal();
  };

  const handleDiscard = () => {
    const idleSeconds = Math.floor(idleTimeMs / 1000);
    subtractWorkTime(idleSeconds);
    resumeFromIdle();
    closeIdleModal();
  };

  if (!showIdleModal) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Idle Time Detected</h2>
        <p className={styles.message}>
          You were idle for <strong>{formatIdleTime(idleTimeMs)}</strong>.
        </p>
        <p className={styles.question}>Do you want to discard this idle time or keep it?</p>

        <div className={styles.actions}>
          <button className={styles.discardBtn} onClick={handleDiscard}>
            Discard Time
          </button>
          <button className={styles.keepBtn} onClick={handleKeep}>
            Keep Time
          </button>
        </div>
      </div>
    </div>
  );
}
