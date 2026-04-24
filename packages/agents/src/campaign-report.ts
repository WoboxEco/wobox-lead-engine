import { type DbClient, createAdminClient } from '@wobox/core';

export interface CampaignReportOptions {
  campaignId?: string;
  venture?: string;
  json?: boolean;
}

interface CampaignSummary {
  id: string;
  name: string;
  venture: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  companies_total: number;
  by_stage: Record<string, number>;
  messages_sent: number;
  messages_edited: number;
  replied: number;
  meetings_booked: number;
  closed_won: number;
  conversion_qualified_to_booked: number | null;
  conversion_sent_to_reply: number | null;
  avg_score: number | null;
}

export async function run(opts: CampaignReportOptions): Promise<void> {
  const db = createAdminClient();

  let query = db
    .from('campaigns')
    .select('id, name, venture, status, started_at, ended_at')
    .order('started_at', { ascending: false });

  if (opts.campaignId) query = query.eq('id', opts.campaignId);
  if (opts.venture) query = query.eq('venture', opts.venture);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const campaigns = (data as unknown as CampaignSummary[]) ?? [];
  if (campaigns.length === 0) {
    console.log('No hay campaigns que coincidan con el filtro.');
    return;
  }

  const reports: CampaignSummary[] = [];
  for (const c of campaigns) {
    const r = await buildCampaignReport(db, c);
    reports.push(r);
  }

  if (opts.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  for (const r of reports) printReport(r);
}

async function buildCampaignReport(
  db: DbClient,
  c: CampaignSummary,
): Promise<CampaignSummary> {
  // Companies en la campaign
  const { data: companies } = await db
    .from('companies')
    .select('id, stage, scores(total_score, scored_at)')
    .eq('campaign_id', c.id);

  type CompanyRow = {
    id: string;
    stage: string;
    scores: Array<{ total_score: number; scored_at: string }>;
  };
  const companyRows = (companies as unknown as CompanyRow[]) ?? [];
  const companyIds = companyRows.map((x) => x.id);

  const byStage: Record<string, number> = {};
  let scoreSum = 0;
  let scoreCount = 0;
  for (const r of companyRows) {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
    if (latest) {
      scoreSum += latest.total_score;
      scoreCount++;
    }
  }

  // Messages stats (si no hay companies, skip)
  let sent = 0;
  let edited = 0;
  if (companyIds.length > 0) {
    const { data: msgs } = await db
      .from('messages')
      .select('status, body, original_body')
      .in('company_id', companyIds);
    const msgRows =
      (msgs as unknown as Array<{ status: string; body: string; original_body: string }>) ?? [];
    for (const m of msgRows) {
      if (m.status === 'sent') sent++;
      if (m.body !== m.original_body && m.status !== 'discarded') edited++;
    }
  }

  // Interactions: replied + meetings
  let replied = 0;
  let meetings = 0;
  let closedWon = 0;
  if (companyIds.length > 0) {
    const { data: ints } = await db
      .from('interactions')
      .select('outcome, type')
      .in('company_id', companyIds);
    const intRows =
      (ints as unknown as Array<{ outcome: string | null; type: string | null }>) ?? [];
    for (const i of intRows) {
      if (i.outcome === 'replied') replied++;
      if (i.type === 'meeting') meetings++;
    }

    // closed_won: via companies.hubspot_deal_id y stage
    const { data: hubs } = await db
      .from('companies')
      .select('stage, hubspot_deal_id')
      .in('id', companyIds);
    const hubRows =
      (hubs as unknown as Array<{ stage: string; hubspot_deal_id: string | null }>) ?? [];
    for (const h of hubRows) {
      if (h.stage === 'meeting_booked' && h.hubspot_deal_id) closedWon++; // aproximacion
    }
  }

  const qualifiedCount = byStage['qualified'] ?? 0;
  const bookedCount = byStage['meeting_booked'] ?? 0;
  const convQualifiedToBooked =
    qualifiedCount + bookedCount > 0 ? bookedCount / (qualifiedCount + bookedCount) : null;
  const convSentToReply = sent > 0 ? replied / sent : null;

  return {
    id: c.id,
    name: c.name,
    venture: c.venture,
    status: c.status,
    started_at: c.started_at,
    ended_at: c.ended_at,
    companies_total: companyRows.length,
    by_stage: byStage,
    messages_sent: sent,
    messages_edited: edited,
    replied,
    meetings_booked: meetings,
    closed_won: closedWon,
    conversion_qualified_to_booked: convQualifiedToBooked,
    conversion_sent_to_reply: convSentToReply,
    avg_score: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
  };
}

function printReport(r: CampaignSummary): void {
  console.log('\n' + '='.repeat(70));
  console.log(`${r.name}  (${r.venture} · ${r.status})`);
  console.log(`Started: ${r.started_at.slice(0, 10)}${r.ended_at ? ` · Ended: ${r.ended_at.slice(0, 10)}` : ''}`);
  console.log('='.repeat(70));

  console.log(`Companies (${r.companies_total} total):`);
  for (const [stage, n] of Object.entries(r.by_stage).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${stage.padEnd(16)} ${n}`);
  }
  if (r.avg_score !== null) console.log(`  avg_score        ${r.avg_score}`);

  console.log(`\nMessaging:`);
  console.log(`  enviados         ${r.messages_sent}`);
  console.log(`  editados (IA != final)  ${r.messages_edited}`);
  console.log(`  replies          ${r.replied}`);
  console.log(`  meetings booked  ${r.meetings_booked}`);
  console.log(`  closed won       ${r.closed_won}`);

  console.log(`\nConversion:`);
  console.log(
    `  qualified -> booked  ${pct(r.conversion_qualified_to_booked)}`,
  );
  console.log(
    `  sent -> reply        ${pct(r.conversion_sent_to_reply)}`,
  );
}

function pct(v: number | null): string {
  if (v === null) return 'n/a';
  return `${(v * 100).toFixed(1)}%`;
}
