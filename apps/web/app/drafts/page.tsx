import { createAdminClient } from '@wobox/core';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DraftsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture);

  const db = createAdminClient();

  const { data, error } = await db
    .from('messages')
    .select(
      'id, subject, body, original_body, approach_type, channel, sequence_step, created_at, prompt_version, status, contacts(name, role, warm_path), companies(name, venture, buyer_persona)',
    )
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return <p className="subtitle">Error: {error.message}</p>;
  }

  type Row = {
    id: string;
    subject: string | null;
    body: string;
    original_body: string;
    approach_type: string;
    channel: string;
    sequence_step: number | null;
    created_at: string;
    prompt_version: string;
    status: string;
    contacts: { name: string; role: string | null; warm_path: string | null } | null;
    companies: { name: string; venture: string; buyer_persona: string | null } | null;
  };

  let rows = (data as unknown as Row[]) ?? [];
  if (venture) rows = rows.filter((r) => r.companies?.venture === venture);

  return (
    <>
      <h1>Drafts pendientes</h1>
      <p className="subtitle">
        {rows.length} drafts en status=draft{venture ? ` · venture=${venture}` : ''}
      </p>

      <form method="get" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <select name="venture" defaultValue={venture ?? ''}>
          <option value="">— todas las ventures —</option>
          <option value="wobox_food">wobox_food</option>
          <option value="wobox_fashion">wobox_fashion</option>
          <option value="loop">loop</option>
        </select>
        <button type="submit">Filtrar</button>
      </form>

      {rows.length === 0 ? (
        <p className="empty">Sin drafts pendientes</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Contact</th>
              <th>Approach</th>
              <th>Channel</th>
              <th>Body</th>
              <th>Edad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.companies?.name ?? '-'}
                  <br />
                  <span className="mono" style={{ color: '#888' }}>
                    {r.companies?.venture}
                    {r.companies?.buyer_persona ? ` · ${r.companies.buyer_persona}` : ''}
                  </span>
                </td>
                <td>
                  {r.contacts?.name ?? '-'}
                  {r.contacts?.role ? <><br /><span style={{ color: '#888' }}>{r.contacts.role}</span></> : null}
                </td>
                <td>
                  <span className="pill">{r.approach_type}</span>
                  {r.sequence_step ? <><br /><span className="mono">step {r.sequence_step}</span></> : null}
                </td>
                <td>{r.channel}</td>
                <td>
                  {r.subject ? (
                    <>
                      <strong>{r.subject}</strong>
                      <br />
                    </>
                  ) : null}
                  <div className="draft-body">{r.body}</div>
                </td>
                <td className="mono">{ageLabel(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="subtitle" style={{ marginTop: 24 }}>
        Aprobar via CLI:{' '}
        <code className="mono">pnpm skill approve-message --id=&lt;uuid&gt; --action=approve</code>
      </p>
    </>
  );
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
