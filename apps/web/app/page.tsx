import { createAdminClient } from '@wobox/core';

export const dynamic = 'force-dynamic';

const STAGES_ORDER = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
] as const;

export default async function HomePage() {
  const db = createAdminClient();
  const { data, error } = await db.from('companies').select('stage, venture');

  if (error) {
    return (
      <>
        <h1>Wobox Lead Engine</h1>
        <p className="subtitle">Error cargando pipeline: {error.message}</p>
      </>
    );
  }

  const rows = (data as unknown as Array<{ stage: string; venture: string }>) ?? [];
  const byStage = new Map<string, number>();
  const byVenture = new Map<string, number>();
  for (const r of rows) {
    byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1);
    byVenture.set(r.venture, (byVenture.get(r.venture) ?? 0) + 1);
  }

  return (
    <>
      <h1>Wobox Lead Engine</h1>
      <p className="subtitle">Pipeline total: {rows.length} companies</p>

      <h2>Por stage</h2>
      <div className="grid">
        {STAGES_ORDER.map((s) => (
          <div key={s} className="card">
            <p className="label">{s.replace('_', ' ')}</p>
            <p className="value">{byStage.get(s) ?? 0}</p>
          </div>
        ))}
      </div>

      <h2>Por venture</h2>
      <div className="grid">
        {[...byVenture.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([v, n]) => (
            <div key={v} className="card">
              <p className="label">{v}</p>
              <p className="value">{n}</p>
            </div>
          ))}
      </div>

      <p className="subtitle">
        Operar desde CLI: <code className="mono">pnpm skill &lt;nombre&gt;</code>
      </p>
    </>
  );
}
