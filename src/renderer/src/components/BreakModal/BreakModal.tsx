import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useUiStore } from '@/stores/uiStore';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { getBreakReasons, startBreak, BreakReason } from '@/services/BreakApi.services';
import styles from './BreakModal.module.css';

export function BreakModal() {
  const showBreakModal = useUiStore((s) => s.showBreakModal);
  const closeBreakModal = useUiStore((s) => s.closeBreakModal);
  const startBreakTimer = useTimerStore((s) => s.startBreak);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);

  const [search, setSearch] = useState('');
  const [reasons, setReasons] = useState<BreakReason[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (showBreakModal) {
      setSearch('');
      fetchReasons();
    }
  }, [showBreakModal]);

  const fetchReasons = async () => {
    try {
      setIsLoading(true);
      const data = await getBreakReasons();
      setReasons(data);
    } catch (error) {
      toast.error('Failed to load break reasons');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectReason = async (reasonId: number) => {
    if (!activeTimeLog) {
      toast.error('No active time log found');
      return;
    }

    try {
      setIsStarting(true);
      const selectedReason = reasons.find(r => r.id === reasonId);
      await startBreak(activeTimeLog.id, reasonId);
      startBreakTimer(selectedReason?.reasonText);
      window.electronAPI?.startBreak();
      toast.success('Break started');
      closeBreakModal();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to start break');
    } finally {
      setIsStarting(false);
    }
  };

  if (!showBreakModal) return null;

  const filteredReasons = reasons.filter((r) =>
    r.reasonText.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Select Break Reason</h2>
          <button className={styles.closeBtn} onClick={closeBreakModal}>
            &times;
          </button>
        </div>

        <div className={styles.body}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search Break..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className={styles.reasonList}>
            {isLoading ? (
              <div className={styles.loading}>Loading...</div>
            ) : filteredReasons.length > 0 ? (
              filteredReasons.map((r) => (
                <button
                  key={r.id}
                  className={styles.reasonBtn}
                  onClick={() => handleSelectReason(r.id)}
                  disabled={isStarting}
                >
                  {r.reasonText}
                </button>
              ))
            ) : (
              <div className={styles.empty}>No reasons found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
