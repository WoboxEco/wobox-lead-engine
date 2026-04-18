import type { DbClient } from './db.js';

export class SkillError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SkillError';
  }
}

export async function writeErrorLog(
  db: DbClient,
  params: {
    skill: string;
    error: unknown;
    companyId?: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const errorMessage = params.error instanceof Error ? params.error.message : String(params.error);
  const errorType = params.error instanceof Error ? params.error.name : 'unknown';

  await db.from('error_logs').insert({
    skill: params.skill,
    company_id: params.companyId ?? null,
    error_type: errorType,
    error_message: errorMessage,
    context: params.context ?? {},
    resolved: false,
  });
}
