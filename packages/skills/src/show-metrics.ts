import { type DbClient, createAdminClient, createLogger, fetchAllRows } from '@wobox/core';

// Precios por millon de tokens (actualizar cuando cambien).
const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 15, output: 75 },
};

// Apify Google Maps ~$0.007 por place.
const APIFY_PRICING: Record<string, number> = {
  'google-maps-search': 0.007,
};

export interface ShowMetricsOptions {
  venture?: string;
  period?: string; // dias hacia atras, default: 30
}

export async function run(opts: ShowMetricsOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('show-metrics');
  const days = Number.parseInt(opts.period ?? '30', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  console.log(
    `\nWobox Lead Engine - Metricas  (ultimos ${days} dias${opts.venture ? ` | venture=${opts.venture}` : ''})`,
  );
  console.log('='.repeat(80));

  await funnel(db, opts.venture, since);
  await byBuyerPersona(db, opts.venture, since);
  await messageMetrics(db, opts.venture, since);
  await flywheel(db, opts.venture, since);
  await costBreakdown(db, opts.venture, since);
  console.log();
  log.info({ days, venture: opts.venture ?? 'all' }, 'metrics done');
}

async function funnel(db: DbClient, venture: string | undefined, since: string): Promise<void> {
  // fetchAllRows pagina con .range(): un select plano se corta en 1000 filas.
  const rows = await fetchAllRows<{ stage: string; venture: string }>((from, to) => {
    const q = db
      .from('companies')
      .select('stage, venture')
      .gte('created_at', since)
      .order('id')
      .range(from, to);
    return venture ? q.eq('venture', venture) : q;
  });

  const byVenture: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!byVenture[r.venture]) byVenture[r.venture] = {};
    byVenture[r.venture]![r.stage] = (byVenture[r.venture]![r.stage] ?? 0) + 1;
  }

  const stages = [
    'new',
    'enriched',
    'qualified',
    'nurturing',
    'contacted',
    'meeting_booked',
    'discarded',
  ];
  console.log('\nFunnel por venture:');
  console.log(
    `  ${'stage'.padEnd(18)}  ${Object.keys(byVenture)
      .map((v) => v.padStart(12))
      .join(' ')}`,
  );
  for (const s of stages) {
    const counts = Object.keys(byVenture).map((v) => String(byVenture[v]![s] ?? 0).padStart(12));
    const total = Object.values(byVenture).reduce((a, vs) => a + (vs[s] ?? 0), 0);
    if (total === 0) continue;
    console.log(`  ${s.padEnd(18)}  ${counts.join(' ')}`);
  }
}

async function byBuyerPersona(
  db: DbClient,
  venture: string | undefined,
  since: string,
): Promise<void> {
  if (venture && venture !== 'loop') return; // solo aplica a Loop
  const rows = await fetchAllRows<{ buyer_persona: string | null; stage: string }>((from, to) =>
    db
      .from('companies')
      .select('buyer_persona, stage')
      .eq('venture', 'loop')
      .gte('created_at', since)
      .order('id')
      .range(from, to),
  );
  if (rows.length === 0) return;

  const bp: Record<
    string,
    { total: number; qualified: number; contacted: number; meeting: number }
  > = {};
  for (const r of rows) {
    const key = r.buyer_persona ?? 'unknown';
    if (!bp[key]) bp[key] = { total: 0, qualified: 0, contacted: 0, meeting: 0 };
    bp[key]!.total += 1;
    if (['qualified', 'nurturing', 'contacted', 'meeting_booked'].includes(r.stage))
      bp[key]!.qualified += 1;
    if (['contacted', 'meeting_booked'].includes(r.stage)) bp[key]!.contacted += 1;
    if (r.stage === 'meeting_booked') bp[key]!.meeting += 1;
  }

  console.log('\nPor buyer persona (Loop):');
  console.log(
    `  ${'BP'.padEnd(6)}  ${'total'.padStart(6)}  ${'qual'.padStart(6)}  ${'contacted'.padStart(10)}  ${'meeting'.padStart(8)}`,
  );
  for (const k of Object.keys(bp).sort()) {
    const v = bp[k]!;
    console.log(
      `  ${k.padEnd(6)}  ${String(v.total).padStart(6)}  ${String(v.qualified).padStart(6)}  ${String(v.contacted).padStart(10)}  ${String(v.meeting).padStart(8)}`,
    );
  }
}

async function messageMetrics(
  db: DbClient,
  venture: string | undefined,
  since: string,
): Promise<void> {
  const rows = await fetchAllRows<{ status: string; approach_type: string; channel: string }>(
    (from, to) => {
      const q = db
        .from('messages')
        .select('status, approach_type, channel, companies!inner(venture)')
        .gte('created_at', since)
        .order('id')
        .range(from, to);
      return venture ? q.eq('companies.venture', venture) : q;
    },
  );
  if (rows.length === 0) return;

  const byStatus: Record<string, number> = {};
  const byApproachChannel: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const k = `${r.approach_type}/${r.channel}`;
    byApproachChannel[k] = (byApproachChannel[k] ?? 0) + 1;
  }

  console.log('\nMensajes:');
  console.log(
    `  ${Object.entries(byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  console.log('\n  Por approach/channel:');
  for (const [k, v] of Object.entries(byApproachChannel).sort()) {
    console.log(`    ${k.padEnd(25)}  ${String(v).padStart(4)}`);
  }
}

async function flywheel(db: DbClient, venture: string | undefined, since: string): Promise<void> {
  // Tasa de edicion de drafts + interactions conversion.
  const messages = await fetchAllRows<{
    body: string;
    original_body: string;
    status: string;
    approach_type: string;
  }>((from, to) => {
    const q = db
      .from('messages')
      .select('body, original_body, status, approach_type, companies!inner(venture)')
      .gte('created_at', since)
      .order('id')
      .range(from, to);
    return venture ? q.eq('companies.venture', venture) : q;
  });
  const totalFinalized = messages.filter(
    (m) => m.status === 'sent' || m.status === 'approved' || m.status === 'discarded',
  ).length;
  const edited = messages.filter((m) => m.body !== m.original_body).length;
  const editRate = totalFinalized > 0 ? (edited / totalFinalized) * 100 : 0;

  const interactions = await fetchAllRows<{ outcome: string; type: string }>((from, to) => {
    const q = db
      .from('interactions')
      .select('outcome, type, companies!inner(venture)')
      .gte('performed_at', since)
      .order('id')
      .range(from, to);
    return venture ? q.eq('companies.venture', venture) : q;
  });
  const sent = interactions.filter((i) => i.outcome === 'sent').length;
  const replied = interactions.filter((i) => i.outcome === 'replied').length;
  const accepted = interactions.filter((i) => i.outcome === 'accepted').length;
  const booked = interactions.filter((i) => i.outcome === 'meeting_booked').length;

  console.log('\nFlywheel:');
  console.log(
    `  Edit rate (body != original_body):  ${editRate.toFixed(1)}%  (${edited}/${totalFinalized})`,
  );
  console.log(
    `  Interactions: sent=${sent}  replied=${replied}  accepted=${accepted}  meeting_booked=${booked}`,
  );
  if (sent > 0) {
    const replyRate = ((replied + accepted + booked) / sent) * 100;
    console.log(`  Reply rate: ${replyRate.toFixed(1)}%`);
  }
}

async function costBreakdown(
  db: DbClient,
  venture: string | undefined,
  since: string,
): Promise<void> {
  const rows = await fetchAllRows<{
    service: string;
    operation: string;
    tokens_used: number | null;
    credits_used: number;
    venture: string | null;
  }>((from, to) => {
    const q = db
      .from('api_usage')
      .select('service, operation, tokens_used, credits_used, venture')
      .gte('created_at', since)
      .order('id')
      .range(from, to);
    return venture ? q.eq('venture', venture) : q;
  });
  if (rows.length === 0) return;

  let claudeCost = 0;
  let apifyCost = 0;
  let claudeTokens = 0;
  let apifyCredits = 0;
  let cacheReads = 0;
  let cacheCreations = 0;

  for (const r of rows) {
    if (r.service === 'claude') {
      claudeTokens += r.tokens_used ?? 0;
      // Parse operation: "prefix::<model>[::cache=W/R]"
      const modelMatch = r.operation.match(/::([^:]+?)(?:::|$)/);
      const cacheMatch = r.operation.match(/::cache=(\d+)\/(\d+)/);
      const model = modelMatch?.[1] ?? 'claude-sonnet-4-5';
      const pricing = CLAUDE_PRICING[model];
      if (!pricing) continue;

      const w = cacheMatch ? Number.parseInt(cacheMatch[1]!, 10) : 0;
      const r_ = cacheMatch ? Number.parseInt(cacheMatch[2]!, 10) : 0;
      cacheCreations += w;
      cacheReads += r_;

      // Aproximacion: regular = total - cache writes - cache reads.
      // output ~10% del regular (no se guarda breakdown exacto en api_usage).
      const total = r.tokens_used ?? 0;
      const regular = Math.max(0, total - w - r_);
      const outputTokens = Math.round(regular * 0.1);
      const inputTokens = regular - outputTokens;

      claudeCost +=
        (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output +
        (w / 1_000_000) * pricing.input * 1.25 +
        (r_ / 1_000_000) * pricing.input * 0.1;
    } else if (r.service === 'apify') {
      apifyCredits += r.credits_used;
      const perUnit = APIFY_PRICING[r.operation] ?? 0;
      apifyCost += r.credits_used * perUnit;
    }
  }

  console.log('\nCostos estimados:');
  console.log(
    `  Claude : ${claudeTokens} tokens (cache write: ${cacheCreations}, cache read: ${cacheReads})  ~$${claudeCost.toFixed(3)}`,
  );
  console.log(`  Apify  : ${apifyCredits} places   ~$${apifyCost.toFixed(3)}`);
  console.log(`  Total  : ~$${(claudeCost + apifyCost).toFixed(3)}`);
  if (cacheReads > 0) {
    const savings = (cacheReads / 1_000_000) * 3 * 0.9; // ~90% ahorro vs input regular a Sonnet rate
    console.log(`  Ahorro estimado por cache reads: ~$${savings.toFixed(3)}`);
  }
}
