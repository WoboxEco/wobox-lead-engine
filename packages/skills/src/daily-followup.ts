import { type DbClient, createAdminClient, createLogger, env, writeErrorLog } from '@wobox/core';

import { type CheckRepliesResult, checkReplies } from './check-replies.js';
import { type SendableMessage, sendMessage } from './deliver.js';
import * as nurtureSequence from './nurture-sequence.js';

// Estimaciones conservadoras de cuanto tarda cada operacion. Antes de arrancar una,
// se exige que quede al menos ese tiempo (+ margen para responder el resumen).
const COST_MS = {
  imap: 4000,
  classify: 2500,
  generate: 7000,
  send: 2000,
} as const;
const SAFETY_MS = 700;

export interface DailyFollowupOptions {
  /** Presupuesto total en ms (default env CRON_TIME_BUDGET_MS = 9000). */
  budgetMs?: string | number;
  /** Salta el paso de nurture (generacion con Claude). */
  skipNurture?: boolean;
  dryRun?: boolean;
}

export interface AutoSendResult {
  sent: number;
  failed: number;
  pending: number;
  cutShort: boolean;
  limitReached: boolean;
}

export interface DailyFollowupResult {
  elapsedMs: number;
  budgetMs: number;
  replies: CheckRepliesResult | { error: string } | { skipped: 'time' };
  nurture: nurtureSequence.NurtureSequenceResult | { error: string } | { skipped: string };
  autoSend: AutoSendResult | { error: string };
  /** true si algun paso se corto por tiempo: lo que falta queda para manana. */
  cutShort: boolean;
}

/** Reloj de presupuesto: `has(ms)` = queda al menos ms (+ margen) antes del corte. */
export function createBudget(budgetMs: number) {
  const started = Date.now();
  return {
    started,
    elapsed: () => Date.now() - started,
    has: (ms: number) => Date.now() - started + ms + SAFETY_MS <= budgetMs,
  };
}

export async function run(opts: DailyFollowupOptions = {}): Promise<DailyFollowupResult> {
  const res = await runDailyFollowup(createAdminClient(), opts);
  console.log(JSON.stringify(res, null, 2));
  return res;
}

/**
 * Corrida diaria del follow-up (la llama /api/cron/daily):
 *   (a) checkReplies: detecta respuestas por IMAP, pausa secuencias y clasifica
 *   (b) nurture-sequence en todas las ventures (salta companies pausadas)
 *   (c) auto_send: envia los follow-ups de email (steps 2-4) de campanas con auto_send
 * Todo respeta un presupuesto de tiempo (Vercel Hobby): si no alcanza, corta y lo que
 * queda se procesa en la proxima corrida.
 */
export async function runDailyFollowup(
  db: DbClient,
  opts: DailyFollowupOptions = {},
): Promise<DailyFollowupResult> {
  const log = createLogger('daily-followup');
  const budgetMs = Number(opts.budgetMs ?? env().CRON_TIME_BUDGET_MS);
  const budget = createBudget(budgetMs);
  let cutShort = false;

  // (a) respuestas primero: si alguien respondio, no le mandamos el siguiente paso.
  let replies: DailyFollowupResult['replies'];
  if (budget.has(COST_MS.imap)) {
    try {
      replies = await checkReplies(db, {
        ...(opts.dryRun ? { dryRun: true } : {}),
        canContinue: () => budget.has(COST_MS.classify + COST_MS.send),
      });
      cutShort ||= replies.cutShort;
    } catch (err) {
      log.error({ err: String(err) }, 'checkReplies fallo');
      await writeErrorLog(db, {
        skill: 'daily-followup',
        error: err,
        context: { step: 'replies' },
      });
      replies = { error: String(err) };
    }
  } else {
    replies = { skipped: 'time' };
    cutShort = true;
  }

  // (b) generar los pasos que tocan hoy. Reservamos tiempo para (c).
  let nurture: DailyFollowupResult['nurture'];
  if (opts.skipNurture) {
    nurture = { skipped: 'flag' };
  } else {
    try {
      nurture = await nurtureSequence.run({
        ...(opts.dryRun ? { dryRun: true } : {}),
        canContinue: () => budget.has(COST_MS.generate + COST_MS.send),
      });
      cutShort ||= nurture.cutShort;
    } catch (err) {
      log.error({ err: String(err) }, 'nurture-sequence fallo');
      await writeErrorLog(db, {
        skill: 'daily-followup',
        error: err,
        context: { step: 'nurture' },
      });
      nurture = { error: String(err) };
    }
  }

  // (c) enviar drafts pendientes de campanas auto_send (los de hoy + los que quedaron).
  let autoSend: DailyFollowupResult['autoSend'];
  try {
    autoSend = await autoSendDrafts(db, {
      ...(opts.dryRun ? { dryRun: true } : {}),
      canContinue: () => budget.has(COST_MS.send),
    });
    cutShort ||= autoSend.cutShort;
  } catch (err) {
    log.error({ err: String(err) }, 'auto-send fallo');
    await writeErrorLog(db, {
      skill: 'daily-followup',
      error: err,
      context: { step: 'auto-send' },
    });
    autoSend = { error: String(err) };
  }

  return { elapsedMs: budget.elapsed(), budgetMs, replies, nurture, autoSend, cutShort };
}

type DraftRow = SendableMessage & { sequence_step: number | null };

/**
 * Envia automaticamente los drafts de follow-up por email (nurture steps 2-4) de companies
 * cuya campana tiene auto_send=true y cuya secuencia no esta pausada.
 * El primer contacto (step 1 / direct / warm_intro) sigue siendo manual.
 */
export async function autoSendDrafts(
  db: DbClient,
  opts: { canContinue?: () => boolean; dryRun?: boolean; limit?: number } = {},
): Promise<AutoSendResult> {
  const log = createLogger('auto-send');
  const result: AutoSendResult = {
    sent: 0,
    failed: 0,
    pending: 0,
    cutShort: false,
    limitReached: false,
  };

  const { data: camps, error: campErr } = await db
    .from('campaigns')
    .select('id')
    .eq('auto_send', true)
    .eq('status', 'active');
  if (campErr) throw new Error(`load campaigns: ${campErr.message}`);
  const campaignIds = ((camps as unknown as Array<{ id: string }>) ?? []).map((c) => c.id);
  if (campaignIds.length === 0) return result;

  const { data: comps, error: compErr } = await db
    .from('companies')
    .select('id')
    .in('campaign_id', campaignIds)
    .eq('sequence_paused', false)
    .not('stage', 'in', '(meeting_booked,discarded)');
  if (compErr) throw new Error(`load companies: ${compErr.message}`);
  const companyIds = ((comps as unknown as Array<{ id: string }>) ?? []).map((c) => c.id);
  if (companyIds.length === 0) return result;

  const { data: drafts, error: draftErr } = await db
    .from('messages')
    .select(
      'id, company_id, contact_id, approach_type, channel, subject, body, original_body, status, sequence_step',
    )
    .in('company_id', companyIds)
    .eq('status', 'draft')
    .eq('channel', 'email')
    .eq('approach_type', 'nurture')
    .gte('sequence_step', 2)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 50);
  if (draftErr) throw new Error(`load drafts: ${draftErr.message}`);
  const rows = (drafts as unknown as DraftRow[]) ?? [];
  result.pending = rows.length;

  for (const msg of rows) {
    if (opts.canContinue && !opts.canContinue()) {
      result.cutShort = true;
      break;
    }
    if (opts.dryRun) {
      console.log(`[DRY-RUN] enviaria ${msg.id} (step ${msg.sequence_step})`);
      continue;
    }
    try {
      await sendMessage(db, msg);
      result.sent++;
      result.pending--;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (/Limite diario/i.test(text)) {
        result.limitReached = true;
        break;
      }
      result.failed++;
      result.pending--;
      log.warn({ err: text, messageId: msg.id }, 'auto-send fallo');
      await writeErrorLog(db, {
        skill: 'auto-send',
        error: err,
        companyId: msg.company_id,
        context: { messageId: msg.id },
      });
    }
  }

  return result;
}
