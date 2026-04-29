import { buildDailySummary, createAdminClient, parsePeriod } from '@wobox/core';

export const dynamic = 'force-dynamic';

const VALID_PERIODS = new Set(['1d', '7d', '30d']);

export default async function DailyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; venture?: string }>;
}) {
  const { period: rawPeriod, venture: rawVenture } = await searchParams;
  const period = rawPeriod && VALID_PERIODS.has(rawPeriod) ? rawPeriod : '1d';
  const venture = rawVenture ?? null;

  const db = createAdminClient();
  const hours = parsePeriod(period);
  const summary = await buildDailySummary(db, hours, venture);

  const ventureRows = Object.entries(summary.by_venture).sort(([a], [b]) => a.localeCompare(b));
  const generatedAt = new Date(summary.generated_at).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  return (
    <>
      <h1>Daily review</h1>
      <p className="subtitle">
        Ventana: {summary.window_hours}h
        {summary.venture_filter ? ` · venture=${summary.venture_filter}` : ' · todos los ventures'}
        {' · '}
        actualizado {generatedAt}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
        <PeriodLink current={period} value="1d" venture={venture} label="ultimas 24h" />
        <PeriodLink current={period} value="7d" venture={venture} label="ultimos 7d" />
        <PeriodLink current={period} value="30d" venture={venture} label="ultimos 30d" />
      </div>

      <h2>En las ultimas {summary.window_hours}h</h2>
      <div className="grid">
        <Stat label="nuevas companies" value={summary.new_companies} />
        <Stat label="mensajes enviados" value={summary.messages_sent} />
        <Stat label="meetings booked" value={summary.meetings_booked} />
        <Stat label="replies" value={summary.replies} />
      </div>

      <h2>Accion pendiente</h2>
      <div className="grid">
        <Stat label="drafts por aprobar" value={summary.drafts_pending} />
        <Stat label="nurture hoy" value={summary.nurture_today} />
        <Stat label="qualified vigentes" value={summary.qualified_without_contact} />
      </div>

      <h2>Breakdown por venture</h2>
      {ventureRows.length === 0 ? (
        <p className="subtitle">Sin datos.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.5rem' }}>venture</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>new</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>qualified</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>nurturing</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>booked</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>drafts</th>
            </tr>
          </thead>
          <tbody>
            {ventureRows.map(([v, b]) => (
              <tr key={v} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.5rem' }}>{v}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{b.new_companies}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{b.qualified}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{b.nurturing}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{b.meeting_booked}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{b.drafts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className="value">{value}</p>
    </div>
  );
}

function PeriodLink({
  current,
  value,
  venture,
  label,
}: {
  current: string;
  value: string;
  venture: string | null;
  label: string;
}) {
  const params = new URLSearchParams();
  params.set('period', value);
  if (venture) params.set('venture', venture);
  const isActive = current === value;
  return (
    <a
      href={`/daily-review?${params.toString()}`}
      style={{
        padding: '0.35rem 0.75rem',
        border: '1px solid #ccc',
        borderRadius: 4,
        textDecoration: 'none',
        background: isActive ? '#222' : 'white',
        color: isActive ? 'white' : 'inherit',
        fontSize: '0.85rem',
      }}
    >
      {label}
    </a>
  );
}
