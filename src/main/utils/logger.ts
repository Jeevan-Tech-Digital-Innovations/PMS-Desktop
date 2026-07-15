const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LOG_LEVELS;

const currentLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

function shouldLog(level: Level): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) console.log(`[${timestamp()}] [INFO] ${message}`, ...args);
  },
  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) console.warn(`[${timestamp()}] [WARN] ${message}`, ...args);
  },
  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) console.error(`[${timestamp()}] [ERROR] ${message}`, ...args);
  },
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) console.debug(`[${timestamp()}] [DEBUG] ${message}`, ...args);
  },
};
