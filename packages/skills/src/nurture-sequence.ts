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
};

export async function run(opts: NurtureSequenceOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('nurture-sequence');
  const limit = opts.limit ?? 50;

  let query = db
    .from('companies')
    .select('id, name, stage, venture')
    .eq('stage', 'nurturing')
    .limit(limit);
  if (opts.venture) query = query.eq('venture', opts.venture);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const companies = (data as unknown as CompanyRow[]) ?? [];

  if (companies.length === 0) {
    console.log('No hay companies en stage=nurturing');
    return;
  }

  let generated = 0;
  let waiting = 0;
  let done = 0;
  let skipped = 0;

  for (const c of companies) {
    const last = await loadLastNurtureMessage(db, c.id);

    if (!last) {
      console.log(`[${c.name}] skip: sin mensaje nurture previo (arrancar con generate-messages)`);
      skipped++;
      continue;
    }

    const channel: Channel = last.channel ?? 'linkedin';
    const isEmail = channel === 'email';
    const lastStep =
      last.sequence_step ?? (isEmail ? generateMessages.EMAIL_NURTURE_FIRST_STEP : 1);
    const lastStepOfSequence = isEmail ? generateMessages.EMAIL_NURTURE_LAST_STEP : 4;
    if (lastStep >= lastStepOfSequence) {
      console.log(`[${c.name}] secuencia completa (step ${lastStep})`);
      done++;
      continue;
    }

    const nextStep = lastStep + 1;

    // Si ya existe draft para nextStep, skip.
    const already = await draftExists(db, c.id, nextStep);
    if (already) {
      console.log(`[${c.name}] ya existe draft para step ${nextStep}`);
      skipped++;
      continue;
    }

    const requiredDelay = NEXT_STEP_DELAY_DAYS[nextStep] ?? 2;
    const daysSince = daysSinceSent(last.sent_at);

    if (daysSince === null) {
      console.log(
        `[${c.name}] step ${lastStep} aun no esta sent (status=${last.status}); nurture aprobar primero`,
      );
      skipped++;
      continue;
    }

    if (daysSince < requiredDelay) {
      console.log(
        `[${c.name}] step ${nextStep} en ${(requiredDelay - daysSince).toFixed(1)}d (ultimo envio hace ${daysSince.toFixed(1)}d)`,
      );
      waiting++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[${c.name}] [DRY-RUN] generaria step ${nextStep}`);
      generated++;
      continue;
    }

    console.log(`[${c.name}] generando step ${nextStep}...`);
    try {
      await generateMessages.run({
        id: c.id,
        approach: 'nurture',
        channel,
        step: String(nextStep),
        ...(opts.model ? { model: opts.model } : {}),
      });
      generated++;
    } catch (err) {
      log.error({ err: String(err), company: c.name, step: nextStep }, 'generate failed');
      skipped++;
    }
  }

  console.log(
    `\nResumen: generated=${generated}, waiting=${waiting}, done=${done}, skipped=${skipped}`,
  );
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
