import { createAdminClient } from '@wobox/core';
import { Check, CheckCircle2, Pencil, RotateCcw, Send, Trash2, User } from 'lucide-react';
import {
  approveDraft,
  discardDraft,
  markSentDraft,
  revertToDraft,
  saveEditAndApprove,
} from './actions';
import { CopyButton } from './copy-button';
import { EmailDraftForm } from './email-draft-form';

export const dynamic = 'force-dynamic';

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  instagram_dm: 'Instagram',
  phone: 'Llamada',
};

const APPROACH_LABELS: Record<string, string> = {
  direct: 'Directo',
  warm_intro: 'Warm intro',
  nurture: 'Nurture',
};

function approachLabel(approach: string, step: number | null): string {
  const label = APPROACH_LABELS[approach] ?? approach;
  return approach === 'nurture' && step ? `${label} · step ${step}` : label;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DRAFT_SELECT =
  'id, subject, body, original_body, approach_type, channel, sequence_step, created_at, prompt_version, status, contact_id, contacts(id, name, role, email, warm_path), companies(name, venture, buyer_persona)';

export default async function DraftsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture);
  const tab = params.tab === 'sent' ? 'sent' : 'pending';
  const includeApproved = params.include === 'approved';
  const sentNotice = pickString(params.sent);

  const db = createAdminClient();
  const statuses = tab === 'sent' ? ['sent'] : includeApproved ? ['draft', 'approved'] : ['draft'];

  let data: unknown[] | null = null;
  let errorMessage: string | null = null;
  if (tab === 'sent') {
    // sent_to viene de la migration 0009; si todavía no está aplicada, se reintenta sin la columna
    // y el destinatario se toma de interactions.metadata / contacts.email.
    const withSentTo = await db
      .from('messages')
      .select(`${DRAFT_SELECT}, sent_at, sent_to`)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(100);
    if (withSentTo.error) {
      const fallback = await db
        .from('messages')
        .select(`${DRAFT_SELECT}, sent_at`)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(100);
      data = fallback.data;
      errorMessage = fallback.error?.message ?? null;
    } else {
      data = withSentTo.data;
    }
  } else {
    const res = await db
      .from('messages')
      .select(DRAFT_SELECT)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .limit(100);
    data = res.data;
    errorMessage = res.error?.message ?? null;
  }

  if (errorMessage) {
    return <p className="text-muted">Error: {errorMessage}</p>;
  }

  let rows = (data as unknown as DraftRow[]) ?? [];
  if (venture) rows = rows.filter((r) => r.companies?.venture === venture);

  if (tab === 'sent') {
    const missing = rows.filter((r) => !r.sent_to).map((r) => r.id);
    if (missing.length > 0) {
      const { data: ints } = await db
        .from('interactions')
        .select('metadata')
        .eq('outcome', 'sent')
        .in('metadata->>message_id', missing);
      const byMessage = new Map<string, string>();
      for (const i of (ints as { metadata: { message_id?: string; sent_to?: string } }[]) ?? []) {
        if (i.metadata?.message_id && i.metadata.sent_to) {
          byMessage.set(i.metadata.message_id, i.metadata.sent_to);
        }
      }
      rows = rows.map((r) => (r.sent_to ? r : { ...r, sent_to: byMessage.get(r.id) ?? null }));
    }
  }

  const tabHref = (t: 'pending' | 'sent') => {
    const q = new URLSearchParams();
    if (venture) q.set('venture', venture);
    if (t === 'sent') q.set('tab', 'sent');
    const qs = q.toString();
    return qs ? `/drafts?${qs}` : '/drafts';
  };

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

      {sentNotice ? (
        <div
          aria-live="polite"
          className="surface p-3 flex items-center gap-2 text-[13px] border-[oklch(0.6_0.15_150)]"
        >
          <CheckCircle2 size={16} className="text-[oklch(0.72_0.17_150)]" />
          <span>
            Enviado a <span className="mono font-medium">{sentNotice}</span>
          </span>
          {tab !== 'sent' ? (
            <a href={tabHref('sent')} className="ml-auto text-muted hover:text-[var(--foreground)]">
              Ver en Enviados →
            </a>
          ) : null}
        </div>
      ) : null}

      <nav className="flex items-center gap-1 border-b border-[var(--border)] text-[13px]">
        {(
          [
            ['pending', 'Pendientes'],
            ['sent', 'Enviados'],
          ] as const
        ).map(([t, label]) => (
          <a
            key={t}
            href={tabHref(t)}
            className={`px-3 py-2 -mb-px border-b-2 ${
              tab === t
                ? 'border-[var(--accent)] text-[var(--foreground)] font-medium'
                : 'border-transparent text-muted hover:text-[var(--foreground)]'
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      <form method="get" className="surface p-4 flex items-center gap-3 flex-wrap">
        {tab === 'sent' ? <input type="hidden" name="tab" value="sent" /> : null}
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
        {tab === 'pending' ? (
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
        ) : null}
        <button
          type="submit"
          className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-muted">
            {tab === 'sent' ? 'Sin mensajes enviados.' : 'Sin drafts pendientes.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) =>
            tab === 'sent' ? <SentCard key={r.id} row={r} /> : <DraftCard key={r.id} row={r} />,
          )}
        </div>
      )}
    </div>
  );
}

function CardHeader({ row, right }: { row: DraftRow; right: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-[15px] font-semibold tracking-tight">{row.companies?.name ?? '—'}</h3>
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
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">{right}</div>
    </header>
  );
}

function SentCard({ row }: { row: DraftRow }) {
  const isEmail = row.channel === 'email';
  const recipient = row.sent_to ?? (isEmail ? (row.contacts?.email ?? null) : null);
  return (
    <article className="surface p-5">
      <CardHeader
        row={row}
        right={
          <>
            <span className="pill stage-qualified">sent</span>
            <span className="pill stage-nurturing">
              {CHANNEL_LABELS[row.channel] ?? row.channel}
            </span>
            <span className="pill stage-enriched">
              {approachLabel(row.approach_type, row.sequence_step)}
            </span>
          </>
        }
      />
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        {isEmail ? (
          <>
            <dt className="text-muted text-[11px] uppercase tracking-[0.08em] pt-0.5">Para:</dt>
            <dd className="mono">
              {recipient ?? '—'}
              {!row.sent_to && recipient ? (
                <span className="text-muted text-[11px] ml-2">(email actual del contacto)</span>
              ) : null}
            </dd>
            <dt className="text-muted text-[11px] uppercase tracking-[0.08em] pt-0.5">Asunto:</dt>
            <dd>{row.subject ?? '—'}</dd>
          </>
        ) : null}
        <dt className="text-muted text-[11px] uppercase tracking-[0.08em] pt-0.5">Fecha:</dt>
        <dd className="mono">{row.sent_at ? formatDateTime(row.sent_at) : '—'}</dd>
      </dl>
      <div className="mt-3 text-[13.5px] leading-relaxed text-muted-strong whitespace-pre-wrap max-w-3xl">
        {row.body}
      </div>
      <footer className="mt-5">
        <form action={revertToDraft}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            title="Vuelve a status=draft y borra la interaction de envío (no des-envía el email)"
            className={btnSecondary}
          >
            <RotateCcw size={14} /> Volver a borrador
          </button>
        </form>
      </footer>
    </article>
  );
}

function DraftCard({ row }: { row: DraftRow }) {
  const edited = row.body !== row.original_body;
  const isEmail = row.channel === 'email';
  return (
    <article className="surface p-5 hover:border-[var(--border-strong)] transition-colors">
      <CardHeader
        row={row}
        right={
          <>
            <span className={`pill ${row.status === 'approved' ? 'stage-qualified' : 'stage-new'}`}>
              {row.status}
            </span>
            <span className="pill stage-nurturing">
              {CHANNEL_LABELS[row.channel] ?? row.channel}
            </span>
            <span className="pill stage-enriched">
              {approachLabel(row.approach_type, row.sequence_step)}
            </span>
            {edited ? (
              <span className="text-[11px] text-[oklch(0.78_0.16_75)] mono">editado</span>
            ) : null}
            <span className="text-[11px] text-muted mono">{ageLabel(row.created_at)}</span>
          </>
        }
      />

      {isEmail ? (
        <EmailDraftForm
          id={row.id}
          status={row.status}
          to={(row.contacts?.email ?? '').trim()}
          subject={row.subject ?? ''}
          body={row.body}
          btnPrimary={btnPrimary}
          btnSecondary={btnSecondary}
          btnDanger={btnDanger}
          inputCls={inputCls}
        />
      ) : (
        <>
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

            <CopyButton text={row.body} className={btnSecondary} />
            <form action={markSentDraft}>
              <input type="hidden" name="id" value={row.id} />
              <button
                type="submit"
                title="Mandalo a mano por el canal y después marcalo como enviado"
                className={btnSecondary}
              >
                <Send size={14} /> Marcar enviado
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
        </>
      )}
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
  sent_at?: string | null;
  sent_to?: string | null;
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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
