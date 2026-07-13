import { createAdminClient } from '@wobox/core';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getRole } from '../../../lib/auth/whitelist';
import { getOwnerDirectory } from '../../../lib/owners';
import { changeStage } from '../../pipeline/actions';
import {
  addCoOwner,
  addNote,
  removeCoOwner,
  scheduleHandoff,
  setFirstContactDate,
  setOwner,
  toggleTask,
  updateCompanyDetails,
} from '../actions';

export const dynamic = 'force-dynamic';

const DEAL_STAGES = [
  'deal_sin_contacto',
  'deal_contacto',
  'deal_presentacion',
  'deal_negociacion',
  'deal_onboarding',
  'deal_ganado',
  'deal_perdido',
];

const STAGE_LABELS: Record<string, string> = {
  deal_sin_contacto: 'Sin contacto',
  deal_contacto: 'Contacto',
  deal_presentacion: 'Presentacion',
  deal_negociacion: 'Negociacion',
  deal_onboarding: 'Onboarding',
  deal_ganado: 'Ganado',
  deal_perdido: 'Perdido',
};

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = createAdminClient();

  const [
    { data: company, error },
    { data: coOwnerRows },
    { data: handoffs },
    { data: notes },
    { data: tasks },
    owners,
  ] = await Promise.all([
    db
      .from('companies')
      .select(
        'id, name, venture, stage, deal_value, lost_reason, region, neighborhood, instagram_handle, first_contact_date, website, subsector, assigned_to, contacts(id, name, role, email, phone)',
      )
      .eq('id', id)
      .single(),
    db.from('company_co_owners').select('user_id').eq('company_id', id),
    db
      .from('ownership_handoffs')
      .select('id, from_user_id, to_user_id, effective_date, reason, applied_at, created_at')
      .eq('company_id', id)
      .order('effective_date', { ascending: false }),
    db
      .from('interactions')
      .select('id, content, performed_at, performed_by')
      .eq('company_id', id)
      .eq('type', 'note')
      .order('performed_at', { ascending: false }),
    db
      .from('tasks')
      .select('id, title, due_date, done')
      .eq('company_id', id)
      .order('due_date', { ascending: true }),
    getOwnerDirectory(),
  ]);

  if (error || !company) {
    return <p className="text-muted">Empresa no encontrada.</p>;
  }

  // sales: solo puede ver companies donde es owner o co-owner.
  const headerList = await headers();
  const viewerEmail = headerList.get('x-user-email');
  const role = getRole(viewerEmail);
  if (role === 'sales') {
    const ownId = owners.find(
      (o) => o.email.toLowerCase() === (viewerEmail ?? '').toLowerCase(),
    )?.id;
    const coOwnerIdsCheck = new Set(
      ((coOwnerRows as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id),
    );
    const isOwnerOrCoOwner =
      ownId &&
      ((company as { assigned_to: string | null }).assigned_to === ownId ||
        coOwnerIdsCheck.has(ownId));
    if (!isOwnerOrCoOwner) {
      return <p className="text-muted">Empresa no encontrada.</p>;
    }
  }

  type Company = {
    id: string;
    name: string;
    venture: string;
    stage: string;
    deal_value: number | null;
    lost_reason: string | null;
    region: string | null;
    neighborhood: string | null;
    instagram_handle: string | null;
    first_contact_date: string | null;
    website: string | null;
    subsector: string | null;
    assigned_to: string | null;
    contacts: Array<{
      id: string;
      name: string;
      role: string | null;
      email: string | null;
      phone: string | null;
    }>;
  };
  const c = company as unknown as Company;

  type Note = {
    id: string;
    content: string | null;
    performed_at: string;
    performed_by: string | null;
  };
  const noteRows = (notes as Note[] | null) ?? [];

  type Task = { id: string; title: string; due_date: string | null; done: boolean };
  const taskRows = (tasks as Task[] | null) ?? [];

  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const coOwnerIds = new Set(
    ((coOwnerRows as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id),
  );
  const coOwnerCandidates = owners.filter((o) => o.id !== c.assigned_to && !coOwnerIds.has(o.id));

  type Handoff = {
    id: string;
    from_user_id: string | null;
    to_user_id: string;
    effective_date: string;
    reason: string | null;
    applied_at: string | null;
    created_at: string;
  };
  const handoffRows = (handoffs as Handoff[] | null) ?? [];
  const pendingHandoff = handoffRows.find((h) => !h.applied_at);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href={`/crm?venture=${c.venture}`}
          className="text-muted hover:text-[var(--foreground)] text-[12.5px]"
        >
          ← {VENTURE_LABELS[c.venture] ?? c.venture}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">{c.name}</h1>
        <div className="flex items-center gap-3 mt-2">
          <span className={`pill stage-${c.stage}`}>{STAGE_LABELS[c.stage] ?? c.stage}</span>
          {c.deal_value ? (
            <span className="text-[13px] text-muted-strong">
              ${c.deal_value.toLocaleString('es-AR')}
            </span>
          ) : null}
          {c.region ? (
            <span className="text-[13px] text-muted">
              {c.region}
              {c.neighborhood ? `, ${c.neighborhood}` : ''}
            </span>
          ) : null}
          {c.instagram_handle ? (
            <a
              href={`https://instagram.com/${c.instagram_handle}`}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] text-accent hover:underline"
            >
              instagram.com/{c.instagram_handle}
            </a>
          ) : null}
        </div>
      </div>

      {/* Stage */}
      <div className="surface p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">Stage</p>
        <form action={changeStage} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <select
            name="stage"
            defaultValue={c.stage}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
          >
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded text-[12.5px] font-medium hover:opacity-90 transition-opacity"
          >
            Actualizar
          </button>
        </form>
      </div>

      {/* Detalles: ciudad/barrio/instagram */}
      <div className="surface p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">Detalles</p>
        <form action={updateCompanyDetails} className="grid grid-cols-3 gap-3 items-end">
          <input type="hidden" name="company_id" value={c.id} />
          <label className="block">
            <span className="block text-[11px] text-muted mb-1">Ciudad *</span>
            <input
              type="text"
              name="region"
              defaultValue={c.region ?? ''}
              required
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-muted mb-1">Barrio</span>
            <input
              type="text"
              name="neighborhood"
              defaultValue={c.neighborhood ?? ''}
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-muted mb-1">Instagram</span>
            <input
              type="text"
              name="instagram"
              defaultValue={c.instagram_handle ? `instagram.com/${c.instagram_handle}` : ''}
              placeholder="instagram.com/handle"
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
            />
          </label>
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded text-[12.5px] font-medium hover:opacity-90 transition-opacity col-span-3 w-fit"
          >
            Guardar detalles
          </button>
        </form>
      </div>

      {/* Primer contacto: dispara follow-ups automaticos a 3 y 7 dias */}
      <div className="surface p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">Primer contacto</p>
        <p className="text-[12px] text-muted mb-3">
          Al guardar la fecha se crean (o reprograman) dos tasks de seguimiento: a los 3 y a los 7
          dias.
        </p>
        <form action={setFirstContactDate} className="flex items-center gap-2">
          <input type="hidden" name="company_id" value={c.id} />
          <input
            type="date"
            name="first_contact_date"
            defaultValue={c.first_contact_date ?? ''}
            required
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
          />
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded text-[12.5px] font-medium hover:opacity-90 transition-opacity"
          >
            Guardar
          </button>
        </form>

        {taskRows.length > 0 ? (
          <div className="mt-4 border-t border-[var(--border)] pt-3 space-y-1.5">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-1">Tareas</p>
            {taskRows.map((t) => (
              <form key={t.id} action={toggleTask} className="flex items-center gap-2">
                <input type="hidden" name="task_id" value={t.id} />
                <input type="hidden" name="company_id" value={c.id} />
                <input type="hidden" name="done" value={String(t.done)} />
                <button
                  type="submit"
                  className={`size-4 rounded border shrink-0 ${
                    t.done
                      ? 'bg-accent border-accent'
                      : 'border-[var(--border-strong)] bg-transparent'
                  }`}
                  aria-label={t.done ? 'Marcar pendiente' : 'Marcar hecho'}
                />
                <span className={`text-[13px] ${t.done ? 'text-muted line-through' : ''}`}>
                  {t.title}
                </span>
                {t.due_date ? (
                  <span className="text-[11.5px] text-muted">· {formatDate(t.due_date)}</span>
                ) : null}
              </form>
            ))}
          </div>
        ) : null}
      </div>

      {/* Owner + co-owners */}
      <div className="surface p-4 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">Owner</p>
          <form action={setOwner} className="flex items-center gap-2">
            <input type="hidden" name="company_id" value={c.id} />
            <select
              name="user_id"
              defaultValue={c.assigned_to ?? ''}
              className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
            >
              <option value="">Sin asignar</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded text-[12.5px] font-medium hover:opacity-90 transition-opacity"
            >
              Asignar
            </button>
          </form>
          {pendingHandoff ? (
            <p className="text-[12px] text-muted mt-2">
              → pasa a{' '}
              <strong>{ownerById.get(pendingHandoff.to_user_id)?.displayName ?? '?'}</strong> el{' '}
              {formatDate(pendingHandoff.effective_date)}
              {pendingHandoff.reason ? ` (${pendingHandoff.reason})` : ''}
            </p>
          ) : null}
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">
            Co-owners (leads compartidos)
          </p>
          {coOwnerIds.size === 0 ? (
            <p className="text-[12.5px] text-muted mb-2">Sin co-owners.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-2">
              {[...coOwnerIds].map((uid) => (
                <form key={uid} action={removeCoOwner} className="inline-flex">
                  <input type="hidden" name="company_id" value={c.id} />
                  <input type="hidden" name="user_id" value={uid} />
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] bg-[var(--surface-elevated)] border border-[var(--border)] hover:border-[oklch(0.55_0.18_25)] hover:text-[oklch(0.75_0.18_25)] transition-colors"
                    title="Quitar co-owner"
                  >
                    {ownerById.get(uid)?.displayName ?? uid} ×
                  </button>
                </form>
              ))}
            </div>
          )}
          {coOwnerCandidates.length > 0 ? (
            <form action={addCoOwner} className="flex items-center gap-2">
              <input type="hidden" name="company_id" value={c.id} />
              <select
                name="user_id"
                className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
              >
                {coOwnerCandidates.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 rounded text-[12.5px] font-medium border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors"
              >
                + Agregar co-owner
              </button>
            </form>
          ) : null}
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">
            Programar handoff
          </p>
          <p className="text-[12px] text-muted mb-3">
            Para vacaciones o renuncias — el owner cambia solo en la fecha elegida.
          </p>
          <form action={scheduleHandoff} className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <input type="hidden" name="company_id" value={c.id} />
            <label className="block">
              <span className="block text-[11px] text-muted mb-1">Handoff a</span>
              <select
                name="to_user_id"
                required
                className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
              >
                <option value="">Elegir...</option>
                {owners
                  .filter((o) => o.id !== c.assigned_to)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-muted mb-1">Fecha</span>
              <input
                type="date"
                name="effective_date"
                required
                className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
              />
            </label>
            <button
              type="submit"
              className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded text-[12.5px] font-medium hover:opacity-90 transition-opacity"
            >
              Programar
            </button>
            <label className="block col-span-3">
              <span className="block text-[11px] text-muted mb-1">Motivo (opcional)</span>
              <input
                type="text"
                name="reason"
                placeholder="ej. vacaciones, renuncia"
                className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
              />
            </label>
          </form>

          {handoffRows.length > 0 ? (
            <div className="mt-3 space-y-1">
              {handoffRows.map((h) => (
                <p key={h.id} className="text-[11.5px] text-muted">
                  {formatDate(h.effective_date)}:{' '}
                  {ownerById.get(h.from_user_id ?? '')?.displayName ?? 'sin asignar'} →{' '}
                  {ownerById.get(h.to_user_id)?.displayName ?? '?'}
                  {h.reason ? ` (${h.reason})` : ''} — {h.applied_at ? 'aplicado' : 'pendiente'}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Notas */}
      <div className="surface p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">Notas</p>
        <form action={addNote} className="flex items-start gap-2 mb-4">
          <input type="hidden" name="company_id" value={c.id} />
          <textarea
            name="body"
            required
            rows={2}
            placeholder="Agregar una nota..."
            className="flex-1 bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--border-strong)] resize-none"
          />
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-3 py-2 rounded text-[12.5px] font-medium hover:opacity-90 transition-opacity shrink-0"
          >
            Agregar
          </button>
        </form>
        {noteRows.length === 0 ? (
          <p className="text-[12.5px] text-muted">Sin notas todavia.</p>
        ) : (
          <div className="space-y-3">
            {noteRows.map((n) => (
              <div key={n.id} className="border-t border-[var(--border)] pt-3">
                <p className="text-[13px] whitespace-pre-wrap">{n.content}</p>
                <p className="text-[11px] text-muted mt-1">
                  {ownerById.get(n.performed_by ?? '')?.displayName ?? 'Desconocido'} ·{' '}
                  {formatDate(n.performed_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contactos */}
      <div className="surface p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-2">Contactos</p>
        {c.contacts.length === 0 ? (
          <p className="text-[12.5px] text-muted">Sin contactos.</p>
        ) : (
          <div className="space-y-1.5">
            {c.contacts.map((ct) => (
              <div key={ct.id} className="text-[13px]">
                <span className="font-medium">{ct.name}</span>
                {ct.role && <span className="text-muted"> · {ct.role}</span>}
                {ct.email && <span className="text-muted"> · {ct.email}</span>}
                {ct.phone && <span className="text-muted"> · {ct.phone}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
