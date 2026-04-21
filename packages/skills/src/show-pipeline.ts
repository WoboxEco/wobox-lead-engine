import { type DbClient, createAdminClient, createLogger } from '@wobox/core';

const STAGE_ORDER = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
] as const;

type Stage = (typeof STAGE_ORDER)[number];

export interface ShowPipelineOptions {
  venture?: string;
  stage?: string;
  founder?: string;
  campaign?: string;
  minScore?: string;
  bp?: string;
  limit?: string;
}

type Row = {
  id: string;
  name: string;
  venture: string;
  stage: Stage;
  buyer_persona?: string;
  neighborhood?: string;
  region?: string;
  instagram_handle?: string;
  campaign_id?: string;
  assigned_to?: string;
  scores: Array<{ total_score: number; scored_at: string }>;
};

export async function run(opts: ShowPipelineOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('show-pipeline');
  const limit = Number.parseInt(opts.limit ?? '200', 10);
  const minScore = opts.minScore ? Number.parseInt(opts.minScore, 10) : null;

  const rows = await fetchRows(db, opts, limit);
  const enriched = rows
    .map((r) => {
      const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
      return { ...r, score: latest?.total_score ?? null };
    })
    .filter((r) => (minScore === null ? true : (r.score ?? 0) >= minScore));

  if (enriched.length === 0) {
    log.info('no matches');
    return;
  }

  const byStage: Record<string, typeof enriched> = {};
  for (const r of enriched) {
    if (!byStage[r.stage]) byStage[r.stage] = [];
    byStage[r.stage]!.push(r);
  }

  const filters: string[] = [];
  if (opts.venture) filters.push(`venture=${opts.venture}`);
  if (opts.stage) filters.push(`stage=${opts.stage}`);
  if (opts.bp) filters.push(`bp=${opts.bp}`);
  if (opts.campaign) filters.push(`campaign=${opts.campaign}`);
  if (minScore !== null) filters.push(`min_score=${minScore}`);
  console.log(
    `\nWobox Lead Engine - Pipeline  (total: ${enriched.length}${filters.length ? ` | ${filters.join(' ')}` : ''})`,
  );
  console.log('='.repeat(100));

  for (const stage of STAGE_ORDER) {
    const items = byStage[stage];
    if (!items || items.length === 0) continue;
    items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    console.log(`\n[${stage}]  (${items.length})`);
    for (const r of items) {
      const score = r.score !== null ? String(r.score).padStart(3) : ' - ';
      const bp = (r.buyer_persona ?? '   ').padEnd(4);
      const ig = r.instagram_handle ? `@${r.instagram_handle}` : '';
      const loc = [r.neighborhood, r.region].filter(Boolean).join(', ');
      console.log(
        `  ${score} | ${bp} | ${(r.name ?? '').slice(0, 50).padEnd(50)} | ${loc.slice(0, 25).padEnd(25)} | ${ig}`,
      );
    }
  }
  console.log();
}

async function fetchRows(db: DbClient, opts: ShowPipelineOptions, limit: number): Promise<Row[]> {
  let query = db
    .from('companies')
    .select(
      'id, name, venture, stage, buyer_persona, neighborhood, region, instagram_handle, campaign_id, assigned_to, scores(total_score, scored_at)',
    )
    .limit(limit);

  if (opts.venture) query = query.eq('venture', opts.venture);
  if (opts.stage) query = query.eq('stage', opts.stage);
  if (opts.bp) query = query.eq('buyer_persona', opts.bp);
  if (opts.campaign) query = query.eq('campaign_id', opts.campaign);
  if (opts.founder) query = query.eq('assigned_to', opts.founder);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as unknown as Row[]) ?? [];
}
