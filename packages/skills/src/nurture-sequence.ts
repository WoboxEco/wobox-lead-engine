import { type Channel, type DbClient, createAdminClient, createLogger } from '@wobox/core';

import * as generateMessages from './generate-messages.js';

// Schedule dias entre steps de la secuencia nurture:
//   step 1 (day 0) -> step 2 (day +2) -> step 3 (day +5 desde 1) -> step 4 (day +10 desde 1)
// Lo expresamos como delta desde el anterior.
const NEXT_STEP_DELAY_DAYS: Record<number, number> = {
  2: 2, // 2 dias despues de step 1
  3: 3, // 3 dias despues de step 2
  4: 5, // 5 dias despues de step 3
  // Solo email: el nurture por email arranca en el step 4 (propuesta) y sigue con follow-ups.
  5: 3, // 3 dias despues de la propuesta
  6: 5, // 5 dias despues del primer follow-up (ultimo toque)
};

export interface NurtureSequenceOptions {
  venture?: string;
  limit?: number;
  dryRun?: boolean;
  model?: string;
  /**
   * Corte por tiempo (cron): antes de generar cada paso se llama; si devuelve false
   * se frena y el resto queda para la proxima corrida.
   */
  canContinue?: () => boolean;
}

export interface NurtureSequenceResult {
  generated: number;
  waiting: number;
  done: number;
  skipped: number;
  paused: number;
  /** true si se freno por canContinue() antes de recorrer todas las companies. */
  cutShort: boolean;
  /** Drafts creados en esta corrida (para auto_send). */
  draftIds: string[];
}

type LastMessage = {
  sequence_step: number | null;
  channel: Channel | null;
  sent_at: string | null;
  status: string;
};

type CompanyRow = {
  id: string;
  name: string;
  stage: string;
  venture: string;
  sequence_paused: boolean | null;
  sequence_resume_at: string | null;
};

export async function run(opts: NurtureSequenceOptions): Promise<NurtureSequenceResult> {
  const db = createAdminClient();
  const log = createLogger('nurture-sequence');
  const limit = opts.limit ?? 50;

  let query = db
    .from('companies')
    .select('id, name, stage, venture, sequence_paused, sequence_resume_at')
    .eq('stage', 'nurturing')
    .limit(limit);
  if (opts.venture) query = query.eq('venture', opts.venture);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const companies = (data as unknown as CompanyRow[]) ?? [];

  const result: NurtureSequenceResult = {
    generated: 0,
    waiting: 0,
    done: 0,
    skipped: 0,
    paused: 0,
    cutShort: false,
    draftIds: [],
  };

  if (companies.length === 0) {
    console.log('No hay companies en stage=nurturing');
    return result;
  }

  for (const c of companies) {
    if (c.sequence_paused) {
      console.log(`[${c.name}] secuencia pausada`);
      result.paused++;
      continue;
    }
    if (c.sequence_resume_at && new Date(c.sequence_resume_at).getTime() > Date.now()) {
      console.log(`[${c.name}] reprogramada hasta ${c.sequence_resume_at.slice(0, 10)}`);
      result.waiting++;
      continue;
    }

    const last = await loadLastNurtureMessage(db, c.id);

    if (!last) {
      console.log(`[${c.name}] skip: sin mensaje nurture previo (arrancar con generate-messages)`);
      result.skipped++;
      continue;
    }

    const channel: Channel = last.channel ?? 'linkedin';
    const isEmail = channel === 'email';
    const lastStep =
      last.sequence_step ?? (isEmail ? generateMessages.EMAIL_NURTURE_FIRST_STEP : 1);
    const lastStepOfSequence = isEmail ? generateMessages.EMAIL_NURTURE_LAST_STEP : 4;
    if (lastStep >= lastStepOfSequence) {
      console.log(`[${c.name}] secuencia completa (step ${lastStep})`);
      result.done++;
      continue;
    }

    const nextStep = lastStep + 1;

    // Si ya existe draft para nextStep, skip.
    const already = await draftExists(db, c.id, nextStep);
    if (already) {
      console.log(`[${c.name}] ya existe draft para step ${nextStep}`);
      result.skipped++;
      continue;
    }

    const requiredDelay = NEXT_STEP_DELAY_DAYS[nextStep] ?? 2;
    const daysSince = daysSinceSent(last.sent_at);

    if (daysSince === null) {
      console.log(
        `[${c.name}] step ${lastStep} aun no esta sent (status=${last.status}); nurture aprobar primero`,
      );
      result.skipped++;
      continue;
    }

    if (daysSince < requiredDelay) {
      console.log(
        `[${c.name}] step ${nextStep} en ${(requiredDelay - daysSince).toFixed(1)}d (ultimo envio hace ${daysSince.toFixed(1)}d)`,
      );
      result.waiting++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[${c.name}] [DRY-RUN] generaria step ${nextStep}`);
      result.generated++;
      continue;
    }

    if (opts.canContinue && !opts.canContinue()) {
      result.cutShort = true;
      break;
    }

    console.log(`[${c.name}] generando step ${nextStep} (${last.channel})...`);
    try {
      // Mismo canal que el paso anterior (antes caia siempre en el default linkedin).
      await generateMessages.run({
        id: c.id,
        approach: 'nurture',
        channel,
        step: String(nextStep),
        ...(opts.model ? { model: opts.model } : {}),
      });
      result.generated++;
      const draftId = await findDraftId(db, c.id, nextStep);
      if (draftId) result.draftIds.push(draftId);
    } catch (err) {
      log.error({ err: String(err), company: c.name, step: nextStep }, 'generate failed');
      result.skipped++;
    }
  }

  console.log(
    `\nResumen: generated=${result.generated}, waiting=${result.waiting}, done=${result.done}, skipped=${result.skipped}, paused=${result.paused}${result.cutShort ? ' (cortado por tiempo)' : ''}`,
  );
  return result;
}

async function findDraftId(db: DbClient, companyId: string, step: number): Promise<string | null> {
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('company_id', companyId)
    .eq('approach_type', 'nurture')
    .eq('sequence_step', step)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);
  return ((data as unknown as Array<{ id: string }>) ?? [])[0]?.id ?? null;
}

async function loadLastNurtureMessage(
  db: DbClient,
  companyId: string,
): Promise<LastMessage | null> {
  const { data, error } = await db
    .from('messages')
    .select('sequence_step, channel, sent_at, status')
    .eq('company_id', companyId)
    .eq('approach_type', 'nurture')
    .in('status', ['approved', 'sent'])
    .order('sequence_step', { ascending: false, nullsFirst: false })
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const first = ((data as unknown as LastMessage[]) ?? [])[0];
  return first ?? null;
}

async function draftExists(db: DbClient, companyId: string, step: number): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('company_id', companyId)
    .eq('approach_type', 'nurture')
    .eq('sequence_step', step)
    .in('status', ['draft', 'approved', 'sent'])
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data as unknown as Array<{ id: string }>) ?? []).length > 0;
}

function daysSinceSent(sentAt: string | null): number | null {
  if (!sentAt) return null;
  const t = new Date(sentAt).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}
