import { getMainWindow } from '../index';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LOG_LEVELS;

const currentLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

function shouldLog(level: Level): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeToFile(level: string, message: string, ...args: unknown[]) {
  try {
    const logPath = path.join(app.getPath('userData'), 'pms_debug_logs.txt');
    const msg = `[${timestamp()}] [${level.toUpperCase()}] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;
    fs.appendFileSync(logPath, msg);
  } catch (e) {
    // Ignore
  }
}


export const logger = {
  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) {
      console.log(`[${timestamp()}] [INFO] ${message}`, ...args);
      writeToFile('info', message, ...args);
    }
  },
  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) {
      console.warn(`[${timestamp()}] [WARN] ${message}`, ...args);
      writeToFile('warn', message, ...args);
    }
  },
  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) {
      console.error(`[${timestamp()}] [ERROR] ${message}`, ...args);
      writeToFile('error', message, ...args);
    }
  },
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) {
      console.debug(`[${timestamp()}] [DEBUG] ${message}`, ...args);
      writeToFile('debug', message, ...args);
    }
  },
};
