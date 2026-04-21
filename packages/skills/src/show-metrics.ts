import { type DbClient, createAdminClient, createLogger } from '@wobox/core';

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
  let q = db.from('companies').select('stage, venture').gte('created_at', since);
  if (venture) q = q.eq('venture', venture);
  const { data } = await q;
  const rows = (data as Array<{ stage: string; venture: string }>) ?? [];

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
  const q = db
    .from('companies')
    .select('buyer_persona, stage')
    .eq('venture', 'loop')
    .gte('created_at', since);
  if (venture && venture !== 'loop') return; // solo aplica a Loop
  const { data } = await q;
  const rows = (data as Array<{ buyer_persona: string | null; stage: string }>) ?? [];
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
  let q = db
    .from('messages')
    .select('status, approach_type, channel, companies!inner(venture)')
    .gte('created_at', since);
  if (venture) q = q.eq('companies.venture', venture);
  const { data } = await q;
  const rows = (data as Array<{ status: string; approach_type: string; channel: string }>) ?? [];
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
  let mq = db
    .from('messages')
    .select('body, original_body, status, approach_type, companies!inner(venture)')
    .gte('created_at', since);
  if (venture) mq = mq.eq('companies.venture', venture);
  const { data: msgs } = await mq;
  const messages =
    (msgs as Array<{
      body: string;
      original_body: string;
      status: string;
      approach_type: string;
    }>) ?? [];
  const totalFinalized = messages.filter(
    (m) => m.status === 'sent' || m.status === 'approved' || m.status === 'discarded',
  ).length;
  const edited = messages.filter((m) => m.body !== m.original_body).length;
  const editRate = totalFinalized > 0 ? (edited / totalFinalized) * 100 : 0;

  let iq = db
    .from('interactions')
    .select('outcome, type, companies!inner(venture)')
    .gte('performed_at', since);
  if (venture) iq = iq.eq('companies.venture', venture);
  const { data: ints } = await iq;
  const interactions = (ints as Array<{ outcome: string; type: string }>) ?? [];
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
  let q = db
    .from('api_usage')
    .select('service, operation, tokens_used, credits_used, venture')
    .gte('created_at', since);
  if (venture) q = q.eq('venture', venture);
  const { data } = await q;
  const rows =
    (data as Array<{
      service: string;
      operation: string;
      tokens_used: number | null;
      credits_used: number;
      venture: string | null;
    }>) ?? [];
  if (rows.length === 0) return;

  let claudeCost = 0;
  let apifyCost = 0;
  let claudeTokens = 0;
  let apifyCredits = 0;

  for (const r of rows) {
    if (r.service === 'claude') {
      claudeTokens += r.tokens_used ?? 0;
      // Extraer model del operation: "prefix::<model_id>"
      const modelMatch = r.operation.match(/::(.+)$/);
      const model = modelMatch?.[1] ?? 'claude-sonnet-4-5';
      const pricing = CLAUDE_PRICING[model];
      if (pricing) {
        // Aprox: 90% input, 10% output (no guardamos breakdown en api_usage hoy).
        const tokens = r.tokens_used ?? 0;
        claudeCost +=
          ((tokens * 0.9) / 1_000_000) * pricing.input +
          ((tokens * 0.1) / 1_000_000) * pricing.output;
      }
    } else if (r.service === 'apify') {
      apifyCredits += r.credits_used;
      const perUnit = APIFY_PRICING[r.operation] ?? 0;
      apifyCost += r.credits_used * perUnit;
    }
  }

  console.log('\nCostos estimados:');
  console.log(`  Claude : ${claudeTokens} tokens  ~$${claudeCost.toFixed(3)}`);
  console.log(`  Apify  : ${apifyCredits} places   ~$${apifyCost.toFixed(3)}`);
  console.log(`  Total  : ~$${(claudeCost + apifyCost).toFixed(3)}`);
}
