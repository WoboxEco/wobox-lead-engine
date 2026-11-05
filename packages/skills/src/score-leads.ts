import {
  type Venture,
  createAdminClient,
  createLogger,
  isWoboxVenture,
  loopScoreSchema,
  scoringModelForVenture,
  woboxScoreSchema,
  writeErrorLog,
} from '@wobox/core';
import { claude } from '@wobox/integrations';
import { buildLeadData, loadPromptSplit } from '@wobox/prompts';

// Default: Haiku. Scoring es clasificacion multi-dimensional con reasoning corto.
// Override con --model=sonnet si queres validar consistencia en una corrida.
const DEFAULT_MODEL = 'haiku';

export interface ScoreLeadsOptions {
  venture?: Venture;
  id?: string;
  all?: boolean;
  limit?: string;
  model?: string;
  stages?: string;
  /** Scorear solo estas companies (dashboard: lotes chicos para no pasar el timeout). */
  ids?: string[];
}

export interface ScoreLeadsResult {
  ok: number;
  failed: number;
  qualified: number;
  discarded: number;
}

export async function run(opts: ScoreLeadsOptions): Promise<ScoreLeadsResult> {
  const log = createLogger('score-leads');
  const db = createAdminClient();

  if (!opts.id && !opts.all && !opts.ids?.length) {
    throw new Error('Requiere --id <uuid> o --all');
  }

  const limit = Number.parseInt(opts.limit ?? '10', 10);
  const model = opts.model ?? DEFAULT_MODEL;
  log.info({ model }, 'using model');

  // Query companies target.
  const stagesFilter = (opts.stages ?? 'new,enriched').split(',').map((s) => s.trim());
  let query = db.from('companies').select('*, contacts(*)').limit(limit);
  if (opts.id) {
    query = db.from('companies').select('*, contacts(*)').eq('id', opts.id);
  } else if (opts.ids?.length) {
    query = db
      .from('companies')
      .select('*, contacts(*)')
      .in('id', opts.ids)
      .in('stage', stagesFilter);
  } else {
    query = query.in('stage', stagesFilter);
    if (opts.venture) {
      query = query.eq('venture', opts.venture);
    }
  }

  const { data: companies, error } = await query;
  if (error) throw new Error(`Failed to fetch companies: ${error.message}`);
  if (!companies || companies.length === 0) {
    log.warn('no companies to score');
    return { ok: 0, failed: 0, qualified: 0, discarded: 0 };
  }

  log.info({ count: companies.length }, 'scoring companies');

  let ok = 0;
  let failed = 0;
  let qualified = 0;

  for (const company of companies) {
    const c = company as unknown as Record<string, unknown> & { id: string; venture: Venture };
    try {
      const stage = await scoreOne(c, db, log, model);
      ok += 1;
      if (stage === 'qualified') qualified += 1;
    } catch (err) {
      failed += 1;
      log.error({ err, companyId: c.id }, 'score failed');
      await writeErrorLog(db, {
        skill: 'score-leads',
        error: err,
        companyId: c.id,
        context: { venture: c.venture },
      });
    }
  }

  log.info({ ok, failed, qualified, total: companies.length }, 'scoring done');
  return { ok, failed, qualified, discarded: ok - qualified };
}

// Umbral de calificación: companies con total_score por debajo se descartan.
const QUALIFY_THRESHOLD = 50;

async function scoreOne(
  company: Record<string, unknown> & { id: string; venture: Venture },
  db: ReturnType<typeof createAdminClient>,
  log: ReturnType<typeof createLogger>,
  model: string | undefined,
): Promise<'qualified' | 'discarded'> {
  const venture = company.venture;
  const scoringModel = scoringModelForVenture(venture);

  const { contacts, ...companyFields } = company as typeof company & { contacts?: unknown[] };
  const leadData = buildLeadData(companyFields, (contacts as Record<string, unknown>[]) ?? []);

  // Split para prompt caching: template estable (instructions + criterios) cacheable,
  // LEAD_DATA variable por lead. Cache hit a partir de la 2da corrida del batch.
  const { stable, variable } = await loadPromptSplit(
    'scoring',
    scoringModel,
    {},
    'LEAD_DATA',
    leadData,
  );

  let totalScore = 0;

  if (isWoboxVenture(venture)) {
    const score = await claude.completeJson({
      system: 'Sos un analista comercial senior. Respondes SOLO JSON valido.',
      cachedPrefix: stable,
      user: variable,
      schema: woboxScoreSchema,
      venture,
      operation: `score-${scoringModel}`,
      ...(model ? { model } : {}),
    });

    await persistWoboxScore(db, company.id, scoringModel, score);
    totalScore = score.total_score;
  } else {
    const score = await claude.completeJson({
      system: 'Sos un analista comercial senior. Respondes SOLO JSON valido.',
      cachedPrefix: stable,
      user: variable,
      schema: loopScoreSchema,
      venture,
      operation: `score-${scoringModel}`,
      ...(model ? { model } : {}),
    });

    await persistLoopScore(db, company.id, scoringModel, score);
    totalScore = score.total_score;
  }

  // Gate por umbral: ≥50 califica, <50 se descarta (comportamiento documentado en CLAUDE.md).
  const newStage = totalScore >= QUALIFY_THRESHOLD ? 'qualified' : 'discarded';
  const { error: stageErr } = await db
    .from('companies')
    .update({ stage: newStage, updated_at: new Date().toISOString() })
    .eq('id', company.id);
  if (stageErr) log.warn({ err: stageErr }, 'stage update failed');
  return newStage;
}

type WoboxScore = ReturnType<typeof woboxScoreSchema.parse>;
type LoopScore = ReturnType<typeof loopScoreSchema.parse>;

async function persistWoboxScore(
  db: ReturnType<typeof createAdminClient>,
  companyId: string,
  scoringModel: string,
  score: WoboxScore,
): Promise<void> {
  const { error } = await db.from('scores').insert({
    company_id: companyId,
    total_score: score.total_score,
    scoring_model: scoringModel,
    dimensions: {
      vertical: score.vertical_score,
      scale: score.scale_score,
      overstock: score.overstock_score,
      franchise: score.franchise_score,
      region: score.region_score,
    },
    ai_reasoning: score.ai_reasoning,
    buyer_persona_assigned: null,
    scored_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to insert wobox score: ${error.message}`);
}

async function persistLoopScore(
  db: ReturnType<typeof createAdminClient>,
  companyId: string,
  scoringModel: string,
  score: LoopScore,
): Promise<void> {
  const { error: scoreErr } = await db.from('scores').insert({
    company_id: companyId,
    total_score: score.total_score,
    scoring_model: scoringModel,
    dimensions: {
      recurrence: score.recurrence_score,
      subsector: score.subsector_score,
      digital: score.digital_score,
      scale: score.scale_score,
      region: score.region_score,
    },
    ai_reasoning: score.ai_reasoning,
    buyer_persona_assigned: score.buyer_persona,
    scored_at: new Date().toISOString(),
  });
  if (scoreErr) throw new Error(`Failed to insert loop score: ${scoreErr.message}`);

  const { error: bpErr } = await db
    .from('companies')
    .update({ buyer_persona: score.buyer_persona })
    .eq('id', companyId);
  if (bpErr) throw new Error(`Failed to set buyer_persona: ${bpErr.message}`);
}
