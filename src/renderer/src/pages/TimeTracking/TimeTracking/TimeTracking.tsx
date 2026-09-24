import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useTimerStore } from '@/stores/timerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useStartTimeLog } from '@/hooks/useStartTimeLog';
import { formatTime } from '@/utils/formatTime';
import { stopTimeLog, getPreviousSecondsForTask } from '../TimeTrackingApi.services';
import { stopBreak } from '@/services/BreakApi.services';
import { getNotesForTask, updateNote, deleteNote } from '@/services/NoteApi.services';
import styles from './TimeTracking.module.css';

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const NoteItem = ({ note, onDelete, onUpdate }: { note: any, onDelete: (id: number) => void, onUpdate: (id: number, text: string) => Promise<void> }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(note.noteText);

  const handleSave = async () => {
    await onUpdate(note.noteId, text);
    setIsEditing(false);
  };

  return (
    <div className={styles.noteItem}>
      {isEditing ? (
        <div className={styles.editNoteContainer}>
          <textarea 
            className={styles.editNoteInput}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <div className={styles.noteActions}>
            <button onClick={() => { setIsEditing(false); setText(note.noteText); }} className={styles.cancelBtn}>Cancel</button>
            <button onClick={handleSave} className={styles.saveBtn}>Save</button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.noteText}>{note.noteText}</div>
          <div className={styles.noteFooter}>
            <span className={styles.noteTime}>
              {new Date(note.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
            <div className={styles.noteActions}>
              <button 
                className={styles.actionBtn} 
                title="Edit Note"
                onClick={() => { setIsEditing(true); setText(note.noteText); }}
              >
                <EditIcon />
              </button>
              <button 
                className={styles.actionBtnDelete} 
                title="Delete Note"
                onClick={() => onDelete(note.noteId)}
              >
                <DeleteIcon />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export function TimeTracking() {
  const navigate = useNavigate();
  const {
    isRunning,
    workSeconds,
    idleSeconds,
    breakSeconds,
    activeBreakLimit,
    isOnBreak,
    isIdle,
    startTimer,
    stopTimer,
    tick,
    tickBreak,
    stopBreak: stopBreakTimer,
  } = useTimerStore();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const selectedTask = useProjectStore((s) => s.selectedTask);
  const activeTimeLog = useProjectStore((s) => s.activeTimeLog);
  const setActiveTimeLog = useProjectStore((s) => s.setActiveTimeLog);
  const openBreakModal = useUiStore((s) => s.openBreakModal);
  const openNoteModal = useUiStore((s) => s.openNoteModal);
  const showNoteModal = useUiStore((s) => s.showNoteModal);
  const startMutation = useStartTimeLog();

  const [notes, setNotes] = useState<any[]>([]);

  const fetchNotes = () => {
    if (selectedTask?.id) {
      getNotesForTask(selectedTask.id)
        .then(setNotes)
        .catch(console.error);
    }
  };

  useEffect(() => {
    if (!showNoteModal) {
      fetchNotes();
    }
  }, [selectedTask?.id, showNoteModal]);

  const handleDeleteNote = async (noteId: number) => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
      await deleteNote(noteId);
      toast.success('Note deleted');
      fetchNotes();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to delete note');
    }
  };

  const handleUpdateNote = async (noteId: number, text: string) => {
    if (!text.trim()) {
      toast.error('Note text is required');
      return;
    }
    try {
      await updateNote(noteId, text);
      toast.success('Note updated');
      fetchNotes();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update note');
      throw e;
    }
  };

  // Resume timer UI if we arrive here with an active time log
  useEffect(() => {
    if (activeTimeLog && !isRunning) {
      getPreviousSecondsForTask(activeTimeLog.taskId).then((prevSec) => {
        const diffSec = activeTimeLog.startTime
          ? Math.max(0, Math.floor((Date.now() - new Date(activeTimeLog.startTime).getTime()) / 1000))
          : 0;
        startTimer(prevSec + diffSec);
      });
    }
  }, [activeTimeLog, isRunning, startTimer]);

  const stopMutation = useMutation({
    mutationFn: () => stopTimeLog(activeTimeLog!.taskId),
    onSuccess: () => {
      stopTimer();
      setActiveTimeLog(null);
      window.electronAPI?.stopTimer();
      toast.success('Timer stopped');
      navigate('/dashboard');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to stop timer');
    },
  });

  const handleStart = () => {
    if (!selectedProject || !selectedTask) return;
    startMutation.mutate({ taskId: selectedTask.id });
  };

  const handleStop = () => {
    if (!activeTimeLog) {
      stopTimer();
      window.electronAPI?.stopTimer();
      navigate('/dashboard');
      return;
    }
    stopMutation.mutate();
  };

  const handleBreakToggle = async () => {
    if (isOnBreak) {
      if (!activeTimeLog) return;
      try {
        await stopBreak(activeTimeLog.id);
        stopBreakTimer();
        window.electronAPI?.stopBreak();
        toast.success('Break stopped');
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Failed to stop break');
      }
    } else {
      openBreakModal();
    }
  };

  if (!selectedProject || !selectedTask) {
    return (
      <div className={styles.container}>
        <div className={styles.timerSection}>
          <p className={styles.emptyText}>No project or task selected.</p>
          <button className={styles.startBtn} onClick={() => navigate('/projects')}>
            Select Project
          </button>
        </div>
      </div>
    );
  }

  // Show start prompt if timer is not running
  if (!isRunning) {
    return (
      <div className={styles.container}>
        <div className={styles.timerSection}>
          <div className={styles.timer}>{formatTime(0)}</div>
        </div>

        <div className={styles.projectCard}>
          <h3 className={styles.projectName}>{selectedProject.name}</h3>
          <p className={styles.taskName}>{selectedTask.title}</p>
        </div>

        <button
          className={styles.startBtn}
          onClick={handleStart}
          disabled={startMutation.isPending}
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.connectionStatus}>
        <span className={styles.statusDot} />
        Connected
      </div>

      <div className={styles.timerSection}>
        <div className={styles.timer}>{formatTime(workSeconds + idleSeconds + breakSeconds)}</div>
        <div className={styles.counters}>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>Work</span>
            <span className={styles.counterValue}>{formatTime(workSeconds)}</span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>Idle</span>
            <span className={`${styles.counterValue} ${isIdle ? styles.idleActive : ''}`}>
              {formatTime(idleSeconds)}
            </span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterLabel}>
              Break {isOnBreak && activeBreakLimit && breakSeconds > activeBreakLimit ? '(Exceeded)' : ''}
            </span>
            <span className={`${styles.counterValue} ${isOnBreak && activeBreakLimit && breakSeconds > activeBreakLimit ? styles.breakExceeded : ''}`}>
              {formatTime(breakSeconds)}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.projectCard}>
        <h3 className={styles.projectName}>{selectedProject.name}</h3>
        <p className={styles.taskName}>{selectedTask.title}</p>
      </div>

      <div className={styles.actions}>
        <button className={styles.breakBtn} onClick={handleBreakToggle}>
          {isOnBreak ? 'Back to Work' : 'Break'}
        </button>
        <button className={styles.noteBtn} onClick={() => openNoteModal()}>
          Add Note
        </button>
        <button
          className={styles.stopBtn}
          onClick={handleStop}
          disabled={stopMutation.isPending}
        >
          {stopMutation.isPending ? 'Stopping...' : 'Stop'}
        </button>
      </div>

      {notes.length > 0 && (
        <div className={styles.notesSection}>
          <h3 className={styles.notesHeader}>Session Notes</h3>
          <div className={styles.noteList}>
            {notes.map((note) => (
              <NoteItem 
                key={note.noteId} 
                note={note} 
                onDelete={handleDeleteNote} 
                onUpdate={handleUpdateNote} 
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
