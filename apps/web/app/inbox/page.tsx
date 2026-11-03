import { createAdminClient } from '@wobox/core';
import { CalendarCheck, Check, Clock, Inbox, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { replyDiscard, replyMarkHandled, replyMeetingBooked, replyNurtureLater } from './actions';

export const dynamic = 'force-dynamic';

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

const INTENT_LABELS: Record<string, { label: string; cls: string }> = {
  interested: { label: 'Interesado', cls: 'stage-meeting_booked' },
  question: { label: 'Pregunta', cls: 'stage-qualified' },
  not_now: { label: 'Ahora no', cls: 'stage-nurturing' },
  not_interested: { label: 'No interesado', cls: 'stage-discarded' },
  out_of_office: { label: 'Fuera de oficina', cls: 'stage-new' },
  other: { label: 'Otro', cls: 'stage-new' },
};

const ACTION_LABELS: Record<string, string> = {
  agendar_calendly: 'Mandarle el link de Calendly / proponer horario',
  responder_pregunta: 'Responder la pregunta a mano',
  nurture_3_meses: 'Pausar y volver a contactar en 3 meses',
  descartar: 'Descartar, no contactar mas',
  reprogramar: 'Retomar la secuencia cuando vuelva',
};

type ReplyRow = {
  id: string;
  company_id: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
  intent: string | null;
  suggested_action: string | null;
  ai_reasoning: string | null;
  companies: { name: string; venture: string; stage: string } | null;
  contacts: { name: string; role: string | null } | null;
};

export default async function InboxPage() {
  const db = createAdminClient();
  const { data, error } = await db
    .from('replies')
    .select(
      'id, company_id, from_email, subject, body, received_at, intent, suggested_action, ai_reasoning, companies(name, venture, stage), contacts(name, role)',
    )
    .eq('handled', false)
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-muted mt-2">Error: {error.message}</p>
      </div>
    );
  }

  const rows = (data as unknown as ReplyRow[]) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1 flex items-center gap-1.5">
          <Inbox size={12} className="text-accent" />
          Inbox
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {rows.length} {rows.length === 1 ? 'respuesta' : 'respuestas'} sin manejar
        </h1>
        <p className="text-muted mt-1.5 text-[13.5px]">
          Respuestas detectadas por el cron diario. La secuencia de esas companies queda pausada.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-muted">No hay respuestas pendientes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const intent = r.intent ? INTENT_LABELS[r.intent] : null;
            return (
              <article key={r.id} className="surface p-5 space-y-3">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold tracking-tight">
                      <Link
                        href={`/crm/${r.company_id}`}
                        className="hover:underline underline-offset-2"
                      >
                        {r.companies?.name ?? 'Company'}
                      </Link>
                      <span className="text-muted font-normal text-[12px] ml-2">
                        {VENTURE_LABELS[r.companies?.venture ?? ''] ?? r.companies?.venture}
                        {r.companies?.stage ? ` · ${r.companies.stage}` : ''}
                      </span>
                    </p>
                    <p className="text-[12px] text-muted-strong mt-0.5">
                      {r.contacts?.name ?? r.from_email}
                      {r.contacts?.role ? ` · ${r.contacts.role}` : ''}
                      <span className="text-muted mono ml-2">{r.from_email}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`pill ${intent?.cls ?? 'stage-new'}`}>
                      {intent?.label ?? 'Sin clasificar'}
                    </span>
                    <span className="text-[11.5px] text-muted mono">
                      {r.received_at.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                </header>

                {r.subject ? <p className="text-[13px] font-medium">{r.subject}</p> : null}
                <p className="text-[13px] whitespace-pre-wrap text-muted-strong leading-relaxed max-h-60 overflow-y-auto">
                  {r.body || '(sin cuerpo)'}
                </p>

                {r.suggested_action || r.ai_reasoning ? (
                  <div className="rounded-md bg-[var(--surface-elevated)] border border-[var(--border)] px-3 py-2 text-[12.5px]">
                    {r.suggested_action ? (
                      <p>
                        <span className="text-muted">Sugerencia: </span>
                        <span className="font-medium">
                          {ACTION_LABELS[r.suggested_action] ?? r.suggested_action}
                        </span>
                      </p>
                    ) : null}
                    {r.ai_reasoning ? <p className="text-muted mt-0.5">{r.ai_reasoning}</p> : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <form action={replyMeetingBooked}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={btnPrimary}>
                      <CalendarCheck size={12} /> Agendé reunión
                    </button>
                  </form>
                  <form action={replyNurtureLater}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={btnSmall}>
                      <Clock size={12} /> Nurture 3 meses
                    </button>
                  </form>
                  <form action={replyDiscard}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={btnSmall}>
                      <Trash2 size={12} /> Descartar
                    </button>
                  </form>
                  <form action={replyMarkHandled}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={btnSmall}>
                      <Check size={12} /> Marcar manejado
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

const btnPrimary =
  'inline-flex items-center gap-1.5 bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[12px] font-medium hover:opacity-90 transition-opacity';

const btnSmall =
  'inline-flex items-center gap-1.5 bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] px-3 py-1.5 rounded-md text-[12px] font-medium hover:border-[var(--border-strong)] transition-colors';
