import { createAdminClient } from '@wobox/core';
import { approveDraft, discardDraft, saveEditAndApprove, sendDraft } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DraftsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture);
  const includeApproved = params.include === 'approved';

  const db = createAdminClient();

  const statuses = includeApproved ? ['draft', 'approved'] : ['draft'];

  const { data, error } = await db
    .from('messages')
    .select(
      'id, subject, body, original_body, approach_type, channel, sequence_step, created_at, prompt_version, status, contacts(name, role, warm_path), companies(name, venture, buyer_persona)',
    )
    .in('status', statuses)
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
      <h1>Drafts</h1>
      <p className="subtitle">
        {rows.length} mensajes · status={statuses.join('/')} {venture ? `· venture=${venture}` : ''}
      </p>

      <form method="get" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <select name="venture" defaultValue={venture ?? ''}>
          <option value="">— todas las ventures —</option>
          <option value="wobox_food">wobox_food</option>
          <option value="wobox_fashion">wobox_fashion</option>
          <option value="loop">loop</option>
        </select>
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            name="include"
            value="approved"
            defaultChecked={includeApproved}
          />{' '}
          Incluir approved
        </label>
        <button type="submit">Filtrar</button>
      </form>

      {rows.length === 0 ? (
        <p className="empty">Sin drafts pendientes</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => (
            <DraftCard key={r.id} row={r} />
          ))}
        </div>
      )}
    </>
  );
}

function DraftCard({ row }: { row: DraftRow }) {
  const edited = row.body !== row.original_body;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{row.companies?.name ?? '—'}</strong>
            <span className="mono" style={{ color: '#888', fontSize: 11 }}>
              {row.companies?.venture}
              {row.companies?.buyer_persona ? ` · ${row.companies.buyer_persona}` : ''}
            </span>
            <span className={`pill stage-${row.status === 'approved' ? 'nurturing' : 'new'}`}>
              {row.status}
            </span>
            <span className="pill">{row.approach_type}</span>
            <span className="pill">{row.channel}</span>
            {row.sequence_step ? <span className="mono">step {row.sequence_step}</span> : null}
            {edited ? <span className="mono" style={{ color: '#a60' }}>(editado)</span> : null}
            <span className="mono" style={{ color: '#aaa', marginLeft: 'auto' }}>
              {ageLabel(row.created_at)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Para: {row.contacts?.name ?? '—'}
            {row.contacts?.role ? ` (${row.contacts.role})` : ''}
          </div>
        </div>
      </div>

      {row.subject ? (
        <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>
          SUBJECT: {row.subject}
        </div>
      ) : null}

      <div className="draft-body" style={{ marginTop: 8, fontSize: 13 }}>
        {row.body}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {row.status === 'draft' ? (
          <form action={approveDraft} style={{ display: 'inline' }}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" style={btnStyle('#0a0')}>
              Aprobar
            </button>
          </form>
        ) : null}

        <form action={sendDraft} style={{ display: 'inline' }}>
          <input type="hidden" name="id" value={row.id} />
          <button type="submit" style={btnStyle('#036')}>
            Marcar enviado
          </button>
        </form>

        <form action={discardDraft} style={{ display: 'inline' }}>
          <input type="hidden" name="id" value={row.id} />
          <button type="submit" style={btnStyle('#900')}>
            Descartar
          </button>
        </form>

        <details style={{ flex: '0 0 100%', marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>Editar</summary>
          <form
            action={saveEditAndApprove}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}
          >
            <input type="hidden" name="id" value={row.id} />
            {row.channel === 'email' ? (
              <input
                name="subject"
                defaultValue={row.subject ?? ''}
                placeholder="Subject"
                style={inputStyle}
              />
            ) : null}
            <textarea
              name="body"
              defaultValue={row.body}
              rows={6}
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div>
              <button type="submit" style={btnStyle('#036')}>
                Guardar y aprobar
              </button>
            </div>
          </form>
        </details>
      </div>
    </div>
  );
}

type DraftRow = {
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

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
};

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    background: color,
    color: 'white',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  };
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
