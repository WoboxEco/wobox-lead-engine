import { createAdminClient } from '@wobox/core';
import { Check, Mail, Pencil, Send, Trash2, User } from 'lucide-react';
import {
  approveDraft,
  discardDraft,
  saveEditAndApprove,
  sendDraft,
  updateContactEmail,
} from './actions';

export const dynamic = 'force-dynamic';

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

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
      'id, subject, body, original_body, approach_type, channel, sequence_step, created_at, prompt_version, status, contact_id, contacts(id, name, role, email, warm_path), companies(name, venture, buyer_persona)',
    )
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return <p className="text-muted">Error: {error.message}</p>;
  }

  type Row = DraftRow;
  let rows = (data as unknown as Row[]) ?? [];
  if (venture) rows = rows.filter((r) => r.companies?.venture === venture);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1">Mensajes</p>
        <h1 className="text-3xl font-semibold tracking-tight">Drafts</h1>
        <p className="text-muted mt-1.5 text-[13.5px]">
          {rows.length} mensajes · {statuses.join(' / ')}
          {venture ? ` · ${VENTURE_LABELS[venture] ?? venture}` : ''}
        </p>
      </div>

      <form method="get" className="surface p-4 flex items-center gap-3 flex-wrap">
        <select
          name="venture"
          defaultValue={venture ?? ''}
          className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px]"
        >
          <option value="">Todas las ventures</option>
          <option value="wobox_food">Wobox Food</option>
          <option value="wobox_fashion">Wobox Fashion</option>
          <option value="loop">Loop</option>
        </select>
        <label className="text-[13px] text-muted-strong flex items-center gap-2">
          <input
            type="checkbox"
            name="include"
            value="approved"
            defaultChecked={includeApproved}
            className="accent-[var(--accent)]"
          />
          Incluir approved
        </label>
        <button
          type="submit"
          className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-muted">Sin drafts pendientes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <DraftCard key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ row }: { row: DraftRow }) {
  const edited = row.body !== row.original_body;
  const isEmail = row.channel === 'email';
  const toEmail = (row.contacts?.email ?? '').trim();
  const missingEmail = isEmail && !toEmail;
  return (
    <article className="surface p-5 hover:border-[var(--border-strong)] transition-colors">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold tracking-tight">
              {row.companies?.name ?? '—'}
            </h3>
            <span className="text-[11.5px] text-muted">
              {row.companies?.venture
                ? (VENTURE_LABELS[row.companies.venture] ?? row.companies.venture)
                : ''}
              {row.companies?.buyer_persona ? ` · ${row.companies.buyer_persona}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted mt-1">
            <User size={12} />
            {row.contacts?.name ?? '—'}
            {row.contacts?.role ? <span> · {row.contacts.role}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          <span className={`pill ${row.status === 'approved' ? 'stage-qualified' : 'stage-new'}`}>
            {row.status}
          </span>
          <span className="pill stage-enriched">{row.approach_type}</span>
          <span className="pill stage-nurturing">{row.channel}</span>
          {row.sequence_step ? (
            <span className="text-[11px] text-muted mono">step {row.sequence_step}</span>
          ) : null}
          {edited ? (
            <span className="text-[11px] text-[oklch(0.78_0.16_75)] mono">editado</span>
          ) : null}
          <span className="text-[11px] text-muted mono">{ageLabel(row.created_at)}</span>
        </div>
      </header>

      {isEmail ? (
        <form
          action={updateContactEmail}
          className="mt-4 flex items-center gap-2 flex-wrap text-[13px]"
        >
          <input type="hidden" name="contactId" value={row.contacts?.id ?? row.contact_id} />
          <label
            htmlFor={`to-${row.id}`}
            className="text-muted text-[11px] uppercase tracking-[0.08em]"
          >
            Para:
          </label>
          <input
            id={`to-${row.id}`}
            type="email"
            name="email"
            required
            defaultValue={toEmail}
            placeholder="email@empresa.com"
            className={`${inputCls} w-auto min-w-[260px] py-1`}
          />
          <button type="submit" className={btnSecondary}>
            <Mail size={14} /> Guardar email
          </button>
        </form>
      ) : null}

      {row.subject ? (
        <div className="mt-4 text-[13px] font-medium text-muted-strong">
          <span className="text-muted text-[11px] uppercase tracking-[0.08em] mr-2">Subject</span>
          {row.subject}
        </div>
      ) : null}

      <div className="mt-3 text-[13.5px] leading-relaxed text-muted-strong whitespace-pre-wrap max-w-3xl">
        {row.body}
      </div>

      <footer className="mt-5 flex items-center gap-2 flex-wrap">
        {row.status === 'draft' ? (
          <form action={approveDraft}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className={btnPrimary}>
              <Check size={14} /> Aprobar
            </button>
          </form>
        ) : null}

        <form action={sendDraft}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            disabled={missingEmail}
            title={missingEmail ? 'Cargá el email en "Para:" para poder enviar' : undefined}
            className={`${btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Send size={14} />{' '}
            {missingEmail ? 'Falta email' : isEmail ? 'Enviar' : 'Marcar enviado'}
          </button>
        </form>

        <form action={discardDraft}>
          <input type="hidden" name="id" value={row.id} />
          <button type="submit" className={btnDanger}>
            <Trash2 size={14} /> Descartar
          </button>
        </form>

        <details className="basis-full mt-1">
          <summary className="cursor-pointer text-[12.5px] text-muted hover:text-[var(--foreground)] inline-flex items-center gap-1.5 transition-colors select-none">
            <Pencil size={12} /> Editar
          </summary>
          <form action={saveEditAndApprove} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={row.id} />
            {row.channel === 'email' ? (
              <input
                name="subject"
                defaultValue={row.subject ?? ''}
                placeholder="Subject"
                className={inputCls}
              />
            ) : null}
            <textarea
              name="body"
              defaultValue={row.body}
              rows={7}
              className={`${inputCls} font-sans resize-y`}
            />
            <button type="submit" className={btnPrimary}>
              <Check size={14} /> Guardar y aprobar
            </button>
          </form>
        </details>
      </footer>
    </article>
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
  contact_id: string;
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    warm_path: string | null;
  } | null;
  companies: { name: string; venture: string; buyer_persona: string | null } | null;
};

const btnPrimary =
  'inline-flex items-center gap-1.5 bg-accent text-[var(--accent-foreground)] px-3.5 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity';
const btnSecondary =
  'inline-flex items-center gap-1.5 bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] px-3.5 py-1.5 rounded-md text-[13px] font-medium hover:border-[var(--border-strong)] transition-colors';
const btnDanger =
  'inline-flex items-center gap-1.5 bg-transparent border border-[var(--border)] text-muted px-3.5 py-1.5 rounded-md text-[13px] font-medium hover:border-[oklch(0.55_0.18_25)] hover:text-[oklch(0.75_0.18_25)] transition-colors';
const inputCls =
  'w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--border-strong)]';

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
