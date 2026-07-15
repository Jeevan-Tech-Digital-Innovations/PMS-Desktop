export interface BreakReason {
  id: number;
  reasonText: string;
}

export interface Break {
  breakId: number;
  timeLogId: number;
  breakReason: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
}

export interface StartBreakRequest {
  breakReasonId: number;
}

export interface StartBreakResponse {
  status: string;
  message: string;
  data: Break;
  timestamp: string;
}
