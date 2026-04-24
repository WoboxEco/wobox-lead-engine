import { createAdminClient } from '@wobox/core';
import { approveDraft, discardDraft, sendDraft } from '../drafts/actions';

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
        <code className="mono">nurture_today</code> (drafts pendientes de aprobar/enviar)
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
                  <th>Status</th>
                  <th>Acciones</th>
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
                    <td>
                      <span className={`pill stage-${r.status === 'approved' ? 'nurturing' : 'new'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      {r.status === 'draft' ? (
                        <form action={approveDraft}>
                          <input type="hidden" name="id" value={r.message_id} />
                          <button type="submit" style={btnStyle('#0a0')}>
                            Aprobar
                          </button>
                        </form>
                      ) : null}
                      <form action={sendDraft}>
                        <input type="hidden" name="id" value={r.message_id} />
                        <button type="submit" style={btnStyle('#036')}>
                          Enviado
                        </button>
                      </form>
                      <form action={discardDraft}>
                        <input type="hidden" name="id" value={r.message_id} />
                        <button type="submit" style={btnStyle('#900')}>
                          Descartar
                        </button>
                      </form>
                    </td>
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

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px',
    background: color,
    color: 'white',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  };
}
