import { createAdminClient } from '@wobox/core';
import { createCampaign, setCampaignStatus } from './actions';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const db = createAdminClient();

  const { data: campaigns, error } = await db
    .from('campaigns')
    .select('id, name, venture, status, vertical_focus, region_focus, started_at, ended_at')
    .order('started_at', { ascending: false });

  if (error) {
    return (
      <>
        <h1>Campaigns</h1>
        <p className="subtitle">Error: {error.message}</p>
      </>
    );
  }

  type Campaign = {
    id: string;
    name: string;
    venture: string;
    status: string;
    vertical_focus: string | null;
    region_focus: string | null;
    started_at: string;
    ended_at: string | null;
  };

  const rows = (campaigns as unknown as Campaign[]) ?? [];

  // Counts de companies por campaign (1 query bulk)
  const { data: companies } = await db
    .from('companies')
    .select('campaign_id, stage')
    .not('campaign_id', 'is', null);

  const companyRows =
    (companies as unknown as Array<{ campaign_id: string; stage: string }>) ?? [];
  const countsByCampaign = new Map<string, { total: number; qualified: number; booked: number }>();
  for (const c of companyRows) {
    const entry = countsByCampaign.get(c.campaign_id) ?? {
      total: 0,
      qualified: 0,
      booked: 0,
    };
    entry.total++;
    if (c.stage === 'qualified') entry.qualified++;
    if (c.stage === 'meeting_booked') entry.booked++;
    countsByCampaign.set(c.campaign_id, entry);
  }

  return (
    <>
      <h1>Campaigns</h1>
      <p className="subtitle">{rows.length} campaigns en total</p>

      <h2>Crear campaign</h2>
      <form
        action={createCampaign}
        className="card"
        style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', padding: 16 }}
      >
        <input
          name="name"
          required
          placeholder="Nombre (ej: Q2 Gastro Palermo)"
          style={inputStyle}
        />
        <select name="venture" required defaultValue="loop" style={inputStyle}>
          <option value="loop">loop</option>
          <option value="wobox_food">wobox_food</option>
          <option value="wobox_fashion">wobox_fashion</option>
        </select>
        <input
          name="vertical_focus"
          placeholder="Vertical focus (ej: cafeteria)"
          style={inputStyle}
        />
        <input
          name="region_focus"
          placeholder="Region focus (ej: Palermo Soho)"
          style={inputStyle}
        />
        <textarea
          name="approach_strategy"
          placeholder="Estrategia (opcional)"
          rows={2}
          style={{ ...inputStyle, gridColumn: 'span 2', fontFamily: 'inherit' }}
        />
        <div style={{ gridColumn: 'span 2' }}>
          <button type="submit" style={btnStyle('#036')}>
            Crear
          </button>
        </div>
      </form>

      <h2>Lista</h2>
      {rows.length === 0 ? (
        <p className="empty">Sin campaigns</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Venture</th>
              <th>Status</th>
              <th>Focus</th>
              <th>Companies</th>
              <th>Iniciada</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const counts = countsByCampaign.get(c.id) ?? { total: 0, qualified: 0, booked: 0 };
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{c.venture}</td>
                  <td>
                    <span
                      className={`pill ${c.status === 'active' ? 'stage-qualified' : c.status === 'paused' ? 'stage-nurturing' : 'stage-discarded'}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {c.vertical_focus ?? '-'}
                    {c.region_focus ? ` · ${c.region_focus}` : ''}
                  </td>
                  <td>
                    {counts.total} <span style={{ color: '#888' }}>({counts.qualified} qual · {counts.booked} booked)</span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {c.started_at.slice(0, 10)}
                    {c.ended_at ? <><br />→ {c.ended_at.slice(0, 10)}</> : null}
                  </td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    {c.status !== 'active' ? (
                      <form action={setCampaignStatus}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value="active" />
                        <button type="submit" style={btnStyle('#0a0')}>
                          Activar
                        </button>
                      </form>
                    ) : (
                      <form action={setCampaignStatus}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value="paused" />
                        <button type="submit" style={btnStyle('#a60')}>
                          Pausar
                        </button>
                      </form>
                    )}
                    {c.status !== 'completed' ? (
                      <form action={setCampaignStatus}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value="completed" />
                        <button type="submit" style={btnStyle('#666')}>
                          Cerrar
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
};

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
