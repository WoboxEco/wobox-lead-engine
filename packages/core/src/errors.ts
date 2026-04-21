import type { DbClient } from './db.js';

export class SkillError extends Error {
  public readonly context: Record<string, unknown> | undefined;

  constructor(message: string, cause?: unknown, context?: Record<string, unknown>) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SkillError';
    this.context = context;
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
