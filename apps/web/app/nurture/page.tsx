import { createAdminClient, fetchAllRows } from '@wobox/core';
import { CalendarClock, Check, Send, Trash2 } from 'lucide-react';
import { approveDraft, discardDraft, markSentDraft } from '../drafts/actions';

export const dynamic = 'force-dynamic';

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

export default async function NurturePage() {
  const db = createAdminClient();

  // Paginado con .range(): un select plano se corta en 1000 filas.
  let data: unknown[] = [];
  let error: { message: string } | null = null;
  try {
    data = await fetchAllRows((from, to) =>
      db.from('nurture_today').select('*').order('message_id').range(from, to),
    );
  } catch (err) {
    error = { message: (err as Error).message };
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Nurture hoy</h1>
        <p className="text-muted mt-2">Error cargando vista: {error.message}</p>
      </div>
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
    <div className="space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1 flex items-center gap-1.5">
          <CalendarClock size={12} className="text-accent" />
          Nurture hoy
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{rows.length} touchpoints</h1>
        <p className="text-muted mt-1.5 text-[13.5px]">
          Drafts pendientes de aprobar o enviar (vista <code className="mono">nurture_today</code>)
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-muted">Nada para nurturear hoy.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {[...byFounder.entries()].map(([founder, items]) => (
            <section key={founder}>
              <header className="flex items-baseline gap-2 mb-3">
                <h2 className="text-[15px] font-semibold tracking-tight">Founder: {founder}</h2>
                <span className="text-[12px] text-muted">{items.length} touchpoints</span>
              </header>
              <div className="surface overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted border-b border-[var(--border)]">
                        <th className="py-3 px-4">Company</th>
                        <th className="py-3 px-4">Venture · BP</th>
                        <th className="py-3 px-4 text-center">Step</th>
                        <th className="py-3 px-4">Approach</th>
                        <th className="py-3 px-4">Channel</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr
                          key={r.message_id}
                          className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-elevated)] transition-colors"
                        >
                          <td className="py-3 px-4 font-medium">{r.company_name}</td>
                          <td className="py-3 px-4 text-muted-strong">
                            {VENTURE_LABELS[r.venture] ?? r.venture}
                            {r.buyer_persona ? (
                              <span className="text-muted"> · {r.buyer_persona}</span>
                            ) : null}
                          </td>
                          <td className="py-3 px-4 text-center mono tabular-nums">
                            {r.sequence_step ?? '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="pill stage-enriched">{r.approach_type}</span>
                          </td>
                          <td className="py-3 px-4 text-muted-strong">{r.channel}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`pill ${
                                r.status === 'approved' ? 'stage-qualified' : 'stage-new'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {r.status === 'draft' ? (
                                <form action={approveDraft}>
                                  <input type="hidden" name="id" value={r.message_id} />
                                  <button type="submit" className={btnPrimary}>
                                    <Check size={12} /> Aprobar
                                  </button>
                                </form>
                              ) : null}
                              {r.channel === 'email' ? (
                                <a
                                  href="/drafts"
                                  title="Los emails se envían desde /drafts confirmando el destinatario"
                                  className={btnSecondary}
                                >
                                  <Send size={12} /> Enviar en Drafts
                                </a>
                              ) : (
                                <form action={markSentDraft}>
                                  <input type="hidden" name="id" value={r.message_id} />
                                  <button type="submit" className={btnSecondary}>
                                    <Send size={12} /> Enviado
                                  </button>
                                </form>
                              )}
                              <form action={discardDraft}>
                                <input type="hidden" name="id" value={r.message_id} />
                                <button type="submit" className={btnDanger}>
                                  <Trash2 size={12} />
                                </button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const btnPrimary =
  'inline-flex items-center gap-1 bg-accent text-[var(--accent-foreground)] px-2.5 py-1 rounded text-[11.5px] font-medium hover:opacity-90 transition-opacity';
const btnSecondary =
  'inline-flex items-center gap-1 bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] px-2.5 py-1 rounded text-[11.5px] font-medium hover:border-[var(--border-strong)] transition-colors';
const btnDanger =
  'inline-flex items-center bg-transparent border border-[var(--border)] text-muted px-2 py-1 rounded text-[11.5px] hover:border-[oklch(0.55_0.18_25)] hover:text-[oklch(0.75_0.18_25)] transition-colors';
