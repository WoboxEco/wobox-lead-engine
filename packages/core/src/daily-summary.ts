import { countRows } from './counts.js';
import type { DbClient } from './db.js';
import { VENTURES } from './domain.js';

export interface DailySummary {
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

export function parsePeriod(raw: string): number {
  const m = raw.match(/^(\d+)([hdw])$/);
  if (!m) throw new Error(`--period invalido: ${raw} (usa 1d | 24h | 7d | 1w)`);
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === 'h') return n;
  if (unit === 'd') return n * 24;
  if (unit === 'w') return n * 24 * 7;
  return 24;
}

export async function buildDailySummary(
  db: DbClient,
  hours: number,
  ventureFilter: string | null,
): Promise<DailySummary> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  // Todo se cuenta con head-count queries ({ count: 'exact', head: true }) en paralelo.
  // No traer filas para contar: Supabase corta los selects en 1000 filas (ver counts.ts).
  const companies = (venture: string | null) => {
    const q = db.from('companies').select('id', { count: 'exact', head: true });
    return venture ? q.eq('venture', venture) : q;
  };
  const messages = (venture: string | null) => {
    const q = db
      .from('messages')
      .select('id, companies!inner(venture)', { count: 'exact', head: true });
    return venture ? q.eq('companies.venture', venture) : q;
  };
  const interactions = (venture: string | null) => {
    const q = db
      .from('interactions')
      .select('id, companies!inner(venture)', { count: 'exact', head: true });
    return venture ? q.eq('companies.venture', venture) : q;
  };
  const nurture = (venture: string | null) => {
    const q = db.from('nurture_today').select('venture', { count: 'exact', head: true });
    return venture ? q.eq('venture', venture) : q;
  };

  const v = ventureFilter;
  const [
    newCount,
    draftsCount,
    sentCount,
    meetingsCount,
    repliesCount,
    nurtureCount,
    qualifiedCount,
    perVenture,
  ] = await Promise.all([
    countRows(companies(v).gte('created_at', since)),
    countRows(messages(v).eq('status', 'draft')),
    countRows(messages(v).eq('status', 'sent').gte('sent_at', since)),
    countRows(interactions(v).eq('type', 'meeting').gte('performed_at', since)),
    countRows(interactions(v).eq('outcome', 'replied').gte('performed_at', since)),
    countRows(nurture(v)),
    countRows(companies(v).eq('stage', 'qualified')),
    Promise.all(
      VENTURES.map((venture) =>
        Promise.all([
          countRows(companies(venture).gte('created_at', since)),
          countRows(companies(venture).eq('stage', 'qualified')),
          countRows(companies(venture).eq('stage', 'nurturing')),
          countRows(companies(venture).eq('stage', 'meeting_booked')),
          countRows(messages(venture).eq('status', 'draft')),
        ]),
      ),
    ),
  ]);

  const byVenture: DailySummary['by_venture'] = {};
  VENTURES.forEach((venture, i) => {
    const [newC, qualified, nurturing, meeting_booked, drafts] = perVenture[i] ?? [0, 0, 0, 0, 0];
    byVenture[venture] = { new_companies: newC, qualified, nurturing, meeting_booked, drafts };
  });

  return {
    window_hours: hours,
    generated_at: new Date().toISOString(),
    venture_filter: ventureFilter,
    new_companies: newCount,
    drafts_pending: draftsCount,
    messages_sent: sentCount,
    meetings_booked: meetingsCount,
    replies: repliesCount,
    nurture_today: nurtureCount,
    qualified_without_contact: qualifiedCount,
    by_venture: byVenture,
  };
}
