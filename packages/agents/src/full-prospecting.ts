import { type DbClient, createAdminClient, createLogger } from '@wobox/core';
import { checkWarmPath, enrichLead, scoreLeads, searchLeads, searchLeadsWeb } from '@wobox/skills';

export interface FullProspectingOptions {
  venture?: string;
  subsector?: string;
  city?: string;
  neighborhood?: string;
  campaign?: string;
  limit?: number;
  skipSearch?: boolean;
  skipEnrich?: boolean;
  skipScore?: boolean;
  skipWarm?: boolean;
  autoReveal?: boolean;
  autoMinScore?: number;
  model?: string;
}

interface Snapshot {
  new: number;
  enriched: number;
  qualified: number;
  nurturing: number;
  discarded: number;
  total: number;
}

export async function run(opts: FullProspectingOptions): Promise<void> {
  const log = createLogger('full-prospecting');
  const db = createAdminClient();
  const venture = opts.venture ?? 'loop';
  const limit = opts.limit ?? 50;
  const started = Date.now();

  console.log(`\n=== full-prospecting (venture=${venture}, limit=${limit}) ===\n`);
  const pre = await snapshot(db, venture);
  printSnapshot('Pre', pre);

  // Fase 1: source de leads — switch segun venture.
  //   - loop + subsector  -> Apify Maps (search-leads-web)
  //   - wobox_food/fashion -> Apollo (search-leads)
  //   - loop sin subsector -> saltado (no hay path Apollo default para Loop aca)
  if (!opts.skipSearch) {
    const phase = timer();
    if (venture === 'loop' && opts.subsector) {
      console.log(
        `\n[1/4] search-leads-web via Apify Maps (subsector=${opts.subsector}, city=${opts.city ?? 'Buenos Aires'})`,
      );
      try {
        await searchLeadsWeb.run({
          subsector: opts.subsector,
          ...(opts.city ? { city: opts.city } : {}),
          ...(opts.neighborhood ? { neighborhood: opts.neighborhood } : {}),
          ...(opts.campaign ? { campaign: opts.campaign } : {}),
          limit: String(limit),
          ...(opts.model ? { model: opts.model } : {}),
        });
      } catch (err) {
        log.error({ err: String(err) }, 'search-leads-web failed');
      }
      console.log(`[1/4] hecho en ${phase()}s`);
    } else if (venture === 'wobox_food' || venture === 'wobox_fashion') {
      console.log(`\n[1/4] search-leads via Apollo (venture=${venture}, limit=${limit})`);
      try {
        await searchLeads.run({
          venture,
          limit: String(limit),
          ...(opts.campaign ? { campaign: opts.campaign } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        });
      } catch (err) {
        log.error({ err: String(err) }, 'search-leads failed');
      }
      console.log(`[1/4] hecho en ${phase()}s`);
    } else {
      console.log('\n[1/4] search: saltado (loop sin --subsector; usar --subsector para Apify)');
    }
  } else {
    console.log('\n[1/4] search: saltado (--skip-search)');
  }

  // Fase 2: enrich-lead
  if (!opts.skipEnrich) {
    const phase = timer();
    console.log('\n[2/4] enrich-lead --all');
    try {
      await enrichLead.run({ all: true, venture, limit });
    } catch (err) {
      log.error({ err: String(err) }, 'enrich-lead failed');
    }
    console.log(`[2/4] hecho en ${phase()}s`);
  } else {
    console.log('\n[2/4] enrich-lead: saltado (--skip-enrich)');
  }

  // Fase 3: score-leads
  if (!opts.skipScore) {
    const phase = timer();
    console.log('\n[3/4] score-leads --all');
    try {
      await scoreLeads.run({
        venture: venture as 'wobox_food' | 'wobox_fashion' | 'loop',
        all: true,
        limit: String(limit),
        ...(opts.model ? { model: opts.model } : {}),
      });
    } catch (err) {
      log.error({ err: String(err) }, 'score-leads failed');
    }
    console.log(`[3/4] hecho en ${phase()}s`);
  } else {
    console.log('\n[3/4] score-leads: saltado (--skip-score)');
  }

  // Fase 4: check-warm-path --auto
  if (!opts.skipWarm) {
    const phase = timer();
    console.log('\n[4/4] check-warm-path --auto');
    try {
      await checkWarmPath.run({
        auto: true,
        venture,
        autoLimit: limit,
        autoMinScore: opts.autoMinScore ?? 70,
        autoReveal: opts.autoReveal ?? false,
      });
    } catch (err) {
      log.error({ err: String(err) }, 'check-warm-path failed');
    }
    console.log(`[4/4] hecho en ${phase()}s`);
  } else {
    console.log('\n[4/4] check-warm-path: saltado (--skip-warm)');
  }

  // Resumen final
  const post = await snapshot(db, venture);
  console.log('\n=== Resumen ===');
  printSnapshotDiff(pre, post);
  console.log(`\nTotal: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function snapshot(db: DbClient, venture: string): Promise<Snapshot> {
  const { data } = await db.from('companies').select('stage').eq('venture', venture);
  const rows = (data as unknown as Array<{ stage: string }>) ?? [];
  const s: Snapshot = {
    new: 0,
    enriched: 0,
    qualified: 0,
    nurturing: 0,
    discarded: 0,
    total: rows.length,
  };
  const counts = s as unknown as Record<string, number>;
  for (const r of rows) {
    if (r.stage in s && typeof counts[r.stage] === 'number') {
      counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    }
  }
  return s;
}

function printSnapshot(label: string, s: Snapshot): void {
  console.log(
    `${label}: total=${s.total} | new=${s.new} enriched=${s.enriched} qualified=${s.qualified} nurturing=${s.nurturing} discarded=${s.discarded}`,
  );
}

function printSnapshotDiff(a: Snapshot, b: Snapshot): void {
  const diff = (x: number, y: number): string => {
    const d = y - x;
    if (d === 0) return `${y}`;
    return `${y} (${d > 0 ? '+' : ''}${d})`;
  };
  console.log(
    `total=${diff(a.total, b.total)} | new=${diff(a.new, b.new)} enriched=${diff(a.enriched, b.enriched)} qualified=${diff(a.qualified, b.qualified)} nurturing=${diff(a.nurturing, b.nurturing)} discarded=${diff(a.discarded, b.discarded)}`,
  );
}

function timer(): () => string {
  const t = Date.now();
  return () => ((Date.now() - t) / 1000).toFixed(1);
}
