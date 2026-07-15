export interface Note {
  noteId: number;
  timeLogId: number;
  noteText: string;
  createdAt: string;
}

export interface AddNoteRequest {
  noteText: string;
}

export interface AddNoteResponse {
  status: string;
  message: string;
  data: Note;
  timestamp: string;
}

export const NOTE_MAX_LENGTH = 120;
