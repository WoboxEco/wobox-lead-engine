import { createAdminClient } from '@wobox/core';

export const dynamic = 'force-dynamic';

export default async function NurturePage() {
  const db = createAdminClient();

  const { data, error } = await db.from('nurture_today').select('*');

  if (error) {
    return (
      <>
        <h1>Nurture hoy</h1>
        <p className="subtitle">Error cargando vista: {error.message}</p>
      </>
    );
  }

  type Row = {
    message_id: string;
    company_id: string;
    contact_id: string;
    sequence_step: number | null;
    approach_type: string;
    channel: string;
    assigned_to: string | null;
    company_name: string;
    venture: string;
    buyer_persona: string | null;
    status: string;
  };

  const rows = (data as unknown as Row[]) ?? [];
  const byFounder = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.assigned_to ?? 'sin-asignar';
    const arr = byFounder.get(key) ?? [];
    arr.push(r);
    byFounder.set(key, arr);
  }

  return (
    <>
      <h1>Nurture hoy</h1>
      <p className="subtitle">
        {rows.length} touchpoints · vista{' '}
        <code className="mono">nurture_today</code> (drafts de nurture pendientes)
      </p>

      {rows.length === 0 ? (
        <p className="empty">Nada que nurturear hoy</p>
      ) : (
        [...byFounder.entries()].map(([founder, items]) => (
          <div key={founder} style={{ marginBottom: 32 }}>
            <h2>Founder: {founder}</h2>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Venture / BP</th>
                  <th>Step</th>
                  <th>Approach</th>
                  <th>Channel</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.message_id}>
                    <td>{r.company_name}</td>
                    <td>
                      {r.venture}
                      {r.buyer_persona ? ` · ${r.buyer_persona}` : ''}
                    </td>
                    <td className="mono">{r.sequence_step ?? '-'}</td>
                    <td>
                      <span className="pill">{r.approach_type}</span>
                    </td>
                    <td>{r.channel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </>
  );
}
