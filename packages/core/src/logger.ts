import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { env } from './env.js';

const base = pino({
  level: env().LOG_LEVEL,
  transport:
    env().NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

export type Logger = pino.Logger;

export function createLogger(skill: string): Logger {
  return base.child({ skill, run_id: randomUUID() });
}

export const logger = base;
