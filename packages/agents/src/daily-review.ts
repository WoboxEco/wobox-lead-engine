import { type DbClient, createAdminClient } from '@wobox/core';

export interface DailyReviewOptions {
  venture?: string;
  period?: string;
  json?: boolean;
}

interface Summary {
  window_hours: number;
  generated_at: string;
  venture_filter: string | null;
  new_companies: number;
  drafts_pending: number;
  messages_sent: number;
  meetings_booked: number;
  replies: number;
  nurture_today: number;
  qualified_without_contact: number;
  by_venture: Record<
    string,
    {
      new_companies: number;
      qualified: number;
      nurturing: number;
      meeting_booked: number;
      drafts: number;
    }
  >;
}

export async function run(opts: DailyReviewOptions): Promise<void> {
  const db = createAdminClient();
  const hours = parsePeriod(opts.period ?? '1d');
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const summary = await buildSummary(db, since, hours, opts.venture ?? null);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  printSummary(summary);
}

function parsePeriod(raw: string): number {
  const m = raw.match(/^(\d+)([hdw])$/);
  if (!m) throw new Error(`--period invalido: ${raw} (usa 1d | 24h | 7d | 1w)`);
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === 'h') return n;
  if (unit === 'd') return n * 24;
  if (unit === 'w') return n * 24 * 7;
  return 24;
}

async function buildSummary(
  db: DbClient,
  since: string,
  hours: number,
  ventureFilter: string | null,
): Promise<Summary> {
  const ventureEq = ventureFilter;

  // 1. Companies nuevas en ventana
  const newCompaniesQ = db
    .from('companies')
    .select('id, venture, stage', { count: 'exact' })
    .gte('created_at', since);
  const { count: newCount } = ventureEq
    ? await newCompaniesQ.eq('venture', ventureEq)
    : await newCompaniesQ;

  // 2. Drafts pendientes (status=draft)
  const draftsQ = db
    .from('messages')
    .select('id, companies!inner(venture)', { count: 'exact', head: false })
    .eq('status', 'draft');
  const { data: draftsData } = ventureEq
    ? await draftsQ.eq('companies.venture', ventureEq)
    : await draftsQ;
  const draftRows =
    (draftsData as unknown as Array<{ companies: { venture: string } }>) ?? [];

  // 3. Mensajes enviados en ventana
  const sentQ = db
    .from('messages')
    .select('id, companies!inner(venture)', { count: 'exact' })
    .eq('status', 'sent')
    .gte('sent_at', since);
  const { count: sentCount } = ventureEq
    ? await sentQ.eq('companies.venture', ventureEq)
    : await sentQ;

  // 4. Meetings booked en ventana (interactions type=meeting)
  const meetingsQ = db
    .from('interactions')
    .select('id, companies!inner(venture)', { count: 'exact' })
    .eq('type', 'meeting')
    .gte('performed_at', since);
  const { count: meetingsCount } = ventureEq
    ? await meetingsQ.eq('companies.venture', ventureEq)
    : await meetingsQ;

  // 5. Replies en ventana (interactions outcome=replied)
  const repliesQ = db
    .from('interactions')
    .select('id, companies!inner(venture)', { count: 'exact' })
    .eq('outcome', 'replied')
    .gte('performed_at', since);
  const { count: repliesCount } = ventureEq
    ? await repliesQ.eq('companies.venture', ventureEq)
    : await repliesQ;

  // 6. Nurture today (de la vista)
  const { data: nurtureData } = await db
    .from('nurture_today')
    .select('venture');
  const nurtureRows = (nurtureData as unknown as Array<{ venture: string }>) ?? [];
  const nurtureCount = ventureEq
    ? nurtureRows.filter((r) => r.venture === ventureEq).length
    : nurtureRows.length;

  // 7. Qualified sin contact (proxy: companies stage=qualified y sin messages)
  const qualifiedQ = db
    .from('companies')
    .select('id, venture', { count: 'exact' })
    .eq('stage', 'qualified');
  const { count: qualifiedCount } = ventureEq
    ? await qualifiedQ.eq('venture', ventureEq)
    : await qualifiedQ;

  // 8. Breakdown por venture (sin filtro ventureEq para esto, siempre todo)
  const { data: allCompanies } = await db.from('companies').select('venture, stage, created_at');
  const byVenture: Summary['by_venture'] = {};
  for (const c of ((allCompanies as unknown as Array<{
    venture: string;
    stage: string;
    created_at: string;
  }>) ?? [])) {
    byVenture[c.venture] ??= {
      new_companies: 0,
      qualified: 0,
      nurturing: 0,
      meeting_booked: 0,
      drafts: 0,
    };
    if (c.created_at >= since) byVenture[c.venture]!.new_companies++;
    if (c.stage === 'qualified') byVenture[c.venture]!.qualified++;
    if (c.stage === 'nurturing') byVenture[c.venture]!.nurturing++;
    if (c.stage === 'meeting_booked') byVenture[c.venture]!.meeting_booked++;
  }
  for (const d of draftRows) {
    byVenture[d.companies.venture] ??= {
      new_companies: 0,
      qualified: 0,
      nurturing: 0,
      meeting_booked: 0,
      drafts: 0,
    };
    byVenture[d.companies.venture]!.drafts++;
  }

  return {
    window_hours: hours,
    generated_at: new Date().toISOString(),
    venture_filter: ventureFilter,
    new_companies: newCount ?? 0,
    drafts_pending: draftRows.length,
    messages_sent: sentCount ?? 0,
    meetings_booked: meetingsCount ?? 0,
    replies: repliesCount ?? 0,
    nurture_today: nurtureCount,
    qualified_without_contact: qualifiedCount ?? 0,
    by_venture: byVenture,
  };
}

function printSummary(s: Summary): void {
  console.log(
    `\nDaily review  (ventana: ${s.window_hours}h${s.venture_filter ? ` · venture=${s.venture_filter}` : ''})`,
  );
  console.log('='.repeat(60));

  console.log(`En las ultimas ${s.window_hours}h:`);
  console.log(`  Nuevas companies:     ${s.new_companies}`);
  console.log(`  Mensajes enviados:    ${s.messages_sent}`);
  console.log(`  Meetings booked:      ${s.meetings_booked}`);
  console.log(`  Replies:              ${s.replies}`);

  console.log('\nAccion pendiente:');
  console.log(`  Drafts por aprobar:   ${s.drafts_pending}`);
  console.log(`  Nurture hoy:          ${s.nurture_today}`);
  console.log(`  Qualified vigentes:   ${s.qualified_without_contact}`);

  console.log('\nBreakdown por venture:');
  const headers = ['venture', 'new', 'qualified', 'nurturing', 'booked', 'drafts'];
  console.log(
    headers
      .map((h, i) => (i === 0 ? h.padEnd(16) : h.padStart(11)))
      .join(''),
  );
  console.log('-'.repeat(60));
  for (const [v, b] of Object.entries(s.by_venture).sort(([a], [c]) => a.localeCompare(c))) {
    console.log(
      v.padEnd(16) +
        String(b.new_companies).padStart(11) +
        String(b.qualified).padStart(11) +
        String(b.nurturing).padStart(11) +
        String(b.meeting_booked).padStart(11) +
        String(b.drafts).padStart(11),
    );
  }
}
