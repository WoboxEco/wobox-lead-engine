import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { env } from './env.js';

const e = env();

const base = pino({
  level: e.LOG_LEVEL,
  ...(e.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
});

export type Logger = pino.Logger;

export function createLogger(skill: string): Logger {
  return base.child({ skill, run_id: randomUUID() });
}

export const logger = base;
