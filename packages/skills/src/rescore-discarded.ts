import { createAdminClient, createLogger, fetchAllRows, scoringModelForVenture } from '@wobox/core';
import * as scoreLeads from './score-leads.js';

/**
 * Re-puntúa con el modelo de scoring vigente (wobox_fashion → v2) las companies `discarded`
 * cuyo último score quedó cerca del umbral (default 35–49). Pensado para rescatar marcas de
 * ropa que el v1 castigó por no saber cuántos locales tienen.
 *
 * - CLI: `pnpm skill rescore-discarded [--min=35] [--max=49] [--limit=50] [--dry-run]`
 * - Dashboard: `planRescore()` devuelve los IDs y el cliente llama `rescoreIds()` en lotes
 *   chicos (`/api/rescore-discarded`) para no pasar el timeout de Vercel Hobby.
 */

export const RESCORE_VENTURE = 'wobox_fashion' as const;
export const DEFAULT_MIN_SCORE = 35;
export const DEFAULT_MAX_SCORE = 49;
/** Companies por request desde el dashboard (Claude ~2-4s c/u, timeout 10s). */
export const MAX_RESCORE_IDS_PER_REQUEST = 2;

type ScoreRow = {
  total_score: number | null;
  scored_at: string | null;
  scoring_model: string | null;
};
export type RescoreCompanyRow = { id: string; scores: ScoreRow[] | null };

/**
 * Candidatas: último score (por `scored_at`) en [min, max] y hecho con otro modelo que el
 * vigente (si ya se re-puntuó con v2 y siguió abajo, no se repite).
 */
export function selectRescoreCandidates(
  rows: RescoreCompanyRow[],
  opts: { min: number; max: number; currentModel: string },
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const latest = [...(r.scores ?? [])].sort((a, b) =>
      String(b.scored_at ?? '').localeCompare(String(a.scored_at ?? '')),
    )[0];
    if (!latest || latest.total_score === null) continue;
    if (latest.scoring_model === opts.currentModel) continue;
    if (latest.total_score >= opts.min && latest.total_score <= opts.max) ids.push(r.id);
  }
  return ids;
}

export async function planRescore(
  opts: { min?: number; max?: number } = {},
): Promise<{ ids: string[]; model: string }> {
  const db = createAdminClient();
  const model = scoringModelForVenture(RESCORE_VENTURE);
  const rows = await fetchAllRows<RescoreCompanyRow>((from, to) =>
    db
      .from('companies')
      .select('id, scores(total_score, scored_at, scoring_model)')
      .eq('venture', RESCORE_VENTURE)
      .eq('stage', 'discarded')
      .order('id')
      .range(from, to),
  );
  const ids = selectRescoreCandidates(rows, {
    min: opts.min ?? DEFAULT_MIN_SCORE,
    max: opts.max ?? DEFAULT_MAX_SCORE,
    currentModel: model,
  });
  return { ids, model };
}

/** Re-puntúa estas companies (solo si siguen `discarded`): pasan a qualified si ≥50. */
export async function rescoreIds(ids: string[]): Promise<scoreLeads.ScoreLeadsResult> {
  if (ids.length === 0) return { ok: 0, failed: 0, qualified: 0, discarded: 0 };
  return scoreLeads.run({ venture: RESCORE_VENTURE, ids, stages: 'discarded' });
}

export interface RescoreDiscardedOptions {
  min?: string;
  max?: string;
  limit?: string;
  dryRun?: boolean;
}

export async function run(opts: RescoreDiscardedOptions): Promise<scoreLeads.ScoreLeadsResult> {
  const log = createLogger('rescore-discarded');
  const min = opts.min ? Number.parseInt(opts.min, 10) : DEFAULT_MIN_SCORE;
  const max = opts.max ? Number.parseInt(opts.max, 10) : DEFAULT_MAX_SCORE;
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 50;

  const { ids, model } = await planRescore({ min, max });
  const batch = ids.slice(0, limit);
  log.info({ candidates: ids.length, batch: batch.length, min, max, model }, 'rescore plan');

  if (opts.dryRun) {
    console.log(
      `rescore-discarded [DRY]: ${ids.length} candidatas (score ${min}-${max}, modelo != ${model}).`,
    );
    return { ok: 0, failed: 0, qualified: 0, discarded: 0 };
  }

  const total = { ok: 0, failed: 0, qualified: 0, discarded: 0 };
  for (let i = 0; i < batch.length; i += 5) {
    const r = await rescoreIds(batch.slice(i, i + 5));
    total.ok += r.ok;
    total.failed += r.failed;
    total.qualified += r.qualified;
    total.discarded += r.discarded;
  }
  console.log(
    `rescore-discarded: ${total.ok} re-puntuadas, ${total.qualified} pasaron a qualified, ${total.discarded} siguen descartadas, ${total.failed} fallaron (quedan ${ids.length - batch.length}).`,
  );
  return total;
}
