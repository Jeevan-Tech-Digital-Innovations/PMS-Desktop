/**
 * Centralised IPC channel names.
 * Both main and preload reference these constants to avoid string drift.
 */
export const IPC = {
  // Auth
  AUTH_GET_TOKENS: 'auth:get-tokens',
  AUTH_SAVE_TOKENS: 'auth:save-tokens',
  AUTH_CLEAR_TOKENS: 'auth:clear-tokens',
  AUTH_GET_USER: 'auth:get-user',
  AUTH_SAVE_USER: 'auth:save-user',

  // Timer
  TIMER_START: 'timer:start',
  TIMER_STOP: 'timer:stop',
  TIMER_TICK: 'timer:tick',

  // Idle
  IDLE_DETECTED: 'idle:detected',
  IDLE_RESPONSE: 'idle:response',

  // Break
  BREAK_START: 'break:start',
  BREAK_STOP: 'break:stop',

  // Screenshots
  SCREENSHOT_CAPTURE: 'screenshot:capture',
  SCREENSHOT_UPLOADED: 'screenshot:uploaded',

  // App lifecycle
  APP_QUIT: 'app:quit',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_MINIMIZE_TO_TRAY: 'app:minimize-to-tray',

  // Active window info (pushed from main on interval)
  ACTIVE_WINDOW_INFO: 'active-window:info',
} as const;
