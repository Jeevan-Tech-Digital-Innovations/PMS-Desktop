import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { addNote } from '@/services/NoteApi.services';
import styles from './NoteModal.module.css';

const MAX_CHARS = 120;

export function NoteModal() {
  const showNoteModal = useUiStore((s) => s.showNoteModal);
  const closeNoteModal = useUiStore((s) => s.closeNoteModal);
  const isNoteModalMandatory = useUiStore((s) => s.isNoteModalMandatory);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);

  const [noteText, setNoteText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (showNoteModal) {
      setNoteText('');
    }
  }, [showNoteModal]);

  const handleSave = async () => {
    if (!activeTimeLog) {
      toast.error('No active time log found');
      return;
    }

    if (!noteText.trim()) {
      toast.error('Note text is required');
      return;
    }

    if (noteText.length > MAX_CHARS) {
      toast.error(`Note text cannot exceed ${MAX_CHARS} characters`);
      return;
    }

    try {
      setIsSaving(true);
      await addNote(activeTimeLog.id, noteText);
      toast.success('Note added successfully');
      closeNoteModal();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to add note');
    } finally {
      setIsSaving(false);
    }
  };

  if (!showNoteModal) return null;

  return (
    <div className={styles.overlay} onClick={closeNoteModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Add Note</h2>
          <button className={styles.closeBtn} onClick={closeNoteModal}>
            &times;
          </button>
        </div>

        <div className={styles.body}>
          <textarea
            className={styles.textarea}
            placeholder="Type your note here..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            maxLength={MAX_CHARS}
            rows={4}
          />
          <div className={styles.charCounter}>
            {noteText.length} / {MAX_CHARS} characters
          </div>
        </div>

        <div className={styles.footer}>
            <button
              className={styles.backBtn}
              onClick={closeNoteModal}
              disabled={isSaving}
            >
              Back
            </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
